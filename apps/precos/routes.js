// apps/precos/routes.js
// Rotas da API de Preços
const express = require('express');

module.exports = function(supabase) {
    const router = express.Router();

    // HEAD - verificação de disponibilidade
    router.head('/', (req, res) => res.status(200).end());

    // Listar marcas disponíveis
    router.get('/marcas', async (req, res) => {
        try {
            const { data, error } = await supabase.from('precos').select('marca');
            if (error) throw error;
            const marcas = [...new Set((data || []).map(r => r.marca?.trim()).filter(Boolean))].sort();
            res.json(marcas);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao buscar marcas' });
        }
    });

    // Listar preços (com paginação e filtros)
    router.get('/', async (req, res) => {
        try {
            const page = parseInt(req.query.page) || 1;
            const limit = Math.min(parseInt(req.query.limit) || 50, 50);
            const marca = req.query.marca || null;
            const search = req.query.search || null;

            const from = (page - 1) * limit;
            const to = from + limit - 1;

            let query = supabase
                .from('precos')
                .select('*', { count: 'exact' })
                .order('marca', { ascending: true })
                .order('codigo', { ascending: true });

            if (marca && marca !== 'TODAS') {
                query = query.eq('marca', marca);
            }

            if (search) {
                query = query.or(`codigo.ilike.%${search}%,marca.ilike.%${search}%,descricao.ilike.%${search}%`);
            }

            query = query.range(from, to);

            const { data, error, count } = await query;
            if (error) throw error;

            res.json({
                data: data || [],
                total: count || 0,
                page,
                limit,
                totalPages: Math.ceil((count || 0) / limit)
            });
        } catch (error) {
            res.status(500).json({ error: 'Erro ao buscar preços' });
        }
    });

    // Buscar preço específico
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('precos')
                .select('*')
                .eq('id', req.params.id)
                .single();

            if (error) return res.status(404).json({ error: 'Preço não encontrado' });
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao buscar preço' });
        }
    });

    // Criar preço
    router.post('/', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body;

            if (!marca || !codigo || !preco || !descricao) {
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
            }

            const { data, error } = await supabase
                .from('precos')
                .insert([{
                    marca: marca.trim(),
                    codigo: codigo.trim(),
                    preco: parseFloat(preco),
                    descricao: descricao.trim(),
                    timestamp: new Date().toISOString()
                }])
                .select()
                .single();

            if (error) throw error;
            res.status(201).json(data);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao criar preço' });
        }
    });

    // Atualizar preço
    router.put('/:id', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body;

            if (!marca || !codigo || !preco || !descricao) {
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
            }

            const { data, error } = await supabase
                .from('precos')
                .update({
                    marca: marca.trim(),
                    codigo: codigo.trim(),
                    preco: parseFloat(preco),
                    descricao: descricao.trim(),
                    timestamp: new Date().toISOString()
                })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) return res.status(404).json({ error: 'Preço não encontrado' });
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao atualizar preço' });
        }
    });

    // Deletar preço
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('precos')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;
            res.status(204).end();
        } catch (error) {
            res.status(500).json({ error: 'Erro ao excluir preço' });
        }
    });

    return router;
};
