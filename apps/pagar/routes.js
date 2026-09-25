// ============================================
// ROUTES — CONTAS A PAGAR
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── Helper: busca TODAS as linhas paginando (contorna limite de 1000) ──
    async function fetchAllContas(buildQuery) {
        const PAGE_SIZE = 1000;
        let all = [];
        let from = 0;

        while (true) {
            const to = from + PAGE_SIZE - 1;
            const { data, error } = await buildQuery().range(from, to);
            if (error) throw error;
            if (!data || data.length === 0) break;
            all = all.concat(data);
            if (data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }
        return all;
    }

    // ─── GET /api/contas ────────────────────────────────────────────────────
    router.get('/contas', async (req, res) => {
        try {
            const { mes, ano } = req.query;

            const buildQuery = () => {
                let q = supabase
                    .from('contas_pagar')
                    .select('*')
                    .order('data_vencimento', { ascending: true })
                    .order('id', { ascending: true });

                if (mes && ano) {
                    const mesNum = parseInt(mes, 10);
                    const anoNum = parseInt(ano, 10);
                    const inicio = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`;
                    const fimDate = new Date(anoNum, mesNum, 0); // último dia do mês
                    const fim = fimDate.toISOString().split('T')[0];
                    q = q.gte('data_vencimento', inicio).lte('data_vencimento', fim);
                }
                return q;
            };

            const data = await fetchAllContas(buildQuery);
            res.json(data);
        } catch (err) {
            console.error('[pagar] GET /contas:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/contas/grupo/:grupoId ─────────────────────────────────────
    router.get('/contas/grupo/:grupoId', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('contas_pagar')
                .select('*')
                .eq('grupo_id', req.params.grupoId)
                .order('parcela_numero', { ascending: true });
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('[pagar] GET /contas/grupo:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── POST /api/contas ───────────────────────────────────────────────────
    router.post('/contas', async (req, res) => {
        try {
            const body = req.body;
            delete body.id;
            delete body.created_at;
            delete body.updated_at;

            const { data, error } = await supabase
                .from('contas_pagar')
                .insert([body])
                .select()
                .single();
            if (error) throw error;
            res.status(201).json(data);
        } catch (err) {
            console.error('[pagar] POST /contas:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PUT /api/contas/:id ────────────────────────────────────────────────
    router.put('/contas/:id', async (req, res) => {
        try {
            const body = { ...req.body };
            delete body.id;
            delete body.created_at;
            body.updated_at = new Date().toISOString();

            const { data, error } = await supabase
                .from('contas_pagar')
                .update(body)
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('[pagar] PUT /contas/:id:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PATCH /api/contas/:id ──────────────────────────────────────────────
    router.patch('/contas/:id', async (req, res) => {
        try {
            const updates = { ...req.body, updated_at: new Date().toISOString() };
            delete updates.id;
            delete updates.created_at;

            const { data, error } = await supabase
                .from('contas_pagar')
                .update(updates)
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('[pagar] PATCH /contas/:id:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── DELETE /api/contas/:id ─────────────────────────────────────────────
    router.delete('/contas/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('contas_pagar')
                .delete()
                .eq('id', req.params.id);
            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('[pagar] DELETE /contas/:id:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
