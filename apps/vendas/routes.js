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
    function makeKey(numeroNF) {
        return normalizeNF(numeroNF);
    }

    // ─── Normaliza o status do frete para exibição uniforme ──────────────────
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

    // ─── Agrupa uma lista de registros (frete ou conta) por número de NF ─────
    function agruparPorNF(registros) {
        const grupos = {};
        for (const r of (registros || [])) {
            const key = makeKey(r.numero_nf);
            if (!grupos[key]) grupos[key] = [];
            grupos[key].push(r);
        }
        return grupos;
    }

    // ─── Prioridade de status do frete (registro mais "avançado" no fluxo de
    //     entrega vence quando há mais de um lançamento para a mesma NF) ─────
    const STATUS_FRETE_PRIORIDADE = [
        'AGUARDANDO_COLETA', 'EM_TRANSITO', 'DEVOLVIDO', 'EXTRAVIADO', 'ENTREGUE'
    ];

    function prioridadeStatusFrete(status) {
        if (!status) return -1;
        return STATUS_FRETE_PRIORIDADE.indexOf(status.toUpperCase().trim());
    }

    // ─── Escolhe, entre vários lançamentos de Controle de Frete para a mesma
    //     NF, qual deve ser considerado o registro "oficial". Usado tanto na
    //     sincronização (tabela vendas) quanto na rota /fontes (dados do
    //     modal "Ver"), para que as duas telas NUNCA mostrem informações de
    //     lançamentos diferentes para a mesma nota.
    //     Critério: status mais avançado no fluxo; em empate, o mais recente
    //     (maior id).
    //     ANTES: a sincronização usava "o último processado no loop" (ordem
    //     do banco, não-determinística) e a rota /fontes não escolhia nada —
    //     o frontend pegava o primeiro item do array bruto arbitrariamente.
    //     Isso fazia o modal "Ver" mostrar um lançamento diferente do que
    //     realmente virou a linha da tabela vendas.
    function pickMelhorFrete(fretesMesmaNF) {
        if (!fretesMesmaNF || !fretesMesmaNF.length) return null;
        return fretesMesmaNF.reduce((melhor, atual) => {
            if (!melhor) return atual;
            const pMelhor = prioridadeStatusFrete(melhor.status);
            const pAtual  = prioridadeStatusFrete(atual.status);
            if (pAtual !== pMelhor) return pAtual > pMelhor ? atual : melhor;
            return (atual.id || 0) > (melhor.id || 0) ? atual : melhor;
        }, null);
    }

    // ─── Escolhe, entre vários lançamentos de Contas a Receber para a mesma
    //     NF, o registro "oficial": PAGO > com data_pagamento > mais recente.
    //     Mesmo critério usado nos dois endpoints (antes só existia, parcial,
    //     dentro do /sincronizar).
    function pickMelhorConta(contasMesmaNF) {
        if (!contasMesmaNF || !contasMesmaNF.length) return null;
        return contasMesmaNF.reduce((melhor, atual) => {
            if (!melhor) return atual;
            if (atual.status === 'PAGO' && melhor.status !== 'PAGO') return atual;
            if (melhor.status === 'PAGO' && atual.status !== 'PAGO') return melhor;
            if (atual.data_pagamento && !melhor.data_pagamento) return atual;
            if (melhor.data_pagamento && !atual.data_pagamento) return melhor;
            return (atual.id || 0) > (melhor.id || 0) ? atual : melhor;
        }, null);
    }

    // ─── Exclusão GLOBAL por NF, olhando frete e conta juntos ────────────────
    //     Se qualquer uma das duas fontes indicar que a NF é
    //     SIMPLES_REMESSA/REMESSA_AMOSTRA/DEVOLUCAO/CANCELADA, a NF inteira
    //     fica de fora dos dois lados (evita que ela "vaze" como venda real
    //     quando só uma fonte marcou a exclusão).
    function calcularNfsExcluidas(fretesRaw, contasRaw) {
        const nfsExcluidas = new Set();
        for (const f of (fretesRaw || [])) {
            if (isExcludedTipoNF(f.tipo_nf)) nfsExcluidas.add(makeKey(f.numero_nf));
        }
        for (const c of (contasRaw || [])) {
            if (isExcludedTipoNF(c.tipo_nf)) nfsExcluidas.add(makeKey(c.numero_nf));
        }
        return nfsExcluidas;
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
    // GET /api/vendas/fontes
    // Retorna os registros BRUTOS de controle_frete e contas_receber (para a
    // aba Observações, que precisa juntar notas de todos os lançamentos), e
    // também o registro "oficial" por NF (fretePrincipal / contaPrincipal),
    // escolhido com o MESMO critério usado em /sincronizar — é o que o
    // frontend deve exibir nas abas Geral/Frete/Receber do modal "Ver".
    // ─────────────────────────────────────────────────────────────────────────
    router.get('/fontes', async (req, res) => {
        try {
            const { data: fretesRaw, error: errFretes } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '("DEVOLVIDO","DEVOLUCAO")');
            if (errFretes) throw new Error(`Frete: ${errFretes.message}`);

            const { data: contasRaw, error: errContas } = await supabase
                .from('contas_receber')
                .select('*');
            if (errContas) throw new Error(`Contas: ${errContas.message}`);

            const nfsExcluidas = calcularNfsExcluidas(fretesRaw, contasRaw);

            const fretes = (fretesRaw || []).filter(f =>
                !isExcludedTipoNF(f.tipo_nf) && !nfsExcluidas.has(makeKey(f.numero_nf)));
            const contas = (contasRaw || []).filter(c =>
                !isExcludedTipoNF(c.tipo_nf) && !nfsExcluidas.has(makeKey(c.numero_nf)));

            const fretePrincipal = {};
            for (const [key, grupo] of Object.entries(agruparPorNF(fretes))) {
                fretePrincipal[key] = pickMelhorFrete(grupo);
            }
            const contaPrincipal = {};
            for (const [key, grupo] of Object.entries(agruparPorNF(contas))) {
                contaPrincipal[key] = pickMelhorConta(grupo);
            }

            res.json({ fretes, contas, fretePrincipal, contaPrincipal });
        } catch (e) {
            console.error('[vendas] GET /fontes erro:', e.message);
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

            // ── 2. Filtra tipos de NF excluídos (exclusão cruzada) ────────────
            const nfsExcluidas = calcularNfsExcluidas(fretesRaw, contasRaw);

            const fretes = (fretesRaw || []).filter(f =>
                !isExcludedTipoNF(f.tipo_nf) && !nfsExcluidas.has(makeKey(f.numero_nf)));
            const contas = (contasRaw || []).filter(c =>
                !isExcludedTipoNF(c.tipo_nf) && !nfsExcluidas.has(makeKey(c.numero_nf)));

            console.log(`[vendas] Fretes: ${fretes.length} | Contas: ${contas.length}`);

            // ── 3. Escolhe o registro "oficial" por NF em cada fonte ──────────
            //      MESMO critério usado em GET /fontes (pickMelhorFrete /
            //      pickMelhorConta) — garante que a linha gravada em "vendas"
            //      seja sempre a mesma que o modal "Ver" exibe.
            const fretesPorNF = {};
            for (const [key, grupo] of Object.entries(agruparPorNF(fretes))) {
                fretesPorNF[key] = pickMelhorFrete(grupo);
            }
            const contasPorNF = {};
            for (const [key, grupo] of Object.entries(agruparPorNF(contas))) {
                contasPorNF[key] = pickMelhorConta(grupo);
            }

            // ── 4. Constrói mapa indexado apenas pelo número da NF ────────────
            const mapa = {};

            for (const [key, frete] of Object.entries(fretesPorNF)) {
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

                    const vendedorConta = (conta.vendedor || '').toUpperCase().trim();
                    if (vendedorConta) {
                        mapa[key].vendedor = vendedorConta;
                    }
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

            console.log(`[vendas] Matches frete+conta: ${matched} | Só frete: ${Object.keys(fretesPorNF).length - matched} | Só conta: ${unmatchedContas}`);

            const registros = Object.values(mapa);
            if (!registros.length)
                return res.json({ success: true, message: 'Nenhum registro para sincronizar', total: 0 });

            console.log(`[vendas] Total a sincronizar: ${registros.length}`);

            const CHUNK = 200;

            // ── 6. Remove duplicatas com vendedor desatualizado ───────────────
            const numerosNF = registros.map(r => r.numero_nf);
            const vendedorCorretoPorNF = {};
            registros.forEach(r => { vendedorCorretoPorNF[r.numero_nf] = r.vendedor; });

            let duplicatasRemovidas = 0;
            for (let i = 0; i < numerosNF.length; i += CHUNK) {
                const loteNF = numerosNF.slice(i, i + CHUNK);
                if (!loteNF.length) continue;

                const { data: existentes, error: errExistentes } = await supabase
                    .from('vendas')
                    .select('id, numero_nf, vendedor')
                    .in('numero_nf', loteNF);

                if (errExistentes) {
                    console.error('[vendas] ⚠️ Erro ao checar duplicatas:', errExistentes.message);
                    continue;
                }

                const idsParaRemover = (existentes || [])
                    .filter(e => {
                        const correto = vendedorCorretoPorNF[normalizeNF(e.numero_nf)];
                        return correto && (e.vendedor || '').toUpperCase().trim() !== correto;
                    })
                    .map(e => e.id);

                if (idsParaRemover.length) {
                    const { error: errDelete } = await supabase.from('vendas').delete().in('id', idsParaRemover);
                    if (errDelete) {
                        console.error('[vendas] ⚠️ Erro ao remover duplicatas:', errDelete.message);
                    } else {
                        duplicatasRemovidas += idsParaRemover.length;
                    }
                }
            }
            if (duplicatasRemovidas > 0) {
                console.log(`[vendas] 🧹 ${duplicatasRemovidas} duplicata(s) com vendedor desatualizado removida(s)`);
            }

            // ── 7. Upsert em lotes ────────────────────────────────────────────
            let erros = 0;
            const erroMsgs = [];

            for (let i = 0; i < registros.length; i += CHUNK) {
                const chunk = registros.slice(i, i + CHUNK).map(sanitize);

                const { error: upsertError } = await supabase
                    .from('vendas')
                    .upsert(chunk, {
                        onConflict:       'numero_nf',
                        ignoreDuplicates: false
                    });

                if (upsertError) {
                    console.error(`[vendas] ❌ Erro no lote ${i}:`, upsertError.message);
                    erros++;
                    erroMsgs.push(upsertError.message);

                    const msgErro = (upsertError.message || '').toLowerCase();
                    if (upsertError.code === '42P10' || msgErro.includes('no unique or exclusion constraint')) {
                        console.error(
                            '[vendas] 🚨 AÇÃO NECESSÁRIA: a tabela "vendas" não tem a constraint ' +
                            'UNIQUE(numero_nf) exigida pelo upsert (onConflict: "numero_nf"). ' +
                            'Enquanto isso não for corrigido no banco, NENHUM registro novo ou ' +
                            'atualizado será sincronizado. Rode no Supabase (SQL Editor):\n' +
                            '  ALTER TABLE vendas DROP CONSTRAINT IF EXISTS vendas_numero_nf_vendedor_key;\n' +
                            '  ALTER TABLE vendas ADD CONSTRAINT vendas_numero_nf_key UNIQUE (numero_nf);'
                        );
                    }
                } else {
                    console.log(`[vendas] ✅ Lote ${i} ok (${chunk.length} registros)`);
                }
            }

            const faltaConstraint = erroMsgs.some(m =>
                (m || '').toLowerCase().includes('no unique or exclusion constraint'));

            const msg = erros
                ? (faltaConstraint
                    ? `Falha ao gravar: falta a constraint UNIQUE(numero_nf) na tabela "vendas" no banco. Peça para rodar a migração indicada nos logs do servidor. (${erroMsgs[0]})`
                    : `${registros.length} registros processados com ${erros} lote(s) com erro: ${erroMsgs[0]}`)
                : `${registros.length} registros sincronizados (match: ${matched} | só frete: ${Object.keys(fretesPorNF).length - matched} | só conta: ${unmatchedContas}${duplicatasRemovidas ? ` | duplicatas removidas: ${duplicatasRemovidas}` : ''})`;

            console.log(`[vendas] ${erros ? '⚠️' : '✅'} ${msg}`);
            res.json({ success: erros === 0, message: msg, total: registros.length, matched, unmatchedContas, duplicatasRemovidas });

        } catch (err) {
            console.error('[vendas] ❌ Erro geral na sincronização:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
