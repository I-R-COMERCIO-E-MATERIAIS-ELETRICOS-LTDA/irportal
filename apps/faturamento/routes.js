// ============================================
// PEDIDOS DE FATURAMENTO - routes.js
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ── Helper: range de mês ─────────────────────────────────────────────────
    function buildDateRange(mes, ano) {
        const m = parseInt(mes);
        const y = parseInt(ano);
        if (isNaN(m) || isNaN(y)) return null;
        // data_registro é do tipo date (YYYY-MM-DD)
        const mm   = String(m + 1).padStart(2, '0');
        const last = new Date(y, m + 1, 0).getDate();
        return {
            start: `${y}-${mm}-01`,
            end:   `${y}-${mm}-${String(last).padStart(2, '0')}`
        };
    }

    // GET /api/pedidos/me — retorna dados do usuário autenticado
    router.get('/me', (req, res) => {
        if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
        res.json(req.user);
    });

    // GET /api/pedidos — lista pedidos (filtro por mês/ano via data_registro)
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, responsavel, status } = req.query;

            let query = supabase
                .from('pedidos_faturamento')
                .select('*')
                .order('codigo', { ascending: true });

            if (mes !== undefined && ano !== undefined) {
                const range = buildDateRange(mes, ano);
                if (range) {
                    query = query
                        .gte('data_registro', range.start)
                        .lte('data_registro', range.end);
                }
            }

            if (responsavel) query = query.eq('responsavel', responsavel);
            if (status)      query = query.eq('status', status);

            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar pedidos:', err.message);
            res.status(500).json({ error: 'Erro ao listar pedidos' });
        }
    });

    // GET /api/pedidos/ultimo-numero — próximo código sequencial
    router.get('/ultimo-numero', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('pedidos_faturamento')
                .select('codigo')
                .order('codigo', { ascending: false })
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            const proximo = data ? data.codigo + 1 : 1;
            res.json({ proximo });
        } catch (err) {
            console.error('Erro ao obter último número:', err.message);
            res.status(500).json({ error: 'Erro ao obter último número' });
        }
    });

    // GET /api/pedidos/:id
    router.get('/:id', async (req, res) => {
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
            console.error('Erro ao buscar pedido:', err.message);
            res.status(500).json({ error: 'Erro ao buscar pedido' });
        }
    });

    // POST /api/pedidos — cria novo pedido (código gerado pelo banco via sequence)
    router.post('/', async (req, res) => {
        try {
            const payload = { ...req.body };
            delete payload.id;     // o banco gera o UUID
            delete payload.codigo; // o banco gera via serial / unique constraint

            // Obtém o próximo código manualmente (sem race condition em mono-tenant)
            const { data: last } = await supabase
                .from('pedidos_faturamento')
                .select('codigo')
                .order('codigo', { ascending: false })
                .limit(1)
                .maybeSingle();

            payload.codigo      = last ? last.codigo + 1 : 1;
            payload.created_at  = new Date().toISOString();
            payload.updated_at  = new Date().toISOString();
            payload.timestamp   = new Date().toISOString();

            const { data, error } = await supabase
                .from('pedidos_faturamento')
                .insert([payload])
                .select()
                .single();

            if (error) throw error;
            res.status(201).json(data);
        } catch (err) {
            console.error('Erro ao criar pedido:', err.message);
            res.status(500).json({ error: 'Erro ao criar pedido' });
        }
    });

    // PUT /api/pedidos/:id — atualização completa
    router.put('/:id', async (req, res) => {
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
            console.error('Erro ao atualizar pedido:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar pedido' });
        }
    });

    // PATCH /api/pedidos/:id — atualização parcial (status, data_emissao, etc.)
    router.patch('/:id', async (req, res) => {
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
            console.error('Erro ao atualizar pedido (patch):', err.message);
            res.status(500).json({ error: 'Erro ao atualizar pedido' });
        }
    });

    // DELETE /api/pedidos/:id
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('pedidos_faturamento')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('Erro ao excluir pedido:', err.message);
            res.status(500).json({ error: 'Erro ao excluir pedido' });
        }
    });

    // ── Estoque ───────────────────────────────────────────────────────────────
    // GET /api/estoque — lista itens de estoque
    router.get('/estoque-items/all', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('estoque')
                .select('*')
                .order('codigo', { ascending: true });

            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar estoque:', err.message);
            res.status(500).json({ error: 'Erro ao listar estoque' });
        }
    });

    return router;
};
