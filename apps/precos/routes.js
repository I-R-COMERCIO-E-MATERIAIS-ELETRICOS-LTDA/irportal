// apps/precos/routes.js
const express = require('express');

module.exports = function(supabase) {
    const router = express.Router();

    router.head('/', (req, res) => res.status(200).end());

    // ─── PREÇOS ───────────────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const page   = parseInt(req.query.page)  || 1;
            const limit  = Math.min(parseInt(req.query.limit) || 50, 50);
            const marca  = req.query.marca  || null;
            const search = req.query.search || null;
            const from   = (page - 1) * limit;
            const to     = from + limit - 1;

            let query = supabase
                .from('precos')
                .select('*', { count: 'exact' })
                .order('marca', { ascending: true })
                .order('codigo', { ascending: true });

            if (marca && marca !== 'TODAS') {
                query = query.eq('marca', marca);
            }

            if (search) {
                query = query.or(
                    `codigo.ilike.%${search}%,marca.ilike.%${search}%,descricao.ilike.%${search}%`
                );
            }

            query = query.range(from, to);

            const { data, error, count } = await query;
            if (error) throw error;

            const normalized = (data || []).map(p => ({
                id: p.id,
                marca: p.marca,
                codigo: p.codigo,
                preco: p.preco,
                descricao: p.descricao,
                timestamp: p.timestamp,
                marca_nome: p.marca  // campo para manter compatibilidade com frontend
            }));

            res.json({
                data: normalized,
                total: count || 0,
                page,
                limit,
                totalPages: Math.ceil((count || 0) / limit)
            });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao buscar preços' });
        }
    });

    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('precos')
                .select('*')
                .eq('id', req.params.id)
                .single();
            if (error) return res.status(404).json({ error: 'Preço não encontrado' });
            res.json({ ...data, marca_nome: data.marca });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao buscar preço' });
        }
    });

    router.post('/', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body;
            if (!marca || !codigo || !preco || !descricao)
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });

            const { data, error } = await supabase
                .from('precos')
                .insert([{
                    marca:     marca.trim().toUpperCase(),
                    codigo:    codigo.trim(),
                    preco:     parseFloat(preco),
                    descricao: descricao.trim(),
                    timestamp: new Date().toISOString()
                }])
                .select('*')
                .single();

            if (error) throw error;
            res.status(201).json({ ...data, marca_nome: data.marca });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao criar preço' });
        }
    });

    router.put('/:id', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body;
            if (!marca || !codigo || !preco || !descricao)
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });

            const { data, error } = await supabase
                .from('precos')
                .update({
                    marca:     marca.trim().toUpperCase(),
                    codigo:    codigo.trim(),
                    preco:     parseFloat(preco),
                    descricao: descricao.trim(),
                    timestamp: new Date().toISOString()
                })
                .eq('id', req.params.id)
                .select('*')
                .single();

            if (error) return res.status(404).json({ error: 'Preço não encontrado' });
            res.json({ ...data, marca_nome: data.marca });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao atualizar preço' });
        }
    });

    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase.from('precos').delete().eq('id', req.params.id);
            if (error) throw error;
            res.status(204).end();
        } catch (e) {
            res.status(500).json({ error: 'Erro ao excluir preço' });
        }
    });

    return router;
};
