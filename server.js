// ============================================
// SERVER.JS — MONOREPO CENTRAL
// IR Comércio e Materiais Elétricos
// ============================================
require('dotenv').config();
const express  = require('express');
const path     = require('path');
const cors     = require('cors');

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

// ─── AUTENTICAÇÃO MIDDLEWARE ─────────────────────────────────────────────────
// Valida X-Session-Token ou sessionToken antes de qualquer rota /api
// O PORTAL é o pivô; ele emite os tokens.
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function authMiddleware(req, res, next) {
    // Rota de verificação de sessão — chamada pelo portal, sempre liberada
    if (req.path === '/api/verify-session') return next();

    const token = req.headers['x-session-token']
               || req.query.sessionToken
               || (req.body && req.body.sessionToken);

    if (!token) {
        return res.status(401).json({ error: 'Token de sessão não informado' });
    }

    try {
        // Verifica a sessão na tabela sessions do Supabase (gerenciada pelo PORTAL)
        const { data, error } = await supabase
            .from('sessions')
            .select('user_id, expires_at, user:users(ip_address, role)')
            .eq('token', token)
            .maybeSingle();

        if (error || !data) {
            return res.status(401).json({ error: 'Sessão inválida' });
        }

        if (new Date(data.expires_at) < new Date()) {
            return res.status(401).json({ error: 'Sessão expirada' });
        }

        // Restrição de IP para usuários não-admin
        const clientIp = req.headers['x-forwarded-for']?.split(',')[0]?.trim()
                      || req.socket.remoteAddress;

        const user = data.user;
        if (user?.role !== 'admin') {
            const allowedIps = process.env.ALLOWED_USER_IPS
                ? process.env.ALLOWED_USER_IPS.split(',').map(ip => ip.trim())
                : [];
            if (allowedIps.length > 0 && !allowedIps.includes(clientIp)) {
                return res.status(403).json({ error: 'Acesso negado para este IP' });
            }
        }

        // Restrição de horário
        if (user?.role !== 'admin') {
            const now   = new Date();
            const hour  = now.getHours();
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

// Aplica autenticação a TODAS as rotas /api, exceto verify-session
app.use('/api', authMiddleware);

// ─── ROTA: VERIFY SESSION (usada pelos frontends via PORTAL_URL) ─────────────
app.post('/api/verify-session', async (req, res) => {
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ valid: false });

    try {
        const { data, error } = await supabase
            .from('sessions')
            .select('user_id, expires_at')
            .eq('token', sessionToken)
            .maybeSingle();

        if (error || !data) return res.json({ valid: false });
        if (new Date(data.expires_at) < new Date()) return res.json({ valid: false });
        res.json({ valid: true, userId: data.user_id });
    } catch (err) {
        console.error('[verify-session]', err.message);
        res.status(500).json({ valid: false });
    }
});

// ─── ROTAS DOS MÓDULOS ───────────────────────────────────────────────────────

// PORTAL
app.use(express.static(path.join(__dirname, 'apps/portal')));

// CONTAS A PAGAR  → /pagar  (frontend) + /api  (backend)
app.use('/pagar', express.static(path.join(__dirname, 'apps/pagar')));
app.use('/api',   require('./apps/pagar/routes'));

// LUCRO REAL → /lucro (frontend) + /api (backend)
app.use('/lucro', express.static(path.join(__dirname, 'apps/lucro')));
app.use('/api',   require('./apps/lucro/routes'));

// PREÇOS
app.use('/precos', express.static(path.join(__dirname, 'apps/precos')));
if (require('fs').existsSync(path.join(__dirname, 'apps/precos/routes.js'))) {
    app.use('/api', require('./apps/precos/routes'));
}

// COMPRAS
app.use('/compra', express.static(path.join(__dirname, 'apps/compra')));
if (require('fs').existsSync(path.join(__dirname, 'apps/compra/routes.js'))) {
    app.use('/api', require('./apps/compra/routes'));
}

// TRANSPORTADORAS
app.use('/transportadoras', express.static(path.join(__dirname, 'apps/transportadoras')));
if (require('fs').existsSync(path.join(__dirname, 'apps/transportadoras/routes.js'))) {
    app.use('/api', require('./apps/transportadoras/routes'));
}

// COTAÇÕES
app.use('/cotacoes', express.static(path.join(__dirname, 'apps/cotacoes')));
if (require('fs').existsSync(path.join(__dirname, 'apps/cotacoes/routes.js'))) {
    app.use('/api', require('./apps/cotacoes/routes'));
}

// FATURAMENTO
app.use('/faturamento', express.static(path.join(__dirname, 'apps/faturamento')));
if (require('fs').existsSync(path.join(__dirname, 'apps/faturamento/routes.js'))) {
    app.use('/api', require('./apps/faturamento/routes'));
}

// ─── FALLBACK — PORTAL ROOT ──────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'apps/portal/index.html'));
});

app.use((req, res) => {
    res.status(404).json({ error: 'Rota não encontrada' });
});

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log(`✅ Servidor rodando na porta ${PORT}`);
    console.log(`   Portal   → http://localhost:${PORT}/`);
    console.log(`   Pagar    → http://localhost:${PORT}/pagar`);
    console.log(`   Lucro    → http://localhost:${PORT}/lucro`);
});
