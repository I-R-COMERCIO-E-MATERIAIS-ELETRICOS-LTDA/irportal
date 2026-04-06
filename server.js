'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();

// ============================================
// SUPABASE
// ============================================

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERRO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configurados');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase configurado:', supabaseUrl);

// ============================================
// MIDDLEWARES GLOBAIS
// ============================================

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token']
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
    console.log(`📥 ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// ============================================
// ARQUIVOS ESTÁTICOS — CADA MÓDULO NA SUA PASTA
// ============================================

// Portal (raiz — acesso direto em /)
app.use('/', express.static(path.join(__dirname, 'apps', 'portal'), {
    setHeaders: setStaticHeaders
}));

// Módulos
const MODULOS = [
    'licitacoes', 'precos', 'compra', 'transportadoras',
    'cotacoes', 'faturamento', 'estoque', 'frete',
    'receber', 'vendas', 'pagar', 'lucro'
];

MODULOS.forEach(modulo => {
    app.use(`/${modulo}`, express.static(path.join(__dirname, 'apps', modulo), {
        setHeaders: setStaticHeaders
    }));
});

function setStaticHeaders(res, filepath) {
    if (filepath.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript');
    if (filepath.endsWith('.css'))  res.setHeader('Content-Type', 'text/css');
    if (filepath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
}

// ============================================
// AUTENTICAÇÃO CENTRALIZADA
// ============================================

const PORTAL_URL = process.env.PORTAL_URL || 'https://irportal.onrender.com';

async function verificarAutenticacao(req, res, next) {
    const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;

    if (!sessionToken) {
        return res.status(401).json({ error: 'Não autenticado', redirectToLogin: true });
    }

    try {
        const verifyResponse = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ sessionToken })
        });

        if (!verifyResponse.ok) {
            return res.status(401).json({ error: 'Sessão inválida', redirectToLogin: true });
        }

        const sessionData = await verifyResponse.json();

        if (!sessionData.valid) {
            return res.status(401).json({ error: 'Sessão inválida', redirectToLogin: true });
        }

        req.user         = sessionData.session;
        req.sessionToken = sessionToken;
        next();
    } catch (err) {
        console.error('❌ Erro ao verificar sessão:', err.message);
        return res.status(500).json({ error: 'Erro ao verificar autenticação' });
    }
}

// ============================================
// DADOS BANCÁRIOS PROTEGIDOS (BACKEND ONLY)
// ============================================

function getDadosBancarios(banco) {
    const dadosBancarios = {
        'BANCO DO BRASIL': 'BANCO DO BRASIL - AG: 3167-4 / CONTA CORRENTE: 130115-2',
        'BRADESCO':        'BRADESCO - AG: 0000-0 / CONTA CORRENTE: 000000-0',
        'SICOOB':          'SICOOB - AG: 0000 / CONTA CORRENTE: 00000-0'
    };
    return dadosBancarios[banco] || null;
}

// ============================================
// PORTAL — ROTAS DE AUTENTICAÇÃO
// ============================================
// As rotas abaixo são responsabilidade do portal.
// O portal tem seu próprio servidor de auth; aqui
// apenas expõe os endpoints para que os iframes
// possam chamar /api/verify-session etc.
// Se o portal rodar no mesmo processo, inclua as
// rotas aqui. Caso contrário, o portal pode ter
// seu próprio Render service e o PORTAL_URL aponta
// para ele. Por enquanto deixamos um proxy simples
// para que módulos filhos consigam chamar /api/login
// e /api/verify-session sem CORS adicional.

// Proxy: /api/login  →  PORTAL_URL/api/login
app.post('/api/login', async (req, res) => {
    try {
        const r = await fetch(`${PORTAL_URL}/api/login`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(req.body)
        });
        const d = await r.json();
        res.status(r.status).json(d);
    } catch (err) {
        res.status(502).json({ error: 'Portal indisponível', message: err.message });
    }
});

// Proxy: /api/verify-session
app.post('/api/verify-session', async (req, res) => {
    try {
        const r = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(req.body)
        });
        const d = await r.json();
        res.status(r.status).json(d);
    } catch (err) {
        res.status(502).json({ error: 'Portal indisponível', message: err.message });
    }
});

// Proxy: /api/logout
app.post('/api/logout', async (req, res) => {
    try {
        const r = await fetch(`${PORTAL_URL}/api/logout`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(req.body)
        });
        const d = await r.json();
        res.status(r.status).json(d);
    } catch (err) {
        res.status(502).json({ error: 'Portal indisponível', message: err.message });
    }
});

// Proxy: /api/ip
app.get('/api/ip', async (req, res) => {
    try {
        const r = await fetch(`${PORTAL_URL}/api/ip`);
        const d = await r.json();
        res.status(r.status).json(d);
    } catch {
        // fallback: retornar IP do request
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
        res.json({ ip });
    }
});

// ============================================
// MÓDULO: LICITAÇÕES
// Tabelas: licitacoes  |  itens
// ============================================

app.use('/api/licitacoes', verificarAutenticacao);

// HEAD — verificar conectividade
app.head('/api/licitacoes', (req, res) => res.status(200).end());

// GET /api/licitacoes?mes=&ano=
app.get('/api/licitacoes', async (req, res) => {
    try {
        console.log('📋 Listando licitações...');
        let query = supabase.from('licitacoes').select('*');

        const { mes, ano } = req.query;
        if (mes && ano) {
            const mesNum = parseInt(mes);
            const anoNum = parseInt(ano);
            if (!isNaN(mesNum) && !isNaN(anoNum)) {
                const startDate = `${anoNum}-${mesNum.toString().padStart(2, '0')}-01`;
                const endDate   = mesNum === 12
                    ? `${anoNum + 1}-01-01`
                    : `${anoNum}-${(mesNum + 1).toString().padStart(2, '0')}-01`;
                query = query.filter('data', 'gte', startDate).filter('data', 'lt', endDate);
            }
        }

        const { data, error } = await query.order('data', { ascending: false });
        if (error) throw error;

        console.log(`✅ ${data?.length || 0} licitações encontradas`);
        res.json(data || []);
    } catch (err) {
        console.error('❌ Erro ao listar licitações:', err.message);
        res.status(500).json({ success: false, error: 'Erro ao listar licitações', message: err.message });
    }
});

// GET /api/licitacoes/:id
app.get('/api/licitacoes/:id', async (req, res) => {
    try {
        console.log(`🔍 Buscando licitação ID: ${req.params.id}`);
        const { data, error } = await supabase
            .from('licitacoes')
            .select('*')
            .eq('id', req.params.id)
            .single();

        if (error) {
            if (error.code === 'PGRST116')
                return res.status(404).json({ success: false, error: 'Licitação não encontrada' });
            throw error;
        }

        res.json(data);
    } catch (err) {
        console.error('❌ Erro ao buscar licitação:', err.message);
        res.status(500).json({ success: false, error: 'Erro ao buscar licitação', message: err.message });
    }
});

// POST /api/licitacoes
app.post('/api/licitacoes', async (req, res) => {
    try {
        console.log('➕ Criando nova licitação...');
        const {
            responsavel, data, hora, numero_pregao, uasg, nome_orgao, municipio, uf,
            telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
            detalhes, banco, status, ganho, disputa_por
        } = req.body;

        const novaLicitacao = {
            responsavel,
            data,
            hora:               hora || null,
            numero_pregao,
            uasg:               uasg || null,
            nome_orgao:         nome_orgao || null,
            municipio:          municipio || null,
            uf:                 uf || null,
            telefones:          telefones || [],
            emails:             emails || [],
            validade_proposta:  validade_proposta || null,
            prazo_entrega:      prazo_entrega || null,
            prazo_pagamento:    prazo_pagamento || null,
            detalhes:           detalhes || [],
            banco:              banco || null,
            status:             status || 'ABERTO',
            ganho:              ganho || false
        };
        if (disputa_por !== undefined) novaLicitacao.disputa_por = disputa_por || 'ITEM';

        const { data: dataResponse, error } = await supabase
            .from('licitacoes')
            .insert([novaLicitacao])
            .select()
            .single();

        if (error) throw error;

        console.log('✅ Licitação criada! ID:', dataResponse.id);
        res.status(201).json(dataResponse);
    } catch (err) {
        console.error('❌ Erro ao criar licitação:', err.message);
        res.status(500).json({ success: false, error: 'Erro ao criar licitação', message: err.message });
    }
});

// PUT /api/licitacoes/:id
app.put('/api/licitacoes/:id', async (req, res) => {
    try {
        console.log(`✏️ Atualizando licitação ID: ${req.params.id}`);
        const {
            responsavel, data, hora, numero_pregao, uasg, nome_orgao, municipio, uf,
            telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
            detalhes, banco, status, ganho, disputa_por
        } = req.body;

        const licitacaoAtualizada = {
            responsavel,
            data,
            hora:               hora || null,
            numero_pregao,
            uasg:               uasg || null,
            nome_orgao:         nome_orgao || null,
            municipio:          municipio || null,
            uf:                 uf || null,
            telefones:          telefones || [],
            emails:             emails || [],
            validade_proposta:  validade_proposta || null,
            prazo_entrega:      prazo_entrega || null,
            prazo_pagamento:    prazo_pagamento || null,
            detalhes:           detalhes || [],
            banco:              banco || null,
            status:             status || 'ABERTO',
            ganho:              ganho !== undefined ? ganho : false,
            updated_at:         new Date().toISOString()
        };
        if (disputa_por !== undefined) licitacaoAtualizada.disputa_por = disputa_por || 'ITEM';

        const { data: dataResponse, error } = await supabase
            .from('licitacoes')
            .update(licitacaoAtualizada)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116')
                return res.status(404).json({ success: false, error: 'Licitação não encontrada' });
            throw error;
        }

        console.log('✅ Licitação atualizada!');
        res.json(dataResponse);
    } catch (err) {
        console.error('❌ Erro ao atualizar licitação:', err.message);
        res.status(500).json({ success: false, error: 'Erro ao atualizar licitação', message: err.message });
    }
});

// DELETE /api/licitacoes/:id  (exclui itens via CASCADE ou manual)
app.delete('/api/licitacoes/:id', async (req, res) => {
    try {
        const lid = req.params.id;
        console.log(`🗑️ Deletando licitação ID: ${lid} (com itens)`);

        // Excluir itens primeiro para evitar FK violation caso CASCADE não esteja ativo
        const { error: erroItens } = await supabase
            .from('itens')
            .delete()
            .eq('licitacao_id', lid);
        if (erroItens) console.warn('⚠️ Aviso ao excluir itens:', erroItens.message);

        const { error } = await supabase.from('licitacoes').delete().eq('id', lid);
        if (error) throw error;

        console.log('✅ Licitação e itens deletados!');
        res.json({ success: true, message: 'Licitação removida com sucesso' });
    } catch (err) {
        console.error('❌ Erro ao deletar licitação:', err.message);
        res.status(500).json({ success: false, error: 'Erro ao deletar licitação', message: err.message });
    }
});

// GET /api/licitacoes/:id/dados-bancarios
app.get('/api/licitacoes/:id/dados-bancarios', verificarAutenticacao, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('licitacoes')
            .select('banco')
            .eq('id', req.params.id)
            .single();

        if (error) return res.status(404).json({ success: false, error: 'Licitação não encontrada' });

        res.json({ dados_bancarios: getDadosBancarios(data.banco) });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar dados bancários', message: err.message });
    }
});

// ============================================
// MÓDULO: LICITAÇÕES — ITENS
// Tabela: itens  (coluna de FK: licitacao_id)
// ============================================

// GET /api/licitacoes/:licitacao_id/itens
app.get('/api/licitacoes/:licitacao_id/itens', verificarAutenticacao, async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('itens')
            .select('*')
            .eq('licitacao_id', req.params.licitacao_id)
            .order('numero', { ascending: true });

        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar itens', message: err.message });
    }
});

// POST /api/licitacoes/:licitacao_id/itens
app.post('/api/licitacoes/:licitacao_id/itens', verificarAutenticacao, async (req, res) => {
    try {
        const {
            numero, descricao, qtd, unidade, marca, modelo,
            estimado_unt, estimado_total, custo_unt, custo_total,
            porcentagem, venda_unt, venda_total, ganho,
            grupo_tipo, grupo_numero
        } = req.body;

        const novoItem = {
            licitacao_id:   req.params.licitacao_id,
            numero:         String(numero || 1),
            descricao:      descricao || null,
            qtd:            parseInt(qtd) || 1,
            unidade:        unidade || 'UN',
            marca:          marca || null,
            modelo:         modelo || null,
            estimado_unt:   parseFloat(estimado_unt) || 0,
            estimado_total: parseFloat(estimado_total) || 0,
            custo_unt:      parseFloat(custo_unt) || 0,
            custo_total:    parseFloat(custo_total) || 0,
            porcentagem:    parseFloat(porcentagem) || 149,
            venda_unt:      parseFloat(venda_unt) || 0,
            venda_total:    parseFloat(venda_total) || 0,
            ganho:          ganho === true || ganho === 'true' || false
        };
        if (grupo_tipo   !== undefined) novoItem.grupo_tipo   = grupo_tipo || null;
        if (grupo_numero !== undefined) novoItem.grupo_numero = grupo_numero != null ? parseInt(grupo_numero) : null;

        const { data, error } = await supabase.from('itens').insert([novoItem]).select().single();
        if (error) throw error;

        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao criar item', message: err.message });
    }
});

// PUT /api/licitacoes/:licitacao_id/itens/:id
app.put('/api/licitacoes/:licitacao_id/itens/:id', verificarAutenticacao, async (req, res) => {
    try {
        const {
            numero, descricao, qtd, unidade, marca, modelo,
            estimado_unt, estimado_total, custo_unt, custo_total,
            porcentagem, venda_unt, venda_total, ganho,
            grupo_tipo, grupo_numero
        } = req.body;

        const itemAtualizado = {
            numero:         String(numero || 1),
            descricao:      descricao || null,
            qtd:            parseInt(qtd) || 1,
            unidade:        unidade || 'UN',
            marca:          marca || null,
            modelo:         modelo || null,
            estimado_unt:   parseFloat(estimado_unt) || 0,
            estimado_total: parseFloat(estimado_total) || 0,
            custo_unt:      parseFloat(custo_unt) || 0,
            custo_total:    parseFloat(custo_total) || 0,
            porcentagem:    parseFloat(porcentagem) || 149,
            venda_unt:      parseFloat(venda_unt) || 0,
            venda_total:    parseFloat(venda_total) || 0,
            ganho:          ganho === true || ganho === 'true' || false,
            updated_at:     new Date().toISOString()
        };
        if (grupo_tipo   !== undefined) itemAtualizado.grupo_tipo   = grupo_tipo || null;
        if (grupo_numero !== undefined) itemAtualizado.grupo_numero = grupo_numero != null ? parseInt(grupo_numero) : null;

        const { data, error } = await supabase
            .from('itens')
            .update(itemAtualizado)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116')
                return res.status(404).json({ success: false, error: 'Item não encontrado' });
            throw error;
        }

        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar item', message: err.message });
    }
});

// DELETE /api/licitacoes/:licitacao_id/itens/:id
app.delete('/api/licitacoes/:licitacao_id/itens/:id', verificarAutenticacao, async (req, res) => {
    try {
        const { error } = await supabase.from('itens').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Item removido com sucesso' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao deletar item', message: err.message });
    }
});

// POST /api/licitacoes/:licitacao_id/itens/delete-multiple
app.post('/api/licitacoes/:licitacao_id/itens/delete-multiple', verificarAutenticacao, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids) || ids.length === 0)
            return res.status(400).json({ success: false, error: 'IDs inválidos' });

        const { error } = await supabase.from('itens').delete().in('id', ids);
        if (error) throw error;

        res.json({ success: true, message: `${ids.length} itens removidos com sucesso` });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao deletar itens', message: err.message });
    }
});

// ============================================
// MÓDULO: COMPRA — ORDENS DE COMPRA
// Tabela: compra
// ============================================

app.use('/api/compra', verificarAutenticacao);
app.head('/api/compra', (req, res) => res.status(200).end());

app.get('/api/compra', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('compra')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar ordens', message: err.message });
    }
});

app.get('/api/compra/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('compra')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) {
            if (error.code === 'PGRST116')
                return res.status(404).json({ success: false, error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar ordem', message: err.message });
    }
});

app.post('/api/compra', async (req, res) => {
    try {
        const {
            numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia,
            cnpj, enderecoFornecedor, site, contato, telefone, email, items,
            valorTotal, frete, localEntrega, prazoEntrega, transporte,
            formaPagamento, prazoPagamento, dadosBancarios, status
        } = req.body;

        const novaOrdem = {
            numero_ordem:       numeroOrdem,
            responsavel,
            data_ordem:         dataOrdem,
            razao_social:       razaoSocial,
            nome_fantasia:      nomeFantasia || null,
            cnpj,
            endereco_fornecedor: enderecoFornecedor || null,
            site:               site || null,
            contato:            contato || null,
            telefone:           telefone || null,
            email:              email || null,
            items:              items || [],
            valor_total:        valorTotal || 'R$ 0,00',
            frete:              frete || null,
            local_entrega:      localEntrega || null,
            prazo_entrega:      prazoEntrega || null,
            transporte:         transporte || null,
            forma_pagamento:    formaPagamento,
            prazo_pagamento:    prazoPagamento,
            dados_bancarios:    dadosBancarios || null,
            status:             status || 'aberta'
        };

        const { data, error } = await supabase.from('compra').insert([novaOrdem]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao criar ordem', message: err.message });
    }
});

app.put('/api/compra/:id', async (req, res) => {
    try {
        const {
            numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia,
            cnpj, enderecoFornecedor, site, contato, telefone, email, items,
            valorTotal, frete, localEntrega, prazoEntrega, transporte,
            formaPagamento, prazoPagamento, dadosBancarios, status
        } = req.body;

        const ordemAtualizada = {
            numero_ordem:       numeroOrdem,
            responsavel,
            data_ordem:         dataOrdem,
            razao_social:       razaoSocial,
            nome_fantasia:      nomeFantasia || null,
            cnpj,
            endereco_fornecedor: enderecoFornecedor || null,
            site:               site || null,
            contato:            contato || null,
            telefone:           telefone || null,
            email:              email || null,
            items:              items || [],
            valor_total:        valorTotal || 'R$ 0,00',
            frete:              frete || null,
            local_entrega:      localEntrega || null,
            prazo_entrega:      prazoEntrega || null,
            transporte:         transporte || null,
            forma_pagamento:    formaPagamento,
            prazo_pagamento:    prazoPagamento,
            dados_bancarios:    dadosBancarios || null,
            status:             status || 'aberta',
            updated_at:         new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('compra')
            .update(ordemAtualizada)
            .eq('id', req.params.id)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116')
                return res.status(404).json({ success: false, error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar ordem', message: err.message });
    }
});

app.patch('/api/compra/:id/status', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('compra')
            .update({ status: req.body.status, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) {
            if (error.code === 'PGRST116')
                return res.status(404).json({ success: false, error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar status', message: err.message });
    }
});

app.delete('/api/compra/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('compra').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Ordem removida com sucesso' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao deletar ordem', message: err.message });
    }
});

// ============================================
// ROTAS DE SAÚDE E FALLBACK
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status:    'ok',
        timestamp: new Date().toISOString(),
        modulos:   ['portal', ...MODULOS]
    });
});

// Fallback: servir index.html do portal para a raiz
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'apps', 'portal', 'index.html'));
});

// Fallback por módulo: qualquer rota não encontrada dentro de /<modulo>/* serve o index.html do módulo
MODULOS.forEach(modulo => {
    app.get(`/${modulo}/*`, (req, res) => {
        res.sendFile(path.join(__dirname, 'apps', modulo, 'index.html'));
    });
});

// ============================================
// TRATAMENTO GLOBAL DE ERROS
// ============================================

app.use((err, req, res, next) => {
    console.error('❌ Erro não tratado:', err);
    res.status(500).json({ success: false, error: 'Erro interno do servidor', message: err.message });
});

// ============================================
// INICIAR SERVIDOR
// ============================================

const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('===============================================');
    console.log('🚀 I.R. COMÉRCIO - MONOREPO CENTRAL');
    console.log('===============================================');
    console.log(`✅ Porta:    ${PORT}`);
    console.log(`✅ Supabase: ${supabaseUrl}`);
    console.log(`✅ Portal:   ${PORTAL_URL}`);
    console.log('');
    console.log('📦 Módulos servidos:');
    console.log('   • Portal         → /');
    MODULOS.forEach(m => console.log(`   • ${m.padEnd(16)} → /${m}`));
    console.log('');
    console.log('🔌 APIs ativas:');
    console.log('   • /api/licitacoes   (licitacoes + itens)');
    console.log('   • /api/compra       (ordens de compra)');
    console.log('   • /api/login        /api/verify-session  /api/logout');
    console.log('===============================================');
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error);
    process.exit(1);
});

module.exports = app;
