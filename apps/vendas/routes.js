const express = require('express');
module.exports = function (supabase) {
    const router = express.Router();

    // ─── GET /api/vendas ────────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor, status_frete, status_pagamento } = req.query;

            let query = supabase
                .from('vendas')
                .select('*')
                .order('numero_nf', { ascending: true });

            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }
            if (vendedor)         query = query.eq('vendedor', vendedor);
            if (status_frete)     query = query.eq('status_frete', status_frete);
            if (status_pagamento) query = query.eq('status_pagamento', status_pagamento);

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

        // Mapa de status do controle_frete → texto exibido
        const statusFreteMap = {
            'EM_TRANSITO':       'EM TRÂNSITO',
            'ENTREGUE':          'ENTREGUE',
            'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
            'EXTRAVIADO':        'EXTRAVIADO',
            // valores já no formato texto (caso já estejam assim no banco)
            'EM TRÂNSITO':       'EM TRÂNSITO',
            'AGUARDANDO COLETA': 'AGUARDANDO COLETA',
        };

        try {
            // ── 1. CONTROLE DE FRETE ──────────────────────────────────────────
            // Traz TODOS os fretes exceto devolvidos (múltiplos formatos do valor)
            const { data: fretes, error: fErr } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO","devolvido","devolucao")');

            if (fErr) {
                console.error('[vendas] Erro ao buscar controle_frete:', fErr.message);
                return res.status(500).json({ success: false, error: fErr.message });
            }

            console.log(`[vendas] Fretes encontrados: ${fretes?.length || 0}`);

            for (const f of (fretes || [])) {
                try {
                    const statusFrete = statusFreteMap[f.status] || f.status || 'EM TRÂNSITO';

                    const payload = {
                        numero_nf:        f.numero_nf,
                        origem:           'CONTROLE_FRETE',
                        data_emissao:     f.data_emissao   || null,
                        valor_nf:         parseFloat(f.valor_nf)    || 0,
                        tipo_nf:          f.tipo_nf        || null,
                        nome_orgao:       f.nome_orgao     || f.orgao || null,
                        vendedor:         f.vendedor       || null,
                        documento:        f.documento      || null,
                        contato_orgao:    f.contato_orgao  || null,
                        transportadora:   f.transportadora || null,
                        valor_frete:      parseFloat(f.valor_frete)  || 0,
                        data_coleta:      f.data_coleta    || null,
                        cidade_destino:   f.cidade_destino || null,
                        previsao_entrega: f.previsao_entrega || null,
                        status_frete:     statusFrete,
                        id_controle_frete: f.id,
                        updated_at:       new Date().toISOString(),
                    };

                    // Verifica se já existe pelo índice único numero_nf + vendedor
                    const { data: exist, error: eErr } = await supabase
                        .from('vendas')
                        .select('id, status_pagamento')
                        .eq('numero_nf', f.numero_nf)
                        .eq('vendedor',  f.vendedor || '')
                        .maybeSingle();

                    if (eErr) throw eErr;

                    if (exist) {
                        // Atualiza campos de frete, preserva dados de pagamento
                        const { error: uErr } = await supabase
                            .from('vendas')
                            .update(payload)
                            .eq('id', exist.id);
                        if (uErr) throw uErr;
                        atualizados++;
                    } else {
                        const { error: iErr } = await supabase
                            .from('vendas')
                            .insert([{ ...payload, prioridade: 1 }]);
                        if (iErr) throw iErr;
                        inseridos++;
                    }
                } catch (itemErr) {
                    console.error(`[vendas] Erro frete NF ${f.numero_nf}:`, itemErr.message);
                    erros++;
                }
            }

            // ── 2. CONTAS A RECEBER ───────────────────────────────────────────
            // IMPORTANTE: traz TODOS os status (PAGO, A RECEBER, PARCELA, etc.)
            // para que o painel mostre também os valores a receber
            const { data: contas, error: cErr } = await supabase
                .from('contas_receber')
                .select('*');

            if (cErr) {
                console.error('[vendas] Erro ao buscar contas_receber:', cErr.message);
                // Não aborta — continua com o que já foi sincronizado
            } else {
                console.log(`[vendas] Contas a receber encontradas: ${contas?.length || 0}`);

                for (const c of (contas || [])) {
                    try {
                        // Calcula valor pago (considera parcelas no campo observacoes)
                        let valorPago = parseFloat(c.valor_pago) || 0;
                        try {
                            const obs = c.observacoes;
                            if (obs) {
                                const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
                                if (Array.isArray(parsed?.parcelas) && parsed.parcelas.length) {
                                    valorPago = parsed.parcelas.reduce(
                                        (s, p) => s + parseFloat(p.valor || 0), 0
                                    );
                                }
                            }
                        } catch (_) { /* mantém valor original */ }

                        // id_contas_receber na tabela vendas é bigint,
                        // mas contas_receber pode usar UUID como id.
                        // Só gravamos se o valor for um inteiro válido.
                        const idContasReceber = Number.isInteger(Number(c.id)) && !isNaN(Number(c.id))
                            ? Number(c.id)
                            : null;

                        // Campos de pagamento que serão gravados / atualizados
                        const payFields = {
                            banco:              c.banco            || null,
                            data_vencimento:    c.data_vencimento  || null,
                            data_pagamento:     c.data_pagamento   || null,
                            status_pagamento:   c.status           || 'A RECEBER',
                            valor_pago:         valorPago,
                            id_contas_receber:  idContasReceber,
                            updated_at:         new Date().toISOString(),
                        };

                        const { data: exist, error: eErr } = await supabase
                            .from('vendas')
                            .select('id')
                            .eq('numero_nf', c.numero_nf)
                            .eq('vendedor',  c.vendedor || '')
                            .maybeSingle();

                        if (eErr) throw eErr;

                        if (exist) {
                            // Já existe (veio do frete ou entrada anterior) → atualiza só pagamento
                            const { error: uErr } = await supabase
                                .from('vendas')
                                .update(payFields)
                                .eq('id', exist.id);
                            if (uErr) throw uErr;
                            atualizados++;
                        } else {
                            // Não existe: cria entrada vinda apenas de contas_receber
                            const novo = {
                                numero_nf:       c.numero_nf,
                                origem:          'CONTAS_RECEBER',
                                data_emissao:    c.data_emissao || null,
                                valor_nf:        parseFloat(c.valor) || 0,
                                tipo_nf:         c.tipo_nf  || null,
                                // campo orgao OU nome_orgao dependendo da tabela
                                nome_orgao:      c.nome_orgao || c.orgao || null,
                                vendedor:        c.vendedor || null,
                                status_frete:    null,
                                ...payFields,
                                prioridade:      1,
                            };
                            const { error: iErr } = await supabase
                                .from('vendas')
                                .insert([novo]);
                            if (iErr) throw iErr;
                            inseridos++;
                        }
                    } catch (itemErr) {
                        console.error(`[vendas] Erro conta NF ${c.numero_nf}:`, itemErr.message);
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
