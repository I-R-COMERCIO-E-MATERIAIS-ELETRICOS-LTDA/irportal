// ============================================
// COTAÇÕES DE FRETE - routes.js
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ── Helpers ──────────────────────────────────────────────────────────────
    function buildDateRange(mes, ano) {
        // mes é 0-indexed (igual ao JS Date.getMonth())
        const m = parseInt(mes);
        const y = parseInt(ano);
        if (isNaN(m) || isNaN(y)) return null;
        const start = new Date(y, m, 1).toISOString();
        const end   = new Date(y, m + 1, 0, 23, 59, 59, 999).toISOString();
        return { start, end };
    }

    // GET /api/cotacoes — lista cotações (com filtro de mês/ano)
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, transportadora, responsavel, status } = req.query;

            let query = supabase
                .from('cotacoes')
                .select('*')
                .order('timestamp', { ascending: false });

            // Filtro por mês/ano via campo dataCotacao (texto "DD/MM/YYYY") ou timestamp
            if (mes !== undefined && ano !== undefined) {
                const range = buildDateRange(mes, ano);
                if (range) {
                    query = query
                        .gte('createdat', range.start)
                        .lte('createdat', range.end);
                }
            }

            if (transportadora) query = query.eq('transportadora', transportadora);
            if (responsavel)    query = query.eq('responsavel', responsavel);
            if (status === 'aprovada')   query = query.eq('"negocioFechado"', true);
            if (status === 'reprovada')  query = query.eq('"negocioFechado"', false);

            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar cotações:', err.message);
            res.status(500).json({ error: 'Erro ao listar cotações' });
        }
    });

    // GET /api/cotacoes/:id
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('cotacoes')
                .select('*')
                .eq('id', req.params.id)
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cotação não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('Erro ao buscar cotação:', err.message);
            res.status(500).json({ error: 'Erro ao buscar cotação' });
        }
    });

    // POST /api/cotacoes — cria nova cotação
    router.post('/', async (req, res) => {
        try {
            const payload = { ...req.body };

            // Garante campos de auditoria
            payload.createdat  = payload.createdat  || new Date().toISOString();
            payload.timestamp  = payload.timestamp  || new Date().toISOString();
            payload.updatedat  = new Date().toISOString();

            const { data, error } = await supabase
                .from('cotacoes')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;
            res.status(201).json(data);
        } catch (err) {
            console.error('Erro ao criar cotação:', err.message);
            res.status(500).json({ error: 'Erro ao criar cotação' });
        }
    });

    // PUT /api/cotacoes/:id — atualiza cotação
    router.put('/:id', async (req, res) => {
        try {
            const payload = { ...req.body };
            payload.updatedat = new Date().toISOString();
            delete payload.id;
            delete payload.createdat;

            const { data, error } = await supabase
                .from('cotacoes')
                .update(payload)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cotação não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('Erro ao atualizar cotação:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar cotação' });
        }
    });

    // PATCH /api/cotacoes/:id — atualização parcial
    router.patch('/:id', async (req, res) => {
        try {
            const payload = { ...req.body };
            payload.updatedat = new Date().toISOString();
            delete payload.id;

            const { data, error } = await supabase
                .from('cotacoes')
                .update(payload)
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Cotação não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('Erro ao atualizar cotação:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar cotação' });
        }
    });

    // DELETE /api/cotacoes/:id
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('cotacoes')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('Erro ao excluir cotação:', err.message);
            res.status(500).json({ error: 'Erro ao excluir cotação' });
        }
    });

    return router;
};
