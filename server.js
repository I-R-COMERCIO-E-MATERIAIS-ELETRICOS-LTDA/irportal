require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── SUPABASE ────────────────────────────────────────────────────────────────
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('❌ ERRO: Variáveis de ambiente do Supabase não configuradas');
    process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

// ─── MIDDLEWARES ──────────────────────────────────────────────────────────────
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── LOG DE ACESSOS ───────────────────────────────────────────────────────────
const logFilePath = path.join(__dirname, 'acessos.log');
let accessCount = 0, uniqueIPs = new Set();

function registrarAcesso(req, res, next) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    const clientIP = xForwardedFor ? xForwardedFor.split(',')[0].trim() : req.socket.remoteAddress;
    const cleanIP = (clientIP || '').replace('::ffff:', '');
    fs.appendFile(logFilePath, `[${new Date().toISOString()}] ${cleanIP} - ${req.method} ${req.path}\n`, () => {});
    accessCount++;
    uniqueIPs.add(cleanIP);
    next();
}
app.use(registrarAcesso);

setInterval(() => {
    if (accessCount > 0) {
        console.log(`📊 Última hora: ${accessCount} requisições de ${uniqueIPs.size} IPs únicos`);
        accessCount = 0;
        uniqueIPs.clear();
    }
}, 3600000);

// ─── AUTENTICAÇÃO CENTRAL ─────────────────────────────────────────────────────
const PUBLIC_PATHS = ['/', '/health', '/app', '/portal', '/portal/', '/api/supabase-config'];
const STATIC_EXTENSIONS = /\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$/i;

async function verificarAutenticacao(req, res, next) {
    const isPublicPath = PUBLIC_PATHS.some(p => req.path === p);
    const isStaticAsset = STATIC_EXTENSIONS.test(req.path);

    if (isPublicPath || isStaticAsset) return next();
    if (req.path.startsWith('/api/portal/')) return next();

    const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;

    if (!sessionToken) {
        if (req.headers.accept && req.headers.accept.includes('text/html'))
            return res.redirect('/portal?redirect=' + encodeURIComponent(req.path));
        return res.status(401).json({ error: 'Não autenticado', redirectToLogin: true });
    }

    try {
        const { data: session, error } = await supabase
            .from('active_sessions')
            .select(`*, users(id, username, name, is_admin, is_active, sector, apps, authorized_ips)`)
            .eq('session_token', sessionToken)
            .eq('is_active', true)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (error || !session || !session.users || !session.users.is_active)
            return res.status(401).json({ error: 'Sessão inválida', redirectToLogin: true });

        supabase
            .from('active_sessions')
            .update({ last_activity: new Date().toISOString() })
            .eq('session_token', sessionToken)
            .then(() => {});

        req.user = session.users;
        req.session = session;
        req.sessionToken = sessionToken;
        next();
    } catch (error) {
        console.error('Erro ao verificar autenticação:', error.message);
        return res.status(500).json({ error: 'Erro ao verificar autenticação' });
    }
}

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
    try {
        const { error } = await supabase.from('users').select('count', { count: 'exact', head: true });
        res.json({
            status: error ? 'unhealthy' : 'healthy',
            database: error ? 'disconnected' : 'connected',
            timestamp: new Date().toISOString()
        });
    } catch {
        res.json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }
});

// ─── CONFIGURAÇÃO DO SUPABASE PARA FRONTEND ──────────────────────────────────
app.get('/api/supabase-config', (req, res) => {
    const url = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;
    console.log('[supabase-config] URL exists:', !!url);
    console.log('[supabase-config] ANON_KEY exists:', !!anonKey);
    if (!url || !anonKey) {
        console.error('❌ Supabase config missing: URL or ANON_KEY not set in environment');
        return res.status(500).json({ error: 'Configuração do Supabase incompleta no servidor' });
    }
    res.json({ url, anonKey });
});

// ─── ARQUIVOS ESTÁTICOS DOS MÓDULOS ─────────────────────────────────────────
const APPS = [
    'portal', 'precos', 'compra', 'transportadoras', 'cotacoes',
    'faturamento', 'frete', 'receber', 'vendas',
    'pagar', 'lucro', 'licitacoes', 'estoque'
];

APPS.forEach(appName => {
    const appPath = path.join(__dirname, 'apps', appName);
    if (fs.existsSync(appPath)) {
        app.use(`/${appName}/assets`, express.static(appPath));
        app.get(`/${appName}`, (req, res) => res.sendFile(path.join(appPath, 'index.html')));
        app.get(`/${appName}/`, (req, res) => res.sendFile(path.join(appPath, 'index.html')));
        app.use(`/${appName}`, express.static(appPath, { index: false, dotfiles: 'deny' }));
        console.log(`✅ Servindo /${appName}`);
    } else {
        console.log(`⚠️  Pasta não encontrada: ${appPath}`);
    }
});

// ─── MIDDLEWARE: FALLBACK DE ASSETS ───────────────────────────────────────────
app.use((req, res, next) => {
    if (!STATIC_EXTENSIONS.test(req.path)) return next();
    const referer = req.get('Referer') || '';
    let matchedApp = null;
    for (const appName of APPS) {
        if (referer.includes(`/${appName}`)) { matchedApp = appName; break; }
    }
    if (!matchedApp) return next();
    const appPath = path.join(__dirname, 'apps', matchedApp);
    const fileName = req.path.replace(/^\//, '');
    const filePath = path.join(appPath, fileName);
    if (fs.existsSync(filePath)) {
        console.log(`🔧 Asset fallback: ${req.path} → /${matchedApp}/${fileName}`);
        return res.sendFile(filePath);
    }
    next();
});

// ─── ROTA RAIZ → PORTAL ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
    const portalPath = path.join(__dirname, 'apps', 'portal', 'index.html');
    if (fs.existsSync(portalPath)) res.sendFile(portalPath);
    else res.json({ message: 'I.R. Comércio - Sistema Central', apps: APPS.map(a => `/${a}`) });
});

// ─── API DO PORTAL (sem autenticação central) ─────────────────────────────────
const portalRoutes = require('./apps/portal/routes');
app.use('/api/portal', portalRoutes(supabase));

// ─── MIDDLEWARE DE AUTENTICAÇÃO (aplicado a TODAS as rotas /api a partir daqui)
app.use('/api', verificarAutenticacao);

// ─── API DE NOTIFICAÇÕES ──────────────────────────────────────────────────────
app.post('/api/notifications', async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Mensagem inválida' });
        const { data, error } = await supabase.from('compranotifications').insert({ message }).select().single();
        if (error) throw error;
        res.status(201).json({ id: data.id });
    } catch (err) { res.status(500).json({ error: 'Erro interno' }); }
});
app.get('/api/notifications', async (req, res) => {
    try {
        const { data, error } = await supabase.from('compranotifications').select('*').order('created_at', { ascending: false }).limit(50);
        if (error) throw error;
        res.json(data || []);
    } catch (err) { res.status(500).json({ error: 'Erro ao buscar notificações' }); }
});

// ─── API DE PREÇOS ────────────────────────────────────────────────────────────
const precosRoutes = require('./apps/precos/routes');
app.use('/api/precos', precosRoutes(supabase));

// ─── API DE COMPRAS ───────────────────────────────────────────────────────────
const compraRoutes = require('./apps/compra/routes');
app.use('/api', compraRoutes(supabase));

// ─── API DE TRANSPORTADORAS ───────────────────────────────────────────────────
const transportadorasRoutes = require('./apps/transportadoras/routes');
app.use('/api/transportadoras', transportadorasRoutes(supabase));

// ─── API DE COTAÇÕES DE FRETE ─────────────────────────────────────────────────
const cotacoesRoutes = require('./apps/cotacoes/routes');
app.use('/api/cotacoes', cotacoesRoutes(supabase));

// ─── API DE FATURAMENTO ───────────────────────────────────────────────────────
const faturamentoRoutes = require('./apps/faturamento/routes');
app.use('/api/pedidos', faturamentoRoutes(supabase));

// ─── API DE CONTROLE DE FRETE ─────────────────────────────────────────────────
const freteRoutes = require('./apps/frete/routes');
app.use('/api/fretes', freteRoutes(supabase));

// ─── API DE CONTAS A RECEBER ──────────────────────────────────────────────────
const receberRoutes = require('./apps/receber/routes');
app.use('/api/receber', receberRoutes(supabase));

// ─── API DE VENDAS ────────────────────────────────────────────────────────────
const vendasRoutes = require('./apps/vendas/routes');
app.use('/api/vendas', vendasRoutes(supabase));

// ─── API DE LUCRO REAL ────────────────────────────────────────────────────────
const lucroRoutes = require('./apps/lucro/routes');
app.use('/api', lucroRoutes(supabase));

// 🚨🚨 NOVO – API DE CONTAS A PAGAR 🚨🚨
const contasPagarRoutes = require('./apps/pagar/routes');
app.use('/api', contasPagarRoutes(supabase));
// 🚨🚨 FIM DA ADIÇÃO 🚨🚨

// ─── ROTA DE ESTOQUE ──────────────────────────────────────────────────────────
app.get('/api/estoque', async (req, res) => {
    try {
        const { data, error } = await supabase.from('estoque').select('*').order('codigo', { ascending: true });
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: 'Erro ao listar estoque' }); }
});
app.patch('/api/estoque/:codigo', async (req, res) => {
    try {
        const { quantidade } = req.body;
        const { data, error } = await supabase.from('estoque').update({ quantidade }).eq('codigo', req.params.codigo).select().single();
        if (error) throw error;
        res.json(data);
    } catch (err) { res.status(500).json({ error: 'Erro ao atualizar estoque' }); }
});

// ─── ENDPOINT DE VERIFICAÇÃO DE SESSÃO ────────────────────────────────────────
app.post('/api/verify-session', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        if (!sessionToken) return res.json({ valid: false });
        const { data: session, error } = await supabase
            .from('active_sessions')
            .select(`*, users(id, username, name, is_admin, is_active, sector, apps, authorized_ips)`)
            .eq('session_token', sessionToken)
            .eq('is_active', true)
            .gt('expires_at', new Date().toISOString())
            .single();
        if (error || !session || !session.users || !session.users.is_active) return res.json({ valid: false });
        res.json({ valid: true, session: session.users });
    } catch (err) { res.status(500).json({ valid: false }); }
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => { res.status(404).json({ error: '404 - Rota não encontrada' }); });

// ─── TRATAMENTO DE ERROS ──────────────────────────────────────────────────────
app.use((error, req, res, next) => { console.error('Erro interno:', error.message); res.status(500).json({ error: 'Erro interno do servidor' }); });

// ─── INICIAR ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ I.R. Comércio - Servidor Central rodando na porta ${PORT}`);
    console.log(`✅ Database: Supabase conectado`);
    console.log(`✅ Autenticação: Ativa (via Supabase)\n`);
    APPS.forEach(appName => {
        const appPath = path.join(__dirname, 'apps', appName);
        const status = fs.existsSync(appPath) ? '✅' : '⚠️ ';
        console.log(`  ${status} /${appName}`);
    });
    console.log(`\n📝 Logs salvos em: acessos.log\n`);
    console.log('📡 Rotas de API registradas:');
    console.log('  POST /api/portal/...         → Portal (auth)');
    console.log('  POST /api/notifications      → Notificações globais');
    console.log('  GET  /api/transportadoras    → Transportadoras');
    console.log('  GET  /api/cotacoes           → Cotações de Frete');
    console.log('  GET  /api/pedidos            → Pedidos de Faturamento');
    console.log('  GET  /api/estoque            → Estoque');
    console.log('  GET  /api/precos             → Preços');
    console.log('  GET  /api/ordens             → Compras');
    console.log('  CRUD /api/fretes             → Controle de Frete');
    console.log('  CRUD /api/receber            → Contas a Receber');
    console.log('  CRUD /api/vendas             → Vendas');
    console.log('  CRUD /api/lucro-real         → Lucro Real');
    console.log('  POST /api/custo-fixo         → Custo Fixo Mensal');
    console.log('  CRUD /api/contas             → Contas a Pagar\n');  // 🚨 NOVO
});
