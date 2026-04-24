// apps/compra/routes.js
// Rotas da API de Ordens de Compra

module.exports = function(supabase) {
    const router = require('express').Router();

    // ─── Utilitários ──────────────────────────────────────────────
    function toSnakeCase(obj) {
        if (!obj || typeof obj !== 'object') return obj;
        const newObj = {};
        for (const [key, value] of Object.entries(obj)) {
            const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
            newObj[snakeKey] = value;
        }
        return newObj;
    }

    // Função auxiliar para inserir notificação global
    async function inserirNotificacao(message) {
        try {
            await supabase.from('app_notifications').insert({ message });
        } catch (err) {
            console.error('Erro ao inserir notificação:', err.message);
        }
    }

    // ─── GET /ordens/ultimo-numero ─────────────────────────────────
    router.get('/ordens/ultimo-numero', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('ordens_compra')
                .select('numero_ordem')
                .order('numero_ordem', { ascending: false })
                .limit(1);
            if (error) throw error;
            const ultimoNumero = data && data[0] ? parseInt(data[0].numero_ordem) || 0 : 0;
            res.json({ ultimoNumero });
        } catch (err) {
            console.error('GET /ordens/ultimo-numero error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /ordens?mes=&ano= ────────────────────────────────────
    router.get('/ordens', async (req, res) => {
        try {
            const { mes, ano } = req.query;
            let query = supabase.from('ordens_compra').select('*');

            if (mes !== undefined && ano !== undefined) {
                const startDate = new Date(Number(ano), Number(mes), 1);
                const endDate = new Date(Number(ano), Number(mes) + 1, 1);
                query = query
                    .gte('data_ordem', startDate.toISOString().split('T')[0])
                    .lt('data_ordem', endDate.toISOString().split('T')[0]);
            }

            const { data, error } = await query.order('numero_ordem', { ascending: true });
            if (error) throw error;
            res.json(data || []);
        } catch (err) {
            console.error('GET /ordens error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── POST /ordens ──────────────────────────────────────────────
    router.post('/ordens', async (req, res) => {
        try {
            const ordem = toSnakeCase(req.body);
            if (!ordem.items || !Array.isArray(ordem.items)) ordem.items = [];
            const { data, error } = await supabase
                .from('ordens_compra')
                .insert(ordem)
                .select()
                .single();
            if (error) throw error;
            
            // Notificação global: Ordem de Nº X aberta
            const numeroOrdem = data.numero_ordem;
            await inserirNotificacao(`Ordem de Nº ${numeroOrdem} aberta`);
            
            res.status(201).json(data);
        } catch (err) {
            console.error('POST /ordens error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PUT /ordens/:id ───────────────────────────────────────────
    router.put('/ordens/:id', async (req, res) => {
        try {
            const ordem = toSnakeCase(req.body);
            if (!ordem.items || !Array.isArray(ordem.items)) ordem.items = [];
            
            // Buscar dados antigos para obter número da ordem
            const { data: oldData, error: fetchError } = await supabase
                .from('ordens_compra')
                .select('numero_ordem')
                .eq('id', req.params.id)
                .single();
            
            if (fetchError) throw fetchError;
            
            const { data, error } = await supabase
                .from('ordens_compra')
                .update(ordem)
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) throw error;
            
            const numeroOrdem = oldData.numero_ordem;
            await inserirNotificacao(`Ordem de Nº ${numeroOrdem} atualizada`);
            
            res.json(data);
        } catch (err) {
            console.error('PUT /ordens/:id error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── DELETE /ordens/:id ────────────────────────────────────────
    router.delete('/ordens/:id', async (req, res) => {
        try {
            // Buscar ordem antes de deletar para pegar o número
            const { data: ordem, error: fetchError } = await supabase
                .from('ordens_compra')
                .select('numero_ordem')
                .eq('id', req.params.id)
                .single();
            
            if (fetchError) throw fetchError;
            
            const { error } = await supabase
                .from('ordens_compra')
                .delete()
                .eq('id', req.params.id);
            if (error) throw error;
            
            const numeroOrdem = ordem.numero_ordem;
            await inserirNotificacao(`Ordem de Nº ${numeroOrdem} excluída`);
            
            res.status(204).send();
        } catch (err) {
            console.error('DELETE /ordens/:id error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PATCH /ordens/:id/status ──────────────────────────────────
    router.patch('/ordens/:id/status', async (req, res) => {
        try {
            const { status } = req.body;
            const { data, error } = await supabase
                .from('ordens_compra')
                .update({ status })
                .eq('id', req.params.id)
                .select()
                .single();
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('PATCH /ordens/:id/status error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /fornecedores (lista única) ───────────────────────────
    router.get('/fornecedores', async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('ordens_compra')
                .select('razao_social, nome_fantasia, cnpj, endereco_fornecedor, site, contato, telefone, email')
                .order('razao_social');
            if (error) throw error;

            const unique = new Map();
            for (const f of data) {
                const key = f.razao_social?.trim().toUpperCase() || '';
                if (key && !unique.has(key)) {
                    unique.set(key, {
                        razao_social: f.razao_social,
                        nome_fantasia: f.nome_fantasia || '',
                        cnpj: f.cnpj || '',
                        endereco_fornecedor: f.endereco_fornecedor || '',
                        site: f.site || '',
                        contato: f.contato || '',
                        telefone: f.telefone || '',
                        email: f.email || ''
                    });
                }
            }
            res.json(Array.from(unique.values()));
        } catch (err) {
            console.error('GET /fornecedores error:', err);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
