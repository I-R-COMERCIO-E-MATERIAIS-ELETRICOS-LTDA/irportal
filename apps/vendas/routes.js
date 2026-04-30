// ============================================
// VENDAS ROUTES — /api/vendas
// ============================================
const express = require('express');

// Lista de tipos de NF que NÃO devem ser incluídos no módulo Vendas
const EXCLUDED_NF_TYPES = [
    'DEVOLUÇÃO', 'DEVOLUCAO', 'DEVOLUÇÃO DE MERCADORIA',
    'SIMPLES REMESSA', 'SIMPLES_REMESSA',
    'REMESSA DE AMOSTRA', 'REMESSA_AMOSTRA'
];

function isExcludedTipoNF(tipo) {
    if (!tipo) return false;
    const upperTipo = tipo.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    return EXCLUDED_NF_TYPES.some(ex => upperTipo.includes(ex.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase()));
}

module.exports = function (supabase) {
    const router = express.Router();

    // GET /api/vendas (listagem)
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor } = req.query;
            let query = supabase
                .from('vendas')
                .select('*')
                .order('numero_nf', { ascending: true });

            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const fimDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${fimDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }
            if (vendedor) query = query.eq('vendedor', vendedor);

            const { data, error } = await query;
            if (error) throw error;
            res.json(data || []);
        } catch (e) {
            console.error('[vendas] GET /:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // GET /api/vendas/:id
    router.get('/:id', async (req, res) => {
        if (req.params.id === 'sincronizar') return res.status(405).json({ error: 'Use POST para sincronizar' });
        try {
            const { data, error } = await supabase
                .from('vendas')
                .select('*')
                .eq('id', req.params.id)
                .single();
            if (error) return res.status(500).json({ error: error.message });
            if (!data) return res.status(404).json({ error: 'Não encontrado' });
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // POST /api/vendas/sincronizar
    router.post('/sincronizar', async (req, res) => {
        const normFrete = s => ({
            'EM_TRANSITO': 'EM TRÂNSITO',
            'EM TRANSITO': 'EM TRÂNSITO',
            'ENTREGUE': 'ENTREGUE',
            'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
            'AGUARDANDO COLETA': 'AGUARDANDO COLETA',
            'EXTRAVIADO': 'EM TRÂNSITO',
        }[s] || s || 'EM TRÂNSITO');

        const chave = (nf, vend) => `${(nf || '').trim()}||${(vend || '').toUpperCase().trim()}`;

        function processarConta(c) {
            let status = c.status || 'A RECEBER';
            let valorPago = parseFloat(c.valor_pago) || 0;
            let dataPagamento = c.data_pagamento || null;
            let obsOriginal = c.observacoes;

            try {
                const raw = c.observacoes;
                if (raw) {
                    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
                    const arrParcelas = Array.isArray(parsed?.parcelas) && parsed.parcelas.length > 0
                        ? parsed.parcelas
                        : Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.valor !== undefined
                            ? parsed
                            : null;

                    if (arrParcelas) {
                        valorPago = arrParcelas.reduce((s, p) => s + parseFloat(p.valor || p.valor_parcela || 0), 0);
                        const datas = arrParcelas.map(p => p.data || p.data_pagamento).filter(Boolean).sort();
                        dataPagamento = datas.length > 0 ? datas[datas.length - 1] : dataPagamento;
                        const valorNF = parseFloat(c.valor) || 0;
                        if (valorNF > 0 && valorPago >= valorNF) status = 'PAGO';
                        else if (arrParcelas.length > 0) status = `${arrParcelas.length}ª PARCELA`;
                    }
                    obsOriginal = typeof raw === 'string' ? raw : JSON.stringify(raw);
                }
            } catch (_) { }

            return { status_pagamento: status, valor_pago: valorPago, data_pagamento: dataPagamento, observacoes: obsOriginal };
        }

        try {
            console.log('[vendas] Iniciando sincronização...');

            // Busca fretes e contas, já filtrando tipos de NF excluídos
            let fretesRes = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO","devolvido","devolucao","DEVOLUÇÃO","DEVOLUÇAO")');

            let contasRes = await supabase.from('contas_receber').select('*');

            if (fretesRes.error) throw new Error('controle_frete: ' + fretesRes.error.message);
            if (contasRes.error) throw new Error('contas_receber: ' + contasRes.error.message);

            let fretes = (fretesRes.data || []).filter(f => !isExcludedTipoNF(f.tipo_nf));
            let contas = (contasRes.data || []).filter(c => !isExcludedTipoNF(c.tipo_nf));

            console.log(`[vendas] Fretes (após filtro): ${fretes.length} | Contas (após filtro): ${contas.length}`);

            const mapaFinal = {};

            // Base a partir do controle_frete
            for (const f of fretes) {
                const k = chave(f.numero_nf, f.vendedor);
                mapaFinal[k] = {
                    numero_nf: (f.numero_nf || '').trim(),
                    origem: 'CONTROLE_FRETE',
                    data_emissao: f.data_emissao || null,
                    valor_nf: parseFloat(f.valor_nf) || 0,
                    tipo_nf: f.tipo_nf || null,
                    nome_orgao: f.nome_orgao || f.orgao || null,
                    vendedor: f.vendedor || null,
                    documento: f.documento || null,
                    contato_orgao: f.contato_orgao || null,
                    transportadora: f.transportadora || null,
                    valor_frete: parseFloat(f.valor_frete) || 0,
                    data_coleta: f.data_coleta || null,
                    cidade_destino: f.cidade_destino || null,
                    previsao_entrega: f.previsao_entrega || null,
                    status_frete: normFrete(f.status),
                    id_controle_frete: (!isNaN(Number(f.id)) && String(f.id).length < 15) ? Number(f.id) : null,
                    status_pagamento: null,
                    banco: null,
                    data_vencimento: null,
                    data_pagamento: null,
                    valor_pago: 0,
                    observacoes: null,
                    id_contas_receber: null,
                    prioridade: 1,
                    updated_at: new Date().toISOString(),
                };
            }

            // Aplica dados de contas_receber (pagamentos)
            for (const c of contas) {
                const k = chave(c.numero_nf, c.vendedor);
                const idCR = (!isNaN(Number(c.id)) && String(c.id).length < 15) ? Number(c.id) : null;
                const pgto = processarConta(c);

                const paymentFields = {
                    status_pagamento: pgto.status_pagamento,
                    banco: c.banco || null,
                    data_vencimento: c.data_vencimento || null,
                    data_pagamento: pgto.data_pagamento,
                    valor_pago: pgto.valor_pago,
                    observacoes: pgto.observacoes,
                    id_contas_receber: idCR,
                };

                if (mapaFinal[k]) {
                    Object.assign(mapaFinal[k], paymentFields);
                    mapaFinal[k].updated_at = new Date().toISOString();
                } else {
                    // Registro exclusivo de contas_receber (sem frete)
                    mapaFinal[k] = {
                        numero_nf: (c.numero_nf || '').trim(),
                        origem: 'CONTAS_RECEBER',
                        data_emissao: c.data_emissao || null,
                        valor_nf: parseFloat(c.valor) || 0,
                        tipo_nf: c.tipo_nf || null,
                        nome_orgao: c.orgao || null,
                        vendedor: c.vendedor || null,
                        status_frete: null,
                        id_controle_frete: null,
                        ...paymentFields,
                        prioridade: 1,
                        updated_at: new Date().toISOString(),
                    };
                }
            }

            const registros = Object.values(mapaFinal);
            if (!registros.length) {
                return res.json({ success: true, message: '0 registros sincronizados (após exclusão de tipos)', total: 0 });
            }

            // Upsert em lotes
            const CHUNK = 200;
            let erros = 0;
            for (let i = 0; i < registros.length; i += CHUNK) {
                const chunk = registros.slice(i, i + CHUNK);
                const { error: uErr } = await supabase
                    .from('vendas')
                    .upsert(chunk, { onConflict: 'numero_nf,vendedor', ignoreDuplicates: false });
                if (uErr) {
                    console.error(`[vendas] Upsert chunk ${i}:`, uErr.message);
                    erros++;
                }
            }

            const msg = `${registros.length} registros sincronizados${erros ? ` (${erros} chunks com erro)` : ''}`;
            console.log('[vendas] Sync:', msg);
            res.json({ success: erros === 0, message: msg, total: registros.length });

        } catch (err) {
            console.error('[vendas] Erro geral sync:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
