const express = require('express');
module.exports = function (supabase) {
    const router = express.Router();

    // ─── GET /api/vendas ────────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor } = req.query;

            let query = supabase
                .from('vendas')
                .select('*')
                .order('numero_nf', { ascending: true });

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
                .from('vendas')
                .select('*')
                .eq('id', req.params.id)
                .single();
            if (error) return res.status(500).json({ error: error.message });
            if (!data)  return res.status(404).json({ error: 'Não encontrado' });
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── POST /api/vendas/sincronizar ───────────────────────────────────────────
    router.post('/sincronizar', async (req, res) => {
        let inseridos = 0, atualizados = 0, erros = 0;

        const normalizarStatusFrete = (status) => {
            const map = {
                'EM_TRANSITO':       'EM TRÂNSITO',
                'EM TRANSITO':       'EM TRÂNSITO',
                'ENTREGUE':          'ENTREGUE',
                'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
                'AGUARDANDO COLETA': 'AGUARDANDO COLETA',
                'EXTRAVIADO':        'EM TRÂNSITO',
            };
            return map[status] || status || 'EM TRÂNSITO';
        };

        try {
            // ── 1. CONTROLE DE FRETE ──────────────────────────────────────────
            const { data: fretes, error: fErr } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO","devolvido","devolucao","DEVOLUÇÃO")');

            if (fErr) {
                console.error('[vendas] Erro ao buscar controle_frete:', fErr.message);
                return res.status(500).json({ success: false, error: fErr.message });
            }
            console.log(`[vendas] Fretes encontrados: ${fretes?.length || 0}`);

            for (const f of (fretes || [])) {
                try {
                    const payload = {
                        numero_nf:         f.numero_nf,
                        origem:            'CONTROLE_FRETE',
                        data_emissao:      f.data_emissao     || null,
                        valor_nf:          parseFloat(f.valor_nf)   || 0,
                        tipo_nf:           f.tipo_nf          || null,
                        nome_orgao:        f.nome_orgao || f.orgao || null,
                        vendedor:          f.vendedor         || null,
                        documento:         f.documento        || null,
                        contato_orgao:     f.contato_orgao    || null,
                        transportadora:    f.transportadora   || null,
                        valor_frete:       parseFloat(f.valor_frete) || 0,
                        data_coleta:       f.data_coleta      || null,
                        cidade_destino:    f.cidade_destino   || null,
                        previsao_entrega:  f.previsao_entrega || null,
                        status_frete:      normalizarStatusFrete(f.status),
                        id_controle_frete: Number.isInteger(Number(f.id)) ? Number(f.id) : null,
                        updated_at:        new Date().toISOString(),
                    };

                    const { data: exist, error: eErr } = await supabase
                        .from('vendas').select('id')
                        .eq('numero_nf', f.numero_nf)
                        .eq('vendedor',  f.vendedor || '')
                        .maybeSingle();
                    if (eErr) throw eErr;

                    if (exist) {
                        const { error: uErr } = await supabase.from('vendas').update(payload).eq('id', exist.id);
                        if (uErr) throw uErr;
                        atualizados++;
                    } else {
                        const { error: iErr } = await supabase.from('vendas').insert([{ ...payload, prioridade: 1 }]);
                        if (iErr) throw iErr;
                        inseridos++;
                    }
                } catch (err) {
                    console.error(`[vendas] Erro frete NF ${f.numero_nf}:`, err.message);
                    erros++;
                }
            }

            // ── 2. CONTAS A RECEBER ───────────────────────────────────────────
            const { data: contas, error: cErr } = await supabase
                .from('contas_receber')
                .select('*');

            if (cErr) {
                console.error('[vendas] Erro ao buscar contas_receber:', cErr.message);
            } else {
                console.log(`[vendas] Contas a receber encontradas: ${contas?.length || 0}`);

                for (const c of (contas || [])) {
                    try {
                        // ── Processa parcelas do campo observacoes ──────────
                        // Esperado: { parcelas: [{ numero, valor, data_pagamento }, ...] }
                        let valorPago       = parseFloat(c.valor_pago) || 0;
                        let metaParcelas    = null;
                        let dataPagamento   = c.data_pagamento || null;
                        let statusPagamento = c.status || 'A RECEBER';

                        try {
                            const obs = c.observacoes;
                            if (obs) {
                                const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
                                if (Array.isArray(parsed?.parcelas) && parsed.parcelas.length > 0) {
                                    const parcelas = parsed.parcelas;

                                    // Soma de todas as parcelas pagas
                                    valorPago = parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);

                                    // Última parcela = maior número
                                    const ultima = parcelas.reduce((prev, curr) =>
                                        (parseInt(curr.numero) || 0) >= (parseInt(prev.numero) || 0) ? curr : prev
                                    );

                                    // Data de pagamento = data da última parcela
                                    dataPagamento = ultima.data_pagamento || dataPagamento;

                                    // Guarda metadados de parcelas em observacoes da tabela vendas
                                    metaParcelas = JSON.stringify({
                                        total:         parcelas.length,
                                        ultima_num:    parseInt(ultima.numero) || parcelas.length,
                                        ultima_valor:  parseFloat(ultima.valor) || 0,
                                    });
                                }
                            }
                        } catch (_) { /* mantém valores originais */ }

                        // UUID → bigint: só grava se for inteiro curto
                        const idContasReceber = (!isNaN(Number(c.id)) && String(c.id).length < 15)
                            ? Number(c.id)
                            : null;

                        const payFields = {
                            banco:             c.banco           || null,
                            data_vencimento:   c.data_vencimento || null,
                            data_pagamento:    dataPagamento,
                            status_pagamento:  statusPagamento,
                            valor_pago:        valorPago,
                            observacoes:       metaParcelas,
                            id_contas_receber: idContasReceber,
                            updated_at:        new Date().toISOString(),
                        };

                        const { data: exist, error: eErr } = await supabase
                            .from('vendas').select('id')
                            .eq('numero_nf', c.numero_nf)
                            .eq('vendedor',  c.vendedor || '')
                            .maybeSingle();
                        if (eErr) throw eErr;

                        if (exist) {
                            const { error: uErr } = await supabase.from('vendas').update(payFields).eq('id', exist.id);
                            if (uErr) throw uErr;
                            atualizados++;
                        } else {
                            const novo = {
                                numero_nf:    c.numero_nf,
                                origem:       'CONTAS_RECEBER',
                                data_emissao: c.data_emissao || null,
                                valor_nf:     parseFloat(c.valor) || 0,
                                tipo_nf:      c.tipo_nf || null,
                                nome_orgao:   c.nome_orgao || c.orgao || null,
                                vendedor:     c.vendedor || null,
                                status_frete: null,
                                ...payFields,
                                prioridade:   1,
                            };
                            const { error: iErr } = await supabase.from('vendas').insert([novo]);
                            if (iErr) throw iErr;
                            inseridos++;
                        }
                    } catch (err) {
                        console.error(`[vendas] Erro conta NF ${c.numero_nf}:`, err.message);
                        erros++;
                    }
                }
            }

            const msg = `${inseridos} inseridos, ${atualizados} atualizados${erros ? `, ${erros} erros` : ''}`;
            console.log(`[vendas] Sync concluído: ${msg}`);
            res.json({ success: true, message: msg, inseridos, atualizados, erros });

        } catch (err) {
            console.error('[vendas] Erro geral na sync:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
