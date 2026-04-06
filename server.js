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
    'licitacoes', 'compra', 'precos', 'transportadoras',
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
// PORTAL — ROTAS DE AUTENTICAÇÃO (PROXY)
// ============================================

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

app.get('/api/ip', async (req, res) => {
    try {
        const r = await fetch(`${PORTAL_URL}/api/ip`);
        const d = await r.json();
        res.status(r.status).json(d);
    } catch {
        const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || '';
        res.json({ ip });
    }
});

// ============================================
// MÓDULO: LICITAÇÕES
// ============================================
app.use('/api/licitacoes', verificarAutenticacao);
app.head('/api/licitacoes', (req, res) => res.status(200).end());

app.get('/api/licitacoes', async (req, res) => {
    try {
        let query = supabase.from('licitacoes').select('*');
        const { mes, ano } = req.query;
        if (mes && ano) {
            const mesNum = parseInt(mes);
            const anoNum = parseInt(ano);
            if (!isNaN(mesNum) && !isNaN(anoNum)) {
                const startDate = `${anoNum}-${mesNum.toString().padStart(2,'0')}-01`;
                const endDate   = mesNum === 12 ? `${anoNum+1}-01-01` : `${anoNum}-${(mesNum+1).toString().padStart(2,'0')}-01`;
                query = query.filter('data', 'gte', startDate).filter('data', 'lt', endDate);
            }
        }
        const { data, error } = await query.order('data', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao listar licitações' });
    }
});

app.get('/api/licitacoes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('licitacoes').select('*').eq('id', req.params.id).single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Licitação não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar licitação' });
    }
});

app.post('/api/licitacoes', async (req, res) => {
    try {
        const { responsavel, data, hora, numero_pregao, uasg, nome_orgao, municipio, uf,
                telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
                detalhes, banco, status, ganho, disputa_por } = req.body;
        const novaLicitacao = {
            responsavel, data, hora: hora || null, numero_pregao,
            uasg: uasg || null, nome_orgao: nome_orgao || null,
            municipio: municipio || null, uf: uf || null,
            telefones: telefones || [], emails: emails || [],
            validade_proposta: validade_proposta || null,
            prazo_entrega: prazo_entrega || null,
            prazo_pagamento: prazo_pagamento || null,
            detalhes: detalhes || [], banco: banco || null,
            status: status || 'ABERTO', ganho: ganho || false,
            disputa_por: disputa_por || 'ITEM'
        };
        const { data: inserted, error } = await supabase.from('licitacoes').insert([novaLicitacao]).select().single();
        if (error) throw error;
        res.status(201).json(inserted);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar licitação' });
    }
});

app.put('/api/licitacoes/:id', async (req, res) => {
    try {
        const { responsavel, data, hora, numero_pregao, uasg, nome_orgao, municipio, uf,
                telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
                detalhes, banco, status, ganho, disputa_por } = req.body;
        const atualizada = {
            responsavel, data, hora: hora || null, numero_pregao,
            uasg: uasg || null, nome_orgao: nome_orgao || null,
            municipio: municipio || null, uf: uf || null,
            telefones: telefones || [], emails: emails || [],
            validade_proposta: validade_proposta || null,
            prazo_entrega: prazo_entrega || null,
            prazo_pagamento: prazo_pagamento || null,
            detalhes: detalhes || [], banco: banco || null,
            status: status || 'ABERTO', ganho: ganho !== undefined ? ganho : false,
            disputa_por: disputa_por || 'ITEM', updated_at: new Date().toISOString()
        };
        const { data: updated, error } = await supabase.from('licitacoes').update(atualizada).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Licitação não encontrada' });
            throw error;
        }
        res.json(updated);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar licitação' });
    }
});

app.delete('/api/licitacoes/:id', async (req, res) => {
    try {
        await supabase.from('itens').delete().eq('licitacao_id', req.params.id);
        const { error } = await supabase.from('licitacoes').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao deletar licitação' });
    }
});

app.get('/api/licitacoes/:id/dados-bancarios', verificarAutenticacao, async (req, res) => {
    try {
        const { data, error } = await supabase.from('licitacoes').select('banco').eq('id', req.params.id).single();
        if (error) return res.status(404).json({ error: 'Licitação não encontrada' });
        res.json({ dados_bancarios: getDadosBancarios(data.banco) });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar dados bancários' });
    }
});

// Rotas de itens de licitação (tabela "itens")
app.get('/api/licitacoes/:licitacao_id/itens', verificarAutenticacao, async (req, res) => {
    const { data, error } = await supabase.from('itens').select('*').eq('licitacao_id', req.params.licitacao_id).order('numero', { ascending: true });
    if (error) return res.status(500).json({ error: 'Erro ao listar itens' });
    res.json(data || []);
});
app.post('/api/licitacoes/:licitacao_id/itens', verificarAutenticacao, async (req, res) => {
    const novoItem = { ...req.body, licitacao_id: req.params.licitacao_id };
    const { data, error } = await supabase.from('itens').insert([novoItem]).select().single();
    if (error) return res.status(500).json({ error: 'Erro ao criar item' });
    res.status(201).json(data);
});
app.put('/api/licitacoes/:licitacao_id/itens/:id', verificarAutenticacao, async (req, res) => {
    const { data, error } = await supabase.from('itens').update(req.body).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ error: 'Erro ao atualizar item' });
    res.json(data);
});
app.delete('/api/licitacoes/:licitacao_id/itens/:id', verificarAutenticacao, async (req, res) => {
    const { error } = await supabase.from('itens').delete().eq('id', req.params.id);
    if (error) return res.status(500).json({ error: 'Erro ao deletar item' });
    res.json({ success: true });
});
app.post('/api/licitacoes/:licitacao_id/itens/delete-multiple', verificarAutenticacao, async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'IDs inválidos' });
    const { error } = await supabase.from('itens').delete().in('id', ids);
    if (error) return res.status(500).json({ error: 'Erro ao deletar itens' });
    res.json({ success: true });
});

// ============================================
// MÓDULO: COMPRA (ORDENS DE COMPRA)
// Tabela: compra
// ============================================

app.use('/api/compra', verificarAutenticacao);
app.head('/api/compra', (req, res) => res.status(200).end());

// Listar ordens com filtro de mês/ano
app.get('/api/compra', async (req, res) => {
    try {
        let query = supabase.from('compra').select('*');
        const { mes, ano } = req.query;
        if (mes && ano) {
            const mesNum = parseInt(mes);
            const anoNum = parseInt(ano);
            if (!isNaN(mesNum) && !isNaN(anoNum)) {
                const startDate = `${anoNum}-${mesNum.toString().padStart(2,'0')}-01`;
                const endDate   = mesNum === 12 ? `${anoNum+1}-01-01` : `${anoNum}-${(mesNum+1).toString().padStart(2,'0')}-01`;
                query = query.filter('data_ordem', 'gte', startDate).filter('data_ordem', 'lt', endDate);
            }
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao listar ordens' });
    }
});

// Obter o último número de ordem (global)
app.get('/api/compra/ultimo-numero', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('compra')
            .select('numero_ordem')
            .order('numero_ordem', { ascending: false })
            .limit(1);
        if (error) throw error;
        const ultimoNumero = data && data.length > 0 ? parseInt(data[0].numero_ordem) : 0;
        res.json({ ultimoNumero });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar último número' });
    }
});

// Listar fornecedores distintos (para autocomplete)
app.get('/api/compra/fornecedores', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('compra')
            .select('razao_social, nome_fantasia, cnpj, endereco_fornecedor, site, contato, telefone, email')
            .not('razao_social', 'is', null);
        if (error) throw error;
        // Remove duplicatas baseado na razão social
        const unique = {};
        data.forEach(f => {
            const razao = (f.razao_social || '').trim().toUpperCase();
            if (razao && !unique[razao]) unique[razao] = f;
        });
        res.json(Object.values(unique));
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar fornecedores' });
    }
});

// Obter uma ordem por ID
app.get('/api/compra/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('compra').select('*').eq('id', req.params.id).single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar ordem' });
    }
});

// Criar nova ordem
app.post('/api/compra', async (req, res) => {
    try {
        const { numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia,
                cnpj, enderecoFornecedor, site, contato, telefone, email, items,
                valorTotal, frete, localEntrega, prazoEntrega, transporte,
                formaPagamento, prazoPagamento, dadosBancarios, status } = req.body;
        const novaOrdem = {
            numero_ordem: numeroOrdem,
            responsavel,
            data_ordem: dataOrdem,
            razao_social: razaoSocial,
            nome_fantasia: nomeFantasia || null,
            cnpj,
            endereco_fornecedor: enderecoFornecedor || null,
            site: site || null,
            contato: contato || null,
            telefone: telefone || null,
            email: email || null,
            items: items || [],
            valor_total: valorTotal || 'R$ 0,00',
            frete: frete || null,
            local_entrega: localEntrega || null,
            prazo_entrega: prazoEntrega || null,
            transporte: transporte || null,
            forma_pagamento: formaPagamento,
            prazo_pagamento: prazoPagamento,
            dados_bancarios: dadosBancarios || null,
            status: status || 'aberta'
        };
        const { data, error } = await supabase.from('compra').insert([novaOrdem]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar ordem' });
    }
});

// Atualizar ordem
app.put('/api/compra/:id', async (req, res) => {
    try {
        const { numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia,
                cnpj, enderecoFornecedor, site, contato, telefone, email, items,
                valorTotal, frete, localEntrega, prazoEntrega, transporte,
                formaPagamento, prazoPagamento, dadosBancarios, status } = req.body;
        const ordemAtualizada = {
            numero_ordem: numeroOrdem,
            responsavel,
            data_ordem: dataOrdem,
            razao_social: razaoSocial,
            nome_fantasia: nomeFantasia || null,
            cnpj,
            endereco_fornecedor: enderecoFornecedor || null,
            site: site || null,
            contato: contato || null,
            telefone: telefone || null,
            email: email || null,
            items: items || [],
            valor_total: valorTotal || 'R$ 0,00',
            frete: frete || null,
            local_entrega: localEntrega || null,
            prazo_entrega: prazoEntrega || null,
            transporte: transporte || null,
            forma_pagamento: formaPagamento,
            prazo_pagamento: prazoPagamento,
            dados_bancarios: dadosBancarios || null,
            status: status || 'aberta',
            updated_at: new Date().toISOString()
        };
        const { data, error } = await supabase.from('compra').update(ordemAtualizada).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar ordem' });
    }
});

// Atualizar status da ordem (PATCH)
app.patch('/api/compra/:id/status', async (req, res) => {
    try {
        const { status } = req.body;
        const { data, error } = await supabase
            .from('compra')
            .update({ status, updated_at: new Date().toISOString() })
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar status' });
    }
});

// Deletar ordem
app.delete('/api/compra/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('compra').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao deletar ordem' });
    }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        modulos: ['portal', ...MODULOS]
    });
});

// Fallback para rotas não encontradas
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'apps', 'portal', 'index.html'));
});

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
    res.status(500).json({ error: 'Erro interno do servidor', message: err.message });
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

module.exports = app;
