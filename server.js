// ============================================
// SERVER.JS — MONOREPO CENTRAL
// IR Comércio e Materiais Elétricos
// ============================================
require('dotenv').config();
const express = require('express');
const path    = require('path');
const cors    = require('cors');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── MIDDLEWARES GLOBAIS ─────────────────────────────────────────────────────
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS
        ? process.env.ALLOWED_ORIGINS.split(',')
        : '*',
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── SUPABASE (cliente compartilhado para authMiddleware) ────────────────────
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── AUTENTICAÇÃO MIDDLEWARE ─────────────────────────────────────────────────
// Aplica-se a todas as rotas /api (exceto /api/verify-session).
async function authMiddleware(req, res, next) {
    // FIX: aceita tanto /api/verify-session quanto /api/portal/verify-session
    if (req.path === '/verify-session' || req.path === '/portal/verify-session') return next();

    const token = req.headers['x-session-token']
               || req.query.sessionToken
               || (req.body && req.body.sessionToken);

    if (!token) return res.status(401).json({ error: 'Token de sessão não informado' });

    try {
        const { data, error } = await supabase
            .from('sessions')
            .select('user_id, expires_at, user:users(role)')
            .eq('token', token)
            .maybeSingle();

        if (error || !data) return res.status(401).json({ error: 'Sessão inválida' });
        if (new Date(data.expires_at) < new Date()) return res.status(401).json({ error: 'Sessão expirada' });

        const role = data.user?.role;

        // Restrição de IP para usuários não-admin
        if (role !== 'admin') {
            const clientIp = (req.headers['x-forwarded-for']?.split(',')[0]?.trim())
                          || req.socket.remoteAddress;
            const allowedIps = (process.env.ALLOWED_USER_IPS || '').split(',').map(ip => ip.trim()).filter(Boolean);
            if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
                return res.status(403).json({ error: 'Acesso negado para este IP' });
            }
        }

        // Restrição de horário para usuários não-admin
        if (role !== 'admin') {
            const hour  = new Date().getHours();
            const start = parseInt(process.env.ACCESS_HOUR_START ?? '7');
            const end   = parseInt(process.env.ACCESS_HOUR_END   ?? '22');
            if (hour < start || hour >= end) {
                return res.status(403).json({ error: 'Acesso restrito fora do horário permitido' });
            }
        }

        req.sessionData = data;
        next();
    } catch (err) {
        console.error('[auth]', err.message);
        res.status(500).json({ error: 'Erro interno de autenticação' });
    }
}

app.use('/api', authMiddleware);

// ─── VERIFY-SESSION ──────────────────────────────────────────────────────────
// FIX: responde tanto em /api/verify-session quanto /api/portal/verify-session
async function handleVerifySession(req, res) {
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ valid: false });
    try {
        const { data, error } = await supabase
            .from('sessions')
            .select('user_id, expires_at, user:users(id, name, username, role, sector)')
            .eq('token', sessionToken)
            .maybeSingle();
        if (error || !data) return res.json({ valid: false });
        if (new Date(data.expires_at) < new Date()) return res.json({ valid: false });

        const u = data.user || {};
        res.json({
            valid: true,
            userId: data.user_id,
            // FIX: devolve o objeto session completo que o painel/script.js espera
            session: {
                id:       u.id,
                name:     u.name     || u.username || '',
                username: u.username || '',
                role:     u.role     || '',
                sector:   u.sector   || '',
                isAdmin:  u.role === 'admin'
            }
        });
    } catch (err) {
        console.error('[verify-session]', err.message);
        res.status(500).json({ valid: false });
    }
}

app.post('/api/verify-session',         handleVerifySession);
app.post('/api/portal/verify-session',  handleVerifySession);  // alias usado pelo painel/script.js

// ─── HELPER: registrar módulo ─────────────────────────────────────────────────
function registerModule(mountPath, staticDir, routesFile) {
    app.use(mountPath, express.static(path.join(__dirname, staticDir)));
    if (fs.existsSync(path.join(__dirname, routesFile))) {
        app.use('/api', require(path.join(__dirname, routesFile)));
        console.log(`  ✓ ${mountPath} → ${routesFile}`);
    } else {
        console.log(`  ⚠ ${mountPath} → routes não encontrado: ${routesFile}`);
    }
}

// ─── PORTAL (root) ───────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'apps/portal')));

// ─── MÓDULOS ─────────────────────────────────────────────────────────────────

// PAINEL — FIX: registrado ANTES do fallback para /painel não servir o portal
registerModule('/painel',        'apps/painel',        'apps/painel/routes.js');

// CONTAS A PAGAR
registerModule('/pagar',         'apps/pagar',         'apps/pagar/routes.js');

// LUCRO REAL
registerModule('/lucro',         'apps/lucro',         'apps/lucro/routes.js');

// CONTAS A RECEBER
registerModule('/receber',       'apps/receber',       'apps/receber/routes.js');

// CONTROLE DE FRETE
registerModule('/frete',         'apps/frete',         'apps/frete/routes.js');

// PEDIDOS DE FATURAMENTO
registerModule('/faturamento',   'apps/faturamento',   'apps/faturamento/routes.js');

// VENDAS
registerModule('/vendas',        'apps/vendas',        'apps/vendas/routes.js');

// PREÇOS
registerModule('/precos',        'apps/precos',        'apps/precos/routes.js');

// COMPRAS
registerModule('/compra',        'apps/compra',        'apps/compra/routes.js');

// TRANSPORTADORAS
registerModule('/transportadoras', 'apps/transportadoras', 'apps/transportadoras/routes.js');

// COTAÇÕES
registerModule('/cotacoes',      'apps/cotacoes',      'apps/cotacoes/routes.js');

// ─── FALLBACK ────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'apps/portal/index.html'));
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`\n✅  Servidor IR Comércio — porta ${PORT}`);
    console.log(`    Portal       → http://localhost:${PORT}/`);
    console.log(`    Painel       → http://localhost:${PORT}/painel`);
    console.log(`    Pagar        → http://localhost:${PORT}/pagar`);
    console.log(`    Receber      → http://localhost:${PORT}/receber`);
    console.log(`    Frete        → http://localhost:${PORT}/frete`);
    console.log(`    Faturamento  → http://localhost:${PORT}/faturamento`);
    console.log(`    Lucro        → http://localhost:${PORT}/lucro`);
    console.log(`    Vendas API   → http://localhost:${PORT}/api/vendas\n`);
});
