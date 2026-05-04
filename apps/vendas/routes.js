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

    // ─── Normaliza número de NF (remove zeros à esquerda) ────────────────────
    function normalizeNF(numeroNF) {
        if (!numeroNF) return '';
        const str = String(numeroNF).trim().replace(/^0+/, '');
        return str || '0';
    }

    // ─── Chave de junção: APENAS o número da NF normalizado ──────────────────
    //     O número da NF é o identificador real. Se a NF é a mesma nos dois
    //     módulos, todos os dados pertencem ao mesmo registro.
    function makeKey(numeroNF) {
        return normalizeNF(numeroNF);
    }

    // ─── Normaliza o status do frete para exibição uniforme ──────────────────
    //     Banco grava com underscore: AGUARDANDO_COLETA, EM_TRANSITO …
    //     Frontend espera: EM TRÂNSITO, AGUARDANDO COLETA …
    const STATUS_FRETE_MAP = {
        'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
        'EM_TRANSITO':       'EM TRÂNSITO',
        'ENTREGUE':          'ENTREGUE',
        'EXTRAVIADO':        'EXTRAVIADO',
        'DEVOLVIDO':         'DEVOLVIDO'
    };

    function normalizeStatusFrete(status) {
        if (!status) return 'EM TRÂNSITO';
        const upper = status.toUpperCase().trim();
        return STATUS_FRETE_MAP[upper] || upper.replace(/_/g, ' ');
    }

    // ─── Remove campos incompatíveis com a tabela vendas ─────────────────────
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
    // GET /api/vendas/:id
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/:id', async (req, res) => {
        if (req.params.id === 'sincronizar') return res.status(405).json({ error: 'Use POST' });
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

            // ── 2. Filtra tipos de NF excluídos ───────────────────────────────
            const fretes = (fretesRaw || []).filter(f => !isExcludedTipoNF(f.tipo_nf));
            const contas  = (contasRaw  || []).filter(c => !isExcludedTipoNF(c.tipo_nf));

            console.log(`[vendas] Fretes: ${fretes.length} | Contas: ${contas.length}`);

            // ── 3. Índice de contas por número de NF ─────────────────────────
            //     Se houver mais de uma conta para a mesma NF (ex: parcelamento),
            //     prioriza: PAGO > com data_pagamento > mais recente.
            const contasPorNF = {};
            for (const conta of contas) {
                const key = makeKey(conta.numero_nf);
                const atual = contasPorNF[key];
                if (!atual
                    || conta.status === 'PAGO'
                    || (atual.status !== 'PAGO' && conta.data_pagamento && !atual.data_pagamento)) {
                    contasPorNF[key] = conta;
                }
            }

            // ── 4. Constrói mapa indexado apenas pelo número da NF ────────────
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
                    status_pagamento: null,
                    banco:            null,
                    data_vencimento:  null,
                    data_pagamento:   null,
                    valor_pago:       0,
                    updated_at:       new Date().toISOString()
                };
            }

            // ── 5. Mescla dados de pagamento pelo número da NF ────────────────
            let matched = 0;
            let unmatchedContas = 0;

            for (const [key, conta] of Object.entries(contasPorNF)) {
                const camposPagamento = {
                    status_pagamento: conta.status          || null,
                    banco:            conta.banco           || null,
                    data_vencimento:  conta.data_vencimento || null,
                    data_pagamento:   conta.data_pagamento  || null,
                    valor_pago:       conta.valor_pago != null ? parseFloat(conta.valor_pago) : 0,
                    updated_at:       new Date().toISOString()
                };

                if (mapa[key]) {
                    matched++;
                    Object.assign(mapa[key], camposPagamento);
                    mapa[key].origem = conta.status === 'PAGO' ? 'PAGO' : 'MISTO';

                    if (conta.data_emissao && !mapa[key].data_emissao)
                        mapa[key].data_emissao = conta.data_emissao;
                    if (conta.valor && (!mapa[key].valor_nf || mapa[key].valor_nf === 0))
                        mapa[key].valor_nf = parseFloat(conta.valor) || 0;
                    if (!mapa[key].nome_orgao && conta.orgao)
                        mapa[key].nome_orgao = conta.orgao;
                    if (!mapa[key].vendedor && conta.vendedor)
                        mapa[key].vendedor = (conta.vendedor || '').toUpperCase().trim();
                } else {
                    unmatchedContas++;
                    mapa[key] = {
                        numero_nf:        normalizeNF(conta.numero_nf),
                        origem:           conta.status === 'PAGO' ? 'PAGO' : 'CONTAS_RECEBER',
                        data_emissao:     conta.data_emissao || null,
                        valor_nf:         parseFloat(conta.valor) || 0,
                        tipo_nf:          conta.tipo_nf      || null,
                        nome_orgao:       conta.orgao        || null,
                        vendedor:         (conta.vendedor || '').toUpperCase().trim() || null,
                        status_frete:     null,
                        transportadora:   null,
                        valor_frete:      0,
                        documento:        null,
                        contato_orgao:    null,
                        data_coleta:      null,
                        cidade_destino:   null,
                        previsao_entrega: null,
                        ...camposPagamento
                    };
                }
            }

            console.log(`[vendas] Matches frete+conta: ${matched} | Só frete: ${fretes.length - matched} | Só conta: ${unmatchedContas}`);

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
                : `${registros.length} registros sincronizados (match: ${matched} | só frete: ${fretes.length - matched} | só conta: ${unmatchedContas})`;

            console.log(`[vendas] ${erros ? '⚠️' : '✅'} ${msg}`);
            res.json({ success: erros === 0, message: msg, total: registros.length, matched, unmatchedContas });

        } catch (err) {
            console.error('[vendas] ❌ Erro geral na sincronização:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
