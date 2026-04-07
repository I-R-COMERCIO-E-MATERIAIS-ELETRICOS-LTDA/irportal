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
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'HEAD', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── LOG DE ACESSOS ───────────────────────────────────────────────────────────
const logFilePath = path.join(__dirname, 'acessos.log');
let accessCount = 0;
let uniqueIPs = new Set();

function registrarAcesso(req, res, next) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    const clientIP = xForwardedFor
        ? xForwardedFor.split(',')[0].trim()
        : req.socket.remoteAddress;

    const cleanIP = (clientIP || '').replace('::ffff:', '');
    const logEntry = `[${new Date().toISOString()}] ${cleanIP} - ${req.method} ${req.path}\n`;

    fs.appendFile(logFilePath, logEntry, () => {});
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
// Rotas que não precisam de autenticação
const PUBLIC_PATHS = [
    '/',
    '/health',
    '/app',
    '/portal',
    '/portal/',
];

async function verificarAutenticacao(req, res, next) {
    // Libera rotas públicas e assets estáticos
    const isPublicPath = PUBLIC_PATHS.some(p => req.path === p);
    const isStaticAsset = /\.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$/i.test(req.path);

    if (isPublicPath || isStaticAsset) {
        return next();
    }

    // Rotas da API do portal (login, etc.) são públicas
    if (req.path.startsWith('/api/portal/')) {
        return next();
    }

    const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;

    if (!sessionToken) {
        // Se for navegação HTML, redireciona para o portal
        if (req.headers.accept && req.headers.accept.includes('text/html')) {
            return res.redirect('/portal?redirect=' + encodeURIComponent(req.path));
        }
        return res.status(401).json({ error: 'Não autenticado', redirectToLogin: true });
    }

    try {
        // Verificação interna de sessão via Supabase (não depende de outro servidor)
        const { data: session, error } = await supabase
            .from('active_sessions')
            .select(`
                *,
                users (
                    id, username, name, is_admin, is_active,
                    sector, apps, authorized_ips
                )
            `)
            .eq('session_token', sessionToken)
            .eq('is_active', true)
            .gt('expires_at', new Date().toISOString())
            .single();

        if (error || !session) {
            return res.status(401).json({ error: 'Sessão inválida', redirectToLogin: true });
        }

        if (!session.users || !session.users.is_active) {
            return res.status(401).json({ error: 'Usuário inativo', redirectToLogin: true });
        }

        // Atualiza last_activity
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
        const { error } = await supabase
            .from('users')
            .select('count', { count: 'exact', head: true });

        res.json({
            status: error ? 'unhealthy' : 'healthy',
            database: error ? 'disconnected' : 'connected',
            timestamp: new Date().toISOString(),
            apps: ['portal', 'precos', 'compras', 'transportadoras', 'cotacoes',
                   'faturamento', 'frete', 'receber', 'vendas', 'pagar', 'lucro',
                   'licitacoes', 'estoque']
        });
    } catch (error) {
        res.json({ status: 'unhealthy', timestamp: new Date().toISOString() });
    }
});

// ─── ARQUIVOS ESTÁTICOS DOS MÓDULOS ──────────────────────────────────────────
// Cada módulo serve seus próprios arquivos estáticos a partir de /apps/<modulo>/

const APPS = [
    'portal', 'precos', 'compras', 'transportadoras', 'cotacoes',
    'faturamento', 'frete', 'receber', 'vendas', 'pagar', 'lucro',
    'licitacoes', 'estoque'
];

APPS.forEach(appName => {
    const appPath = path.join(__dirname, 'apps', appName);
    if (fs.existsSync(appPath)) {
        // Assets estáticos (css, js, imagens) servidos sem autenticação
        app.use(`/${appName}/assets`, express.static(appPath));

        // Rota principal do módulo — HTML requer autenticação (exceto portal)
        app.get(`/${appName}`, (req, res) => {
            res.sendFile(path.join(appPath, 'index.html'));
        });

        app.get(`/${appName}/`, (req, res) => {
            res.sendFile(path.join(appPath, 'index.html'));
        });

        // Arquivos estáticos gerais do módulo (css, js, imagens na raiz)
        app.use(`/${appName}`, express.static(appPath, {
            index: false, // não servir index.html automaticamente (já tratamos acima)
            dotfiles: 'deny'
        }));
    }
});

// ─── API DO PORTAL (autenticação e sessões) ───────────────────────────────────
// Importa as rotas do portal
const portalRoutes = require('./apps/portal/routes');
app.use('/api/portal', portalRoutes(supabase));

// ─── MIDDLEWARE DE AUTENTICAÇÃO (aplicado a partir daqui) ─────────────────────
app.use('/api', verificarAutenticacao);

// ─── API DE PREÇOS ────────────────────────────────────────────────────────────
const precosRoutes = require('./apps/precos/routes');
app.use('/api/precos', precosRoutes(supabase));

// ─── ROTA RAIZ → PORTAL ───────────────────────────────────────────────────────
app.get('/', (req, res) => {
    const portalPath = path.join(__dirname, 'apps', 'portal', 'index.html');
    if (fs.existsSync(portalPath)) {
        res.sendFile(portalPath);
    } else {
        res.json({
            message: 'I.R. Comércio - Sistema Central',
            apps: APPS.map(a => `/${a}`)
        });
    }
});

// ─── 404 ──────────────────────────────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: '404 - Rota não encontrada' });
});

// ─── TRATAMENTO DE ERROS ──────────────────────────────────────────────────────
app.use((error, req, res, next) => {
    console.error('Erro interno:', error.message);
    res.status(500).json({ error: 'Erro interno do servidor' });
});

// ─── INICIAR ──────────────────────────────────────────────────────────────────
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n✅ I.R. Comércio - Servidor Central rodando na porta ${PORT}`);
    console.log(`✅ Database: Supabase conectado`);
    console.log(`✅ Autenticação: Ativa (via Supabase direto)\n`);

    APPS.forEach(appName => {
        const appPath = path.join(__dirname, 'apps', appName);
        const status = fs.existsSync(appPath) ? '✅' : '⚠️ ';
        console.log(`  ${status} /${appName}`);
    });

    console.log(`\n📝 Logs salvos em: acessos.log\n`);
});
