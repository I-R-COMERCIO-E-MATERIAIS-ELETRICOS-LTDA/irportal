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

// Normaliza string para comparação segura (remove acentos, espaços, maiúsculas)
function normalizeString(str) {
    if (!str) return '';
    return str
        .toUpperCase()
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

// Verifica se o tipo da NF deve ser excluído
function isExcludedTipoNF(tipo) {
    if (!tipo) return false;
    const normalizedTipo = normalizeString(tipo);
    return EXCLUDED_NF_TYPES.some(ex => normalizedTipo.includes(normalizeString(ex)));
}

// Normaliza status de frete
function normalizeFreteStatus(status) {
    const map = {
        'EM_TRANSITO': 'EM TRÂNSITO',
        'EM TRANSITO': 'EM TRÂNSITO',
        'ENTREGUE': 'ENTREGUE',
        'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
        'AGUARDANDO COLETA': 'AGUARDANDO COLETA',
        'EXTRAVIADO': 'EM TRÂNSITO',
    };
    return map[status] || status || 'EM TRÂNSITO';
}

// Gera chave única para merge (NF + vendedor)
function makeKey(numeroNF, vendedor) {
    const nf = (numeroNF || '').toString().trim();
    const vend = (vendedor || '').toString().toUpperCase().trim();
    return `${nf}||${vend}`;
}

// Processa parcelas e determina status e data de pagamento
function processarConta(conta) {
    let statusPagamento = conta.status || 'A RECEBER';
    let valorPago = parseFloat(conta.valor_pago) || 0;
    let dataPagamento = conta.data_pagamento || null;
    let observacoes = conta.observacoes;

    try {
        const raw = conta.observacoes;
        if (raw) {
            const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
            let parcelas = null;
            if (Array.isArray(parsed?.parcelas) && parsed.parcelas.length > 0) {
                parcelas = parsed.parcelas;
            } else if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.valor !== undefined) {
                parcelas = parsed;
            }
            if (parcelas) {
                valorPago = parcelas.reduce((sum, p) => sum + (parseFloat(p.valor || p.valor_parcela) || 0), 0);
                const datas = parcelas.map(p => p.data || p.data_pagamento).filter(Boolean).sort();
                dataPagamento = datas.length ? datas[datas.length - 1] : dataPagamento;
                const valorNF = parseFloat(conta.valor) || 0;
                if (valorNF > 0 && valorPago >= valorNF) {
                    statusPagamento = 'PAGO';
                } else if (parcelas.length > 0) {
                    statusPagamento = `${parcelas.length}ª PARCELA`;
                }
            }
            observacoes = typeof raw === 'string' ? raw : JSON.stringify(raw);
        }
    } catch (e) {
        console.warn('[processarConta] Erro ao processar observações:', e.message);
    }
    return { statusPagamento, valorPago, dataPagamento, observacoes };
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

    // GET /api/vendas/:id
    router.get('/:id', async (req, res) => {
        if (req.params.id === 'sincronizar') {
            return res.status(405).json({ error: 'Use POST para sincronizar' });
        }
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
        try {
            console.log('[vendas] 🔄 Iniciando sincronização...');

            // 1. Buscar todos os fretes (exceto status DEVOLVIDO)
            const { data: todosFretes, error: errFretes } = await supabase
                .from('controle_frete')
                .select('*')
                .not('status', 'in', '(DEVOLVIDO,DEVOLUCAO,devolvido,devolution,DEVOLUÇÃO,DEVOLUÇAO)');

            if (errFretes) throw new Error(`Erro ao buscar controle_frete: ${errFretes.message}`);

            // 2. Buscar todas as contas a receber
            const { data: todasContas, error: errContas } = await supabase
                .from('contas_receber')
                .select('*');

            if (errContas) throw new Error(`Erro ao buscar contas_receber: ${errContas.message}`);

            // 3. Filtrar tipos excluídos
            let fretes = (todosFretes || []).filter(f => !isExcludedTipoNF(f.tipo_nf));
            let contas = (todasContas || []).filter(c => !isExcludedTipoNF(c.tipo_nf));

            console.log(`[vendas] Fretes após filtro: ${fretes.length} (total ${todosFretes?.length || 0})`);
            console.log(`[vendas] Contas após filtro: ${contas.length} (total ${todasContas?.length || 0})`);

            // Mapa final: chave -> registro consolidado
            const mapa = {};

            // 4. Primeiro, adicionar todos os fretes (base)
            for (const frete of fretes) {
                const key = makeKey(frete.numero_nf, frete.vendedor);
                mapa[key] = {
                    numero_nf: (frete.numero_nf || '').trim(),
                    origem: 'CONTROLE_FRETE',
                    data_emissao: frete.data_emissao || null,
                    valor_nf: parseFloat(frete.valor_nf) || 0,
                    tipo_nf: frete.tipo_nf || null,
                    nome_orgao: frete.nome_orgao || frete.orgao || null,
                    vendedor: frete.vendedor || null,
                    documento: frete.documento || null,
                    contato_orgao: frete.contato_orgao || null,
                    transportadora: frete.transportadora || null,
                    valor_frete: parseFloat(frete.valor_frete) || 0,
                    data_coleta: frete.data_coleta || null,
                    cidade_destino: frete.cidade_destino || null,
                    previsao_entrega: frete.previsao_entrega || null,
                    status_frete: normalizeFreteStatus(frete.status),
                    id_controle_frete: (!isNaN(Number(frete.id)) && String(frete.id).length < 15) ? Number(frete.id) : null,
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

            // 5. Mesclar informações de contas a receber (pagamentos)
            for (const conta of contas) {
                const key = makeKey(conta.numero_nf, conta.vendedor);
                const pgto = processarConta(conta);
                const idCR = (!isNaN(Number(conta.id)) && String(conta.id).length < 15) ? Number(conta.id) : null;

                const camposPagamento = {
                    status_pagamento: pgto.statusPagamento,
                    banco: conta.banco || null,
                    data_vencimento: conta.data_vencimento || null,
                    data_pagamento: pgto.dataPagamento,
                    valor_pago: pgto.valorPago,
                    observacoes: pgto.observacoes,
                    id_contas_receber: idCR,
                    origem: 'CONTAS_RECEBER', // override para indicar que tem pagamento
                    updated_at: new Date().toISOString(),
                };

                if (mapa[key]) {
                    // Já existe do frete: preserva dados de frete, adiciona/sobrescreve pagamento
                    Object.assign(mapa[key], camposPagamento);
                    // Se a nota foi paga integralmente, marcamos origem como mista, mas status_frete continua
                    if (pgto.statusPagamento === 'PAGO') {
                        mapa[key].origem = 'MISTO (PAGO)';
                    } else {
                        mapa[key].origem = 'MISTO (PARCIAL)';
                    }
                } else {
                    // Não tem frete: cria apenas com dados da conta
                    mapa[key] = {
                        numero_nf: (conta.numero_nf || '').trim(),
                        origem: 'CONTAS_RECEBER',
                        data_emissao: conta.data_emissao || null,
                        valor_nf: parseFloat(conta.valor) || 0,
                        tipo_nf: conta.tipo_nf || null,
                        nome_orgao: conta.orgao || null,
                        vendedor: conta.vendedor || null,
                        status_frete: null,
                        id_controle_frete: null,
                        ...camposPagamento,
                        prioridade: 1,
                    };
                }
            }

            const registros = Object.values(mapa);
            if (!registros.length) {
                return res.json({ success: true, message: 'Nenhum registro após filtros', total: 0 });
            }

            // 6. Upsert em lotes (200)
            const CHUNK = 200;
            let erros = 0;
            for (let i = 0; i < registros.length; i += CHUNK) {
                const chunk = registros.slice(i, i + CHUNK);
                const { error: upsertError } = await supabase
                    .from('vendas')
                    .upsert(chunk, { onConflict: 'numero_nf, vendedor', ignoreDuplicates: false });
                if (upsertError) {
                    console.error(`[vendas] Erro upsert lote ${i}:`, upsertError.message);
                    erros++;
                }
            }

            const msg = `${registros.length} registros sincronizados${erros ? ` (${erros} lotes com erro)` : ''}`;
            console.log(`[vendas] ✅ Sincronização concluída: ${msg}`);
            res.json({ success: erros === 0, message: msg, total: registros.length });

        } catch (err) {
            console.error('[vendas] ❌ Erro na sincronização:', err.message);
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return router;
};
