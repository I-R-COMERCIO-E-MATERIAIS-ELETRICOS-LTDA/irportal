// apps/precos/routes.js
const express = require('express');

module.exports = function(supabase) {
    const router = express.Router();

    router.head('/', (req, res) => res.status(200).end());

    // Listar marcas (retrocompatibilidade — agora servido por /api/marcas)
    router.get('/marcas', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('marcas')
                .select('id, nome')
                .order('nome', { ascending: true });
            if (error) throw error;
            res.json(data || []);
        } catch (e) {
            res.status(500).json({ error: 'Erro ao buscar marcas' });
        }
    });

    // Listar preços com join de marcas
    router.get('/', async (req, res) => {
        try {
            const page  = parseInt(req.query.page)  || 1;
            const limit = Math.min(parseInt(req.query.limit) || 50, 50);
            const marca  = req.query.marca  || null;
            const search = req.query.search || null;
            const from = (page - 1) * limit;
            const to   = from + limit - 1;

            let query = supabase
                .from('precos')
                .select('*, marcas(id, nome)', { count: 'exact' })
                .order('marca', { ascending: true })
                .order('codigo', { ascending: true });

            if (marca && marca !== 'TODAS') {
                // Filtra pelo nome via join
                query = query.eq('marcas.nome', marca);
            }

            if (search) {
                query = query.or(
                    `codigo.ilike.%${search}%,marca.ilike.%${search}%,descricao.ilike.%${search}%`
                );
            }

            query = query.range(from, to);

            const { data, error, count } = await query;
            if (error) throw error;

            // Normaliza para o frontend
            const normalized = (data || []).map(p => ({
                ...p,
                marca_nome: p.marcas?.nome || p.marca || '',
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

    // Buscar preço específico
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('precos')
                .select('*, marcas(id, nome)')
                .eq('id', req.params.id)
                .single();
            if (error) return res.status(404).json({ error: 'Preço não encontrado' });
            res.json({ ...data, marca_nome: data.marcas?.nome || data.marca || '' });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao buscar preço' });
        }
    });

    // Criar preço
    router.post('/', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body;
            if (!marca || !codigo || !preco || !descricao)
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });

            // Resolve marca_id pelo nome
            const { data: marcaRow } = await supabase
                .from('marcas').select('id').eq('nome', marca.trim().toUpperCase()).single();

            const { data, error } = await supabase
                .from('precos')
                .insert([{
                    marca:     marca.trim(),
                    marca_id:  marcaRow?.id || null,
                    codigo:    codigo.trim(),
                    preco:     parseFloat(preco),
                    descricao: descricao.trim(),
                    timestamp: new Date().toISOString()
                }])
                .select('*, marcas(id, nome)')
                .single();

            if (error) throw error;
            res.status(201).json({ ...data, marca_nome: data.marcas?.nome || data.marca || '' });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao criar preço' });
        }
    });

    // Atualizar preço
    router.put('/:id', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body;
            if (!marca || !codigo || !preco || !descricao)
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });

            const { data: marcaRow } = await supabase
                .from('marcas').select('id').eq('nome', marca.trim().toUpperCase()).single();

            const { data, error } = await supabase
                .from('precos')
                .update({
                    marca:     marca.trim(),
                    marca_id:  marcaRow?.id || null,
                    codigo:    codigo.trim(),
                    preco:     parseFloat(preco),
                    descricao: descricao.trim(),
                    timestamp: new Date().toISOString()
                })
                .eq('id', req.params.id)
                .select('*, marcas(id, nome)')
                .single();

            if (error) return res.status(404).json({ error: 'Preço não encontrado' });
            res.json({ ...data, marca_nome: data.marcas?.nome || data.marca || '' });
        } catch (e) {
            res.status(500).json({ error: 'Erro ao atualizar preço' });
        }
    });

    // Deletar preço
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
