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

            if (vendedor) {
                query = query.eq('vendedor', vendedor.toUpperCase());
            }

            if (status_frete) {
                query = query.eq('status_frete', status_frete);
            }

            if (status_pagamento) {
                query = query.eq('status_pagamento', status_pagamento);
            }

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

    // ─── ATUALIZAR PRIORIDADE ────────────────────────────────────────────────────
    router.patch('/:id/prioridade', async (req, res) => {
        try {
            const { prioridade } = req.body;

            if (prioridade === undefined || prioridade === null) {
                return res.status(400).json({ error: 'prioridade é obrigatório' });
            }

            const { data, error } = await supabase
                .from('vendas')
                .update({ prioridade: parseInt(prioridade), updated_at: new Date().toISOString() })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Venda não encontrada' });

            res.json(data);
        } catch (err) {
            console.error('Erro ao atualizar prioridade:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar prioridade' });
        }
    });

    // ─── PATCH GENÉRICO ──────────────────────────────────────────────────────────
    router.patch('/:id', async (req, res) => {
        try {
            const updates = { ...req.body, updated_at: new Date().toISOString() };

            const { data, error } = await supabase
                .from('vendas')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Venda não encontrada' });

            res.json(data);
        } catch (err) {
            console.error('Erro ao atualizar venda:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar venda', details: err.message });
        }
    });

    // ─── RELATÓRIO / DASHBOARD ───────────────────────────────────────────────────
    router.get('/relatorio/dashboard', async (req, res) => {
        try {
            const { mes, ano } = req.query;

            let query = supabase.from('vendas').select('*');

            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }

            const { data, error } = await query;
            if (error) throw error;

            const totalPago = data
                .filter(v => v.status_pagamento === 'PAGO')
                .reduce((sum, v) => sum + parseFloat(v.valor_nf || 0), 0);

            const totalAReceber = data
                .filter(v => v.status_pagamento === 'A RECEBER')
                .reduce((sum, v) => sum + parseFloat(v.valor_nf || 0), 0);

            const totalEntregue = data
                .filter(v => v.status_frete === 'ENTREGUE')
                .length;

            const totalFaturado = data
                .reduce((sum, v) => sum + parseFloat(v.valor_nf || 0), 0);

            // Por vendedor
            const porVendedor = {};
            data.forEach(v => {
                const vend = v.vendedor || 'NÃO INFORMADO';
                if (!porVendedor[vend]) {
                    porVendedor[vend] = { total: 0, pago: 0, receber: 0, count: 0 };
                }
                porVendedor[vend].total += parseFloat(v.valor_nf || 0);
                porVendedor[vend].count += 1;
                if (v.status_pagamento === 'PAGO') {
                    porVendedor[vend].pago += parseFloat(v.valor_nf || 0);
                } else if (v.status_pagamento === 'A RECEBER') {
                    porVendedor[vend].receber += parseFloat(v.valor_nf || 0);
                }
            });

            res.json({
                total_registros: data.length,
                total_pago: totalPago,
                total_a_receber: totalAReceber,
                total_entregue: totalEntregue,
                total_faturado: totalFaturado,
                por_vendedor: porVendedor
            });
        } catch (err) {
            console.error('Erro ao gerar dashboard:', err.message);
            res.status(500).json({ error: 'Erro ao gerar dashboard' });
        }
    });

    // ─── SINCRONIZAÇÃO MANUAL (reconcilia vendas com frete e receber) ────────────
    router.post('/sincronizar', async (req, res) => {
        try {
            let inseridos = 0;
            let atualizados = 0;

            // 1. Sincronizar registros do controle_frete
            const { data: fretes, error: erroFrete } = await supabase
                .from('controle_frete')
                .select('*');

            if (erroFrete) throw erroFrete;

            for (const frete of fretes) {
                const statusFreteMap = {
                    'EM_TRANSITO': 'EM TRÂNSITO',
                    'ENTREGUE': 'ENTREGUE',
                    'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
                    'EXTRAVIADO': 'EXTRAVIADO',
                    'DEVOLVIDO': 'DEVOLVIDO'
                };
                const tipoNfMap = {
                    'ENVIO': 'ENVIO', 'CANCELADA': 'CANCELADA',
                    'REMESSA_AMOSTRA': 'REMESSA DE AMOSTRA',
                    'SIMPLES_REMESSA': 'SIMPLES REMESSA',
                    'DEVOLUCAO': 'DEVOLUÇÃO'
                };

                const payload = {
                    numero_nf: frete.numero_nf,
                    origem: 'CONTROLE_FRETE',
                    data_emissao: frete.data_emissao,
                    valor_nf: parseFloat(frete.valor_nf) || 0,
                    tipo_nf: tipoNfMap[frete.tipo_nf] || frete.tipo_nf,
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

                const { data: existente } = await supabase
                    .from('vendas')
                    .select('id')
                    .eq('id_controle_frete', frete.id)
                    .single();

                if (existente) {
                    await supabase.from('vendas').update(payload).eq('id_controle_frete', frete.id);
                    atualizados++;
                } else {
                    await supabase.from('vendas').insert([{ ...payload, prioridade: 1 }]);
                    inseridos++;
                }
            }

            // 2. Sincronizar registros do contas_receber
            const { data: contas, error: erroContas } = await supabase
                .from('contas_receber')
                .select('*');

            if (erroContas) throw erroContas;

            for (const conta of contas) {
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
                    id_contas_receber: conta.id,
                    updated_at: new Date().toISOString()
                };

                const { data: existente } = await supabase
                    .from('vendas')
                    .select('id')
                    .eq('id_contas_receber', conta.id)
                    .single();

                if (existente) {
                    await supabase.from('vendas').update(payload).eq('id_contas_receber', conta.id);
                    atualizados++;
                } else {
                    await supabase.from('vendas').insert([{ ...payload, prioridade: 1 }]);
                    inseridos++;
                }
            }

            res.json({
                success: true,
                message: `Sincronização concluída: ${inseridos} inseridos, ${atualizados} atualizados`
            });
        } catch (err) {
            console.error('Erro na sincronização:', err.message);
            res.status(500).json({ error: 'Erro na sincronização', details: err.message });
        }
    });

    return router;
};
