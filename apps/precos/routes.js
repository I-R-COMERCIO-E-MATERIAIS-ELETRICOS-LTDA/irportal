// apps/precos/routes.js
const express = require('express');
const { randomUUID } = require('crypto'); // nativo do Node.js — sem dependência extra

module.exports = function(supabase) {
    const router = express.Router();

    router.head('/', (req, res) => res.status(200).end());

    // ─── LISTA COMPLETA DE MARCAS DISTINTAS ──────────────────────────────────
    router.get('/marcas', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('precos')
                .select('marca')
                .not('marca', 'is', null)
                .order('marca', { ascending: true });

            if (error) {
                console.error('Supabase error (GET /marcas):', JSON.stringify(error));
                return res.status(500).json({ error: 'Erro ao buscar marcas: ' + (error.message || error.code || 'desconhecido') });
            }

            const marcas = [
                ...new Set(
                    (data || [])
                        .map(p => (p.marca || '').trim().toUpperCase())
                        .filter(m => m.length > 0)
                )
            ].sort();

            res.json(marcas);
        } catch (e) {
            console.error('Erro inesperado ao buscar marcas:', e);
            res.status(500).json({ error: 'Erro interno ao buscar marcas' });
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

            let query = supabase
                .from('precos')
                .select('*', { count: 'exact' })
                .order('marca',  { ascending: true })
                .order('codigo', { ascending: true });

            if (marca && marca.toUpperCase() !== 'TODAS') {
                query = query.ilike('marca', marca.toUpperCase());
            }

            if (search) {
                // Sanitiza o termo de busca para evitar problemas com caracteres especiais
                const s = search.replace(/[%_\\]/g, '\\$&');
                query = query.or(
                    `codigo.ilike.%${s}%,marca.ilike.%${s}%,descricao.ilike.%${s}%`
                );
            }

            query = query.range(from, to);

            const { data, error, count } = await query;

            if (error) {
                console.error('Supabase query error (GET /):', JSON.stringify(error));
                return res.status(500).json({
                    error: 'Erro ao buscar preços: ' + (error.message || error.code || 'desconhecido')
                });
            }

            const normalized = (data || []).map(p => ({
                id:         p.id,
                marca:      (p.marca     || '').trim().toUpperCase(),
                codigo:     (p.codigo    || '').trim(),
                preco:      parseFloat(p.preco) || 0,
                descricao:  (p.descricao || '').trim().toUpperCase(),
                timestamp:  p.timestamp  || null,
                marca_nome: (p.marca     || '').trim().toUpperCase()
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
            const id = req.params.id;

            // Valida se o ID tem formato minimamente aceitável
            if (!id || id === 'undefined' || id === 'null') {
                return res.status(400).json({ error: 'ID inválido' });
            }

            const { data, error } = await supabase
                .from('precos')
                .select('*')
                .eq('id', id)
                .maybeSingle(); // maybeSingle não lança erro quando não encontra

            if (error) {
                console.error('Supabase error (GET /:id):', JSON.stringify(error));
                return res.status(500).json({ error: 'Erro ao buscar preço: ' + (error.message || error.code) });
            }

            if (!data) {
                return res.status(404).json({ error: 'Preço não encontrado' });
            }

            res.json({
                ...data,
                marca:      (data.marca     || '').trim().toUpperCase(),
                descricao:  (data.descricao || '').trim().toUpperCase(),
                marca_nome: (data.marca     || '').trim().toUpperCase()
            });
        } catch (e) {
            console.error('Erro inesperado ao buscar preço por id:', e);
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

            const codigoNorm    = String(codigo).trim();
            const marcaNorm     = String(marca).trim().toUpperCase();
            const descricaoNorm = String(descricao).trim().toUpperCase();

            if (!codigoNorm || !marcaNorm || !descricaoNorm) {
                return res.status(400).json({ error: 'Campos não podem ser vazios após formatação' });
            }

            // Verifica duplicata de código
            const { data: existing, error: checkError } = await supabase
                .from('precos')
                .select('id')
                .eq('codigo', codigoNorm)
                .maybeSingle();

            if (checkError) {
                console.error('Supabase error (POST / - check duplicate):', JSON.stringify(checkError));
                return res.status(500).json({ error: 'Erro ao verificar duplicata: ' + (checkError.message || checkError.code) });
            }

            if (existing) {
                return res.status(409).json({ error: 'Já existe um preço cadastrado com este código' });
            }

            const { data, error } = await supabase
                .from('precos')
                .insert([{
                    id:        randomUUID(),   // gera UUID explicitamente — evita conflito de pkey
                    marca:     marcaNorm,
                    codigo:    codigoNorm,
                    preco:     precoNum,
                    descricao: descricaoNorm,
                    timestamp: new Date().toISOString()
                }])
                .select('*')
                .single();

            if (error) {
                console.error('Supabase error (POST / - insert):', JSON.stringify(error));
                return res.status(500).json({ error: 'Erro ao criar preço: ' + (error.message || error.code) });
            }

            res.status(201).json({
                ...data,
                marca_nome: (data.marca || '').trim().toUpperCase()
            });
        } catch (e) {
            console.error('Erro inesperado ao criar preço:', e);
            res.status(500).json({ error: 'Erro interno ao criar preço' });
        }
    });

    // ─── ATUALIZAR PREÇO ──────────────────────────────────────────────────────
    router.put('/:id', async (req, res) => {
        try {
            const id = req.params.id;

            if (!id || id === 'undefined' || id === 'null') {
                return res.status(400).json({ error: 'ID inválido' });
            }

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

            if (!codigoNorm || !marcaNorm || !descricaoNorm) {
                return res.status(400).json({ error: 'Campos não podem ser vazios após formatação' });
            }

            // Verifica duplicata de código (excluindo o próprio registro)
            const { data: existing, error: checkError } = await supabase
                .from('precos')
                .select('id')
                .eq('codigo', codigoNorm)
                .neq('id', id)
                .maybeSingle();

            if (checkError) {
                console.error('Supabase error (PUT /:id - check duplicate):', JSON.stringify(checkError));
                return res.status(500).json({ error: 'Erro ao verificar duplicata: ' + (checkError.message || checkError.code) });
            }

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
                .eq('id', id)
                .select('*')
                .maybeSingle(); // maybeSingle para não lançar erro se não encontrar

            if (error) {
                console.error('Supabase error (PUT /:id - update):', JSON.stringify(error));
                return res.status(500).json({ error: 'Erro ao atualizar preço: ' + (error.message || error.code) });
            }

            if (!data) {
                return res.status(404).json({ error: 'Preço não encontrado' });
            }

            res.json({
                ...data,
                marca_nome: (data.marca || '').trim().toUpperCase()
            });
        } catch (e) {
            console.error('Erro inesperado ao atualizar preço:', e);
            res.status(500).json({ error: 'Erro interno ao atualizar preço' });
        }
    });

    // ─── EXCLUIR PREÇO ────────────────────────────────────────────────────────
    router.delete('/:id', async (req, res) => {
        try {
            const id = req.params.id;

            if (!id || id === 'undefined' || id === 'null') {
                return res.status(400).json({ error: 'ID inválido' });
            }

            // Verifica se o registro existe antes de deletar
            const { data: existing, error: checkError } = await supabase
                .from('precos')
                .select('id')
                .eq('id', id)
                .maybeSingle();

            if (checkError) {
                console.error('Supabase error (DELETE /:id - check):', JSON.stringify(checkError));
                return res.status(500).json({ error: 'Erro ao verificar preço: ' + (checkError.message || checkError.code) });
            }

            if (!existing) {
                return res.status(404).json({ error: 'Preço não encontrado' });
            }

            const { error } = await supabase
                .from('precos')
                .delete()
                .eq('id', id);

            if (error) {
                console.error('Supabase error (DELETE /:id - delete):', JSON.stringify(error));
                return res.status(500).json({ error: 'Erro ao excluir preço: ' + (error.message || error.code) });
            }

            res.status(204).end();
        } catch (e) {
            console.error('Erro inesperado ao excluir preço:', e);
            res.status(500).json({ error: 'Erro interno ao excluir preço' });
        }
    });

    return router;
};
