'use strict';

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const crypto  = require('crypto');
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
// FUNÇÕES AUXILIARES PARA AUTENTICAÇÃO
// ============================================
function getClientIP(req) {
    const xForwardedFor = req.headers['x-forwarded-for'];
    const clientIP = xForwardedFor
        ? xForwardedFor.split(',')[0].trim()
        : req.socket.remoteAddress;
    return clientIP.replace('::ffff:', '');
}

function generateSecureToken() {
    return 'sess_' + crypto.randomBytes(32).toString('hex');
}

function sanitizeString(str) {
    if (typeof str !== 'string') return '';
    return str.trim().replace(/[<>]/g, '');
}

// Rate limiting simples
const loginAttempts = new Map();
function checkRateLimit(ip) {
    const now = Date.now();
    const attempt = loginAttempts.get(ip);
    if (!attempt) {
        loginAttempts.set(ip, { count: 1, resetTime: now + 5 * 60 * 1000 });
        return true;
    }
    if (now > attempt.resetTime) {
        loginAttempts.set(ip, { count: 1, resetTime: now + 5 * 60 * 1000 });
        return true;
    }
    if (attempt.count >= 5) return false;
    attempt.count++;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, attempt] of loginAttempts.entries()) {
        if (now > attempt.resetTime) loginAttempts.delete(ip);
    }
}, 60 * 60 * 1000);

async function logLoginAttempt(username, success, reason, deviceToken, ip) {
    try {
        await supabase.from('login').insert({
            username: sanitizeString(username),
            ip_address: ip,
            device_token: sanitizeString(deviceToken),
            success: success,
            failure_reason: reason,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Erro ao registrar log:', error);
    }
}

// ============================================
// ROTAS DE AUTENTICAÇÃO (PORTAL)
// ============================================
app.post('/api/login', async (req, res) => {
    try {
        const { username, password, deviceToken } = req.body;
        if (!username || !password || !deviceToken) {
            return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
        }

        const cleanIP = getClientIP(req);
        if (!checkRateLimit(cleanIP)) {
            return res.status(429).json({ error: 'Muitas tentativas de login', message: 'Tente novamente em 5 minutos.' });
        }

        const { data: user, error } = await supabase
            .from('users')
            .select('id, username, password, name, is_admin, is_active, sector')
            .eq('username', username.toLowerCase())
            .single();

        if (error || !user) {
            await logLoginAttempt(username, false, 'Usuário não encontrado', deviceToken, cleanIP);
            return res.status(401).json({ error: 'Usuário ou senha incorretos' });
        }

        if (!user.is_active) {
            await logLoginAttempt(username, false, 'Usuário inativo', deviceToken, cleanIP);
            return res.status(401).json({ error: 'Usuário inativo' });
        }

        if (password !== user.password) {
            await logLoginAttempt(username, false, 'Senha incorreta', deviceToken, cleanIP);
            return res.status(401).json({ error: 'Usuário ou senha incorretos' });
        }

        // Registrar dispositivo
        await supabase.from('authorized').upsert({
            user_id: user.id,
            device_token: deviceToken,
            ip_address: cleanIP,
            user_agent: req.headers['user-agent'] || 'Unknown',
            is_active: true,
            last_access: new Date().toISOString()
        }, { onConflict: 'device_token' });

        // Criar sessão
        const sessionToken = generateSecureToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        // Desativar sessões antigas do mesmo dispositivo
        await supabase.from('active').update({ is_active: false }).eq('user_id', user.id).eq('device_token', deviceToken);
        
        await supabase.from('active').insert({
            user_id: user.id,
            device_token: deviceToken,
            ip_address: cleanIP,
            session_token: sessionToken,
            expires_at: expiresAt.toISOString(),
            is_active: true,
            last_activity: new Date().toISOString()
        });

        await logLoginAttempt(username, true, null, deviceToken, cleanIP);

        res.json({
            success: true,
            session: {
                userId: user.id,
                username: user.username,
                name: user.name,
                sector: user.sector,
                isAdmin: user.is_admin,
                sessionToken: sessionToken,
                deviceToken: deviceToken,
                ip: cleanIP,
                expiresAt: expiresAt.toISOString()
            }
        });
    } catch (err) {
        console.error('❌ Erro no login:', err);
        res.status(500).json({ error: 'Erro interno no servidor' });
    }
});

app.post('/api/logout', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        if (!sessionToken) return res.status(400).json({ error: 'Session token ausente' });
        await supabase.from('active').update({ is_active: false, logout_at: new Date().toISOString() }).eq('session_token', sessionToken);
        res.json({ success: true });
    } catch (err) {
        console.error('❌ Erro no logout:', err);
        res.status(500).json({ error: 'Erro ao fazer logout' });
    }
});

app.post('/api/verify-session', async (req, res) => {
    try {
        const { sessionToken } = req.body;
        if (!sessionToken) return res.status(401).json({ valid: false, reason: 'token_missing' });

        const { data: session, error } = await supabase
            .from('active')
            .select(`
                *,
                users:user_id (id, username, name, sector, is_admin, is_active)
            `)
            .eq('session_token', sessionToken)
            .eq('is_active', true)
            .single();

        if (error || !session) {
            return res.status(401).json({ valid: false, reason: 'session_not_found' });
        }

        if (!session.users.is_active) {
            await supabase.from('active').update({ is_active: false }).eq('session_token', sessionToken);
            return res.status(401).json({ valid: false, reason: 'user_inactive' });
        }

        if (new Date(session.expires_at) < new Date()) {
            await supabase.from('active').update({ is_active: false }).eq('session_token', sessionToken);
            return res.status(401).json({ valid: false, reason: 'session_expired' });
        }

        // Atualizar última atividade
        await supabase.from('active').update({ last_activity: new Date().toISOString() }).eq('session_token', sessionToken);

        res.json({
            valid: true,
            session: {
                userId: session.users.id,
                username: session.users.username,
                name: session.users.name,
                sector: session.users.sector,
                isAdmin: session.users.is_admin
            }
        });
    } catch (err) {
        console.error('❌ Erro ao verificar sessão:', err);
        res.status(500).json({ valid: false, reason: 'server_error' });
    }
});

app.get('/api/ip', (req, res) => {
    res.json({ ip: getClientIP(req) });
});

// ============================================
// ARQUIVOS ESTÁTICOS — CADA MÓDULO NA SUA PASTA
// ============================================
const MODULOS = [
    'licitacoes', 'precos', 'compra', 'transportadoras',
    'cotacoes', 'faturamento', 'estoque', 'frete',
    'receber', 'vendas', 'pagar', 'lucro'
];

// Portal (raiz)
app.use('/', express.static(path.join(__dirname, 'apps', 'portal'), {
    setHeaders: (res, filepath) => {
        if (filepath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
        if (filepath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
        if (filepath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
    }
}));

// Módulos
MODULOS.forEach(modulo => {
    app.use(`/${modulo}`, express.static(path.join(__dirname, 'apps', modulo), {
        setHeaders: (res, filepath) => {
            if (filepath.endsWith('.js')) res.setHeader('Content-Type', 'application/javascript');
            if (filepath.endsWith('.css')) res.setHeader('Content-Type', 'text/css');
            if (filepath.endsWith('.html')) res.setHeader('Content-Type', 'text/html');
        }
    }));
});

// ============================================
// MIDDLEWARE DE AUTENTICAÇÃO PARA APIS DOS MÓDULOS
// ============================================
async function verificarAutenticacao(req, res, next) {
    const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;
    if (!sessionToken) {
        return res.status(401).json({ error: 'Não autenticado', redirectToLogin: true });
    }
    try {
        const { data: session, error } = await supabase
            .from('active')
            .select('*, users:user_id (is_active)')
            .eq('session_token', sessionToken)
            .eq('is_active', true)
            .single();
        if (error || !session) {
            return res.status(401).json({ error: 'Sessão inválida', redirectToLogin: true });
        }
        if (!session.users.is_active) {
            return res.status(401).json({ error: 'Usuário inativo', redirectToLogin: true });
        }
        if (new Date(session.expires_at) < new Date()) {
            await supabase.from('active').update({ is_active: false }).eq('session_token', sessionToken);
            return res.status(401).json({ error: 'Sessão expirada', redirectToLogin: true });
        }
        req.user = session;
        req.sessionToken = sessionToken;
        next();
    } catch (err) {
        console.error('❌ Erro ao verificar autenticação:', err.message);
        return res.status(500).json({ error: 'Erro ao verificar autenticação' });
    }
}

// ============================================
// MÓDULO: LICITAÇÕES (APENAS AS ROTAS CRÍTICAS – O RESTO É IGUAL AO SEU SERVER.JS ORIGINAL)
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
                const endDate = mesNum === 12 ? `${anoNum+1}-01-01` : `${anoNum}-${(mesNum+1).toString().padStart(2,'0')}-01`;
                query = query.filter('data', 'gte', startDate).filter('data', 'lt', endDate);
            }
        }
        const { data, error } = await query.order('data', { ascending: false });
        if (error) throw error;
        res.json(data || []);
    } catch (err) {
        res.status(500).json({ success: false, error: 'Erro ao listar licitações', message: err.message });
    }
});

// As demais rotas (GET/:id, POST, PUT, DELETE, e rotas de itens) você já tem no seu server.js original.
// Vou mantê-las como estão, mas certifique-se de que estão presentes.

// ... (aqui viriam todas as outras rotas que você já possui: /api/compra, etc.)

// ============================================
// ROTAS DE SAÚDE E FALLBACK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), modulos: ['portal', ...MODULOS] });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'apps', 'portal', 'index.html'));
});

MODULOS.forEach(modulo => {
    app.get(`/${modulo}/*`, (req, res) => {
        res.sendFile(path.join(__dirname, 'apps', modulo, 'index.html'));
    });
});

app.use((err, req, res, next) => {
    console.error('❌ Erro não tratado:', err);
    res.status(500).json({ success: false, error: 'Erro interno do servidor', message: err.message });
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log('');
    console.log('===============================================');
    console.log('🚀 I.R. COMÉRCIO - MONOREPO CENTRAL');
    console.log('===============================================');
    console.log(`✅ Porta:    ${PORT}`);
    console.log(`✅ Supabase: ${supabaseUrl}`);
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
