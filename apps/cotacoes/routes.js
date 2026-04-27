const express = require('express');
module.exports = function (supabase) {
    const router = express.Router();

    function buildDateRange(mes, ano) {
        const m = parseInt(mes), y = parseInt(ano);
        if (isNaN(m) || isNaN(y)) return null;
        const start = new Date(y, m, 1).toISOString();
        const end = new Date(y, m + 1, 0, 23, 59, 59, 999).toISOString();
        return { start, end };
    }

    router.get('/', async (req, res) => {
        try {
            const { mes, ano, transportadora, responsavel, status } = req.query;
            let query = supabase.from('cotacoes').select('*').order('timestamp', { ascending: false });
            if (mes !== undefined && ano !== undefined) {
                const range = buildDateRange(mes, ano);
                if (range) query = query.gte('createdat', range.start).lte('createdat', range.end);
            }
            if (transportadora) query = query.eq('transportadora', transportadora);
            if (responsavel) query = query.eq('responsavel', responsavel);
            if (status === 'aprovada') query = query.eq('"negocioFechado"', true);
            if (status === 'reprovada') query = query.eq('"negocioFechado"', false);
            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (err) { res.status(500).json({ error: 'Erro ao listar cotações' }); }
    });

    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase.from('cotacoes').select('*').eq('id', req.params.id).single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cotação não encontrada' });
            res.json(data);
        } catch (err) { res.status(500).json({ error: 'Erro ao buscar cotação' }); }
    });

    router.post('/', async (req, res) => {
        try {
            const payload = { ...req.body };
            payload.createdat = payload.createdat || new Date().toISOString();
            payload.timestamp = payload.timestamp || new Date().toISOString();
            payload.updatedat = new Date().toISOString();
            const { data, error } = await supabase.from('cotacoes').insert([payload]).select().single();
            if (error) throw error;
            res.status(201).json(data);
        } catch (err) { res.status(500).json({ error: 'Erro ao criar cotação' }); }
    });

    router.put('/:id', async (req, res) => {
        try {
            const payload = { ...req.body };
            payload.updatedat = new Date().toISOString();
            delete payload.id; delete payload.createdat;
            const { data, error } = await supabase.from('cotacoes').update(payload).eq('id', req.params.id).select().single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cotação não encontrada' });
            res.json(data);
        } catch (err) { res.status(500).json({ error: 'Erro ao atualizar cotação' }); }
    });

    router.patch('/:id', async (req, res) => {
        try {
            const payload = { ...req.body };
            payload.updatedat = new Date().toISOString();
            delete payload.id;
            const { data, error } = await supabase.from('cotacoes').update(payload).eq('id', req.params.id).select().single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cotação não encontrada' });
            res.json(data);
        } catch (err) { res.status(500).json({ error: 'Erro ao atualizar cotação' }); }
    });

    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase.from('cotacoes').delete().eq('id', req.params.id);
            if (error) throw error;
            res.json({ success: true });
        } catch (err) { res.status(500).json({ error: 'Erro ao excluir cotação' }); }
    });

    // Importação em lote (via API, se necessário)
    router.post('/import', async (req, res) => {
        try {
            const cotacoes = req.body;
            if (!Array.isArray(cotacoes) || cotacoes.length === 0) {
                return res.status(400).json({ error: 'Envie um array de cotações.' });
            }
            const inseridas = [];
            for (const cotacao of cotacoes) {
                const payload = {
                    dataCotacao: cotacao.dataCotacao || cotacao.data_cotacao || '',
                    transportadora: cotacao.transportadora || '',
                    destino: cotacao.destino || '',
                    documento: cotacao.documento || '',
                    numeroCotacao: cotacao.numeroCotacao || cotacao.numero_cotacao || '',
                    valorFrete: cotacao.valorFrete || cotacao.valor_frete || null,
                    previsaoEntrega: cotacao.previsaoEntrega || cotacao.previsao_entrega || null,
                    responsavel: cotacao.responsavel || '',
                    vendedor: cotacao.vendedor || '',
                    responsavelTransportadora: cotacao.responsavelTransportadora || cotacao.responsavel_transportadora || '',
                    canalComunicacao: cotacao.canalComunicacao || cotacao.canal_comunicacao || '',
                    codigoColeta: cotacao.codigoColeta || cotacao.codigo_coleta || '',
                    observacoes: cotacao.observacoes || '',
                    negocioFechado: cotacao.negocioFechado ?? null,
                    createdat: cotacao.createdat || new Date().toISOString(),
                    timestamp: cotacao.timestamp || new Date().toISOString(),
                    updatedat: new Date().toISOString()
                };
                const { data, error } = await supabase.from('cotacoes').insert([payload]).select().single();
                if (error) throw error;
                inseridas.push(data);
            }
            res.status(201).json({ message: `${inseridas.length} cotações importadas`, data: inseridas });
        } catch (err) { res.status(500).json({ error: 'Erro na importação', details: err.message }); }
    });

    return router;
};
