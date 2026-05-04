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

    // ✅ Remove TODOS os campos incompatíveis com a tabela vendas:
    // - id: bigserial gerado automaticamente, nunca enviar
    // - id_controle_frete: bigint na tabela, mas frete.id é UUID → incompatível
    // - id_contas_receber: bigint na tabela, mas conta.id é UUID → incompatível
    // - observacoes: existe na tabela mas não deve ser sobrescrito na sync
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

            // 1. Busca fontes
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

            // 2. Monta mapa
            const mapa = {};

            for (const frete of fretes) {
                const key = makeKey(frete.numero_nf, frete.vendedor);
                mapa[key] = {
                    numero_nf:        normalizeNF(frete.numero_nf),
                    origem:           'CONTROLE_FRETE',
                    data_emissao:     frete.data_emissao || null,
                    valor_nf:         parseFloat(frete.valor_nf) || 0,
                    tipo_nf:          frete.tipo_nf || null,
                    nome_orgao:       frete.nome_orgao || frete.orgao || null,
                    vendedor:         (frete.vendedor || '').toUpperCase().trim() || null,
                    documento:        frete.documento || null,
                    contato_orgao:    frete.contato_orgao || null,
                    transportadora:   frete.transportadora || null,
                    valor_frete:      parseFloat(frete.valor_frete) || 0,
                    data_coleta:      frete.data_coleta || null,
                    cidade_destino:   frete.cidade_destino || null,
                    previsao_entrega: frete.previsao_entrega || null,
                    status_frete:     (frete.status || 'EM TRÂNSITO').replace(/_/g, ' '),
                    // campos de pagamento zerados — serão preenchidos pela conta se existir
                    status_pagamento: null,
                    banco:            null,
                    data_vencimento:  null,
                    data_pagamento:   null,
                    valor_pago:       0,
                    updated_at:       new Date().toISOString()
                };
            }

            let unmatchedContas = 0;
            for (const conta of contas) {
                const key = makeKey(conta.numero_nf, conta.vendedor);

                // Campos exclusivos de pagamento (todos compatíveis com colunas text/numeric/date)
                const camposPagamento = {
                    status_pagamento: conta.status || null,
                    banco:            conta.banco || null,
                    data_vencimento:  conta.data_vencimento || null,
                    data_pagamento:   conta.data_pagamento || null,
                    valor_pago:       parseFloat(conta.valor_pago) || 0,
                    updated_at:       new Date().toISOString()
                };

                if (mapa[key]) {
                    // Mescla: frete + pagamento
                    Object.assign(mapa[key], camposPagamento);
                    mapa[key].origem = conta.status === 'PAGO' ? 'PAGO (Frete+Conta)' : 'MISTO';
                    if (conta.data_emissao && !mapa[key].data_emissao)
                        mapa[key].data_emissao = conta.data_emissao;
                    if (conta.valor && (!mapa[key].valor_nf || mapa[key].valor_nf === 0))
                        mapa[key].valor_nf = parseFloat(conta.valor) || 0;
                } else {
                    // Só conta, sem frete
                    unmatchedContas++;
                    mapa[key] = {
                        numero_nf:        normalizeNF(conta.numero_nf),
                        origem:           'CONTAS_RECEBER',
                        data_emissao:     conta.data_emissao || null,
                        valor_nf:         parseFloat(conta.valor) || 0,
                        tipo_nf:          conta.tipo_nf || null,
                        nome_orgao:       conta.orgao || null,
                        vendedor:         (conta.vendedor || '').toUpperCase().trim() || null,
                        status_frete:     null,
                        transportadora:   null,
                        valor_frete:      0,
                        ...camposPagamento
                    };
                }
            }

            console.log(`[vendas] Contas sem frete: ${unmatchedContas}`);

            const registros = Object.values(mapa);
            if (!registros.length)
                return res.json({ success: true, message: 'Nenhum registro', total: 0 });

            console.log(`[vendas] Total a sincronizar: ${registros.length}`);

            // 3. Upsert — a tabela tem UNIQUE (numero_nf, vendedor) então funciona corretamente
            const CHUNK = 200;
            let erros = 0;
            const erroMsgs = [];

            for (let i = 0; i < registros.length; i += CHUNK) {
                const chunk = registros.slice(i, i + CHUNK).map(sanitize);

                const { error: upsertError } = await supabase
                    .from('vendas')
                    .upsert(chunk, {
                        onConflict: 'numero_nf,vendedor',
                        ignoreDuplicates: false
                    });

                if (upsertError) {
                    console.error(`[vendas] Erro lote ${i}:`, upsertError.message);
                    erros++;
                    erroMsgs.push(upsertError.message);
                } else {
                    console.log(`[vendas] Lote ${i} ok (${chunk.length} registros)`);
                }
            }

            const msg = `${registros.length} registros sincronizados${erros ? ` (${erros} lotes com erro: ${erroMsgs[0]})` : ' com sucesso'}`;
            console.log(`[vendas] ${erros ? '⚠️' : '✅'} ${msg}`);
            res.json({ success: erros === 0, message: msg, total: registros.length });

        } catch (err) {
            console.error('[vendas] ❌ Erro geral:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
