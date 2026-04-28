// ============================================
// VENDAS ROUTES — /api/vendas
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── LISTAR VENDAS ───────────────────────────────────────────────────────────
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
            console.error('Erro ao listar vendas:', err.message);
            res.status(500).json({ error: 'Erro ao listar vendas' });
        }
    });

    // ─── BUSCAR VENDA POR ID ─────────────────────────────────────────────────────
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
            console.error('Erro ao buscar venda:', err.message);
            res.status(500).json({ error: 'Erro ao buscar venda' });
        }
    });

    // ─── SINCRONIZAÇÃO (MERGE INTELIGENTE) ──────────────────────────────────────
    router.post('/sincronizar', async (req, res) => {
        try {
            let inseridos = 0, atualizados = 0;

            // 1. FREInclusão apenas de status que NÃO sejam devolução/devolvida
            const { data: fretes, error: erroFrete } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO")');

            if (erroFrete) throw erroFrete;

            for (const frete of fretes) {
                const statusFreteMap = {
                    'EM_TRANSITO': 'EM TRÂNSITO',
                    'ENTREGUE': 'ENTREGUE',
                    'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
                    'EXTRAVIADO': 'EXTRAVIADO'
                };
                const payload = {
                    numero_nf: frete.numero_nf,
                    origem: 'CONTROLE_FRETE',
                    data_emissao: frete.data_emissao,
                    valor_nf: parseFloat(frete.valor_nf) || 0,
                    tipo_nf: frete.tipo_nf || null,
                    nome_orgao: frete.nome_orgao,
                    vendedor: frete.vendedor,
                    documento: frete.documento || null,
                    contato_orgao: frete.contato_orgao || null,
                    transportadora: frete.transportadora || null,
                    valor_frete: parseFloat(frete.valor_frete) || 0,
                    data_coleta: frete.data_coleta || null,
                    cidade_destino: frete.cidade_destino || null,
                    previsao_entrega: frete.previsao_entrega || null,
                    status_frete: statusFreteMap[frete.status] || frete.status || null,
                    id_controle_frete: frete.id,
                    updated_at: new Date().toISOString()
                };

                // Upsert por numero_nf + vendedor
                const { data: existente } = await supabase
                    .from('vendas')
                    .select('id')
                    .eq('numero_nf', frete.numero_nf)
                    .eq('vendedor', frete.vendedor)
                    .maybeSingle();

                if (existente) {
                    await supabase.from('vendas').update(payload).eq('id', existente.id);
                    atualizados++;
                } else {
                    await supabase.from('vendas').insert([{ ...payload, prioridade: 1 }]);
                    inseridos++;
                }
            }

            // 2. CONTAS A RECEBER — apenas status PAGO ou que contenha "PARCELA"
            const { data: contas, error: erroContas } = await supabase
                .from('contas_receber')
                .select('*')
                .or('status.eq.PAGO,status.ilike.%PARCELA%');

            if (erroContas) throw erroContas;

            for (const conta of contas) {
                // Calcula valor_pago a partir de parcelas, se houver
                let valorPago = parseFloat(conta.valor_pago) || 0;
                try {
                    const obs = conta.observacoes;
                    if (obs) {
                        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
                        if (parsed && Array.isArray(parsed.parcelas) && parsed.parcelas.length > 0) {
                            valorPago = parsed.parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
                        }
                    }
                } catch {}

                const payload = {
                    numero_nf: conta.numero_nf,
                    origem: 'CONTAS_RECEBER',
                    data_emissao: conta.data_emissao,
                    valor_nf: parseFloat(conta.valor) || 0,
                    tipo_nf: conta.tipo_nf || null,
                    nome_orgao: conta.orgao,
                    vendedor: conta.vendedor,
                    banco: conta.banco || null,
                    data_vencimento: conta.data_vencimento || null,
                    data_pagamento: conta.data_pagamento || null,
                    status_pagamento: conta.status || 'A RECEBER',
                    valor_pago: valorPago,
                    id_contas_receber: conta.id,
                    updated_at: new Date().toISOString()
                };

                const { data: existente } = await supabase
                    .from('vendas')
                    .select('id')
                    .eq('numero_nf', conta.numero_nf)
                    .eq('vendedor', conta.vendedor)
                    .maybeSingle();

                if (existente) {
                    // Atualiza apenas campos de pagamento, preservando origem se já existir
                    const updatePayload = { ...payload };
                    delete updatePayload.origem; // mantém a origem original (CONTROLE_FRETE)
                    await supabase.from('vendas').update(updatePayload).eq('id', existente.id);
                    atualizados++;
                } else {
                    await supabase.from('vendas').insert([{ ...payload, prioridade: 1 }]);
                    inseridos++;
                }
            }

            console.log(`[vendas] Sync concluída: ${inseridos} inseridos, ${atualizados} atualizados`);
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
