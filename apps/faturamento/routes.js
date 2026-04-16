// ============================================
// ROUTES — PEDIDOS DE FATURAMENTO
// ============================================
const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── Helper: range de mês ──────────────────────────────────────────────────────
function buildDateRange(mes, ano) {
    const m = parseInt(mes);
    const y = parseInt(ano);
    if (isNaN(m) || isNaN(y)) return null;
    const mm   = String(m + 1).padStart(2, '0');
    const last = new Date(y, m + 1, 0).getDate();
    return {
        start: `${y}-${mm}-01`,
        end:   `${y}-${mm}-${String(last).padStart(2, '0')}`
    };
}

// ─── LISTAR PEDIDOS ──────────────────────────────────────────────────────────
router.get('/pedidos', async (req, res) => {
    try {
        const { mes, ano, responsavel, status } = req.query;

        let query = supabase
            .from('pedidos_faturamento')
            .select('*')
            .order('codigo', { ascending: true });

        if (mes !== undefined && ano !== undefined) {
            const range = buildDateRange(mes, ano);
            if (range) query = query.gte('data_registro', range.start).lte('data_registro', range.end);
        }
        if (responsavel) query = query.eq('responsavel', responsavel);
        if (status)      query = query.eq('status', status);

        const { data, error } = await query;
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[faturamento] GET /pedidos:', err.message);
        res.status(500).json({ error: 'Erro ao listar pedidos' });
    }
});

// ─── PRÓXIMO CÓDIGO SEQUENCIAL ───────────────────────────────────────────────
router.get('/pedidos/ultimo-numero', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('pedidos_faturamento')
            .select('codigo')
            .order('codigo', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (error) throw error;
        res.json({ proximo: data ? data.codigo + 1 : 1 });
    } catch (err) {
        console.error('[faturamento] GET /pedidos/ultimo-numero:', err.message);
        res.status(500).json({ error: 'Erro ao obter último número' });
    }
});

// ─── BUSCAR PEDIDO POR ID ─────────────────────────────────────────────────────
router.get('/pedidos/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('pedidos_faturamento')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Pedido não encontrado' });
        res.json(data);
    } catch (err) {
        console.error('[faturamento] GET /pedidos/:id:', err.message);
        res.status(500).json({ error: 'Erro ao buscar pedido' });
    }
});

// ─── CRIAR PEDIDO ─────────────────────────────────────────────────────────────
router.post('/pedidos', async (req, res) => {
    try {
        const payload = { ...req.body };
        delete payload.id;
        delete payload.codigo;

        const { data: last } = await supabase
            .from('pedidos_faturamento')
            .select('codigo')
            .order('codigo', { ascending: false })
            .limit(1)
            .maybeSingle();

        payload.codigo     = last ? last.codigo + 1 : 1;
        payload.created_at = new Date().toISOString();
        payload.updated_at = new Date().toISOString();
        payload.timestamp  = new Date().toISOString();

        const { data, error } = await supabase
            .from('pedidos_faturamento')
            .insert([payload])
            .select()
            .single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        console.error('[faturamento] POST /pedidos:', err.message);
        res.status(500).json({ error: 'Erro ao criar pedido' });
    }
});

// ─── ATUALIZAR PEDIDO (PUT) ──────────────────────────────────────────────────
router.put('/pedidos/:id', async (req, res) => {
    try {
        const payload = { ...req.body };
        delete payload.id;
        payload.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('pedidos_faturamento')
            .update(payload)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Pedido não encontrado' });
        res.json(data);
    } catch (err) {
        console.error('[faturamento] PUT /pedidos/:id:', err.message);
        res.status(500).json({ error: 'Erro ao atualizar pedido' });
    }
});

// ─── PATCH — atualização parcial ────────────────────────────────────────────
router.patch('/pedidos/:id', async (req, res) => {
    try {
        const payload = { ...req.body };
        delete payload.id;
        payload.updated_at = new Date().toISOString();

        const { data, error } = await supabase
            .from('pedidos_faturamento')
            .update(payload)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Pedido não encontrado' });
        res.json(data);
    } catch (err) {
        console.error('[faturamento] PATCH /pedidos/:id:', err.message);
        res.status(500).json({ error: 'Erro ao atualizar pedido' });
    }
});

// ─── DELETAR PEDIDO ──────────────────────────────────────────────────────────
router.delete('/pedidos/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('pedidos_faturamento')
            .delete()
            .eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('[faturamento] DELETE /pedidos/:id:', err.message);
        res.status(500).json({ error: 'Erro ao excluir pedido' });
    }
});

// ─── ESTOQUE ──────────────────────────────────────────────────────────────────
router.get('/estoque-items/all', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('estoque')
            .select('*')
            .order('codigo', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[faturamento] GET /estoque-items/all:', err.message);
        res.status(500).json({ error: 'Erro ao listar estoque' });
    }
});

module.exports = router;
