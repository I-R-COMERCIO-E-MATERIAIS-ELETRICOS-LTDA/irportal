// ============================================
// ROUTES — LUCRO REAL
// Registrado no server.js como:
//   const lucroRoutes = require('./apps/lucro/routes');
//   app.use('/api', lucroRoutes(supabase));
// ============================================
module.exports = function (supabase) {
    const express = require('express');
    const router  = express.Router();

    // ─── GET /api/lucro-real ─────────────────────────────────────────────────
    router.get('/lucro-real', async (req, res) => {
        try {
            const { mes, ano } = req.query;

            let query = supabase
                .from('lucro_real')
                .select('*')
                .order('data_emissao', { ascending: false });

            if (ano && !mes) {
                query = query
                    .gte('data_emissao', `${ano}-01-01`)
                    .lte('data_emissao', `${ano}-12-31`);
            } else if (mes && ano) {
                const mesNum  = parseInt(mes);
                const anoNum  = parseInt(ano);
                const inicio  = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`;
                const fimDate = new Date(anoNum, mesNum, 0); // último dia do mês
                const fim     = fimDate.toISOString().split('T')[0];
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }

            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('[lucro] GET /lucro-real:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PATCH /api/lucro-real/:codigo (para edição individual) ─────────────
    router.patch('/lucro-real/:codigo', async (req, res) => {
        try {
            const body = { ...req.body };
            delete body.id;
            delete body.created_at;
            body.updated_at = new Date().toISOString();

            const { data, error } = await supabase
                .from('lucro_real')
                .update(body)
                .eq('codigo', req.params.codigo)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Registro não encontrado' });
            res.json(data);
        } catch (err) {
            console.error('[lucro] PATCH /lucro-real/:codigo:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── DELETE /api/lucro-real/:id (exclusão por UUID) ────────────────────
    router.delete('/lucro-real/:id', async (req, res) => {
        try {
            // Usar o campo 'id' (UUID) para excluir
            const { error } = await supabase
                .from('lucro_real')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('[lucro] DELETE /lucro-real/:id:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/custo-fixo ─────────────────────────────────────────────────
    router.get('/custo-fixo', async (req, res) => {
        try {
            const { mes, ano } = req.query;
            if (!mes || !ano) return res.status(400).json({ error: 'mes e ano obrigatórios' });

            const mesNum  = parseInt(mes);
            const anoNum  = parseInt(ano);
            const inicio  = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`;
            const fimDate = new Date(anoNum, mesNum, 0);
            const fim     = fimDate.toISOString().split('T')[0];

            const { data, error } = await supabase
                .from('lucro_real')
                .select('custo_fixo_mensal')
                .gte('data_emissao', inicio)
                .lte('data_emissao', fim)
                .limit(1)
                .maybeSingle();

            if (error) throw error;
            res.json({ custo_fixo_mensal: data?.custo_fixo_mensal ?? 0 });
        } catch (err) {
            console.error('[lucro] GET /custo-fixo:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── POST /api/custo-fixo ────────────────────────────────────────────────
    router.post('/custo-fixo', async (req, res) => {
        try {
            const { mes, ano, custo_fixo_mensal } = req.body;
            if (!mes || !ano || custo_fixo_mensal === undefined)
                return res.status(400).json({ error: 'mes, ano e custo_fixo_mensal obrigatórios' });

            const mesNum  = parseInt(mes);
            const anoNum  = parseInt(ano);
            const inicio  = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`;
            const fimDate = new Date(anoNum, mesNum, 0);
            const fim     = fimDate.toISOString().split('T')[0];

            const { error } = await supabase
                .from('lucro_real')
                .update({ custo_fixo_mensal, updated_at: new Date().toISOString() })
                .gte('data_emissao', inicio)
                .lte('data_emissao', fim);

            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('[lucro] POST /custo-fixo:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── POST /api/monitorar-pedidos ─────────────────────────────────────────
    router.post('/monitorar-pedidos', (req, res) => res.json({ ok: true }));

    return router;
};
