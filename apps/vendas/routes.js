const express = require('express');
module.exports = function (supabase) {
    const router = express.Router();

    // ─── GET / — Lista vendas com filtros opcionais ───────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor, status_frete, status_pagamento } = req.query;
            let query = supabase.from('vendas').select('*').order('data_emissao', { ascending: false });

            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }

            if (vendedor) query = query.eq('vendedor', vendedor);
            if (status_frete) query = query.eq('status_frete', status_frete);
            if (status_pagamento) query = query.eq('status_pagamento', status_pagamento);

            const { data, error } = await query;
            if (error) throw error;
            res.json(data || []);
        } catch (e) {
            console.error('[vendas] GET /:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ─── GET /:id — Busca uma venda por ID ────────────────────────────────────
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('vendas')
                .select('*')
                .eq('id', req.params.id)
                .single();
            if (error) return res.status(500).json({ error: error.message });
            if (!data) return res.status(404).json({ error: 'Não encontrado' });
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─── POST /sincronizar — Sincroniza frete + contas a receber ─────────────
    router.post('/sincronizar', async (req, res) => {
        try {
            let inseridos = 0, atualizados = 0, erros = 0;

            // ── 1. CONTROLE DE FRETE ─────────────────────────────────────────
            // CORREÇÃO: sintaxe correta para NOT IN no Supabase JS client
            const { data: fretes, error: fErr } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '(DEVOLVIDO,DEVOLUCAO,DEVOLU\u00C7\u00C3O)');

            if (fErr) {
                console.error('[vendas] Erro ao buscar fretes:', fErr.message);
                throw fErr;
            }

            console.log(`[vendas] Fretes encontrados: ${fretes?.length || 0}`);

            // Mapeamento de status do controle_frete → vendas
            const statusFreteMap = {
                'EM_TRANSITO':       'EM TRÂNSITO',
                'EM TRANSITO':       'EM TRÂNSITO',
                'EM_TRÂNSITO':       'EM TRÂNSITO',
                'EM TRÂNSITO':       'EM TRÂNSITO',
                'ENTREGUE':          'ENTREGUE',
                'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
                'AGUARDANDO COLETA': 'AGUARDANDO COLETA',
                'EXTRAVIADO':        'EXTRAVIADO',
                'SIMPLES_REMESSA':   'SIMPLES REMESSA',
                'SIMPLES REMESSA':   'SIMPLES REMESSA',
                'REMESSA_AMOSTRA':   'REMESSA DE AMOSTRA',
                'REMESSA DE AMOSTRA':'REMESSA DE AMOSTRA',
            };

            for (const f of (fretes || [])) {
                try {
                    const statusNormalizado = statusFreteMap[f.status] || f.status || null;

                    const payload = {
                        numero_nf:        f.numero_nf,
                        origem:           'CONTROLE_FRETE',
                        data_emissao:     f.data_emissao,
                        valor_nf:         parseFloat(f.valor_nf) || 0,
                        tipo_nf:          f.tipo_nf || null,
                        nome_orgao:       f.nome_orgao || null,
                        vendedor:         f.vendedor || null,
                        documento:        f.documento || null,
                        contato_orgao:    f.contato_orgao || null,
                        transportadora:   f.transportadora || null,
                        valor_frete:      parseFloat(f.valor_frete) || 0,
                        data_coleta:      f.data_coleta || null,
                        cidade_destino:   f.cidade_destino || null,
                        previsao_entrega: f.previsao_entrega || null,
                        status_frete:     statusNormalizado,
                        id_controle_frete: f.id,
                        updated_at:       new Date().toISOString()
                    };

                    const { data: exist } = await supabase
                        .from('vendas')
                        .select('id')
                        .eq('numero_nf', f.numero_nf)
                        .eq('vendedor', f.vendedor)
                        .maybeSingle();

                    if (exist) {
                        const { error: upErr } = await supabase
                            .from('vendas')
                            .update(payload)
                            .eq('id', exist.id);
                        if (upErr) throw upErr;
                        atualizados++;
                    } else {
                        const { error: insErr } = await supabase
                            .from('vendas')
                            .insert([{ ...payload, prioridade: 1 }]);
                        if (insErr) throw insErr;
                        inseridos++;
                    }
                } catch (loopErr) {
                    console.error(`[vendas] Erro no frete NF ${f.numero_nf}:`, loopErr.message);
                    erros++;
                }
            }

            // ── 2. CONTAS A RECEBER ──────────────────────────────────────────
            // CORREÇÃO: usar filter com OR explícito — Supabase aceita .or()
            const { data: contas, error: cErr } = await supabase
                .from('contas_receber')
                .select('*')
                .or('status.eq.PAGO,status.ilike.%PARCELA%,status.eq.A RECEBER');

            if (cErr) {
                console.error('[vendas] Erro ao buscar contas:', cErr.message);
                throw cErr;
            }

            console.log(`[vendas] Contas encontradas: ${contas?.length || 0}`);

            for (const c of (contas || [])) {
                try {
                    // Calcula valor pago (considera parcelas no JSON de observações)
                    let valorPago = parseFloat(c.valor_pago) || 0;
                    try {
                        const obs = c.observacoes;
                        if (obs) {
                            const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
                            if (parsed?.parcelas?.length) {
                                valorPago = parsed.parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
                            }
                        }
                    } catch { /* ignora erros de parse */ }

                    const paymentPayload = {
                        banco:              c.banco || null,
                        data_vencimento:    c.data_vencimento || null,
                        data_pagamento:     c.data_pagamento || null,
                        status_pagamento:   c.status || null,
                        valor_pago:         valorPago,
                        id_contas_receber:  c.id,
                        updated_at:         new Date().toISOString()
                    };

                    const { data: exist } = await supabase
                        .from('vendas')
                        .select('id')
                        .eq('numero_nf', c.numero_nf)
                        .eq('vendedor', c.vendedor)
                        .maybeSingle();

                    if (exist) {
                        const { error: upErr } = await supabase
                            .from('vendas')
                            .update(paymentPayload)
                            .eq('id', exist.id);
                        if (upErr) throw upErr;
                        atualizados++;
                    } else {
                        // Cria registro novo caso não exista pelo frete
                        const novo = {
                            numero_nf:   c.numero_nf,
                            origem:      'CONTAS_RECEBER',
                            data_emissao: c.data_emissao || null,
                            valor_nf:    parseFloat(c.valor) || 0,
                            tipo_nf:     c.tipo_nf || null,
                            nome_orgao:  c.orgao || c.nome_orgao || null,
                            vendedor:    c.vendedor || null,
                            prioridade:  1,
                            ...paymentPayload
                        };
                        const { error: insErr } = await supabase
                            .from('vendas')
                            .insert([novo]);
                        if (insErr) throw insErr;
                        inseridos++;
                    }
                } catch (loopErr) {
                    console.error(`[vendas] Erro na conta NF ${c.numero_nf}:`, loopErr.message);
                    erros++;
                }
            }

            const msg = `${inseridos} inseridos, ${atualizados} atualizados${erros ? `, ${erros} erros` : ''}`;
            console.log(`[vendas] Sync concluído: ${msg}`);
            res.json({ success: true, message: msg, inseridos, atualizados, erros });

        } catch (err) {
            console.error('[vendas] Erro crítico no sync:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
