const express = require('express');
module.exports = function (supabase) {
    const router = express.Router();

    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor, status_frete, status_pagamento } = req.query;
            let query = supabase.from('vendas').select('*').order('data_emissao', { ascending: false });
            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }
            if (vendedor) query = query.eq('vendedor', vendedor);
            if (status_frete) query = query.eq('status_frete', status_frete);
            if (status_pagamento) query = query.eq('status_pagamento', status_pagamento);
            const { data, error } = await query;
            if (error) throw error;
            res.json(data);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.get('/:id', async (req, res) => {
        const { data, error } = await supabase.from('vendas').select('*').eq('id', req.params.id).single();
        if (error) return res.status(500).json({ error: error.message });
        if (!data) return res.status(404).json({ error: 'Não encontrado' });
        res.json(data);
    });

    router.post('/sincronizar', async (req, res) => {
        try {
            let inseridos = 0, atualizados = 0;

            // FREInclusão de fretes (exceto devolução/dev)
            const { data: fretes, error: fErr } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO")');
            if (fErr) throw fErr;

            for (const f of fretes) {
                const statusMap = { 'EM_TRANSITO':'EM TRÂNSITO', 'ENTREGUE':'ENTREGUE', 'AGUARDANDO_COLETA':'AGUARDANDO COLETA', 'EXTRAVIADO':'EXTRAVIADO' };
                const payload = {
                    numero_nf: f.numero_nf, origem: 'CONTROLE_FRETE',
                    data_emissao: f.data_emissao, valor_nf: parseFloat(f.valor_nf)||0,
                    tipo_nf: f.tipo_nf, nome_orgao: f.nome_orgao, vendedor: f.vendedor,
                    documento: f.documento, contato_orgao: f.contato_orgao,
                    transportadora: f.transportadora, valor_frete: parseFloat(f.valor_frete)||0,
                    data_coleta: f.data_coleta, cidade_destino: f.cidade_destino,
                    previsao_entrega: f.previsao_entrega,
                    status_frete: statusMap[f.status] || f.status,
                    id_controle_frete: f.id, updated_at: new Date().toISOString()
                };
                const { data: exist } = await supabase.from('vendas').select('id').eq('numero_nf', f.numero_nf).eq('vendedor', f.vendedor).maybeSingle();
                if (exist) {
                    await supabase.from('vendas').update(payload).eq('id', exist.id);
                    atualizados++;
                } else {
                    await supabase.from('vendas').insert([{...payload, prioridade:1}]);
                    inseridos++;
                }
            }

            // CONTAS A RECEBER (apenas PAGO ou PARCELA)
            const { data: contas, error: cErr } = await supabase
                .from('contas_receber')
                .select('*')
                .or('status.eq.PAGO,status.ilike.%PARCELA%');
            if (cErr) throw cErr;

            for (const c of contas) {
                let valorPago = parseFloat(c.valor_pago)||0;
                try {
                    const obs = c.observacoes;
                    if (obs) {
                        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
                        if (parsed?.parcelas?.length) valorPago = parsed.parcelas.reduce((s,p)=>s+parseFloat(p.valor||0),0);
                    }
                } catch {}
                const pay = {
                    banco: c.banco, data_vencimento: c.data_vencimento,
                    data_pagamento: c.data_pagamento, status_pagamento: c.status,
                    valor_pago: valorPago, id_contas_receber: c.id,
                    updated_at: new Date().toISOString()
                };
                const { data: exist } = await supabase.from('vendas').select('id').eq('numero_nf', c.numero_nf).eq('vendedor', c.vendedor).maybeSingle();
                if (exist) {
                    await supabase.from('vendas').update(pay).eq('id', exist.id);
                    atualizados++;
                } else {
                    const novo = {
                        numero_nf: c.numero_nf, origem: 'CONTAS_RECEBER',
                        data_emissao: c.data_emissao, valor_nf: parseFloat(c.valor)||0,
                        tipo_nf: c.tipo_nf, nome_orgao: c.orgao, vendedor: c.vendedor,
                        ...pay, prioridade:1
                    };
                    await supabase.from('vendas').insert([novo]);
                    inseridos++;
                }
            }

            console.log(`[vendas] Sync: ${inseridos} inseridos, ${atualizados} atualizados`);
            res.json({ success:true, message:`${inseridos} inseridos, ${atualizados} atualizados` });
        } catch (err) {
            console.error('[vendas] Erro sync:', err);
            res.status(500).json({ success:false, error:err.message });
        }
    });

    return router;
};
