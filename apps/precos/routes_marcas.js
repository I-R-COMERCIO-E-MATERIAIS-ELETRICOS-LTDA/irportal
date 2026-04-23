// apps/precos/routes_marcas.js
const express = require('express');

module.exports = function(supabase) {
    const router = express.Router();

    // Listar todas as marcas
    router.get('/', async (req, res) => {
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

    // Criar marca
    router.post('/', async (req, res) => {
        try {
            const { nome } = req.body;
            if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
            const { data, error } = await supabase
                .from('marcas')
                .insert([{ nome: nome.trim().toUpperCase() }])
                .select()
                .single();
            if (error) throw error;
            res.status(201).json(data);
        } catch (e) {
            res.status(500).json({ error: 'Erro ao criar marca' });
        }
    });

    // Renomear marca (atualiza também a coluna legada `marca` em precos)
    router.put('/:id', async (req, res) => {
        try {
            const { nome } = req.body;
            if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
            const nomeUp = nome.trim().toUpperCase();

            const { data, error } = await supabase
                .from('marcas')
                .update({ nome: nomeUp })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) return res.status(404).json({ error: 'Marca não encontrada' });

            // Atualiza coluna legada para retrocompatibilidade
            await supabase
                .from('precos')
                .update({ marca: nomeUp })
                .eq('marca_id', req.params.id);

            res.json(data);
        } catch (e) {
            res.status(500).json({ error: 'Erro ao renomear marca' });
        }
    });

    // Excluir marca e todos os seus itens
    router.delete('/:id', async (req, res) => {
        try {
            // Remove itens vinculados
            await supabase.from('precos').delete().eq('marca_id', req.params.id);
            // Remove a marca
            const { error } = await supabase.from('marcas').delete().eq('id', req.params.id);
            if (error) throw error;
            res.status(204).end();
        } catch (e) {
            res.status(500).json({ error: 'Erro ao excluir marca' });
        }
    });

    return router;
};
