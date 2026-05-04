const express = require('express');

module.exports = function (supabase) {
    const router = express.Router();

    const EXCLUDED_NF_TYPES = [
        'DEVOLUÇÃO', 'DEVOLUCAO', 'DEVOLUÇÃO DE MERCADORIA',
        'SIMPLES REMESSA', 'SIMPLES_REMESSA',
        'REMESSA DE AMOSTRA', 'REMESSA_AMOSTRA', 'DEVOLVIDA'
    ];

    function isExcludedTipoNF(tipo) {
        if (!tipo) return false;
        const normalized = tipo.toUpperCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return EXCLUDED_NF_TYPES.some(ex => normalized.includes(ex.normalize('NFD').replace(/[\u0300-\u036f]/g, '')));
    }

    function normalizeNF(numeroNF) {
        if (!numeroNF) return '';
        let str = String(numeroNF).trim().replace(/^0+/, '');
        return str || '0';
    }

    function makeKey(numeroNF, vendedor) {
        return `${normalizeNF(numeroNF)}||${(vendedor || '').toUpperCase().trim()}`;
    }

    function sanitizeForUpsert(record) {
        const { id, observacoes, id_controle_frete, id_contas_receber, ...safe } = record;
        if (id_controle_frete) safe.id_controle_frete = String(id_controle_frete);
        if (id_contas_receber) safe.id_contas_receber = String(id_contas_receber);
        return safe;
    }

    router.get('/', async (req, res) => {
        try {
            const { mes, ano, vendedor } = req.query;
            let query = supabase.from('vendas').select('*').order('numero_nf', { ascending: true });
            if (mes && ano) {
                const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
                const ultimoDia = new Date(parseInt(ano), parseInt(mes), 0).getDate();
                const fim = `${ano}-${String(mes).padStart(2, '0')}-${ultimoDia}`;
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

    router.get('/:id', async (req, res) => {
        if (req.params.id === 'sincronizar') return res.status(405).json({ error: 'Use POST' });
        try {
            const { data, error } = await supabase.from('vendas').select('*').eq('id', req.params.id).single();
            if (error) return res.status(500).json({ error: error.message });
            if (!data) return res.status(404).json({ error: 'Não encontrado' });
            res.json(data);
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    router.post('/sincronizar', async (req, res) => {
        try {
            console.log('[vendas] 🔄 Sincronização iniciada...');

            // 1. Busca dados das fontes
            const { data: fretesRaw, error: errFretes } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '(DEVOLVIDO,DEVOLUCAO,devolvido,devolution,DEVOLUÇÃO,DEVOLUÇAO)');
            if (errFretes) throw new Error(`Frete: ${errFretes.message}`);

            const { data: contasRaw, error: errContas } = await supabase
                .from('contas_receber')
                .select('*');
            if (errContas) throw new Error(`Contas: ${errContas.message}`);

            const fretes = (fretesRaw || []).filter(f => !isExcludedTipoNF(f.tipo_nf));
            const contas = (contasRaw || []).filter(c => !isExcludedTipoNF(c.tipo_nf));

            console.log(`[vendas] Fretes: ${fretes.length} | Contas: ${contas.length}`);

            // 2. Busca registros existentes na tabela vendas para saber quais fazer UPDATE vs INSERT
            const { data: vendasExistentes, error: errVendas } = await supabase
                .from('vendas')
                .select('id, numero_nf, vendedor');
            if (errVendas) throw new Error(`Vendas existentes: ${errVendas.message}`);

            // key → id (PK bigint) da tabela vendas
            const mapaExistentes = {};
            for (const v of (vendasExistentes || [])) {
                const key = makeKey(v.numero_nf, v.vendedor);
                mapaExistentes[key] = v.id;
            }
            console.log(`[vendas] Registros existentes: ${Object.keys(mapaExistentes).length}`);

            // 3. Monta o mapa completo de registros a sincronizar
            const mapa = {};

            for (const frete of fretes) {
                const key = makeKey(frete.numero_nf, frete.vendedor);
                mapa[key] = {
                    numero_nf:         normalizeNF(frete.numero_nf),
                    origem:            'CONTROLE_FRETE',
                    data_emissao:      frete.data_emissao || null,
                    valor_nf:          parseFloat(frete.valor_nf) || 0,
                    tipo_nf:           frete.tipo_nf || null,
                    nome_orgao:        frete.nome_orgao || frete.orgao || null,
                    vendedor:          (frete.vendedor || '').toUpperCase().trim() || null,
                    documento:         frete.documento || null,
                    contato_orgao:     frete.contato_orgao || null,
                    transportadora:    frete.transportadora || null,
                    valor_frete:       parseFloat(frete.valor_frete) || 0,
                    data_coleta:       frete.data_coleta || null,
                    cidade_destino:    frete.cidade_destino || null,
                    previsao_entrega:  frete.previsao_entrega || null,
                    status_frete:      (frete.status || 'EM TRÂNSITO').replace(/_/g, ' '),
                    id_controle_frete: frete.id,
                    status_pagamento:  null,
                    banco:             null,
                    data_vencimento:   null,
                    data_pagamento:    null,
                    valor_pago:        0,
                    id_contas_receber: null,
                    updated_at:        new Date().toISOString()
                };
            }

            let unmatchedContas = 0;
            for (const conta of contas) {
                const key = makeKey(conta.numero_nf, conta.vendedor);
                const campos = {
                    status_pagamento:  conta.status,
                    banco:             conta.banco || null,
                    data_vencimento:   conta.data_vencimento || null,
                    data_pagamento:    conta.data_pagamento || null,
                    valor_pago:        parseFloat(conta.valor_pago) || 0,
                    id_contas_receber: conta.id,
                    updated_at:        new Date().toISOString()
                };

                if (mapa[key]) {
                    // NF já veio do frete — mescla os dados de pagamento
                    Object.assign(mapa[key], campos);
                    mapa[key].origem = conta.status === 'PAGO' ? 'PAGO (Frete+Conta)' : 'MISTO';
                    if (conta.data_emissao && !mapa[key].data_emissao)
                        mapa[key].data_emissao = conta.data_emissao;
                    if (conta.valor && (!mapa[key].valor_nf || mapa[key].valor_nf === 0))
                        mapa[key].valor_nf = parseFloat(conta.valor) || 0;
                } else {
                    // NF sem frete correspondente
                    unmatchedContas++;
                    mapa[key] = {
                        numero_nf:         normalizeNF(conta.numero_nf),
                        origem:            'CONTAS_RECEBER',
                        data_emissao:      conta.data_emissao || null,
                        valor_nf:          parseFloat(conta.valor) || 0,
                        tipo_nf:           conta.tipo_nf || null,
                        nome_orgao:        conta.orgao || null,
                        vendedor:          (conta.vendedor || '').toUpperCase().trim() || null,
                        status_frete:      null,
                        id_controle_frete: null,
                        ...campos
                    };
                }
            }
            console.log(`[vendas] Contas sem frete: ${unmatchedContas}`);

            // 4. Separa em UPDATE (registro já existe na tabela vendas) e INSERT (novo)
            const paraUpdate = [];
            const paraInsert = [];

            for (const [key, registro] of Object.entries(mapa)) {
                const idExistente = mapaExistentes[key];
                const clean = sanitizeForUpsert(registro);
                if (idExistente !== undefined) {
                    paraUpdate.push({ ...clean, _vendas_id: idExistente });
                } else {
                    paraInsert.push(clean);
                }
            }

            console.log(`[vendas] UPDATE: ${paraUpdate.length} | INSERT: ${paraInsert.length}`);

            const CHUNK = 50; // menor para updates paralelos não sobrecarregar
            let erros = 0;
            const erroMsgs = [];

            // 5. Executa UPDATEs em paralelo por chunks
            for (let i = 0; i < paraUpdate.length; i += CHUNK) {
                const chunk = paraUpdate.slice(i, i + CHUNK);
                const promises = chunk.map(({ _vendas_id, ...fields }) =>
                    supabase
                        .from('vendas')
                        .update(fields)
                        .eq('id', _vendas_id)
                        .then(({ error }) => {
                            if (error) {
                                console.error(`[vendas] Update erro id=${_vendas_id} NF=${fields.numero_nf}:`, error.message);
                                erroMsgs.push(error.message);
                                erros++;
                            }
                        })
                );
                await Promise.all(promises);
                console.log(`[vendas] Update chunk ${i}: ${chunk.length} registros`);
            }

            // 6. Executa INSERTs em chunks
            for (let i = 0; i < paraInsert.length; i += CHUNK) {
                const chunk = paraInsert.slice(i, i + CHUNK);
                const { error: insertError } = await supabase
                    .from('vendas')
                    .insert(chunk);
                if (insertError) {
                    console.error(`[vendas] Insert erro lote ${i}:`, insertError.message);
                    erros++;
                    erroMsgs.push(insertError.message);
                } else {
                    console.log(`[vendas] Insert chunk ${i}: ${chunk.length} registros`);
                }
            }

            const total = paraUpdate.length + paraInsert.length;
            const msg = `${total} registros sincronizados (${paraUpdate.length} atualizados, ${paraInsert.length} inseridos)${erros ? ` — ${erros} erros: ${erroMsgs[0]}` : ''}`;
            console.log(`[vendas] ${erros ? '⚠️' : '✅'} ${msg}`);
            res.json({ success: erros === 0, message: msg, total });

        } catch (err) {
            console.error('[vendas] ❌ Erro geral:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
