// ============================================
// RECEBER ROUTES — /api/receber (versão estável)
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // Utilitário para extrair parcelas do observacoes (formato esperado: { parcelas: [{valor, data_pagamento}] })
    function extrairParcelas(observacoes) {
        try {
            if (!observacoes) return [];
            const parsed = typeof observacoes === 'string' ? JSON.parse(observacoes) : observacoes;
            if (parsed && Array.isArray(parsed.parcelas)) return parsed.parcelas;
            return [];
        } catch {
            return [];
        }
    }

    function calcularPagamento(observacoes, valorTotal) {
        const parcelas = extrairParcelas(observacoes);
        let totalPago = 0;
        let ultimaData = null;
        if (parcelas.length) {
            for (const parcela of parcelas) {
                const valor = parseFloat(parcela.valor) || 0;
                const data = parcela.data_pagamento;
                if (data) {
                    totalPago += valor;
                    if (!ultimaData || data > ultimaData) ultimaData = data;
                }
            }
        }
        const status = totalPago >= valorTotal ? 'PAGO' : (totalPago > 0 ? `${parcelas.filter(p => p.data_pagamento).length}ª PARCELA` : 'A RECEBER');
        return { valor_pago: totalPago, data_pagamento: ultimaData, status };
    }

    // GET /
    router.get('/', async (req, res) => {
        try {
            const { data, error } = await supabase.from('contas_receber').select('*').order('data_emissao', { ascending: false });
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar:', err.message);
            res.status(500).json({ error: 'Erro ao listar contas' });
        }
    });

    // GET /:id
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase.from('contas_receber').select('*').eq('id', req.params.id).single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('Erro ao buscar:', err.message);
            res.status(500).json({ error: 'Erro ao buscar conta' });
        }
    });

    // POST / (criar)
    router.post('/', async (req, res) => {
        try {
            const { parcelas, ...dados } = req.body;
            // Montar observacoes com parcelas
            let observacoes = null;
            if (parcelas && Array.isArray(parcelas) && parcelas.length) {
                observacoes = JSON.stringify({ parcelas: parcelas.map(p => ({
                    numero: p.numero,
                    valor: parseFloat(p.valor) || 0,
                    data_pagamento: p.data_pagamento || null,
                    data_vencimento: p.data_vencimento || dados.data_vencimento
                })) });
            }
            const payload = {
                numero_nf: dados.numero_nf?.toUpperCase().trim(),
                orgao: dados.orgao?.toUpperCase().trim(),
                vendedor: dados.vendedor?.toUpperCase().trim(),
                banco: dados.banco ? dados.banco.toUpperCase().trim() : null,
                valor: parseFloat(dados.valor) || 0,
                data_emissao: dados.data_emissao,
                data_vencimento: dados.data_vencimento || null,
                tipo_nf: dados.tipo_nf || 'ENVIO',
                observacoes: observacoes,
                valor_pago: 0,
                data_pagamento: null,
                status: 'A RECEBER'
            };
            const { data: nova, error } = await supabase.from('contas_receber').insert([payload]).select().single();
            if (error) throw error;

            // Recalcular pagamento a partir das parcelas (se houver)
            const calc = calcularPagamento(nova.observacoes, nova.valor);
            if (calc.valor_pago > 0) {
                await supabase.from('contas_receber').update({ valor_pago: calc.valor_pago, data_pagamento: calc.data_pagamento, status: calc.status }).eq('id', nova.id);
                nova.valor_pago = calc.valor_pago;
                nova.data_pagamento = calc.data_pagamento;
                nova.status = calc.status;
            }
            sincronizarVendas(supabase, nova).catch(console.error);
            res.status(201).json(nova);
        } catch (err) {
            console.error('Erro ao criar:', err.message);
            res.status(500).json({ error: 'Erro ao criar conta', details: err.message });
        }
    });

    // PUT /:id (atualizar completo)
    router.put('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { parcelas, ...dados } = req.body;
            let observacoes = null;
            if (parcelas && Array.isArray(parcelas) && parcelas.length) {
                observacoes = JSON.stringify({ parcelas: parcelas.map(p => ({
                    numero: p.numero,
                    valor: parseFloat(p.valor) || 0,
                    data_pagamento: p.data_pagamento || null,
                    data_vencimento: p.data_vencimento || dados.data_vencimento
                })) });
            }
            const payload = {
                numero_nf: dados.numero_nf?.toUpperCase().trim(),
                orgao: dados.orgao?.toUpperCase().trim(),
                vendedor: dados.vendedor?.toUpperCase().trim(),
                banco: dados.banco ? dados.banco.toUpperCase().trim() : null,
                valor: parseFloat(dados.valor) || 0,
                data_emissao: dados.data_emissao,
                data_vencimento: dados.data_vencimento || null,
                tipo_nf: dados.tipo_nf || 'ENVIO',
                observacoes: observacoes,
                updated_at: new Date().toISOString()
            };
            const { data: updated, error } = await supabase.from('contas_receber').update(payload).eq('id', id).select().single();
            if (error) throw error;
            if (!updated) return res.status(404).json({ error: 'Conta não encontrada' });
            const calc = calcularPagamento(updated.observacoes, updated.valor);
            await supabase.from('contas_receber').update({ valor_pago: calc.valor_pago, data_pagamento: calc.data_pagamento, status: calc.status }).eq('id', id);
            updated.valor_pago = calc.valor_pago;
            updated.data_pagamento = calc.data_pagamento;
            updated.status = calc.status;
            sincronizarVendas(supabase, updated).catch(console.error);
            res.json(updated);
        } catch (err) {
            console.error('Erro ao atualizar:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    // PATCH /:id (parcial)
    router.patch('/:id', async (req, res) => {
        try {
            const updates = { ...req.body, updated_at: new Date().toISOString() };
            const { data, error } = await supabase.from('contas_receber').update(updates).eq('id', req.params.id).select().single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
            const calc = calcularPagamento(data.observacoes, data.valor);
            await supabase.from('contas_receber').update({ valor_pago: calc.valor_pago, data_pagamento: calc.data_pagamento, status: calc.status }).eq('id', req.params.id);
            data.valor_pago = calc.valor_pago;
            data.data_pagamento = calc.data_pagamento;
            data.status = calc.status;
            sincronizarVendas(supabase, data).catch(console.error);
            res.json(data);
        } catch (err) {
            console.error('Erro no PATCH:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    // DELETE /:id
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase.from('contas_receber').delete().eq('id', req.params.id);
            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('Erro ao deletar:', err.message);
            res.status(500).json({ error: 'Erro ao deletar conta' });
        }
    });

    return router;
};

async function sincronizarVendas(supabase, conta) {
    if (!conta || !conta.numero_nf || !conta.vendedor) return;
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
        data_pagamento: conta.data_pagamento,
        status_pagamento: conta.status,
        valor_pago: parseFloat(conta.valor_pago) || 0,
        id_contas_receber: conta.id,
        updated_at: new Date().toISOString()
    };
    const { data: existente } = await supabase.from('vendas').select('id').eq('id_contas_receber', conta.id).single();
    if (existente) {
        await supabase.from('vendas').update(payload).eq('id', existente.id);
    } else {
        await supabase.from('vendas').insert([payload]);
    }
}
