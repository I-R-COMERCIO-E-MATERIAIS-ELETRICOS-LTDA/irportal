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

            // Filtro de vendedor (reforço no backend além do frontend)
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

        const normalizarStatusFrete = (s) => ({
            'EM_TRANSITO':       'EM TRÂNSITO',
            'EM TRANSITO':       'EM TRÂNSITO',
            'ENTREGUE':          'ENTREGUE',
            'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
            'AGUARDANDO COLETA': 'AGUARDANDO COLETA',
            'EXTRAVIADO':        'EM TRÂNSITO',
        }[s] || s || 'EM TRÂNSITO');

        try {
            // ── 1. CONTROLE DE FRETE ──────────────────────────────────────────
            const { data: fretes, error: fErr } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO","devolvido","devolucao","DEVOLUÇÃO")');

            if (fErr) {
                console.error('[vendas] Erro controle_frete:', fErr.message);
                return res.status(500).json({ success: false, error: fErr.message });
            }
            console.log(`[vendas] Fretes: ${fretes?.length || 0}`);

            for (const f of (fretes || [])) {
                try {
                    const payload = {
                        numero_nf:         f.numero_nf,
                        origem:            'CONTROLE_FRETE',
                        data_emissao:      f.data_emissao      || null,
                        valor_nf:          parseFloat(f.valor_nf)    || 0,
                        tipo_nf:           f.tipo_nf           || null,
                        nome_orgao:        f.nome_orgao || f.orgao   || null,
                        vendedor:          f.vendedor          || null,
                        documento:         f.documento         || null,
                        contato_orgao:     f.contato_orgao     || null,
                        transportadora:    f.transportadora    || null,
                        valor_frete:       parseFloat(f.valor_frete) || 0,
                        data_coleta:       f.data_coleta       || null,
                        cidade_destino:    f.cidade_destino    || null,
                        previsao_entrega:  f.previsao_entrega  || null,
                        status_frete:      normalizarStatusFrete(f.status),
                        id_controle_frete: Number.isInteger(Number(f.id)) ? Number(f.id) : null,
                        updated_at:        new Date().toISOString(),
                    };

                    const { data: exist } = await supabase
                        .from('vendas').select('id')
                        .eq('numero_nf', f.numero_nf)
                        .eq('vendedor',  f.vendedor || '')
                        .maybeSingle();

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
                console.error('[vendas] Erro contas_receber:', cErr.message);
            } else {
                console.log(`[vendas] Contas: ${contas?.length || 0}`);

                for (const c of (contas || [])) {
                    try {
                        // ── Parcelas ────────────────────────────────────────
                        let valorPago      = parseFloat(c.valor_pago) || 0;
                        let dataPagamento  = c.data_pagamento || null;
                        let metaParcelas   = null;

                        try {
                            const obs = c.observacoes;
                            if (obs) {
                                const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
                                if (Array.isArray(parsed?.parcelas) && parsed.parcelas.length > 0) {
                                    const parcelas = parsed.parcelas;
                                    valorPago = parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);

                                    // Última parcela = maior número
                                    const ultima = parcelas.reduce((prev, curr) =>
                                        (parseInt(curr.numero) || 0) >= (parseInt(prev.numero) || 0) ? curr : prev
                                    );
                                    dataPagamento = ultima.data_pagamento || dataPagamento;
                                    metaParcelas  = JSON.stringify({
                                        total:        parcelas.length,
                                        ultima_num:   parseInt(ultima.numero) || parcelas.length,
                                        ultima_valor: parseFloat(ultima.valor) || 0,
                                    });
                                }
                            }
                        } catch (_) {}

                        // UUID → bigint: só grava se for inteiro curto
                        const idCR = (!isNaN(Number(c.id)) && String(c.id).length < 15)
                            ? Number(c.id) : null;

                        const payFields = {
                            banco:             c.banco           || null,
                            data_vencimento:   c.data_vencimento || null,
                            data_pagamento:    dataPagamento,
                            status_pagamento:  c.status          || 'A RECEBER',
                            valor_pago:        valorPago,
                            observacoes:       metaParcelas,
                            id_contas_receber: idCR,
                            updated_at:        new Date().toISOString(),
                        };

                        const { data: exist } = await supabase
                            .from('vendas').select('id')
                            .eq('numero_nf', c.numero_nf)
                            .eq('vendedor',  c.vendedor || '')
                            .maybeSingle();

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
            console.log(`[vendas] Sync: ${msg}`);
            res.json({ success: true, message: msg, inseridos, atualizados, erros });

        } catch (err) {
            console.error('[vendas] Erro geral sync:', err);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
