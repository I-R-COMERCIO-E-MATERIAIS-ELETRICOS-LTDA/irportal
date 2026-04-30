// ============================================
// RECEBER ROUTES — /api/receber
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── LISTAR CONTAS (com parcelas) ─────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { data: contas, error } = await supabase
                .from('contas_receber')
                .select('*')
                .order('data_emissao', { ascending: false });
            if (error) throw error;

            const contasComParcelas = await Promise.all(contas.map(async (conta) => {
                const { data: parcelas, error: errParc } = await supabase
                    .from('parcelas_receber')
                    .select('*')
                    .eq('conta_id', conta.id)
                    .order('numero', { ascending: true });
                if (errParc) console.error('Erro parcelas:', errParc);
                return { ...conta, parcelas: parcelas || [] };
            }));
            res.json(contasComParcelas);
        } catch (err) {
            console.error('Erro ao listar:', err.message);
            res.status(500).json({ error: 'Erro ao listar contas' });
        }
    });

    // ─── BUSCAR CONTA POR ID (com parcelas) ───────────────────────────────────
    router.get('/:id', async (req, res) => {
        try {
            const { data: conta, error } = await supabase
                .from('contas_receber')
                .select('*')
                .eq('id', req.params.id)
                .single();
            if (error) throw error;
            if (!conta) return res.status(404).json({ error: 'Conta não encontrada' });

            const { data: parcelas, error: errParc } = await supabase
                .from('parcelas_receber')
                .select('*')
                .eq('conta_id', conta.id)
                .order('numero', { ascending: true });
            res.json({ ...conta, parcelas: parcelas || [] });
        } catch (err) {
            console.error('Erro ao buscar conta:', err.message);
            res.status(500).json({ error: 'Erro ao buscar conta' });
        }
    });

    // ─── CRIAR CONTA (com parcelas) ───────────────────────────────────────────
    router.post('/', async (req, res) => {
        try {
            const { parcelas, ...dadosConta } = req.body;
            if (!dadosConta.numero_nf || !dadosConta.orgao || !dadosConta.vendedor || !dadosConta.data_emissao) {
                return res.status(400).json({ error: 'Campos obrigatórios faltando' });
            }

            const payloadConta = {
                numero_nf: dadosConta.numero_nf.toUpperCase().trim(),
                orgao: dadosConta.orgao.toUpperCase().trim(),
                vendedor: dadosConta.vendedor.toUpperCase().trim(),
                banco: dadosConta.banco ? dadosConta.banco.toUpperCase().trim() : null,
                valor: parseFloat(dadosConta.valor) || 0,
                data_emissao: dadosConta.data_emissao,
                data_vencimento: dadosConta.data_vencimento || null,
                data_pagamento: dadosConta.data_pagamento || null,
                status: dadosConta.status || 'A RECEBER',
                tipo_nf: dadosConta.tipo_nf || 'ENVIO',
                observacoes: null,
                valor_pago: 0
            };

            const { data: novaConta, error: errConta } = await supabase
                .from('contas_receber')
                .insert([payloadConta])
                .select()
                .single();
            if (errConta) throw errConta;

            let parcelasInseridas = [];
            if (parcelas && Array.isArray(parcelas) && parcelas.length > 0) {
                const parcelasInsert = parcelas.map(p => ({
                    conta_id: novaConta.id,
                    numero: p.numero,
                    valor: parseFloat(p.valor) || 0,
                    data_vencimento: p.data_vencimento || novaConta.data_vencimento,
                    data_pagamento: p.data_pagamento || null,
                    status: p.data_pagamento ? 'PAGO' : 'PENDENTE'
                }));
                const { data: inserted, error: errParc } = await supabase
                    .from('parcelas_receber')
                    .insert(parcelasInsert)
                    .select();
                if (!errParc) parcelasInseridas = inserted;
                else console.error('Erro ao inserir parcelas:', errParc);
            }

            sincronizarVendas(supabase, novaConta, parcelasInseridas).catch(console.error);
            res.status(201).json({ ...novaConta, parcelas: parcelasInseridas });
        } catch (err) {
            console.error('Erro ao criar conta:', err.message);
            res.status(500).json({ error: 'Erro ao criar conta', details: err.message });
        }
    });

    // ─── ATUALIZAR CONTA (PUT completo) ───────────────────────────────────────
    router.put('/:id', async (req, res) => {
        try {
            const { id } = req.params;
            const { parcelas, ...dadosConta } = req.body;

            const payloadConta = {
                numero_nf: dadosConta.numero_nf?.toUpperCase().trim(),
                orgao: dadosConta.orgao?.toUpperCase().trim(),
                vendedor: dadosConta.vendedor?.toUpperCase().trim(),
                banco: dadosConta.banco ? dadosConta.banco.toUpperCase().trim() : null,
                valor: parseFloat(dadosConta.valor) || 0,
                data_emissao: dadosConta.data_emissao,
                data_vencimento: dadosConta.data_vencimento || null,
                data_pagamento: dadosConta.data_pagamento || null,
                status: dadosConta.status || 'A RECEBER',
                tipo_nf: dadosConta.tipo_nf || 'ENVIO',
                observacoes: null,
                updated_at: new Date().toISOString()
            };

            const { data: contaAtualizada, error: errConta } = await supabase
                .from('contas_receber')
                .update(payloadConta)
                .eq('id', id)
                .select()
                .single();
            if (errConta) throw errConta;
            if (!contaAtualizada) return res.status(404).json({ error: 'Conta não encontrada' });

            // Remove parcelas antigas e insere novas
            await supabase.from('parcelas_receber').delete().eq('conta_id', id);
            let parcelasAtualizadas = [];
            if (parcelas && Array.isArray(parcelas) && parcelas.length > 0) {
                const parcelasInsert = parcelas.map(p => ({
                    conta_id: id,
                    numero: p.numero,
                    valor: parseFloat(p.valor) || 0,
                    data_vencimento: p.data_vencimento || contaAtualizada.data_vencimento,
                    data_pagamento: p.data_pagamento || null,
                    status: p.data_pagamento ? 'PAGO' : 'PENDENTE'
                }));
                const { data: inserted, error: errParc } = await supabase
                    .from('parcelas_receber')
                    .insert(parcelasInsert)
                    .select();
                if (!errParc) parcelasAtualizadas = inserted;
            }

            sincronizarVendas(supabase, contaAtualizada, parcelasAtualizadas).catch(console.error);
            res.json({ ...contaAtualizada, parcelas: parcelasAtualizadas });
        } catch (err) {
            console.error('Erro ao atualizar conta:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    // ─── PATCH (atualização parcial) ──────────────────────────────────────────
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

            const { data: parcelas } = await supabase
                .from('parcelas_receber')
                .select('*')
                .eq('conta_id', req.params.id);
            sincronizarVendas(supabase, contaAtualizada, parcelas || []).catch(console.error);
            res.json({ ...contaAtualizada, parcelas: parcelas || [] });
        } catch (err) {
            console.error('Erro no PATCH:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar conta' });
        }
    });

    // ─── DELETAR CONTA ─────────────────────────────────────────────────────────
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

// ─── FUNÇÃO DE SINCRONIZAÇÃO COM VENDAS (usa parcelas_receber) ────────────────
async function sincronizarVendas(supabase, conta, parcelas) {
    if (!conta || !conta.numero_nf || !conta.vendedor) return;

    let valorPago = 0;
    let dataUltimoPagamento = null;
    if (parcelas && parcelas.length) {
        const pagas = parcelas.filter(p => p.data_pagamento);
        valorPago = pagas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
        const datasPagas = pagas.map(p => p.data_pagamento).filter(Boolean).sort();
        if (datasPagas.length) dataUltimoPagamento = datasPagas[datasPagas.length - 1];
    } else {
        valorPago = parseFloat(conta.valor_pago) || 0;
        dataUltimoPagamento = conta.data_pagamento;
    }

    const statusPagamento = (valorPago >= (parseFloat(conta.valor) || 0)) ? 'PAGO'
                           : (parcelas && parcelas.length ? `${parcelas.length}ª PARCELA` : conta.status);

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
        data_pagamento: dataUltimoPagamento,
        status_pagamento: statusPagamento,
        valor_pago: valorPago,
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
