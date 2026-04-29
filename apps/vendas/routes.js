const express = require('express');
module.exports = function (supabase) {
    const router = express.Router();

    // ─── GET /api/vendas ────────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor } = req.query;
            let query = supabase.from('vendas').select('*').order('numero_nf', { ascending: true });

            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim    = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }
            if (vendedor) query = query.eq('vendedor', vendedor);

            const { data, error } = await query;
            if (error) throw error;
            res.json(data || []);
        } catch (e) {
            console.error('[vendas] GET /:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ─── GET /api/vendas/:id ────────────────────────────────────────────────────
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('vendas').select('*').eq('id', req.params.id).single();
            if (error) return res.status(500).json({ error: error.message });
            if (!data)  return res.status(404).json({ error: 'Não encontrado' });
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── POST /api/vendas/sincronizar ───────────────────────────────────────────
    router.post('/sincronizar', async (req, res) => {

        const normFrete = s => ({
            'EM_TRANSITO':       'EM TRÂNSITO',
            'EM TRANSITO':       'EM TRÂNSITO',
            'ENTREGUE':          'ENTREGUE',
            'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
            'AGUARDANDO COLETA': 'AGUARDANDO COLETA',
            'EXTRAVIADO':        'EM TRÂNSITO',
        }[s] || s || 'EM TRÂNSITO');

        // Chave de merge — nunca deixa vendedor undefined/null para evitar conflito
        const chave = (nf, vend) => `${(nf || '').trim()}||${(vend || '').toUpperCase().trim()}`;

        try {
            // ── 1. Busca as duas fontes em paralelo ───────────────────────────
            const [fretesRes, contasRes] = await Promise.all([
                supabase.from('controle_frete').select('*')
                    .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO","devolvido","devolucao","DEVOLUÇÃO","DEVOLUÇAO")'),
                supabase.from('contas_receber').select('*'),
            ]);

            if (fretesRes.error) throw new Error('controle_frete: ' + fretesRes.error.message);

            const fretes = fretesRes.data || [];
            const contas = contasRes.data || [];
            console.log(`[vendas] Fretes: ${fretes.length} | Contas: ${contas.length}`);

            // ── 2. Monta mapa de frete (base) ─────────────────────────────────
            const mapaFinal = {};
            for (const f of fretes) {
                const k = chave(f.numero_nf, f.vendedor);
                mapaFinal[k] = {
                    numero_nf:         (f.numero_nf || '').trim(),
                    origem:            'CONTROLE_FRETE',
                    data_emissao:      f.data_emissao     || null,
                    valor_nf:          parseFloat(f.valor_nf)   || 0,
                    tipo_nf:           f.tipo_nf          || null,
                    nome_orgao:        f.nome_orgao || f.orgao  || null,
                    vendedor:          f.vendedor         || null,
                    documento:         f.documento        || null,
                    contato_orgao:     f.contato_orgao    || null,
                    transportadora:    f.transportadora   || null,
                    valor_frete:       parseFloat(f.valor_frete) || 0,
                    data_coleta:       f.data_coleta      || null,
                    cidade_destino:    f.cidade_destino   || null,
                    previsao_entrega:  f.previsao_entrega || null,
                    status_frete:      normFrete(f.status),
                    id_controle_frete: (!isNaN(Number(f.id)) && String(f.id).length < 15) ? Number(f.id) : null,
                    // Campos de pagamento — serão sobrescritos se houver entrada em contas_receber
                    status_pagamento:  null,
                    banco:             null,
                    data_vencimento:   null,
                    data_pagamento:    null,
                    valor_pago:        0,
                    observacoes:       null,
                    id_contas_receber: null,
                    prioridade:        1,
                    updated_at:        new Date().toISOString(),
                };
            }

            // ── 3. Aplica dados de contas_receber sobre o mapa ────────────────
            for (const c of contas) {
                // Processa parcelas — suporta múltiplos formatos do campo observacoes
                let valorPago     = parseFloat(c.valor_pago) || 0;
                let dataPagamento = c.data_pagamento || null;
                let metaStr       = null;

                try {
                    const raw = c.observacoes;
                    if (raw) {
                        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;

                        // Formato 1: { parcelas: [{ numero, valor, data_pagamento }] }
                        if (Array.isArray(parsed?.parcelas) && parsed.parcelas.length > 0) {
                            const parcelas = parsed.parcelas;
                            valorPago = parcelas.reduce((s, p) => s + parseFloat(p.valor || p.valor_parcela || 0), 0);
                            // Última parcela = maior número OU último índice
                            const ultima = parcelas.reduce((prev, curr) => {
                                const nP = parseInt(prev.numero || prev.num || 0);
                                const nC = parseInt(curr.numero || curr.num || 0);
                                return nC >= nP ? curr : prev;
                            });
                            dataPagamento = ultima.data_pagamento || ultima.data || dataPagamento;
                            metaStr = JSON.stringify({
                                total:        parcelas.length,
                                ultima_num:   parseInt(ultima.numero || ultima.num || parcelas.length),
                                ultima_valor: parseFloat(ultima.valor || ultima.valor_parcela || 0),
                            });
                        }
                        // Formato 2: array direto de parcelas
                        else if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.valor !== undefined) {
                            const parcelas = parsed;
                            valorPago = parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
                            const ultima = parcelas[parcelas.length - 1];
                            dataPagamento = ultima.data_pagamento || ultima.data || dataPagamento;
                            metaStr = JSON.stringify({
                                total:        parcelas.length,
                                ultima_num:   parcelas.length,
                                ultima_valor: parseFloat(ultima.valor || 0),
                            });
                        }
                    }
                } catch (_) { /* mantém valores originais */ }

                const idCR = (!isNaN(Number(c.id)) && String(c.id).length < 15) ? Number(c.id) : null;
                const k    = chave(c.numero_nf, c.vendedor);

                const pgto = {
                    status_pagamento:  c.status          || 'A RECEBER',
                    banco:             c.banco            || null,
                    data_vencimento:   c.data_vencimento  || null,
                    data_pagamento:    dataPagamento,
                    valor_pago:        valorPago,
                    observacoes:       metaStr,
                    id_contas_receber: idCR,
                };

                if (mapaFinal[k]) {
                    // Merge: enriquece o registro de frete com dados de pagamento
                    Object.assign(mapaFinal[k], pgto);
                    mapaFinal[k].updated_at = new Date().toISOString();
                } else {
                    // Cria registro exclusivo de contas_receber (sem frete associado)
                    mapaFinal[k] = {
                        numero_nf:    (c.numero_nf || '').trim(),
                        origem:       'CONTAS_RECEBER',
                        data_emissao: c.data_emissao || null,
                        valor_nf:     parseFloat(c.valor) || 0,
                        tipo_nf:      c.tipo_nf || null,
                        nome_orgao:   c.nome_orgao || c.orgao || null,
                        vendedor:     c.vendedor || null,
                        status_frete: null,
                        ...pgto,
                        id_controle_frete: null,
                        prioridade:        1,
                        updated_at:        new Date().toISOString(),
                    };
                }
            }

            const registros = Object.values(mapaFinal);
            if (!registros.length) {
                return res.json({ success: true, message: '0 registros sincronizados' });
            }

            // ── 4. Upsert em lote (chunks de 200) ─────────────────────────────
            // O índice único vendas_nf_vendedor_idx (numero_nf, vendedor) garante merge correto
            const CHUNK = 200;
            let   erros = 0;
            for (let i = 0; i < registros.length; i += CHUNK) {
                const chunk = registros.slice(i, i + CHUNK);
                const { error: uErr } = await supabase
                    .from('vendas')
                    .upsert(chunk, { onConflict: 'numero_nf,vendedor', ignoreDuplicates: false });
                if (uErr) {
                    console.error(`[vendas] Upsert chunk ${i}:`, uErr.message);
                    erros++;
                }
            }

            const msg = `${registros.length} registros sincronizados${erros ? ` (${erros} chunks com erro)` : ''}`;
            console.log('[vendas] Sync:', msg);
            res.json({ success: erros === 0, message: msg, total: registros.length });

        } catch (err) {
            console.error('[vendas] Erro geral sync:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
