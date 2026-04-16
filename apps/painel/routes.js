// ============================================
// PAINEL — routes.js
// Agrega dados de todos os módulos para o painel
// ============================================
const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── HELPERS ────────────────────────────────────────────────────────────────

    function agruparPorMes(rows, campoData, campoValor) {
        const resultado = Array(12).fill(0);
        rows.forEach(r => {
            const d = new Date(r[campoData]);
            if (!isNaN(d)) {
                const mes = d.getUTCMonth(); // 0-11
                resultado[mes] += parseFloat(r[campoValor] || 0);
            }
        });
        return resultado;
    }

    // ─── GET /api/painel/faturamento ─────────────────────────────────────────────
    router.get('/painel/faturamento', async (req, res) => {
        try {
            const { ano, vendedor } = req.query;
            const anoAtual = parseInt(ano) || new Date().getFullYear();
            const anoAnt = anoAtual - 1;

            const campos = 'data_registro,valor_total,responsavel,status';

            let q1 = supabase.from('pedidos_faturamento').select(campos)
                .gte('data_registro', `${anoAtual}-01-01`)
                .lte('data_registro', `${anoAtual}-12-31`);
            if (vendedor) q1 = q1.ilike('responsavel', `%${vendedor}%`);
            const { data: d1 } = await q1;

            let q2 = supabase.from('pedidos_faturamento').select(campos)
                .gte('data_registro', `${anoAnt}-01-01`)
                .lte('data_registro', `${anoAnt}-12-31`);
            if (vendedor) q2 = q2.ilike('responsavel', `%${vendedor}%`);
            const { data: d2 } = await q2;

            const mesesAtual = agruparPorMes(d1 || [], 'data_registro', 'valor_total');
            const mesesAnt   = agruparPorMes(d2 || [], 'data_registro', 'valor_total');

            res.json({
                anoAtual,
                anoAnterior: anoAnt,
                mesesAtual,
                mesesAnt,
                totalAtual: mesesAtual.reduce((a, b) => a + b, 0),
                totalAnt:   mesesAnt.reduce((a, b) => a + b, 0)
            });
        } catch (err) {
            console.error('[painel] faturamento:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/painel/frete ───────────────────────────────────────────────────
    router.get('/painel/frete', async (req, res) => {
        try {
            const { ano, vendedor } = req.query;
            const anoAtual = parseInt(ano) || new Date().getFullYear();
            const anoAnt = anoAtual - 1;

            const campos = 'data_emissao,valor_frete,vendedor,data_entrega,numero_nf,valor_nf,status';

            let q1 = supabase.from('controle_frete').select(campos)
                .gte('data_emissao', `${anoAtual}-01-01`)
                .lte('data_emissao', `${anoAtual}-12-31`);
            if (vendedor) q1 = q1.ilike('vendedor', `%${vendedor}%`);
            const { data: d1 } = await q1;

            let q2 = supabase.from('controle_frete').select(campos)
                .gte('data_emissao', `${anoAnt}-01-01`)
                .lte('data_emissao', `${anoAnt}-12-31`);
            if (vendedor) q2 = q2.ilike('vendedor', `%${vendedor}%`);
            const { data: d2 } = await q2;

            const hoje = new Date().toISOString().split('T')[0];
            let qHoje = supabase.from('controle_frete').select('numero_nf,valor_nf,nome_orgao,data_entrega,vendedor')
                .eq('data_entrega', hoje)
                .eq('status', 'ENTREGUE');
            if (vendedor) qHoje = qHoje.ilike('vendedor', `%${vendedor}%`);
            const { data: entregasHoje } = await qHoje;

            const mesesAtual = agruparPorMes(d1 || [], 'data_emissao', 'valor_frete');
            const mesesAnt   = agruparPorMes(d2 || [], 'data_emissao', 'valor_frete');

            res.json({
                anoAtual,
                anoAnterior: anoAnt,
                mesesAtual,
                mesesAnt,
                totalAtual: mesesAtual.reduce((a, b) => a + b, 0),
                totalAnt:   mesesAnt.reduce((a, b) => a + b, 0),
                entregasHoje: entregasHoje || []
            });
        } catch (err) {
            console.error('[painel] frete:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/painel/vendas ──────────────────────────────────────────────────
    router.get('/painel/vendas', async (req, res) => {
        try {
            const { ano, vendedor } = req.query;
            const anoAtual = parseInt(ano) || new Date().getFullYear();
            const anoAnt = anoAtual - 1;

            const campos = 'data_emissao,valor_pago,valor_total,vendedor,status_pagamento,comissao_percentual,comissao_valor';

            let q1 = supabase.from('vendas').select(campos)
                .gte('data_emissao', `${anoAtual}-01-01`)
                .lte('data_emissao', `${anoAtual}-12-31`)
                .eq('status_pagamento', 'PAGO');
            if (vendedor) q1 = q1.ilike('vendedor', `%${vendedor}%`);
            const { data: d1 } = await q1;

            let q2 = supabase.from('vendas').select(campos)
                .gte('data_emissao', `${anoAnt}-01-01`)
                .lte('data_emissao', `${anoAnt}-12-31`)
                .eq('status_pagamento', 'PAGO');
            if (vendedor) q2 = q2.ilike('vendedor', `%${vendedor}%`);
            const { data: d2 } = await q2;

            let qRec = supabase.from('vendas').select('valor_total,valor_pago,status_pagamento,vendedor')
                .neq('status_pagamento', 'PAGO');
            if (vendedor) qRec = qRec.ilike('vendedor', `%${vendedor}%`);
            const { data: aReceber } = await qRec;

            const totalAReceber = (aReceber || []).reduce((acc, v) => {
                const pago = parseFloat(v.valor_pago || 0);
                const total = parseFloat(v.valor_total || 0);
                return acc + Math.max(0, total - pago);
            }, 0);

            const mesesAtual = agruparPorMes(d1 || [], 'data_emissao', 'valor_pago');
            const mesesAnt   = agruparPorMes(d2 || [], 'data_emissao', 'valor_pago');

            const comissoesMes = Array(12).fill(0);
            (d1 || []).forEach(v => {
                const d = new Date(v.data_emissao);
                if (!isNaN(d)) {
                    const mes = d.getUTCMonth();
                    comissoesMes[mes] += parseFloat(v.comissao_valor || 0);
                }
            });

            let qTodos = supabase.from('vendas').select(campos)
                .gte('data_emissao', `${anoAtual}-01-01`)
                .lte('data_emissao', `${anoAtual}-12-31`)
                .eq('status_pagamento', 'PAGO');
            const { data: dTodos } = await qTodos;

            const vendedores = ['ISAQUE', 'MIGUEL', 'ROBERTO'];
            const porVendedor = {};
            vendedores.forEach(vend => {
                const rows = (dTodos || []).filter(v => (v.vendedor || '').toUpperCase() === vend);
                porVendedor[vend] = {
                    meses: agruparPorMes(rows, 'data_emissao', 'valor_pago'),
                    total: rows.reduce((a, v) => a + parseFloat(v.valor_pago || 0), 0),
                    comissoes: (() => {
                        const c = Array(12).fill(0);
                        rows.forEach(v => {
                            const d = new Date(v.data_emissao);
                            if (!isNaN(d)) c[d.getUTCMonth()] += parseFloat(v.comissao_valor || 0);
                        });
                        return c;
                    })()
                };
            });

            res.json({
                anoAtual,
                anoAnterior: anoAnt,
                mesesAtual,
                mesesAnt,
                totalAtual: mesesAtual.reduce((a, b) => a + b, 0),
                totalAnt:   mesesAnt.reduce((a, b) => a + b, 0),
                totalAReceber,
                comissoesMes,
                porVendedor
            });
        } catch (err) {
            console.error('[painel] vendas:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/painel/receber ─────────────────────────────────────────────────
    router.get('/painel/receber', async (req, res) => {
        try {
            const { ano } = req.query;
            const anoAtual = parseInt(ano) || new Date().getFullYear();
            const anoAnt = anoAtual - 1;

            const campos = 'data_pagamento,valor_pago,valor,status,data_emissao';

            const { data: d1 } = await supabase.from('contas_receber').select(campos)
                .eq('status', 'PAGO')
                .gte('data_pagamento', `${anoAtual}-01-01`)
                .lte('data_pagamento', `${anoAtual}-12-31`);

            const { data: d2 } = await supabase.from('contas_receber').select(campos)
                .eq('status', 'PAGO')
                .gte('data_pagamento', `${anoAnt}-01-01`)
                .lte('data_pagamento', `${anoAnt}-12-31`);

            const { data: pendente } = await supabase.from('contas_receber').select('valor,valor_pago,status')
                .neq('status', 'PAGO');

            const totalAReceber = (pendente || []).reduce((acc, r) => {
                return acc + Math.max(0, parseFloat(r.valor || 0) - parseFloat(r.valor_pago || 0));
            }, 0);

            const mesesAtual = agruparPorMes(d1 || [], 'data_pagamento', 'valor_pago');
            const mesesAnt   = agruparPorMes(d2 || [], 'data_pagamento', 'valor_pago');

            res.json({
                anoAtual,
                anoAnterior: anoAnt,
                mesesAtual,
                mesesAnt,
                totalAtual: mesesAtual.reduce((a, b) => a + b, 0),
                totalAnt:   mesesAnt.reduce((a, b) => a + b, 0),
                totalAReceber
            });
        } catch (err) {
            console.error('[painel] receber:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/painel/pagar ───────────────────────────────────────────────────
    router.get('/painel/pagar', async (req, res) => {
        try {
            const { ano } = req.query;
            const anoAtual = parseInt(ano) || new Date().getFullYear();
            const anoAnt = anoAtual - 1;

            const campos = 'data_pagamento,valor_pago,valor,status,data_vencimento';

            const { data: d1 } = await supabase.from('contas_pagar').select(campos)
                .eq('status', 'PAGO')
                .gte('data_pagamento', `${anoAtual}-01-01`)
                .lte('data_pagamento', `${anoAtual}-12-31`);

            const { data: d2 } = await supabase.from('contas_pagar').select(campos)
                .eq('status', 'PAGO')
                .gte('data_pagamento', `${anoAnt}-01-01`)
                .lte('data_pagamento', `${anoAnt}-12-31`);

            const mesesAtual = agruparPorMes(d1 || [], 'data_pagamento', 'valor_pago');
            const mesesAnt   = agruparPorMes(d2 || [], 'data_pagamento', 'valor_pago');

            res.json({
                anoAtual,
                anoAnterior: anoAnt,
                mesesAtual,
                mesesAnt,
                totalAtual: mesesAtual.reduce((a, b) => a + b, 0),
                totalAnt:   mesesAnt.reduce((a, b) => a + b, 0),
            });
        } catch (err) {
            console.error('[painel] pagar:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/painel/lucro ───────────────────────────────────────────────────
    router.get('/painel/lucro', async (req, res) => {
        try {
            const { ano } = req.query;
            const anoAtual = parseInt(ano) || new Date().getFullYear();
            const anoAnt = anoAtual - 1;

            const campos = 'data_emissao,lucro_liquido';

            const { data: d1 } = await supabase.from('lucro_real').select(campos)
                .gte('data_emissao', `${anoAtual}-01-01`)
                .lte('data_emissao', `${anoAtual}-12-31`);

            const { data: d2 } = await supabase.from('lucro_real').select(campos)
                .gte('data_emissao', `${anoAnt}-01-01`)
                .lte('data_emissao', `${anoAnt}-12-31`);

            const mesesAtual = agruparPorMes(d1 || [], 'data_emissao', 'lucro_liquido');
            const mesesAnt   = agruparPorMes(d2 || [], 'data_emissao', 'lucro_liquido');

            res.json({
                anoAtual,
                anoAnterior: anoAnt,
                mesesAtual,
                mesesAnt,
                totalAtual: mesesAtual.reduce((a, b) => a + b, 0),
                totalAnt:   mesesAnt.reduce((a, b) => a + b, 0),
            });
        } catch (err) {
            console.error('[painel] lucro:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    // ─── GET /api/painel/estoque ─────────────────────────────────────────────────
    router.get('/painel/estoque', async (req, res) => {
        try {
            const { data, error } = await supabase.from('estoque').select('*');
            if (error) throw error;

            const porGrupo = {};
            let totalGeral = 0;
            (data || []).forEach(item => {
                const grupo = item.grupo || 'Sem Grupo';
                const valor = parseFloat(item.preco_medio || item.preco || 0) * parseFloat(item.quantidade || 0);
                if (!porGrupo[grupo]) porGrupo[grupo] = 0;
                porGrupo[grupo] += valor;
                totalGeral += valor;
            });

            res.json({ porGrupo, totalGeral });
        } catch (err) {
            console.error('[painel] estoque:', err.message);
            res.status(500).json({ error: err.message });
        }
    });

    return router;
};
