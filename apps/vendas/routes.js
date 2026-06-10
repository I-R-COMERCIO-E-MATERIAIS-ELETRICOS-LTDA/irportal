const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    // ─── Tipos de NF que devem ser ignorados ─────────────────────────────────
    const EXCLUDED_NF_TYPES = [
        'DEVOLUCAO', 'DEVOLVIDA', 'REMESSA_AMOSTRA', 'SIMPLES_REMESSA', 'CANCELADA'
    ];

    function isExcludedTipoNF(tipo) {
        if (!tipo) return false;
        const n = tipo.toUpperCase().trim()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, '_');
        return EXCLUDED_NF_TYPES.some(ex => n.includes(ex));
    }

    function normalizeNF(numeroNF) {
        if (!numeroNF) return '';
        const str = String(numeroNF).trim().replace(/^0+/, '');
        return str || '0';
    }

    function makeKey(numeroNF) {
        return normalizeNF(numeroNF);
    }

    const STATUS_FRETE_MAP = {
        'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
        'EM_TRANSITO':       'EM TRÂNSITO',
        'ENTREGUE':          'ENTREGUE',
        'EXTRAVIADO':        'EXTRAVIADO',
        'DEVOLVIDO':         'DEVOLVIDO',
        'FORA_DO_PRAZO':     'FORA DO PRAZO'
    };

    function normalizeStatusFrete(status) {
        if (!status) return 'EM TRÂNSITO';
        const upper = status.toUpperCase().trim();
        return STATUS_FRETE_MAP[upper] || upper.replace(/_/g, ' ');
    }

    // ─── Determina status final do registro ──────────────────────────────────
    // PAGO é superior a qualquer status de frete
    // FORA DO PRAZO: data_coleta < hoje e status_frete != ENTREGUE
    function resolveStatusFinal(record) {
        if (record.data_pagamento) return 'PAGO';
        const sf = normalizeStatusFrete(record.status_frete);
        if (sf === 'ENTREGUE') return 'ENTREGUE';
        if (sf === 'FORA DO PRAZO') return 'FORA DO PRAZO';
        // Verifica se está fora do prazo pela previsão de entrega
        if (record.previsao_entrega) {
            const previsao = new Date(record.previsao_entrega);
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            if (previsao < hoje && sf !== 'ENTREGUE') return 'FORA DO PRAZO';
        }
        return sf || 'EM TRÂNSITO';
    }

    function sanitize(record) {
        const {
            id,
            id_controle_frete,
            id_contas_receber,
            observacoes,
            numero_parcela,
            chave_parcela,
            prioridade,
            created_at,
            ...safe
        } = record;
        return safe;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/vendas
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor } = req.query;
            let query = supabase.from('vendas').select('*').order('numero_nf', { ascending: true });

            if (mes && ano) {
                const inicio    = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const ultimoDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim       = `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia}`;
                query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
            }
            if (vendedor) query = query.eq('vendedor', vendedor);

            const { data, error } = await query;
            if (error) throw error;
            res.json(data || []);
        } catch (e) {
            console.error('[vendas] GET / erro:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/vendas/metricas?vendedor=X&ano=Y
    // Retorna métricas mensais e anuais para gráficos
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/metricas', async (req, res) => {
        try {
            const { vendedor, ano } = req.query;
            let query = supabase.from('vendas').select('*');
            if (vendedor) query = query.eq('vendedor', vendedor);

            const { data, error } = await query;
            if (error) throw error;

            const registros = data || [];

            // Agrupa por ano e mês
            const porAnoMes = {};
            const porAno = {};

            for (const v of registros) {
                const valorNF   = parseFloat(v.valor_nf)   || 0;
                const valorPago = parseFloat(v.valor_pago) || 0;

                // FATURADO: por data_emissao
                if (v.data_emissao) {
                    const d = new Date(v.data_emissao + 'T00:00:00');
                    const a = d.getFullYear();
                    const m = d.getMonth();

                    if (!porAnoMes[a]) porAnoMes[a] = Array.from({ length: 12 }, () => ({ faturado: 0, pago: 0, a_receber: 0 }));
                    if (!porAno[a]) porAno[a] = { faturado: 0, pago: 0, a_receber: 0 };

                    porAnoMes[a][m].faturado += valorNF;
                    porAno[a].faturado += valorNF;
                }

                // PAGO: por data_pagamento
                if (v.data_pagamento) {
                    const d = new Date(v.data_pagamento + 'T00:00:00');
                    const a = d.getFullYear();
                    const m = d.getMonth();

                    if (!porAnoMes[a]) porAnoMes[a] = Array.from({ length: 12 }, () => ({ faturado: 0, pago: 0, a_receber: 0 }));
                    if (!porAno[a]) porAno[a] = { faturado: 0, pago: 0, a_receber: 0 };

                    const vp = valorPago || valorNF;
                    porAnoMes[a][m].pago += vp;
                    porAno[a].pago += vp;
                }

                // A RECEBER: entregue e não pago (por emissão)
                const sf = normalizeStatusFrete(v.status_frete);
                if (sf === 'ENTREGUE' && !v.data_pagamento && v.data_emissao) {
                    const d = new Date(v.data_emissao + 'T00:00:00');
                    const a = d.getFullYear();
                    const m = d.getMonth();

                    if (!porAnoMes[a]) porAnoMes[a] = Array.from({ length: 12 }, () => ({ faturado: 0, pago: 0, a_receber: 0 }));
                    if (!porAno[a]) porAno[a] = { faturado: 0, pago: 0, a_receber: 0 };

                    porAnoMes[a][m].a_receber += valorNF;
                    porAno[a].a_receber += valorNF;
                }
            }

            res.json({ porAnoMes, porAno });
        } catch (e) {
            console.error('[vendas] GET /metricas erro:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/vendas/ranking?ano=Y
    // Retorna ranking de vendedores (apenas admins devem chamar)
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/ranking', async (req, res) => {
        try {
            const { ano } = req.query;
            const { data, error } = await supabase.from('vendas').select('*');
            if (error) throw error;

            const vendedores = ['ROBERTO', 'ISAQUE', 'MIGUEL'];
            const porAno = {};

            for (const v of (data || [])) {
                if (!v.vendedor) continue;
                const vend = v.vendedor.toUpperCase().trim();
                if (!vendedores.includes(vend)) continue;

                const valorNF   = parseFloat(v.valor_nf)   || 0;
                const valorPago = parseFloat(v.valor_pago) || 0;

                // FATURADO por emissão
                if (v.data_emissao) {
                    const a = new Date(v.data_emissao + 'T00:00:00').getFullYear();
                    if (!porAno[a]) porAno[a] = {};
                    if (!porAno[a][vend]) porAno[a][vend] = { faturado: 0, pago: 0 };
                    porAno[a][vend].faturado += valorNF;
                }

                // PAGO por pagamento
                if (v.data_pagamento) {
                    const a = new Date(v.data_pagamento + 'T00:00:00').getFullYear();
                    if (!porAno[a]) porAno[a] = {};
                    if (!porAno[a][vend]) porAno[a][vend] = { faturado: 0, pago: 0 };
                    porAno[a][vend].pago += valorPago || valorNF;
                }
            }

            res.json({ porAno });
        } catch (e) {
            console.error('[vendas] GET /ranking erro:', e.message);
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // GET /api/vendas/:id
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/:id', async (req, res) => {
        const reserved = ['sincronizar', 'metricas', 'ranking'];
        if (reserved.includes(req.params.id)) return res.status(405).json({ error: 'Use método correto' });
        try {
            const { data, error } = await supabase
                .from('vendas').select('*').eq('id', req.params.id).single();
            if (error) return res.status(500).json({ error: error.message });
            if (!data)  return res.status(404).json({ error: 'Não encontrado' });
            res.json(data);
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    // ─────────────────────────────────────────────────────────────────────────
    // POST /api/vendas/sincronizar
    // Fonte de verdade: CONTROLE_FRETE para tudo exceto dados de pagamento
    // Dados de pagamento vêm exclusivamente de CONTAS_RECEBER
    // ─────────────────────────────────────────────────────────────────────────
    router.post('/sincronizar', async (req, res) => {
        try {
            console.log('[vendas] 🔄 Sincronização iniciada...');

            // ── 1. Busca dados das duas fontes ────────────────────────────────
            const { data: fretesRaw, error: errFretes } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO")');

            if (errFretes) throw new Error(`Frete: ${errFretes.message}`);

            const { data: contasRaw, error: errContas } = await supabase
                .from('contas_receber')
                .select('*');

            if (errContas) throw new Error(`Contas: ${errContas.message}`);

            // ── 2. Filtra tipos excluídos ─────────────────────────────────────
            const fretes = (fretesRaw || []).filter(f => !isExcludedTipoNF(f.tipo_nf));
            // Contas: só interessa as que têm pagamento confirmado (PAGO)
            const contas = (contasRaw || []).filter(c =>
                !isExcludedTipoNF(c.tipo_nf) && c.status === 'PAGO' && c.data_pagamento
            );

            console.log(`[vendas] Fretes: ${fretes.length} | Contas pagas: ${contas.length}`);

            // ── 3. Índice de contas por número de NF ─────────────────────────
            // Agrupa todas as parcelas de uma mesma NF
            const contasPorNF = {};
            for (const conta of (contasRaw || []).filter(c => !isExcludedTipoNF(c.tipo_nf))) {
                const key = makeKey(conta.numero_nf);
                if (!contasPorNF[key]) contasPorNF[key] = [];
                contasPorNF[key].push(conta);
            }

            // ── 4. Constrói registros baseados em CONTROLE_FRETE ──────────────
            // Todos os campos informativos vêm do frete
            const mapa = {};

            for (const frete of fretes) {
                const key = makeKey(frete.numero_nf);
                mapa[key] = {
                    numero_nf:        normalizeNF(frete.numero_nf),
                    origem:           'CONTROLE_FRETE',
                    data_emissao:     frete.data_emissao     || null,
                    valor_nf:         parseFloat(frete.valor_nf)   || 0,
                    tipo_nf:          frete.tipo_nf          || null,
                    nome_orgao:       frete.nome_orgao       || null,
                    vendedor:         (frete.vendedor || '').toUpperCase().trim() || null,
                    documento:        frete.documento        || null,
                    contato_orgao:    frete.contato_orgao    || null,
                    transportadora:   frete.transportadora   || null,
                    valor_frete:      parseFloat(frete.valor_frete) || 0,
                    data_coleta:      frete.data_coleta      || null,
                    cidade_destino:   frete.cidade_destino   || null,
                    previsao_entrega: frete.previsao_entrega || null,
                    status_frete:     normalizeStatusFrete(frete.status),
                    // Campos de pagamento: nulos por padrão, preenchidos pelo contas_receber
                    status_pagamento: null,
                    banco:            null,
                    data_vencimento:  null,
                    data_pagamento:   null,
                    valor_pago:       0,
                    numero_parcela:   null,
                    updated_at:       new Date().toISOString()
                };
            }

            // ── 5. Mescla dados de pagamento (EXCLUSIVAMENTE de contas_receber) ─
            let matched = 0;

            for (const [key, parcelas] of Object.entries(contasPorNF)) {
                if (!mapa[key]) continue; // Só processa NFs que existem no frete

                // Filtra parcelas pagas
                const parclasPagas = parcelas.filter(p => p.status === 'PAGO' && p.data_pagamento);
                if (!parclasPagas.length) continue;

                matched++;

                // Ordena por data de pagamento (mais recente primeiro)
                parclasPagas.sort((a, b) => new Date(b.data_pagamento) - new Date(a.data_pagamento));

                // Total pago somando todas as parcelas
                const totalPago = parclasPagas.reduce((sum, p) =>
                    sum + (parseFloat(p.valor_pago) || parseFloat(p.valor) || 0), 0);

                // Data de pagamento mais recente
                const ultimoPagamento = parclasPagas[0];

                // Informação de parcelas
                const numParcelas = parclasPagas.length;
                const totalParcelas = parcelas.length;
                let infoParcela = null;
                if (totalParcelas > 1) {
                    infoParcela = `${numParcelas}/${totalParcelas}`;
                }

                mapa[key].status_pagamento = 'PAGO';
                mapa[key].banco            = ultimoPagamento.banco || null;
                mapa[key].data_vencimento  = ultimoPagamento.data_vencimento || null;
                mapa[key].data_pagamento   = ultimoPagamento.data_pagamento;
                mapa[key].valor_pago       = totalPago;
                mapa[key].numero_parcela   = infoParcela;
                mapa[key].origem           = 'PAGO';
                mapa[key].updated_at       = new Date().toISOString();
            }

            console.log(`[vendas] Matches frete+conta: ${matched}`);

            const registros = Object.values(mapa);
            if (!registros.length)
                return res.json({ success: true, message: 'Nenhum registro para sincronizar', total: 0 });

            console.log(`[vendas] Total a sincronizar: ${registros.length}`);

            // ── 6. Upsert em lotes ────────────────────────────────────────────
            const CHUNK = 200;
            let erros = 0;
            const erroMsgs = [];

            for (let i = 0; i < registros.length; i += CHUNK) {
                const chunk = registros.slice(i, i + CHUNK).map(sanitize);

                const { error: upsertError } = await supabase
                    .from('vendas')
                    .upsert(chunk, {
                        onConflict:       'numero_nf,vendedor',
                        ignoreDuplicates: false
                    });

                if (upsertError) {
                    console.error(`[vendas] ❌ Erro no lote ${i}:`, upsertError.message);
                    erros++;
                    erroMsgs.push(upsertError.message);
                } else {
                    console.log(`[vendas] ✅ Lote ${i} ok (${chunk.length} registros)`);
                }
            }

            const msg = erros
                ? `${registros.length} registros processados com ${erros} lote(s) com erro: ${erroMsgs[0]}`
                : `${registros.length} registros sincronizados (${matched} com pagamento confirmado)`;

            console.log(`[vendas] ${erros ? '⚠️' : '✅'} ${msg}`);
            res.json({ success: erros === 0, message: msg, total: registros.length, matched });

        } catch (err) {
            console.error('[vendas] ❌ Erro geral na sincronização:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
