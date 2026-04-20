// ============================================
// RECEBER ROUTES — /api/receber
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── LISTAR CONTAS A RECEBER ─────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('contas_receber')
                .select('*')
                .order('data_emissao', { ascending: false });

            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar contas a receber:', err.message);
            res.status(500).json({ error: 'Erro ao listar contas a receber' });
        }
    });

    // ─── BUSCAR CONTA POR ID ─────────────────────────────────────────────────────
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('contas_receber')
                .select('*')
                .eq('id', req.params.id)
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });

            res.json(data);
        } catch (err) {
            console.error('Erro ao buscar conta:', err.message);
            res.status(500).json({ error: 'Erro ao buscar conta' });
        }
    });

    // ─── CRIAR CONTA A RECEBER ───────────────────────────────────────────────────
    router.post('/', async (req, res) => {
        try {
            const {
                numero_nf, orgao, vendedor, banco, valor,
                data_emissao, data_vencimento, data_pagamento,
                status, tipo_nf, observacoes, valor_pago
            } = req.body;

            if (!numero_nf || !orgao || !vendedor || !data_emissao) {
                return res.status(400).json({
                    error: 'numero_nf, orgao, vendedor e data_emissao são obrigatórios'
                });
            }

            let obsJson = null;
            if (observacoes) {
                try {
                    obsJson = typeof observacoes === 'string'
                        ? JSON.parse(observacoes)
                        : observacoes;
                } catch {
                    obsJson = null;
                }
            }

            const payload = {
                numero_nf: (numero_nf || '').toUpperCase().trim(),
                orgao: (orgao || '').toUpperCase().trim(),
                vendedor: (vendedor || '').toUpperCase().trim(),
                banco: banco ? banco.toUpperCase().trim() : null,
                valor: parseFloat(valor) || 0,
                data_emissao,
                data_vencimento: data_vencimento || null,
                data_pagamento: data_pagamento || null,
                status: status || 'A RECEBER',
                tipo_nf: tipo_nf || 'ENVIO',
                observacoes: obsJson,
                valor_pago: parseFloat(valor_pago) || 0
            };

            const { data, error } = await supabase
                .from('contas_receber')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;

            // Sincronizar com tabela vendas de forma assíncrona
            sincronizarVendas(supabase, data).catch(console.error);

            res.status(201).json(data);
        } catch (err) {
            console.error('Erro ao criar conta a receber:', err.message);
            res.status(500).json({ error: 'Erro ao criar conta a receber', details: err.message });
        }
    });

    // ─── ATUALIZAR CONTA (PUT completo) ─────────────────────────────────────────
    router.put('/:id', async (req, res) => {
        try {
            const {
                numero_nf, orgao, vendedor, banco, valor,
                data_emissao, data_vencimento, data_pagamento,
                status, tipo_nf, observacoes, valor_pago
            } = req.body;

            let obsJson = null;
            if (observacoes) {
                try {
                    obsJson = typeof observacoes === 'string'
                        ? JSON.parse(observacoes)
                        : observacoes;
                } catch {
                    obsJson = null;
                }
            }

            const payload = {
                numero_nf: (numero_nf || '').toUpperCase().trim(),
                orgao: (orgao || '').toUpperCase().trim(),
                vendedor: (vendedor || '').toUpperCase().trim(),
                banco: banco ? banco.toUpperCase().trim() : null,
                valor: parseFloat(valor) || 0,
                data_emissao,
                data_vencimento: data_vencimento || null,
                data_pagamento: data_pagamento || null,
                status: status || 'A RECEBER',
                tipo_nf: tipo_nf || 'ENVIO',
                observacoes: obsJson,
                valor_pago: parseFloat(valor_pago) || 0,
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('contas_receber')
                .update(payload)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });

            // Sincronizar com tabela vendas de forma assíncrona
            sincronizarVendas(supabase, data).catch(console.error);

            res.json(data);
        } catch (err) {
            console.error('Erro ao atualizar conta a receber:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta', details: err.message });
        }
    });

    // ─── PATCH — ATUALIZAÇÃO PARCIAL ────────────────────────────────────────────
    router.patch('/:id', async (req, res) => {
        try {
            const updates = { ...req.body, updated_at: new Date().toISOString() };

            const { data, error } = await supabase
                .from('contas_receber')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });

            // Sincronizar com tabela vendas de forma assíncrona
            sincronizarVendas(supabase, data).catch(console.error);

            res.json(data);
        } catch (err) {
            console.error('Erro ao fazer patch na conta:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta', details: err.message });
        }
    });

    // ─── DELETAR CONTA ───────────────────────────────────────────────────────────
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('contas_receber')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;

            // Remover da tabela vendas de forma assíncrona
            supabase
                .from('vendas')
                .delete()
                .eq('id_contas_receber', req.params.id)
                .then(() => {})
                .catch(console.error);

            res.json({ success: true, message: 'Conta excluída com sucesso' });
        } catch (err) {
            console.error('Erro ao deletar conta:', err.message);
            res.status(500).json({ error: 'Erro ao deletar conta' });
        }
    });

    // ─── RELATÓRIO RESUMIDO (para uso no módulo vendas) ─────────────────────────
    router.get('/relatorio/resumo', async (req, res) => {
        try {
            const { mes, ano } = req.query;

            let query = supabase.from('contas_receber').select('*');

            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }

            const { data, error } = await query;
            if (error) throw error;

            const totalPago = data
                .filter(c => c.status === 'PAGO')
                .reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);

            const totalReceber = data
                .filter(c => c.status === 'A RECEBER')
                .reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);

            const hoje = new Date().toISOString().split('T')[0];
            const totalVencido = data
                .filter(c => c.status === 'A RECEBER' && c.data_vencimento && c.data_vencimento < hoje)
                .reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);

            res.json({
                total_registros: data.length,
                total_pago: totalPago,
                total_receber: totalReceber,
                total_vencido: totalVencido,
                total_faturado: totalPago + totalReceber
            });
        } catch (err) {
            console.error('Erro ao gerar resumo:', err.message);
            res.status(500).json({ error: 'Erro ao gerar resumo' });
        }
    });

    return router;
};

// ─── SINCRONIZAÇÃO COM TABELA VENDAS ────────────────────────────────────────
async function sincronizarVendas(supabase, conta) {
    if (!conta || !conta.numero_nf || !conta.vendedor) return;

    const statusPagamento = conta.status || 'A RECEBER';

    // Calcular valor_pago a partir das parcelas (se houver)
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

    const tipoNfMap = {
        'ENVIO': 'ENVIO',
        'CANCELADA': 'CANCELADA',
        'REMESSA DE AMOSTRA': 'REMESSA DE AMOSTRA',
        'SIMPLES REMESSA': 'SIMPLES REMESSA',
        'DEVOLUÇÃO': 'DEVOLUÇÃO'
    };
    const tipoNf = tipoNfMap[conta.tipo_nf] || conta.tipo_nf || null;

    const payload = {
        numero_nf: conta.numero_nf,
        origem: 'CONTAS_RECEBER',
        data_emissao: conta.data_emissao,
        valor_nf: parseFloat(conta.valor) || 0,
        tipo_nf: tipoNf,
        nome_orgao: conta.orgao,
        vendedor: conta.vendedor,
        banco: conta.banco || null,
        data_vencimento: conta.data_vencimento || null,
        data_pagamento: conta.data_pagamento || null,
        status_pagamento: statusPagamento,
        valor_pago: valorPago,
        id_contas_receber: conta.id,
        updated_at: new Date().toISOString()
    };

    // Verifica se já existe na tabela vendas por id_contas_receber
    const { data: existente } = await supabase
        .from('vendas')
        .select('id')
        .eq('id_contas_receber', conta.id)
        .single();

    if (existente) {
        await supabase
            .from('vendas')
            .update(payload)
            .eq('id_contas_receber', conta.id);
    } else {
        const { data: porNF } = await supabase
            .from('vendas')
            .select('id, origem')
            .eq('numero_nf', conta.numero_nf)
            .eq('vendedor', conta.vendedor)
            .eq('origem', 'CONTAS_RECEBER')
            .single();

        if (porNF) {
            await supabase
                .from('vendas')
                .update(payload)
                .eq('id', porNF.id);
        } else {
            await supabase
                .from('vendas')
                .insert([{ ...payload, prioridade: 1 }]);
        }
    }
}
