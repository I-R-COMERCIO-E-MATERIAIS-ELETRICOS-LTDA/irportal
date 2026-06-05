// ============================================
// ROUTES — LUCRO REAL
// ============================================
module.exports = function (supabase) {
    const express = require('express');
    const router  = express.Router();

    async function sincronizarDoControleFrete(mesNum, anoNum) {
        try {
            const inicio  = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`;
            const fimDate = new Date(anoNum, mesNum, 0);
            const fim     = fimDate.toISOString().split('T')[0];

            console.log('[lucro] sincronizando período:', inicio, 'até', fim);

            const { data: fretes, error: erroFrete } = await supabase
                .from('controle_frete')
                .select('id, numero_nf, vendedor, data_emissao, valor_nf, valor_frete, tipo_nf')
                .gte('data_emissao', inicio)
                .lte('data_emissao', fim)
                .not('tipo_nf', 'in', '("DEVOLUCAO","CANCELADA")');

            console.log('[lucro] fretes encontrados:', fretes?.length, 'erro:', erroFrete?.message);

            if (erroFrete) throw erroFrete;
            if (!fretes || fretes.length === 0) return;

            const { data: existentes, error: erroExistentes } = await supabase
                .from('lucro_real')
                .select('numero_nf, codigo')
                .gte('data_emissao', inicio)
                .lte('data_emissao', fim);

            console.log('[lucro] existentes em lucro_real:', existentes?.length);

            if (erroExistentes) throw erroExistentes;

            const nfsExistentes = new Set((existentes || []).map(r => String(r.numero_nf)));
            const novas = fretes.filter(f => !nfsExistentes.has(String(f.numero_nf)));

            console.log('[lucro] novas a inserir:', novas.length);

            if (novas.length > 0) {
                const registros = novas.map(f => ({
                    codigo:            String(f.numero_nf),
                    nf:                String(f.numero_nf),
                    numero_nf:         String(f.numero_nf),
                    vendedor:          f.vendedor || '',
                    data_emissao:      f.data_emissao,
                    venda:             parseFloat(f.valor_nf)    || 0,
                    frete:             parseFloat(f.valor_frete) || 0,
                    custo:             0,
                    comissao:          0,
                    imposto_federal:   0,
                    custo_fixo_mensal: 0,
                    cancelada:         false,
                    frete_id:          f.id,
                    created_at:        new Date().toISOString(),
                    updated_at:        new Date().toISOString(),
                }));

                const { error: erroInsert } = await supabase.from('lucro_real').insert(registros);
                console.log('[lucro] resultado insert:', erroInsert?.message || 'OK');
            }
        } catch (err) {
            console.error('[lucro] sincronizarDoControleFrete:', err.message);
        }
    }

    async function buscarLucroMesclado(mesNum, anoNum) {
        const inicio  = `${anoNum}-${String(mesNum).padStart(2, '0')}-01`;
        const fimDate = new Date(anoNum, mesNum, 0);
        const fim     = fimDate.toISOString().split('T')[0];

        await sincronizarDoControleFrete(mesNum, anoNum);

        const { data: lucros, error: erroLucro } = await supabase
            .from('lucro_real')
            .select('*')
            .gte('data_emissao', inicio)
            .lte('data_emissao', fim)
            .order('data_emissao', { ascending: false });

        if (erroLucro) throw erroLucro;
        if (!lucros || lucros.length === 0) return [];

        const nfs = lucros.map(r => String(r.numero_nf || r.nf));
        const { data: fretes, error: erroFrete } = await supabase
            .from('controle_frete')
            .select('numero_nf, valor_nf, valor_frete, vendedor, data_emissao, tipo_nf')
            .in('numero_nf', nfs);

        if (erroFrete) throw erroFrete;

        const freteMap = {};
        (fretes || []).forEach(f => { freteMap[String(f.numero_nf)] = f; });

        const resultado = lucros.map(r => {
            const nf    = String(r.numero_nf || r.nf || '');
            const frete = freteMap[nf];
            return {
                ...r,
                nf:        nf,
                numero_nf: nf,
                vendedor:  frete ? (frete.vendedor || r.vendedor || '') : (r.vendedor || ''),
                venda:     frete ? (parseFloat(frete.valor_nf)    || 0) : (r.venda    || 0),
                frete:     frete ? (parseFloat(frete.valor_frete) || 0) : (r.frete    || 0),
                cancelada: !!r.cancelada,
            };
        });

        return resultado;
    }

    // ─── GET /api/lucro-real ─────────────────────────────────────────────────
    router.get('/lucro-real', async (req, res) => {
        try {
            const { mes, ano } = req.query;

            if (mes && ano) {
                const mesNum = parseInt(mes);
                const anoNum = parseInt(ano);
                const data   = await buscarLucroMesclado(mesNum, anoNum);
                return res.json(data);
            }

            let query = supabase
                .from('lucro_real')
                .select('*')
                .order('data_emissao', { ascending: false });

            if (ano) {
                query = query
                    .gte('data_emissao', `${ano}-01-01`)
                    .lte('data_emissao', `${ano}-12-31`);
            }

            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (err) {
            console.error('[lucro] GET /lucro-real:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── PATCH /api/lucro-real/:codigo ───────────────────────────────────────
    router.patch('/lucro-real/:codigo', async (req, res) => {
        try {
            const body = { ...req.body };
            delete body.id;
            delete body.created_at;
            delete body.venda;
            delete body.frete;
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

    // ─── DELETE /api/lucro-real/:id ──────────────────────────────────────────
    router.delete('/lucro-real/:id', async (req, res) => {
        try {
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
    router.post('/monitorar-pedidos', async (req, res) => {
        try {
            const agora = new Date();
            await sincronizarDoControleFrete(agora.getMonth() + 1, agora.getFullYear());
            res.json({ ok: true });
        } catch (err) {
            console.error('[lucro] POST /monitorar-pedidos:', err.message);
            res.status(500).json({ ok: false, error: err.message });
        }
    });

    return router;
};
