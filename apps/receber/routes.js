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

            const obsJson = normalizarObservacoes(observacoes);

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

            const obsJson = normalizarObservacoes(observacoes);

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

            // Se vier observacoes no patch, normalizar também
            if (updates.observacoes !== undefined) {
                updates.observacoes = normalizarObservacoes(updates.observacoes);
            }

            const { data, error } = await supabase
                .from('contas_receber')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });

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

    // ─── RELATÓRIO RESUMIDO ──────────────────────────────────────────────────────
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

// ─── NORMALIZAR OBSERVAÇÕES ──────────────────────────────────────────────────
// Garante que o campo observacoes seja sempre salvo no formato objeto:
// { notas: [{texto, data}], parcelas: [{numero, valor, data}] }
// Suporta migração do formato legado (array direto de notas).
function normalizarObservacoes(observacoes) {
    if (!observacoes) return { notas: [], parcelas: [] };

    let parsed = observacoes;

    // Se vier como string, fazer parse
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            return { notas: [], parcelas: [] };
        }
    }

    // Formato já correto: objeto com notas e/ou parcelas
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
            notas: Array.isArray(parsed.notas) ? parsed.notas : [],
            parcelas: Array.isArray(parsed.parcelas) ? parsed.parcelas : []
        };
    }

    // Formato legado: array direto de notas de texto
    if (Array.isArray(parsed)) {
        const notas = parsed
            .filter(n => n && typeof n === 'object' && n.texto && n.texto !== '[]')
            .map(n => ({ texto: n.texto, data: n.data || '' }));
        return { notas, parcelas: [] };
    }

    return { notas: [], parcelas: [] };
}

// ─── SINCRONIZAÇÃO COM TABELA VENDAS ────────────────────────────────────────
// Lê parcelas do campo observacoes (formato {notas, parcelas})
// e sincroniza cada parcela individualmente na tabela vendas.
async function sincronizarVendas(supabase, conta) {
    if (!conta || !conta.numero_nf || !conta.vendedor) return;

    const statusPagamento = conta.status || 'A RECEBER';

    // Extrair parcelas do campo observacoes
    let parcelas = [];
    let valorPago = parseFloat(conta.valor_pago) || 0;

    try {
        const obs = conta.observacoes;
        if (obs) {
            const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
            if (parsed && Array.isArray(parsed.parcelas) && parsed.parcelas.length > 0) {
                parcelas = parsed.parcelas.filter(p => p.valor > 0);
                valorPago = parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
            }
        }
    } catch (e) {
        console.error('Erro ao parsear observacoes para sincronizarVendas:', e.message);
    }

    const tipoNfMap = {
        'ENVIO': 'ENVIO',
        'CANCELADA': 'CANCELADA',
        'REMESSA DE AMOSTRA': 'REMESSA DE AMOSTRA',
        'SIMPLES REMESSA': 'SIMPLES REMESSA',
        'DEVOLUÇÃO': 'DEVOLUÇÃO'
    };
    const tipoNf = tipoNfMap[conta.tipo_nf] || conta.tipo_nf || null;

    if (parcelas.length > 0) {
        // ── PAGAMENTO PARCELADO: sincronizar cada parcela como uma linha separada em vendas ──
        for (let i = 0; i < parcelas.length; i++) {
            const p = parcelas[i];
            const numeroParc = p.numero || `${i + 1}ª Parcela`;
            const chaveParc = `${conta.id}_parcela_${i + 1}`;

            const payloadParc = {
                numero_nf: conta.numero_nf,
                origem: 'CONTAS_RECEBER',
                data_emissao: conta.data_emissao,
                valor_nf: parseFloat(conta.valor) || 0,
                tipo_nf: tipoNf,
                nome_orgao: conta.orgao,
                vendedor: conta.vendedor,
                banco: conta.banco || null,
                data_vencimento: conta.data_vencimento || null,
                // Cada parcela tem sua própria data e valor de pagamento
                data_pagamento: p.data || null,
                valor_pago: parseFloat(p.valor) || 0,
                status_pagamento: statusPagamento,
                id_contas_receber: conta.id,
                numero_parcela: numeroParc,
                chave_parcela: chaveParc,
                updated_at: new Date().toISOString()
            };

            // Verificar se essa parcela já existe por chave_parcela
            const { data: existente } = await supabase
                .from('vendas')
                .select('id')
                .eq('chave_parcela', chaveParc)
                .single();

            if (existente) {
                await supabase
                    .from('vendas')
                    .update(payloadParc)
                    .eq('chave_parcela', chaveParc);
            } else {
                await supabase
                    .from('vendas')
                    .insert([{ ...payloadParc, prioridade: 1 }]);
            }
        }

        // Remover linhas de parcelas antigas que não existem mais
        // (ex: usuário tinha 3 parcelas e reduziu para 2)
        const chavesAtuais = parcelas.map((_, i) => `${conta.id}_parcela_${i + 1}`);
        await supabase
            .from('vendas')
            .delete()
            .eq('id_contas_receber', conta.id)
            .not('chave_parcela', 'in', `(${chavesAtuais.map(c => `"${c}"`).join(',')})`)
            .not('chave_parcela', 'is', null);

    } else {
        // ── PAGAMENTO ÚNICO (sem parcelas) ──
        // Determinar data_pagamento: última data de parcela ou campo direto
        let dataPagamento = conta.data_pagamento || null;

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
            data_pagamento: dataPagamento,
            status_pagamento: statusPagamento,
            valor_pago: valorPago,
            id_contas_receber: conta.id,
            numero_parcela: null,
            chave_parcela: null,
            updated_at: new Date().toISOString()
        };

        // Verificar se já existe entrada única (sem chave_parcela) para essa conta
        const { data: existente } = await supabase
            .from('vendas')
            .select('id')
            .eq('id_contas_receber', conta.id)
            .is('chave_parcela', null)
            .single();

        if (existente) {
            await supabase
                .from('vendas')
                .update(payload)
                .eq('id_contas_receber', conta.id)
                .is('chave_parcela', null);
        } else {
            // Verificar por numero_nf + vendedor como fallback
            const { data: porNF } = await supabase
                .from('vendas')
                .select('id, origem')
                .eq('numero_nf', conta.numero_nf)
                .eq('vendedor', conta.vendedor)
                .eq('origem', 'CONTAS_RECEBER')
                .is('chave_parcela', null)
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

        // Limpar parcelas antigas dessa conta (se havia parcelas antes e agora não tem mais)
        await supabase
            .from('vendas')
            .delete()
            .eq('id_contas_receber', conta.id)
            .not('chave_parcela', 'is', null);
    }
}
