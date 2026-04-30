// ============================================
// CONTAS A RECEBER - ROUTES (COMPLETO)
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // Lista de tipos de NF que NÃO devem ir para o Vendas (mas permanecem no Contas a Receber)
    const EXCLUDED_FOR_VENDAS = [
        'DEVOLUÇÃO', 'DEVOLUCAO', 'DEVOLUÇÃO DE MERCADORIA',
        'SIMPLES REMESSA', 'SIMPLES_REMESSA',
        'REMESSA DE AMOSTRA', 'REMESSA_AMOSTRA'
    ];

    function isExcludedForVendas(tipo) {
        if (!tipo) return false;
        const normalized = tipo.toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return EXCLUDED_FOR_VENDAS.some(ex => normalized.includes(ex.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
    }

    // GET / - listar todas as contas (incluindo especiais)
    router.get('/', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('contas_receber')
                .select('*')
                .order('data_emissao', { ascending: false });
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar contas:', err.message);
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
            console.error('Erro ao buscar conta:', err.message);
            res.status(500).json({ error: 'Erro ao buscar conta' });
        }
    });

    // POST / - criar nova conta
    router.post('/', async (req, res) => {
        try {
            const { parcelas, ...dados } = req.body;

            // Construir objeto observacoes com parcelas (se houver)
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
                status: dados.status || 'A RECEBER', // preserva o status enviado (ex: "DEVOLUÇÃO")
                observacoes: observacoes,
                valor_pago: parseFloat(dados.valor_pago) || 0,
                data_pagamento: dados.data_pagamento || null
            };

            const { data: novaConta, error } = await supabase
                .from('contas_receber')
                .insert([payload])
                .select()
                .single();
            if (error) throw error;

            // Sincronizar com Vendas apenas se não for nota especial excluída
            if (!isExcludedForVendas(novaConta.tipo_nf)) {
                sincronizarVendas(supabase, novaConta).catch(console.error);
            }

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
                status: dados.status || 'A RECEBER',
                observacoes: observacoes,
                valor_pago: parseFloat(dados.valor_pago) || 0,
                data_pagamento: dados.data_pagamento || null,
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

            if (!isExcludedForVendas(contaAtualizada.tipo_nf)) {
                sincronizarVendas(supabase, contaAtualizada).catch(console.error);
            }

            res.json(contaAtualizada);
        } catch (err) {
            console.error('Erro ao atualizar conta:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    // PATCH /:id - atualização parcial (usado para marcar pagamento)
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

            if (!isExcludedForVendas(contaAtualizada.tipo_nf)) {
                sincronizarVendas(supabase, contaAtualizada).catch(console.error);
            }

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
            console.error('Erro ao deletar conta:', err.message);
            res.status(500).json({ error: 'Erro ao deletar conta' });
        }
    });

    return router;
};

// Sincronização com Vendas (apenas para notas não excluídas)
async function sincronizarVendas(supabase, conta) {
    if (!conta || !conta.numero_nf || !conta.vendedor) return;
    const EXCLUDED_FOR_VENDAS = ['DEVOLUÇÃO', 'DEVOLUCAO', 'SIMPLES REMESSA', 'REMESSA DE AMOSTRA'];
    const isExcluded = EXCLUDED_FOR_VENDAS.some(ex => conta.tipo_nf?.toUpperCase().includes(ex));
    if (isExcluded) return;

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
