// ============================================
// FRETE ROUTES — /api/fretes
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── LISTAR FRETES ──────────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('controle_frete')
                .select('*')
                .order('data_emissao', { ascending: false });

            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar fretes:', err.message);
            res.status(500).json({ error: 'Erro ao listar fretes' });
        }
    });

    // ─── BUSCAR FRETE POR ID ─────────────────────────────────────────────────────
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('controle_frete')
                .select('*')
                .eq('id', req.params.id)
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Frete não encontrado' });

            res.json(data);
        } catch (err) {
            console.error('Erro ao buscar frete:', err.message);
            res.status(500).json({ error: 'Erro ao buscar frete' });
        }
    });

    // ─── CRIAR FRETE ─────────────────────────────────────────────────────────────
    router.post('/', async (req, res) => {
        try {
            const {
                numero_nf, data_emissao, documento, valor_nf, tipo_nf,
                nome_orgao, contato_orgao, vendedor, transportadora,
                valor_frete, data_coleta, cidade_destino, previsao_entrega,
                data_entrega, observacoes
            } = req.body;

            if (!numero_nf || !nome_orgao) {
                return res.status(400).json({ error: 'numero_nf e nome_orgao são obrigatórios' });
            }

            // Calcular status automaticamente
            const tiposSemStatus = ['CANCELADA', 'DEVOLUCAO', 'DEVOLVIDA'];
            let status;
            if (tiposSemStatus.includes(tipo_nf)) {
                status = null;
            } else if (data_entrega) {
                status = 'ENTREGUE';
            } else {
                status = 'EM_TRANSITO';
            }

            let obsJson = '[]';
            if (observacoes) {
                try {
                    obsJson = typeof observacoes === 'string' ? observacoes : JSON.stringify(observacoes);
                    JSON.parse(obsJson); // valida
                } catch {
                    obsJson = '[]';
                }
            }

            const payload = {
                numero_nf: (numero_nf || '').toUpperCase().trim(),
                data_emissao: data_emissao || new Date().toISOString().split('T')[0],
                documento: (documento || 'NÃO INFORMADO').toUpperCase().trim(),
                valor_nf: parseFloat(valor_nf) || 0,
                tipo_nf: tipo_nf || 'ENVIO',
                nome_orgao: (nome_orgao || '').toUpperCase().trim(),
                contato_orgao: (contato_orgao || 'NÃO INFORMADO').toUpperCase().trim(),
                vendedor: (vendedor || 'NÃO INFORMADO').toUpperCase().trim(),
                transportadora: (transportadora || 'NÃO INFORMADO').toUpperCase().trim(),
                valor_frete: parseFloat(valor_frete) || 0,
                data_coleta: data_coleta || null,
                cidade_destino: (cidade_destino || 'NÃO INFORMADO').toUpperCase().trim(),
                previsao_entrega: previsao_entrega || null,
                data_entrega: data_entrega || null,
                status,
                observacoes: JSON.parse(obsJson)
            };

            const { data, error } = await supabase
                .from('controle_frete')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;

            // Sincronizar tabela vendas de forma assíncrona
            sincronizarVendas(supabase, data, 'CONTROLE_FRETE').catch(console.error);

            res.status(201).json(data);
        } catch (err) {
            console.error('Erro ao criar frete:', err.message);
            res.status(500).json({ error: 'Erro ao criar frete', details: err.message });
        }
    });

    // ─── ATUALIZAR FRETE (PUT completo) ─────────────────────────────────────────
    router.put('/:id', async (req, res) => {
        try {
            const {
                numero_nf, data_emissao, documento, valor_nf, tipo_nf,
                nome_orgao, contato_orgao, vendedor, transportadora,
                valor_frete, data_coleta, cidade_destino, previsao_entrega,
                data_entrega, observacoes
            } = req.body;

            // Calcular status automaticamente
            const tiposSemStatus = ['CANCELADA', 'DEVOLUCAO', 'DEVOLVIDA'];
            let status;
            if (tiposSemStatus.includes(tipo_nf)) {
                status = null;
            } else if (data_entrega) {
                status = 'ENTREGUE';
            } else {
                status = 'EM_TRANSITO';
            }

            let obsJson = '[]';
            if (observacoes) {
                try {
                    obsJson = typeof observacoes === 'string' ? observacoes : JSON.stringify(observacoes);
                    JSON.parse(obsJson);
                } catch {
                    obsJson = '[]';
                }
            }

            const payload = {
                numero_nf: (numero_nf || '').toUpperCase().trim(),
                data_emissao: data_emissao || new Date().toISOString().split('T')[0],
                documento: (documento || 'NÃO INFORMADO').toUpperCase().trim(),
                valor_nf: parseFloat(valor_nf) || 0,
                tipo_nf: tipo_nf || 'ENVIO',
                nome_orgao: (nome_orgao || '').toUpperCase().trim(),
                contato_orgao: (contato_orgao || 'NÃO INFORMADO').toUpperCase().trim(),
                vendedor: (vendedor || 'NÃO INFORMADO').toUpperCase().trim(),
                transportadora: (transportadora || 'NÃO INFORMADO').toUpperCase().trim(),
                valor_frete: parseFloat(valor_frete) || 0,
                data_coleta: data_coleta || null,
                cidade_destino: (cidade_destino || 'NÃO INFORMADO').toUpperCase().trim(),
                previsao_entrega: previsao_entrega || null,
                data_entrega: data_entrega || null,
                status,
                observacoes: JSON.parse(obsJson),
                updated_at: new Date().toISOString()
            };

            const { data, error } = await supabase
                .from('controle_frete')
                .update(payload)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Frete não encontrado' });

            // Sincronizar tabela vendas de forma assíncrona
            sincronizarVendas(supabase, data, 'CONTROLE_FRETE').catch(console.error);

            res.json(data);
        } catch (err) {
            console.error('Erro ao atualizar frete:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar frete', details: err.message });
        }
    });

    // ─── PATCH — ATUALIZAÇÃO PARCIAL (ex: status do checkbox) ──────────────────
    router.patch('/:id', async (req, res) => {
        try {
            const updates = { ...req.body, updated_at: new Date().toISOString() };

            const { data, error } = await supabase
                .from('controle_frete')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Frete não encontrado' });

            // Sincronizar tabela vendas de forma assíncrona
            sincronizarVendas(supabase, data, 'CONTROLE_FRETE').catch(console.error);

            res.json(data);
        } catch (err) {
            console.error('Erro ao fazer patch no frete:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar frete', details: err.message });
        }
    });

    // ─── DELETAR FRETE ───────────────────────────────────────────────────────────
    router.delete('/:id', async (req, res) => {
        try {
            // Busca o frete antes de deletar para sincronizar vendas
            const { data: freteExistente } = await supabase
                .from('controle_frete')
                .select('numero_nf, vendedor')
                .eq('id', req.params.id)
                .single();

            const { error } = await supabase
                .from('controle_frete')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;

            // Remover da tabela vendas de forma assíncrona
            if (freteExistente) {
                supabase
                    .from('vendas')
                    .delete()
                    .eq('id_controle_frete', req.params.id)
                    .then(() => {})
                    .catch(console.error);
            }

            res.json({ success: true, message: 'Frete excluído com sucesso' });
        } catch (err) {
            console.error('Erro ao deletar frete:', err.message);
            res.status(500).json({ error: 'Erro ao deletar frete' });
        }
    });

    return router;
};

// ─── SINCRONIZAÇÃO COM TABELA VENDAS ────────────────────────────────────────
async function sincronizarVendas(supabase, frete, origem) {
    if (!frete || !frete.numero_nf || !frete.vendedor) return;

    // Mapear status do frete para status de pagamento/frete na tabela vendas
    const statusFreteMap = {
        'EM_TRANSITO': 'EM TRÂNSITO',
        'ENTREGUE': 'ENTREGUE',
        'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
        'EXTRAVIADO': 'EXTRAVIADO',
        'DEVOLVIDO': 'DEVOLVIDO'
    };

    const statusFrete = statusFreteMap[frete.status] || frete.status || null;

    const tipoNfMap = {
        'ENVIO': 'ENVIO',
        'CANCELADA': 'CANCELADA',
        'REMESSA_AMOSTRA': 'REMESSA DE AMOSTRA',
        'SIMPLES_REMESSA': 'SIMPLES REMESSA',
        'DEVOLUCAO': 'DEVOLUÇÃO',
        'DEVOLVIDA': 'DEVOLVIDA'
    };
    const tipoNf = tipoNfMap[frete.tipo_nf] || frete.tipo_nf || null;

    const payload = {
        numero_nf: frete.numero_nf,
        origem: 'CONTROLE_FRETE',
        data_emissao: frete.data_emissao,
        valor_nf: parseFloat(frete.valor_nf) || 0,
        tipo_nf: tipoNf,
        nome_orgao: frete.nome_orgao,
        vendedor: frete.vendedor,
        documento: frete.documento || null,
        contato_orgao: frete.contato_orgao || null,
        transportadora: frete.transportadora || null,
        valor_frete: parseFloat(frete.valor_frete) || 0,
        data_coleta: frete.data_coleta || null,
        cidade_destino: frete.cidade_destino || null,
        previsao_entrega: frete.previsao_entrega || null,
        status_frete: statusFrete,
        id_controle_frete: frete.id,
        updated_at: new Date().toISOString()
    };

    // Verifica se já existe na tabela vendas por id_controle_frete
    const { data: existente } = await supabase
        .from('vendas')
        .select('id')
        .eq('id_controle_frete', frete.id)
        .single();

    if (existente) {
        await supabase
            .from('vendas')
            .update(payload)
            .eq('id_controle_frete', frete.id);
    } else {
        await supabase
            .from('vendas')
            .insert([{ ...payload, prioridade: 1 }]);
    }
}
