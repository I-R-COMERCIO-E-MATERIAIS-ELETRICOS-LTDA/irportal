// ============================================
// RECEBER ROUTES — /api/receber (versão estável)
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // Utilitário: extrair parcelas de observacoes
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

    // Calcula valor_pago, data_pagamento, status a partir das parcelas
    function calcularPagamento(observacoes, valorTotal) {
        const parcelas = extrairParcelas(observacoes);
        let totalPago = 0;
        let ultimaData = null;
        for (const p of parcelas) {
            const valor = parseFloat(p.valor) || 0;
            const data = p.data_pagamento;
            if (data) {
                totalPago += valor;
                if (!ultimaData || data > ultimaData) ultimaData = data;
            }
        }
        let status = 'A RECEBER';
        if (totalPago >= valorTotal && valorTotal > 0) status = 'PAGO';
        else if (totalPago > 0) status = `${parcelas.filter(p => p.data_pagamento).length}ª PARCELA`;
        return { valor_pago: totalPago, data_pagamento: ultimaData, status };
    }

    // GET / - listar contas
    router.get('/', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('contas_receber')
                .select('*')
                .order('data_emissao', { ascending: false });
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
            const { data, error } = await supabase
                .from('contas_receber')
                .select('*')
                .eq('id', req.params.id)
                .single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('Erro ao buscar:', err.message);
            res.status(500).json({ error: 'Erro ao buscar conta' });
        }
    });

    // POST / - criar conta
    router.post('/', async (req, res) => {
        try {
            const { parcelas, ...dados } = req.body;

            // Construir observacoes com as parcelas
            let observacoes = null;
            if (parcelas && Array.isArray(parcelas) && parcelas.length > 0) {
                observacoes = JSON.stringify({
                    parcelas: parcelas.map(p => ({
                        numero: p.numero,
                        valor: parseFloat(p.valor) || 0,
                        data_pagamento: p.data_pagamento || null,
                        data_vencimento: p.data_vencimento || dados.data_vencimento
                    }))
                });
            }

            // Inserir conta
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

            const { data: novaConta, error } = await supabase
                .from('contas_receber')
                .insert([payload])
                .select()
                .single();
            if (error) throw error;

            // Recalcular pagamento (caso já tenha parcelas pagas)
            const calc = calcularPagamento(novaConta.observacoes, novaConta.valor);
            if (calc.valor_pago > 0) {
                await supabase
                    .from('contas_receber')
                    .update({
                        valor_pago: calc.valor_pago,
                        data_pagamento: calc.data_pagamento,
                        status: calc.status
                    })
                    .eq('id', novaConta.id);
                novaConta.valor_pago = calc.valor_pago;
                novaConta.data_pagamento = calc.data_pagamento;
                novaConta.status = calc.status;
            }

            // Sincronizar com Vendas
            sincronizarVendas(supabase, novaConta).catch(console.error);
            res.status(201).json(novaConta);
        } catch (err) {
            console.error('Erro ao criar conta:', err.message);
            res.status(500).json({ error: 'Erro ao criar conta', details: err.message });
        }
    });

    // PUT /:id - atualizar conta completa
    router.put('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { parcelas, ...dados } = req.body;

            let observacoes = null;
            if (parcelas && Array.isArray(parcelas) && parcelas.length > 0) {
                observacoes = JSON.stringify({
                    parcelas: parcelas.map(p => ({
                        numero: p.numero,
                        valor: parseFloat(p.valor) || 0,
                        data_pagamento: p.data_pagamento || null,
                        data_vencimento: p.data_vencimento || dados.data_vencimento
                    }))
                });
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

            const { data: contaAtualizada, error } = await supabase
                .from('contas_receber')
                .update(payload)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            if (!contaAtualizada) return res.status(404).json({ error: 'Conta não encontrada' });

            // Recalcular pagamento
            const calc = calcularPagamento(contaAtualizada.observacoes, contaAtualizada.valor);
            await supabase
                .from('contas_receber')
                .update({
                    valor_pago: calc.valor_pago,
                    data_pagamento: calc.data_pagamento,
                    status: calc.status
                })
                .eq('id', id);
            contaAtualizada.valor_pago = calc.valor_pago;
            contaAtualizada.data_pagamento = calc.data_pagamento;
            contaAtualizada.status = calc.status;

            sincronizarVendas(supabase, contaAtualizada).catch(console.error);
            res.json(contaAtualizada);
        } catch (err) {
            console.error('Erro ao atualizar conta:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    // PATCH /:id - atualização parcial
    router.patch('/:id', async (req, res) => {
        try {
            const updates = { ...req.body, updated_at: new Date().toISOString() };
            const { data: contaAtualizada, error } = await supabase
                .from('contas_receber')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) throw error;
            if (!contaAtualizada) return res.status(404).json({ error: 'Conta não encontrada' });

            // Se a atualização afetar pagamento, recalcular
            const calc = calcularPagamento(contaAtualizada.observacoes, contaAtualizada.valor);
            await supabase
                .from('contas_receber')
                .update({
                    valor_pago: calc.valor_pago,
                    data_pagamento: calc.data_pagamento,
                    status: calc.status
                })
                .eq('id', req.params.id);
            contaAtualizada.valor_pago = calc.valor_pago;
            contaAtualizada.data_pagamento = calc.data_pagamento;
            contaAtualizada.status = calc.status;

            sincronizarVendas(supabase, contaAtualizada).catch(console.error);
            res.json(contaAtualizada);
        } catch (err) {
            console.error('Erro no PATCH:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    // DELETE /:id
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('contas_receber')
                .delete()
                .eq('id', req.params.id);
            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('Erro ao deletar:', err.message);
            res.status(500).json({ error: 'Erro ao deletar conta' });
        }
    });

    return router;
};

// ─── SINCRONIZAÇÃO COM VENDAS ────────────────────────────────────────────────
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

    const { data: existente } = await supabase
        .from('vendas')
        .select('id')
        .eq('id_contas_receber', conta.id)
        .single();

    if (existente) {
        await supabase.from('vendas').update(payload).eq('id', existente.id);
    } else {
        await supabase.from('vendas').insert([payload]);
    }
}
