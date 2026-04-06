'use strict';

const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');

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
// CONSTANTES
// ============================================

const PORTAL_URL = process.env.PORTAL_URL || 'https://irportal.onrender.com';

const MODULOS = [
    'licitacoes', 'precos', 'compra', 'transportadoras',
    'cotacoes', 'faturamento', 'estoque', 'frete',
    'receber', 'vendas', 'pagar', 'lucro'
];

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
// ARQUIVOS ESTÁTICOS
// ============================================

function setStaticHeaders(res, filepath) {
    if (filepath.endsWith('.js'))   res.setHeader('Content-Type', 'application/javascript');
    if (filepath.endsWith('.css'))  res.setHeader('Content-Type', 'text/css');
    if (filepath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
}

// Portal na raiz
app.use('/', express.static(path.join(__dirname, 'apps', 'portal'), { setHeaders: setStaticHeaders }));

// Módulos
MODULOS.forEach(modulo => {
    app.use(`/${modulo}`, express.static(path.join(__dirname, 'apps', modulo), { setHeaders: setStaticHeaders }));
});

// ============================================
// AUTENTICAÇÃO CENTRALIZADA
// ============================================

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
// PORTAL — AUTENTICAÇÃO (proxy ou direto)
// ============================================

// Estas rotas são usadas tanto pelo portal quanto pelos iframes filhos.
// Se o portal rodar no mesmo processo (mesma instância), as rotas de auth
// devem estar definidas aqui. Se rodar como serviço separado, funcionam
// como proxy transparente.

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
// Tabela: licitacoes  |  itens
// ============================================

app.use('/api/licitacoes', verificarAutenticacao);
app.head('/api/licitacoes', (req, res) => res.status(200).end());

app.get('/api/licitacoes', async (req, res) => {
    try {
        let query = supabase.from('licitacoes').select('*');
        const { mes, ano } = req.query;
        if (mes && ano) {
            const mesNum = parseInt(mes), anoNum = parseInt(ano);
            if (!isNaN(mesNum) && !isNaN(anoNum)) {
                const start = `${anoNum}-${String(mesNum).padStart(2,'0')}-01`;
                const end   = mesNum === 12
                    ? `${anoNum + 1}-01-01`
                    : `${anoNum}-${String(mesNum + 1).padStart(2,'0')}-01`;
                query = query.gte('data', start).lt('data', end);
            }
        }
        const { data, error } = await query.order('data', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar licitações', message: err.message });
    }
});

app.get('/api/licitacoes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('licitacoes').select('*').eq('id', req.params.id).single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Licitação não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar licitação', message: err.message });
    }
});

app.post('/api/licitacoes', async (req, res) => {
    try {
        const { responsavel, data, hora, numero_pregao, uasg, nome_orgao, municipio, uf,
                telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
                detalhes, banco, status, ganho, disputa_por } = req.body;
        const nova = {
            responsavel, data,
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
        if (disputa_por !== undefined) nova.disputa_por = disputa_por || 'ITEM';
        const { data: d, error } = await supabase.from('licitacoes').insert([nova]).select().single();
        if (error) throw error;
        res.status(201).json(d);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao criar licitação', message: err.message });
    }
});

app.put('/api/licitacoes/:id', async (req, res) => {
    try {
        const { responsavel, data, hora, numero_pregao, uasg, nome_orgao, municipio, uf,
                telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
                detalhes, banco, status, ganho, disputa_por } = req.body;
        const upd = {
            responsavel, data,
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
        if (disputa_por !== undefined) upd.disputa_por = disputa_por || 'ITEM';
        const { data: d, error } = await supabase.from('licitacoes').update(upd).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Licitação não encontrada' });
            throw error;
        }
        res.json(d);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar licitação', message: err.message });
    }
});

app.delete('/api/licitacoes/:id', async (req, res) => {
    try {
        await supabase.from('itens').delete().eq('licitacao_id', req.params.id);
        const { error } = await supabase.from('licitacoes').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Licitação removida com sucesso' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao deletar licitação', message: err.message });
    }
});

app.get('/api/licitacoes/:id/dados-bancarios', async (req, res) => {
    try {
        const { data, error } = await supabase.from('licitacoes').select('banco').eq('id', req.params.id).single();
        if (error) return res.status(404).json({ success: false, error: 'Licitação não encontrada' });
        const map = {
            'BANCO DO BRASIL': 'BANCO DO BRASIL - AG: 3167-4 / CONTA CORRENTE: 130115-2',
            'BRADESCO':        'BRADESCO - AG: 0000-0 / CONTA CORRENTE: 000000-0',
            'SICOOB':          'SICOOB - AG: 0000 / CONTA CORRENTE: 00000-0'
        };
        res.json({ dados_bancarios: map[data.banco] || null });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar dados bancários', message: err.message });
    }
});

// Itens de licitação
app.get('/api/licitacoes/:lid/itens', async (req, res) => {
    try {
        const { data, error } = await supabase.from('itens').select('*').eq('licitacao_id', req.params.lid).order('numero', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar itens', message: err.message });
    }
});

app.post('/api/licitacoes/:lid/itens', async (req, res) => {
    try {
        const { numero, descricao, qtd, unidade, marca, modelo,
                estimado_unt, estimado_total, custo_unt, custo_total,
                porcentagem, venda_unt, venda_total, ganho, grupo_tipo, grupo_numero } = req.body;
        const item = {
            licitacao_id:   req.params.lid,
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
        if (grupo_tipo   !== undefined) item.grupo_tipo   = grupo_tipo || null;
        if (grupo_numero !== undefined) item.grupo_numero = grupo_numero != null ? parseInt(grupo_numero) : null;
        const { data, error } = await supabase.from('itens').insert([item]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao criar item', message: err.message });
    }
});

app.put('/api/licitacoes/:lid/itens/:id', async (req, res) => {
    try {
        const { numero, descricao, qtd, unidade, marca, modelo,
                estimado_unt, estimado_total, custo_unt, custo_total,
                porcentagem, venda_unt, venda_total, ganho, grupo_tipo, grupo_numero } = req.body;
        const upd = {
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
        if (grupo_tipo   !== undefined) upd.grupo_tipo   = grupo_tipo || null;
        if (grupo_numero !== undefined) upd.grupo_numero = grupo_numero != null ? parseInt(grupo_numero) : null;
        const { data, error } = await supabase.from('itens').update(upd).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Item não encontrado' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar item', message: err.message });
    }
});

app.delete('/api/licitacoes/:lid/itens/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('itens').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Item removido com sucesso' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao deletar item', message: err.message });
    }
});

app.post('/api/licitacoes/:lid/itens/delete-multiple', async (req, res) => {
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
// MÓDULO: TRANSPORTADORAS
// Tabela: transportadoras
// ============================================

app.use('/api/transportadoras', verificarAutenticacao);
app.head('/api/transportadoras', (req, res) => res.status(200).end());

app.get('/api/transportadoras', async (req, res) => {
    try {
        const { data, error } = await supabase.from('transportadoras').select('*').order('nome', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar transportadoras', message: err.message });
    }
});

app.get('/api/transportadoras/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('transportadoras').select('*').eq('id', req.params.id).single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Transportadora não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar transportadora', message: err.message });
    }
});

app.post('/api/transportadoras', async (req, res) => {
    try {
        const { data, error } = await supabase.from('transportadoras').insert([req.body]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao criar transportadora', message: err.message });
    }
});

app.put('/api/transportadoras/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('transportadoras').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Transportadora não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar transportadora', message: err.message });
    }
});

app.delete('/api/transportadoras/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('transportadoras').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Transportadora removida com sucesso' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao deletar transportadora', message: err.message });
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
        const { mes, ano } = req.query;
        let query = supabase.from('compra').select('*');
        if (mes !== undefined && ano !== undefined) {
            const month = parseInt(mes), year = parseInt(ano);
            const start = new Date(year, month, 1).toISOString().split('T')[0];
            const end   = new Date(year, month + 1, 0).toISOString().split('T')[0];
            query = query.gte('data_ordem', start).lte('data_ordem', end).order('numero_ordem', { ascending: true });
        } else {
            query = query.order('created_at', { ascending: false });
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar ordens', message: err.message });
    }
});

app.get('/api/compra/ultimo-numero', async (req, res) => {
    try {
        const { data, error } = await supabase.from('compra').select('numero_ordem').order('numero_ordem', { ascending: false }).limit(1);
        if (error) throw error;
        const ultimoNumero = data?.length > 0 ? parseInt(data[0].numero_ordem) || 0 : 0;
        res.json({ ultimoNumero });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar último número' });
    }
});

app.get('/api/compra/fornecedores', async (req, res) => {
    try {
        const { data, error } = await supabase.from('compra').select('razao_social,nome_fantasia,cnpj,endereco_fornecedor,site,contato,telefone,email').order('created_at', { ascending: false });
        if (error) throw error;
        const seen = new Set(), fornecedores = [];
        for (const row of data || []) {
            const razao = (row.razao_social || '').trim().toUpperCase();
            if (razao && !seen.has(razao)) { seen.add(razao); fornecedores.push(row); }
        }
        res.json(fornecedores);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar fornecedores' });
    }
});

app.get('/api/compra/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('compra').select('*').eq('id', req.params.id).single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar ordem', message: err.message });
    }
});

app.post('/api/compra', async (req, res) => {
    try {
        const { numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia,
                cnpj, enderecoFornecedor, site, contato, telefone, email, items,
                valorTotal, frete, localEntrega, prazoEntrega, transporte,
                formaPagamento, prazoPagamento, dadosBancarios, status } = req.body;
        const nova = {
            numero_ordem:        numeroOrdem,
            responsavel,
            data_ordem:          dataOrdem,
            razao_social:        razaoSocial,
            nome_fantasia:       nomeFantasia || null,
            cnpj,
            endereco_fornecedor: enderecoFornecedor || null,
            site:                site || null,
            contato:             contato || null,
            telefone:            telefone || null,
            email:               email || null,
            items:               items || [],
            valor_total:         valorTotal || 'R$ 0,00',
            frete:               frete || null,
            local_entrega:       localEntrega || null,
            prazo_entrega:       prazoEntrega || null,
            transporte:          transporte || null,
            forma_pagamento:     formaPagamento,
            prazo_pagamento:     prazoPagamento,
            dados_bancarios:     dadosBancarios || null,
            status:              status || 'aberta'
        };
        const { data, error } = await supabase.from('compra').insert([nova]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao criar ordem', message: err.message });
    }
});

app.put('/api/compra/:id', async (req, res) => {
    try {
        const { numeroOrdem, responsavel, dataOrdem, razaoSocial, nomeFantasia,
                cnpj, enderecoFornecedor, site, contato, telefone, email, items,
                valorTotal, frete, localEntrega, prazoEntrega, transporte,
                formaPagamento, prazoPagamento, dadosBancarios, status } = req.body;
        const upd = {
            numero_ordem:        numeroOrdem,
            responsavel,
            data_ordem:          dataOrdem,
            razao_social:        razaoSocial,
            nome_fantasia:       nomeFantasia || null,
            cnpj,
            endereco_fornecedor: enderecoFornecedor || null,
            site:                site || null,
            contato:             contato || null,
            telefone:            telefone || null,
            email:               email || null,
            items:               items || [],
            valor_total:         valorTotal || 'R$ 0,00',
            frete:               frete || null,
            local_entrega:       localEntrega || null,
            prazo_entrega:       prazoEntrega || null,
            transporte:          transporte || null,
            forma_pagamento:     formaPagamento,
            prazo_pagamento:     prazoPagamento,
            dados_bancarios:     dadosBancarios || null,
            status:              status || 'aberta',
            updated_at:          new Date().toISOString()
        };
        const { data, error } = await supabase.from('compra').update(upd).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Ordem não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar ordem', message: err.message });
    }
});

app.patch('/api/compra/:id/status', async (req, res) => {
    try {
        const { data, error } = await supabase.from('compra').update({ status: req.body.status, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Ordem não encontrada' });
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
// MÓDULO: COTAÇÕES DE FRETE
// Tabela: cotacoes
// ============================================

app.use('/api/cotacoes', verificarAutenticacao);
app.head('/api/cotacoes', (req, res) => res.status(200).end());

app.get('/api/cotacoes', async (req, res) => {
    try {
        const { mes, ano } = req.query;
        if (mes !== undefined && ano !== undefined) {
            const month = parseInt(mes), year = parseInt(ano);
            const start = new Date(year, month, 1).toISOString().split('T')[0];
            const end   = new Date(year, month + 1, 0).toISOString().split('T')[0];
            const { data, error } = await supabase.from('cotacoes').select('*').gte('dataCotacao', start).lte('dataCotacao', end).order('dataCotacao', { ascending: false });
            if (error) throw error;
            return res.json(data || []);
        }
        const { data, error } = await supabase.from('cotacoes').select('*').order('timestamp', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar cotações', details: err.message });
    }
});

app.get('/api/cotacoes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('cotacoes').select('*').eq('id', req.params.id).single();
        if (error) return res.status(404).json({ error: 'Cotação não encontrada' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar cotação', details: err.message });
    }
});

app.post('/api/cotacoes', async (req, res) => {
    try {
        const nova = { ...req.body, id: Date.now().toString(), timestamp: new Date().toISOString() };
        const { data, error } = await supabase.from('cotacoes').insert([nova]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar cotação', details: err.message });
    }
});

app.put('/api/cotacoes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('cotacoes').update({ ...req.body, updatedAt: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) return res.status(404).json({ error: 'Cotação não encontrada' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar cotação', details: err.message });
    }
});

app.patch('/api/cotacoes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('cotacoes').update({ ...req.body, updatedAt: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) return res.status(404).json({ error: 'Cotação não encontrada' });
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar status', details: err.message });
    }
});

app.delete('/api/cotacoes/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('cotacoes').delete().eq('id', req.params.id);
        if (error) throw error;
        res.status(204).end();
    } catch (err) {
        res.status(500).json({ error: 'Erro ao excluir cotação', details: err.message });
    }
});

// ============================================
// MÓDULO: FATURAMENTO — PEDIDOS
// Tabela: faturamento  |  estoque
// ============================================

app.use('/api/pedidos',  verificarAutenticacao);
app.use('/api/estoque',  verificarAutenticacao);
app.use('/api/proximo-codigo', verificarAutenticacao);

app.get('/api/proximo-codigo', async (req, res) => {
    try {
        const { data, error } = await supabase.from('faturamento').select('codigo').order('codigo', { ascending: false }).limit(1);
        if (error) throw error;
        res.json({ proximoCodigo: (data[0]?.codigo || 0) + 1 });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao obter próximo código' });
    }
});

app.get('/api/pedidos', async (req, res) => {
    try {
        const { mes, ano } = req.query;
        let query;
        if (mes !== undefined && ano !== undefined) {
            const month = parseInt(mes), year = parseInt(ano);
            const start = new Date(year, month, 1).toISOString().split('T')[0];
            const end   = new Date(year, month + 1, 0).toISOString().split('T')[0];
            query = supabase.from('faturamento').select('*').gte('data_registro', `${start}T00:00:00`).lte('data_registro', `${end}T23:59:59`).order('codigo', { ascending: true });
        } else {
            query = supabase.from('faturamento').select('*').order('codigo', { ascending: false });
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar pedidos', details: err.message });
    }
});

app.post('/api/pedidos', async (req, res) => {
    try {
        let pedidoData = { ...req.body };
        if (!pedidoData.codigo) {
            const { data: maxData, error: maxErr } = await supabase.from('faturamento').select('codigo').order('codigo', { ascending: false }).limit(1);
            if (maxErr) throw maxErr;
            pedidoData.codigo = (maxData[0]?.codigo || 0) + 1;
        }
        const { data, error } = await supabase.from('faturamento').insert([pedidoData]).select();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar pedido', details: err.message });
    }
});

app.patch('/api/pedidos/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('faturamento').update(req.body).eq('id', req.params.id).select();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar pedido' });
    }
});

app.delete('/api/pedidos/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('faturamento').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao excluir pedido' });
    }
});

// Estoque (compartilhado com faturamento)
app.get('/api/estoque', async (req, res) => {
    try {
        const { data, error } = await supabase.from('estoque').select('*');
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar estoque' });
    }
});

app.patch('/api/estoque/:codigo', async (req, res) => {
    try {
        const { data, error } = await supabase.from('estoque').update(req.body).eq('codigo', req.params.codigo).select();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar estoque' });
    }
});

// ============================================
// MÓDULO: CONTROLE DE FRETE
// Tabela: frete
// ============================================

app.use('/api/fretes', verificarAutenticacao);
app.head('/api/fretes', (req, res) => res.status(200).end());

app.get('/api/fretes', async (req, res) => {
    try {
        const { mes, ano } = req.query;
        let query = supabase.from('frete').select('*');
        if (mes !== undefined && ano !== undefined) {
            const month = parseInt(mes), year = parseInt(ano);
            const start = new Date(year, month, 1).toISOString().split('T')[0];
            const end   = new Date(year, month + 1, 0).toISOString().split('T')[0];
            query = query.gte('data_emissao', start).lte('data_emissao', end);
        }
        const { data, error } = await query.order('timestamp', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar fretes', details: err.message });
    }
});

app.get('/api/fretes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('frete').select('*').eq('id', req.params.id).single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Frete não encontrado' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar frete', details: err.message });
    }
});

app.post('/api/fretes', async (req, res) => {
    try {
        const { data, error } = await supabase.from('frete').insert([{ ...req.body, timestamp: new Date().toISOString() }]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao criar frete', details: err.message });
    }
});

app.put('/api/fretes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('frete').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Frete não encontrado' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar frete', details: err.message });
    }
});

app.patch('/api/fretes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('frete').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Frete não encontrado' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar frete', details: err.message });
    }
});

app.delete('/api/fretes/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('frete').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro ao excluir frete', details: err.message });
    }
});

// ============================================
// MÓDULO: CONTAS A RECEBER
// Tabela: receber
// ============================================

app.use('/api/receber', verificarAutenticacao);
app.head('/api/receber', (req, res) => res.status(200).end());

app.get('/api/receber', async (req, res) => {
    try {
        const { data, error } = await supabase.from('receber').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/receber', async (req, res) => {
    try {
        const { data, error } = await supabase.from('receber').insert([req.body]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/receber/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('receber').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.patch('/api/receber/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('receber').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select().single();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/receber/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('receber').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// MÓDULO: VENDAS
// Tabela: vendas  (sincroniza de frete + receber)
// ============================================

app.use('/api/vendas',              verificarAutenticacao);
app.use('/api/vendas-consolidadas', verificarAutenticacao);
app.use('/api/sync',                verificarAutenticacao);
app.use('/api/dashboard',           verificarAutenticacao);

async function syncVendas() {
    const vendedores = ['ROBERTO', 'ISAQUE', 'MIGUEL'];
    const registros  = [];

    for (const vendedor of vendedores) {
        const { data: freteData  } = await supabase.from('frete').select('*').eq('vendedor', vendedor).order('numero_nf', { ascending: true });
        const { data: contasData } = await supabase.from('receber').select('*').eq('vendedor', vendedor).order('numero_nf', { ascending: true });

        const nfsPagas = new Map();
        (contasData || []).forEach(c => {
            if (c.status === 'PAGO' && c.data_pagamento) nfsPagas.set(c.numero_nf, c);
        });

        const processadas = new Set();

        nfsPagas.forEach((conta, nf) => {
            registros.push({ numero_nf: nf, origem: 'CONTAS_RECEBER', data_emissao: conta.data_emissao, valor_nf: conta.valor, tipo_nf: conta.tipo_nf, nome_orgao: conta.orgao, vendedor, banco: conta.banco, data_vencimento: conta.data_vencimento, data_pagamento: conta.data_pagamento, status_pagamento: conta.status, observacoes: conta.observacoes, id_contas_receber: conta.id, prioridade: 2 });
            processadas.add(nf);
        });

        (freteData || []).forEach(frete => {
            if (!processadas.has(frete.numero_nf)) {
                registros.push({ numero_nf: frete.numero_nf, origem: 'CONTROLE_FRETE', data_emissao: frete.data_emissao, valor_nf: frete.valor_nf, tipo_nf: frete.tipo_nf, nome_orgao: frete.nome_orgao, vendedor, documento: frete.documento, contato_orgao: frete.contato_orgao, transportadora: frete.transportadora, valor_frete: frete.valor_frete, data_coleta: frete.data_coleta, cidade_destino: frete.cidade_destino, previsao_entrega: frete.previsao_entrega, status_frete: frete.status, id_controle_frete: frete.id, prioridade: 1 });
            }
        });
    }

    await supabase.from('vendas').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (registros.length > 0) await supabase.from('vendas').insert(registros);
    return { success: true, count: registros.length };
}

app.get('/api/sync', async (req, res) => {
    try { res.json(await syncVendas()); }
    catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/vendas-consolidadas', async (req, res) => {
    try {
        await syncVendas();
        const { data, error } = await supabase.from('vendas').select('*').order('numero_nf', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/vendas', async (req, res) => {
    try {
        await syncVendas();
        const { data, error } = await supabase.from('vendas').select('*').order('numero_nf', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/dashboard', async (req, res) => {
    try {
        await syncVendas();
        const { data, error } = await supabase.from('vendas').select('*');
        if (error) throw error;
        const stats = { pago: 0, aReceber: 0, entregue: 0, faturado: 0 };
        (data || []).forEach(v => {
            const valor = parseFloat(v.valor_nf) || 0;
            stats.faturado += valor;
            if (v.origem === 'CONTAS_RECEBER' && v.data_pagamento) stats.pago += valor;
            else if (v.origem === 'CONTROLE_FRETE' && v.status_frete === 'ENTREGUE') { stats.aReceber += valor; stats.entregue += 1; }
        });
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ============================================
// MÓDULO: CONTAS A PAGAR
// Tabela: pagar
// ============================================

app.use('/api/contas', verificarAutenticacao);
app.head('/api/contas', (req, res) => res.status(200).end());

app.get('/api/contas/grupo/:grupoId', async (req, res) => {
    try {
        const { data, error } = await supabase.from('pagar').select('*').eq('grupo_id', req.params.grupoId).order('parcela_numero', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar parcelas do grupo', message: err.message });
    }
});

app.get('/api/contas', async (req, res) => {
    try {
        const { data, error } = await supabase.from('pagar').select('*').order('data_vencimento', { ascending: true });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar contas', message: err.message });
    }
});

app.get('/api/contas/:id', async (req, res) => {
    try {
        const { data, error } = await supabase.from('pagar').select('*').eq('id', req.params.id).single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Conta não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao buscar conta', message: err.message });
    }
});

app.post('/api/contas', async (req, res) => {
    try {
        const { documento, descricao, valor, data_vencimento, forma_pagamento, banco,
                data_pagamento, observacoes, parcela_numero, parcela_total, status, grupo_id } = req.body;
        const valorNum = parseFloat(valor);
        if (isNaN(valorNum) || valorNum <= 0) return res.status(400).json({ success: false, error: 'Valor deve ser um número maior que zero' });
        const nova = {
            documento:       documento || null,
            descricao,
            valor:           valorNum,
            data_vencimento,
            forma_pagamento,
            banco,
            data_pagamento:  data_pagamento || null,
            observacoes:     observacoes || null,
            parcela_numero:  parcela_numero || null,
            parcela_total:   parcela_total || null,
            status:          status || (data_pagamento ? 'PAGO' : 'PENDENTE'),
            grupo_id:        grupo_id || uuidv4()
        };
        const { data, error } = await supabase.from('pagar').insert([nova]).select().single();
        if (error) throw error;
        res.status(201).json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao criar conta', message: err.message });
    }
});

app.put('/api/contas/:id', async (req, res) => {
    try {
        const { documento, descricao, valor, data_vencimento, forma_pagamento, banco,
                data_pagamento, observacoes, parcela_numero, parcela_total, status } = req.body;
        const valorNum = parseFloat(valor);
        if (isNaN(valorNum) || valorNum <= 0) return res.status(400).json({ success: false, error: 'Valor deve ser um número maior que zero' });
        const upd = {
            documento:       documento || null,
            descricao,
            valor:           valorNum,
            data_vencimento,
            forma_pagamento,
            banco,
            data_pagamento:  data_pagamento || null,
            observacoes:     observacoes || null,
            parcela_numero:  parcela_numero || null,
            parcela_total:   parcela_total || null,
            status:          status || (data_pagamento ? 'PAGO' : 'PENDENTE')
        };
        const { data, error } = await supabase.from('pagar').update(upd).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Conta não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar conta', message: err.message });
    }
});

app.patch('/api/contas/:id', async (req, res) => {
    try {
        const updates = {};
        if (req.body.status          !== undefined) updates.status          = req.body.status;
        if (req.body.data_pagamento  !== undefined) updates.data_pagamento  = req.body.data_pagamento;
        if (req.body.parcela_total   !== undefined) updates.parcela_total   = req.body.parcela_total;
        const { data, error } = await supabase.from('pagar').update(updates).eq('id', req.params.id).select().single();
        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ success: false, error: 'Conta não encontrada' });
            throw error;
        }
        res.json(data);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao atualizar conta', message: err.message });
    }
});

app.delete('/api/contas/:id', async (req, res) => {
    try {
        const { error } = await supabase.from('pagar').delete().eq('id', req.params.id);
        if (error) throw error;
        res.json({ success: true, message: 'Conta removida com sucesso' });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao deletar conta', message: err.message });
    }
});

// ============================================
// MÓDULO: LUCRO REAL
// Tabela: lucro  (lê de frete para processar)
// ============================================

app.use('/api/lucro-real',  verificarAutenticacao);
app.use('/api/custo-fixo',  verificarAutenticacao);

function parseValorMonetario(valor) {
    if (valor === null || valor === undefined) return 0;
    if (typeof valor === 'number') return valor;
    let s = String(valor).replace('R$', '').trim().replace(',', '.');
    const pts = s.split('.');
    if (pts.length > 2) { const dec = pts.pop(); s = pts.join('') + '.' + dec; }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function calcularValores(venda) {
    return { comissao: venda * 0.0125, impostoFederal: venda * 0.11 };
}

async function obterRegistroExistente(codigo) {
    try {
        const { data } = await supabase.from('lucro').select('*').eq('codigo', codigo);
        return data?.[0] || null;
    } catch { return null; }
}

async function processarFreteParaLucro(frete) {
    if ((frete.tipo_nf || 'ENVIO') !== 'ENVIO') return;
    const venda  = parseValorMonetario(frete.valor_nf);
    const freteV = parseValorMonetario(frete.valor_frete);
    const { comissao, impostoFederal } = calcularValores(venda);
    const existente = await obterRegistroExistente(frete.id);
    const custo = existente?.custo || 0;
    const lucroReal = venda - custo - freteV - comissao - impostoFederal;
    const registro = {
        codigo:         frete.id,
        nf:             frete.numero_nf || '-',
        vendedor:       frete.vendedor || '',
        venda,
        custo,
        frete:          freteV,
        comissao,
        imposto_federal: impostoFederal,
        lucro_real:     lucroReal,
        margem_liquida: venda ? lucroReal / venda : 0,
        data_emissao:   (frete.data_emissao || new Date().toISOString()).split('T')[0]
    };
    if (existente) {
        await supabase.from('lucro').update({ ...registro, custo: existente.custo }).eq('codigo', frete.id);
    } else {
        await supabase.from('lucro').insert([registro]);
    }
}

// Carga inicial e monitoramento
app.get('/api/carga-inicial', async (req, res) => {
    try {
        const { data: fretes } = await supabase.from('frete').select('*');
        for (const f of fretes || []) await processarFreteParaLucro(f);
        res.json({ success: true, total: fretes?.length || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/monitorar-pedidos', async (req, res) => {
    try {
        const dois = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data: fretes } = await supabase.from('frete').select('*').gte('updated_at', dois);
        for (const f of fretes || []) await processarFreteParaLucro(f);
        res.json({ success: true, quantidade: fretes?.length || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/lucro-real', async (req, res) => {
    try {
        const { mes, ano } = req.query;
        if (mes === undefined && ano === undefined) return res.status(400).json({ error: 'Mês/ano ou ano são obrigatórios' });
        let query;
        if (mes !== undefined && ano !== undefined) {
            const month = parseInt(mes), year = parseInt(ano);
            const start = new Date(year, month, 1).toISOString().split('T')[0];
            const end   = new Date(year, month + 1, 0).toISOString().split('T')[0];
            query = supabase.from('lucro').select('*').gte('data_emissao', start).lte('data_emissao', end).order('data_emissao', { ascending: true });
        } else {
            const year  = parseInt(ano);
            const start = `${year}-01-01`, end = `${year}-12-31`;
            query = supabase.from('lucro').select('*').gte('data_emissao', start).lte('data_emissao', end);
        }
        const { data, error } = await query;
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao buscar lucro real', details: err.message });
    }
});

app.patch('/api/lucro-real/:codigo', async (req, res) => {
    try {
        const { data: registros } = await supabase.from('lucro').select('*').eq('codigo', req.params.codigo);
        if (!registros?.length) return res.status(404).json({ error: 'Registro não encontrado' });
        const reg = registros[0];
        const updates = {};
        if (req.body.custo            !== undefined) updates.custo            = req.body.custo;
        if (req.body.comissao         !== undefined) updates.comissao         = req.body.comissao;
        if (req.body.imposto_federal  !== undefined) updates.imposto_federal  = req.body.imposto_federal;
        const custo  = updates.custo           ?? reg.custo;
        const comiss = updates.comissao        ?? reg.comissao;
        const imposto = updates.imposto_federal ?? reg.imposto_federal;
        updates.lucro_real     = reg.venda - custo - (reg.frete || 0) - comiss - imposto;
        updates.margem_liquida = reg.venda ? updates.lucro_real / reg.venda : 0;
        const { data, error } = await supabase.from('lucro').update(updates).eq('codigo', req.params.codigo).select();
        if (error) throw error;
        res.json(data);
    } catch (err) {
        res.status(500).json({ error: 'Erro ao atualizar lucro real', details: err.message });
    }
});

app.get('/api/custo-fixo', async (req, res) => {
    try {
        const { mes, ano } = req.query;
        if (mes === undefined || ano === undefined) return res.status(400).json({ error: 'Mês e ano são obrigatórios' });
        const start = new Date(parseInt(ano), parseInt(mes), 1).toISOString().split('T')[0];
        const end   = new Date(parseInt(ano), parseInt(mes) + 1, 0).toISOString().split('T')[0];
        const { data } = await supabase.from('lucro').select('custo_fixo_mensal').gte('data_emissao', start).lte('data_emissao', end).limit(1);
        res.json({ valor: data?.length > 0 ? (data[0].custo_fixo_mensal || 0) : 0 });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno', details: err.message });
    }
});

app.post('/api/custo-fixo', async (req, res) => {
    try {
        const { mes, ano, valor } = req.body;
        if (mes === undefined || ano === undefined || valor === undefined) return res.status(400).json({ error: 'Mês, ano e valor são obrigatórios' });
        const start = new Date(parseInt(ano), parseInt(mes), 1).toISOString().split('T')[0];
        const end   = new Date(parseInt(ano), parseInt(mes) + 1, 0).toISOString().split('T')[0];
        const { error } = await supabase.from('lucro').update({ custo_fixo_mensal: parseFloat(valor) }).gte('data_emissao', start).lte('data_emissao', end);
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Erro interno', details: err.message });
    }
});

// Rotas de debug (sem auth)
app.get('/api/debug/fretes', async (req, res) => {
    try {
        const { data } = await supabase.from('frete').select('id,numero_nf,tipo_nf,vendedor,valor_nf,valor_frete,data_emissao,updated_at').order('updated_at', { ascending: false }).limit(20);
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/debug/lucro-real', async (req, res) => {
    try {
        const { data } = await supabase.from('lucro').select('*').order('created_at', { ascending: false }).limit(20);
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================
// HEALTH & FALLBACKS
// ============================================

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), modulos: ['portal', ...MODULOS] });
});

app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Raiz → portal
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'apps', 'portal', 'index.html'));
});

// Fallback por módulo → index.html do módulo
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
    console.log('🚀 I.R. COMÉRCIO — MONOREPO CENTRAL');
    console.log('===============================================');
    console.log(`✅ Porta:    ${PORT}`);
    console.log(`✅ Supabase: ${supabaseUrl}`);
    console.log(`✅ Portal:   ${PORTAL_URL}`);
    console.log('');
    console.log('📦 Módulos:');
    console.log('   • Portal            → /');
    MODULOS.forEach(m => console.log(`   • ${m.padEnd(18)} → /${m}`));
    console.log('');
    console.log('🔌 APIs:');
    console.log('   /api/licitacoes   /api/compra        /api/transportadoras');
    console.log('   /api/cotacoes     /api/pedidos        /api/estoque');
    console.log('   /api/fretes       /api/receber        /api/contas');
    console.log('   /api/vendas       /api/lucro-real     /api/custo-fixo');
    console.log('===============================================');
});

// Sincronização inicial de vendas + carga de lucro real
setTimeout(async () => {
    try { await syncVendas(); console.log('✅ Sync vendas OK'); } catch (e) { console.error('Sync vendas:', e.message); }
    try {
        const { data: fretes } = await supabase.from('frete').select('*');
        for (const f of fretes || []) await processarFreteParaLucro(f);
        console.log(`✅ Carga lucro real: ${fretes?.length || 0} registros`);
    } catch (e) { console.error('Carga lucro:', e.message); }
}, 4000);

// Monitoramento a cada 15s (vendas + lucro)
setInterval(async () => {
    try { await syncVendas(); } catch {}
    try {
        const dois = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const { data: fretes } = await supabase.from('frete').select('*').gte('updated_at', dois);
        for (const f of fretes || []) await processarFreteParaLucro(f);
    } catch {}
}, 15000);

process.on('unhandledRejection', reason => console.error('❌ Unhandled Rejection:', reason));
process.on('uncaughtException',  error  => { console.error('❌ Uncaught Exception:', error); process.exit(1); });

module.exports = app;
