// ============================================
// VENDAS ROUTES — /api/vendas
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── LISTAR VENDAS ───────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor, status_frete, status_pagamento } = req.query;

            let query = supabase
                .from('vendas')
                .select('*')
                .order('data_emissao', { ascending: false });

            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }

            if (vendedor) query = query.eq('vendedor', vendedor.toUpperCase());
            if (status_frete) query = query.eq('status_frete', status_frete);
            if (status_pagamento) query = query.eq('status_pagamento', status_pagamento);

            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('[vendas] GET /:', err.message);
            res.status(500).json({ error: 'Erro ao listar vendas' });
        }
    });

    // ─── BUSCAR POR ID ───────────────────────────────────────────────────────
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('vendas')
                .select('*')
                .eq('id', req.params.id)
                .single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Venda não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('[vendas] GET /:id:', err.message);
            res.status(500).json({ error: 'Erro ao buscar venda' });
        }
    });

    // ─── SINCRONIZAR (MERGE DE CONTROLE_FRETE + CONTAS_RECEBER) ─────────────
    router.post('/sincronizar', async (req, res) => {
        try {
            let inseridos = 0, atualizados = 0;

            // 1. Processar fretes (todos, exceto devoluções)
            const { data: fretes, error: erroFrete } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO")');

            if (erroFrete) throw erroFrete;

            for (const f of fretes) {
                const statusFreteMap = {
                    'EM_TRANSITO': 'EM TRÂNSITO',
                    'ENTREGUE': 'ENTREGUE',
                    'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
                    'EXTRAVIADO': 'EXTRAVIADO'
                };

                const payload = {
                    numero_nf: f.numero_nf,
                    origem: 'CONTROLE_FRETE',
                    data_emissao: f.data_emissao,
                    valor_nf: parseFloat(f.valor_nf) || 0,
                    tipo_nf: f.tipo_nf || null,
                    nome_orgao: f.nome_orgao,
                    vendedor: f.vendedor,
                    documento: f.documento || null,
                    contato_orgao: f.contato_orgao || null,
                    transportadora: f.transportadora || null,
                    valor_frete: parseFloat(f.valor_frete) || 0,
                    data_coleta: f.data_coleta || null,
                    cidade_destino: f.cidade_destino || null,
                    previsao_entrega: f.previsao_entrega || null,
                    status_frete: statusFreteMap[f.status] || f.status || null,
                    id_controle_frete: f.id,
                    updated_at: new Date().toISOString()
                };

                // Upsert por numero_nf + vendedor
                const { data: existente } = await supabase
                    .from('vendas')
                    .select('id')
                    .eq('numero_nf', f.numero_nf)
                    .eq('vendedor', f.vendedor)
                    .maybeSingle();

                if (existente) {
                    const { error: upErr } = await supabase
                        .from('vendas')
                        .update(payload)
                        .eq('id', existente.id);
                    if (!upErr) atualizados++;
                } else {
                    const { error: insErr } = await supabase
                        .from('vendas')
                        .insert([{ ...payload, prioridade: 1 }]);
                    if (!insErr) inseridos++;
                }
            }

            // 2. Processar contas a receber (apenas PAGO ou que contenham PARCELA)
            const { data: contas, error: erroContas } = await supabase
                .from('contas_receber')
                .select('*')
                .or('status.eq.PAGO,status.ilike.%PARCELA%');

            if (erroContas) throw erroContas;

            for (const c of contas) {
                // Calcular valor_pago a partir das parcelas, se houver
                let valorPago = parseFloat(c.valor_pago) || 0;
                try {
                    const obs = c.observacoes;
                    if (obs) {
                        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
                        if (parsed && Array.isArray(parsed.parcelas) && parsed.parcelas.length > 0) {
                            valorPago = parsed.parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
                        }
                    }
                } catch {}

                const payloadPgto = {
                    banco: c.banco || null,
                    data_vencimento: c.data_vencimento || null,
                    data_pagamento: c.data_pagamento || null,
                    status_pagamento: c.status || 'A RECEBER',
                    valor_pago: valorPago,
                    id_contas_receber: c.id,
                    updated_at: new Date().toISOString()
                };

                const { data: existente } = await supabase
                    .from('vendas')
                    .select('id, origem')
                    .eq('numero_nf', c.numero_nf)
                    .eq('vendedor', c.vendedor)
                    .maybeSingle();

                if (existente) {
                    // Se já existe (veio do frete), só atualiza campos de pagamento
                    const update = { ...payloadPgto };
                    // Não sobrescreve a origem
                    const { error: upErr } = await supabase
                        .from('vendas')
                        .update(update)
                        .eq('id', existente.id);
                    if (!upErr) atualizados++;
                } else {
                    // Se não existe, insere novo registro com dados de receber + campos de frete vazios
                    const novo = {
                        numero_nf: c.numero_nf,
                        origem: 'CONTAS_RECEBER',
                        data_emissao: c.data_emissao,
                        valor_nf: parseFloat(c.valor) || 0,
                        tipo_nf: c.tipo_nf || null,
                        nome_orgao: c.orgao,
                        vendedor: c.vendedor,
                        ...payloadPgto,
                        prioridade: 1
                    };
                    const { error: insErr } = await supabase
                        .from('vendas')
                        .insert([novo]);
                    if (!insErr) inseridos++;
                }
            }

            console.log(`[vendas] Sync: ${inseridos} inseridos, ${atualizados} atualizados`);
            res.json({
                success: true,
                message: `Sincronização concluída: ${inseridos} inseridos, ${atualizados} atualizados`
            });
        } catch (err) {
            console.error('[vendas] Erro na sincronização:', err.message);
            res.status(500).json({ error: 'Erro na sincronização', details: err.message });
        }
    });

    return router;
};
