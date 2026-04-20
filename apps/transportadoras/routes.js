// ============================================
// TRANSPORTADORAS - routes.js
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // GET /api/transportadoras — lista todas (com paginação opcional)
    router.get('/', async (req, res) => {
        try {
            const page  = parseInt(req.query.page)  || 1;
            const limit = parseInt(req.query.limit) || 100;
            const from  = (page - 1) * limit;
            const to    = from + limit - 1;

            const search = req.query.search || '';

            let query = supabase
                .from('transportadoras')
                .select('*', { count: 'exact' })
                .order('nome', { ascending: true })
                .range(from, to);

            if (search) {
                query = query.or(
                    `nome.ilike.%${search}%,representante.ilike.%${search}%,email.ilike.%${search}%`
                );
            }

            const { data, error, count } = await query;
            if (error) throw error;

            // Suporte à resposta simples (array) ou paginada ({ data, total, page, limit })
            if (req.query.page) {
                return res.json({ data, total: count, page, limit });
            }
            res.json(data);
        } catch (err) {
            console.error('Erro ao listar transportadoras:', err.message);
            res.status(500).json({ error: 'Erro ao listar transportadoras' });
        }
    });

    // GET /api/transportadoras/:id — busca uma transportadora
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('transportadoras')
                .select('*')
                .eq('id', req.params.id)
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Transportadora não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('Erro ao buscar transportadora:', err.message);
            res.status(500).json({ error: 'Erro ao buscar transportadora' });
        }
    });

    // POST /api/transportadoras — cria nova transportadora
    router.post('/', async (req, res) => {
        try {
            const { nome, representante, email, telefones, celulares, regioes, estados } = req.body;

            if (!nome || !email) {
                return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
            }

            const { data, error } = await supabase
                .from('transportadoras')
                .insert([{
                    nome:          nome.trim().toUpperCase(),
                    representante: representante?.trim() || '',
                    email:         email.trim().toLowerCase(),
                    telefones:     Array.isArray(telefones) ? telefones : [],
                    celulares:     Array.isArray(celulares) ? celulares : [],
                    regioes:       Array.isArray(regioes)   ? regioes   : [],
                    estados:       Array.isArray(estados)   ? estados   : [],
                    timestamp:     new Date().toISOString()
                }])
                .select()
                .single();

            if (error) throw error;
            res.status(201).json(data);
        } catch (err) {
            console.error('Erro ao criar transportadora:', err.message);
            res.status(500).json({ error: 'Erro ao criar transportadora' });
        }
    });

    // PUT /api/transportadoras/:id — atualiza transportadora (substituição total)
    router.put('/:id', async (req, res) => {
        try {
            const { nome, representante, email, telefones, celulares, regioes, estados } = req.body;

            if (!nome || !email) {
                return res.status(400).json({ error: 'Nome e e-mail são obrigatórios' });
            }

            const { data, error } = await supabase
                .from('transportadoras')
                .update({
                    nome:          nome.trim().toUpperCase(),
                    representante: representante?.trim() || '',
                    email:         email.trim().toLowerCase(),
                    telefones:     Array.isArray(telefones) ? telefones : [],
                    celulares:     Array.isArray(celulares) ? celulares : [],
                    regioes:       Array.isArray(regioes)   ? regioes   : [],
                    estados:       Array.isArray(estados)   ? estados   : []
                })
                .eq('id', req.params.id)
                .select()
                .single();

            if (error) throw error;
            if (!data) return res.status(404).json({ error: 'Transportadora não encontrada' });
            res.json(data);
        } catch (err) {
            console.error('Erro ao atualizar transportadora:', err.message);
            res.status(500).json({ error: 'Erro ao atualizar transportadora' });
        }
    });

    // DELETE /api/transportadoras/:id — exclui transportadora
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('transportadoras')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;
            res.json({ success: true });
        } catch (err) {
            console.error('Erro ao excluir transportadora:', err.message);
            res.status(500).json({ error: 'Erro ao excluir transportadora' });
        }
    });

    return router;
};
