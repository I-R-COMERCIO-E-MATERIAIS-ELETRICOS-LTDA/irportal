// apps/precos/routes.js
const express = require('express');

module.exports = function(supabase) {
    const router = express.Router();

    router.head('/', (req, res) => res.status(200).end());

    // ─── LISTA COMPLETA DE MARCAS DISTINTAS ──────────────────────────────────
    router.get('/marcas', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('precos')
                .select('marca')
                .order('marca', { ascending: true });

            if (error) throw error;

            const marcas = [
                ...new Set(
                    (data || [])
                        .map(p => (p.marca || '').trim().toUpperCase())
                        .filter(m => m.length > 0)
                )
            ].sort();

            res.json(marcas);
        } catch (e) {
            console.error('Erro ao buscar marcas:', e);
            res.status(500).json({ error: 'Erro ao buscar marcas' });
        }
    });

    // ─── LISTAGEM DE PREÇOS COM PAGINAÇÃO ─────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const page  = Math.max(1, parseInt(req.query.page)  || 1);
            const limit = Math.min(Math.max(1, parseInt(req.query.limit) || 50), 50);
            const marca  = (req.query.marca  || '').trim() || null;
            const search = (req.query.search || '').trim() || null;
            const from   = (page - 1) * limit;
            const to     = from + limit - 1;

            // ── query principal ───────────────────────────────────────────────
            let query = supabase
                .from('precos')
                .select('*', { count: 'exact' })
                .order('marca',  { ascending: true })
                .order('codigo', { ascending: true });

            if (marca && marca.toUpperCase() !== 'TODAS') {
                query = query.eq('marca', marca.toUpperCase());
            }

            if (search) {
                query = query.or(
                    `codigo.ilike.%${search}%,marca.ilike.%${search}%,descricao.ilike.%${search}%`
                );
            }

            query = query.range(from, to);

            const { data, error, count } = await query;

            if (error) {
                console.error('Supabase query error (GET /):', error);
                return res.status(500).json({ error: 'Erro ao buscar preços: ' + (error.message || error) });
            }

            const normalized = (data || []).map(p => ({
                id:         p.id,
                marca:      p.marca       || '',
                codigo:     p.codigo      || '',
                preco:      p.preco       ?? 0,
                descricao:  p.descricao   || '',
                timestamp:  p.timestamp   || null,
                marca_nome: p.marca       || ''
            }));

            const total      = typeof count === 'number' ? count : normalized.length;
            const totalPages = Math.max(1, Math.ceil(total / limit));

            res.json({ data: normalized, total, page, limit, totalPages });
        } catch (e) {
            console.error('Erro inesperado ao buscar preços:', e);
            res.status(500).json({ error: 'Erro interno ao buscar preços' });
        }
    });

    // ─── BUSCA POR ID ─────────────────────────────────────────────────────────
    router.get('/:id', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('precos')
                .select('*')
                .eq('id', req.params.id)
                .single();

            if (error || !data) return res.status(404).json({ error: 'Preço não encontrado' });

            res.json({ ...data, marca_nome: data.marca || '' });
        } catch (e) {
            console.error('Erro ao buscar preço por id:', e);
            res.status(500).json({ error: 'Erro interno ao buscar preço' });
        }
    });

    // ─── CRIAR PREÇO ──────────────────────────────────────────────────────────
    router.post('/', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body || {};

            if (!marca || !codigo || preco === undefined || preco === null || !descricao) {
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
            }

            const precoNum = parseFloat(preco);
            if (isNaN(precoNum) || precoNum <= 0) {
                return res.status(400).json({ error: 'Preço deve ser um número maior que zero' });
            }

            const codigoNorm   = String(codigo).trim();
            const marcaNorm    = String(marca).trim().toUpperCase();
            const descricaoNorm = String(descricao).trim().toUpperCase();

            // verifica duplicata de código
            const { data: existing, error: checkError } = await supabase
                .from('precos')
                .select('id')
                .eq('codigo', codigoNorm)
                .maybeSingle();

            if (checkError) throw checkError;
            if (existing) {
                return res.status(409).json({ error: 'Já existe um preço cadastrado com este código' });
            }

            const { data, error } = await supabase
                .from('precos')
                .insert([{
                    marca:     marcaNorm,
                    codigo:    codigoNorm,
                    preco:     precoNum,
                    descricao: descricaoNorm,
                    timestamp: new Date().toISOString()
                }])
                .select('*')
                .single();

            if (error) throw error;

            res.status(201).json({ ...data, marca_nome: data.marca || '' });
        } catch (e) {
            console.error('Erro ao criar preço:', e);
            res.status(500).json({ error: 'Erro interno ao criar preço' });
        }
    });

    // ─── ATUALIZAR PREÇO ──────────────────────────────────────────────────────
    router.put('/:id', async (req, res) => {
        try {
            const { marca, codigo, preco, descricao } = req.body || {};

            if (!marca || !codigo || preco === undefined || preco === null || !descricao) {
                return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
            }

            const precoNum = parseFloat(preco);
            if (isNaN(precoNum) || precoNum <= 0) {
                return res.status(400).json({ error: 'Preço deve ser um número maior que zero' });
            }

            const codigoNorm    = String(codigo).trim();
            const marcaNorm     = String(marca).trim().toUpperCase();
            const descricaoNorm = String(descricao).trim().toUpperCase();

            // verifica duplicata de código (excluindo o próprio registro)
            const { data: existing, error: checkError } = await supabase
                .from('precos')
                .select('id')
                .eq('codigo', codigoNorm)
                .neq('id', req.params.id)
                .maybeSingle();

            if (checkError) throw checkError;
            if (existing) {
                return res.status(409).json({ error: 'Já existe outro preço cadastrado com este código' });
            }

            const { data, error } = await supabase
                .from('precos')
                .update({
                    marca:     marcaNorm,
                    codigo:    codigoNorm,
                    preco:     precoNum,
                    descricao: descricaoNorm,
                    timestamp: new Date().toISOString()
                })
                .eq('id', req.params.id)
                .select('*')
                .single();

            if (error || !data) return res.status(404).json({ error: 'Preço não encontrado' });

            res.json({ ...data, marca_nome: data.marca || '' });
        } catch (e) {
            console.error('Erro ao atualizar preço:', e);
            res.status(500).json({ error: 'Erro interno ao atualizar preço' });
        }
    });

    // ─── EXCLUIR PREÇO ────────────────────────────────────────────────────────
    router.delete('/:id', async (req, res) => {
        try {
            const { error } = await supabase
                .from('precos')
                .delete()
                .eq('id', req.params.id);

            if (error) throw error;

            res.status(204).end();
        } catch (e) {
            console.error('Erro ao excluir preço:', e);
            res.status(500).json({ error: 'Erro interno ao excluir preço' });
        }
    });

    return router;
};
