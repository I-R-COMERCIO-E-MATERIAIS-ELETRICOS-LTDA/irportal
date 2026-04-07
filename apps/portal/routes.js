// apps/portal/routes.js
// Rotas de autenticação do Portal Central
const express = require('express');
const crypto = require('crypto');

module.exports = function(supabase) {
    const router = express.Router();

    // ─── VERIFICAR SESSÃO (usado pelos outros módulos) ─────────────────────────
    router.post('/verify-session', async (req, res) => {
        const { sessionToken } = req.body;

        if (!sessionToken) {
            return res.status(400).json({ valid: false, error: 'Token não fornecido' });
        }

        try {
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

            if (error || !session || !session.users?.is_active) {
                return res.json({ valid: false });
            }

            // Atualiza last_activity
            supabase
                .from('active_sessions')
                .update({ last_activity: new Date().toISOString() })
                .eq('session_token', sessionToken)
                .then(() => {});

            return res.json({
                valid: true,
                session: {
                    userId: session.users.id,
                    username: session.users.username,
                    name: session.users.name,
                    isAdmin: session.users.is_admin,
                    sector: session.users.sector,
                    apps: session.users.apps,
                    authorized_ips: session.users.authorized_ips,
                    expiresAt: session.expires_at
                }
            });
        } catch (error) {
            console.error('Erro verify-session:', error.message);
            return res.status(500).json({ valid: false, error: 'Erro interno' });
        }
    });

    // ─── LOGIN ─────────────────────────────────────────────────────────────────
    router.post('/login', async (req, res) => {
        const { username, password, deviceToken, deviceFingerprint, deviceName } = req.body;

        const xForwardedFor = req.headers['x-forwarded-for'];
        const clientIP = xForwardedFor
            ? xForwardedFor.split(',')[0].trim()
            : req.socket.remoteAddress;
        const cleanIP = (clientIP || '').replace('::ffff:', '');
        const userAgent = req.headers['user-agent'] || '';

        if (!username || !password) {
            await registrarTentativa(supabase, username, cleanIP, deviceToken, false, 'Campos obrigatórios ausentes');
            return res.status(400).json({ error: 'Username e senha obrigatórios' });
        }

        try {
            // Busca o usuário
            const { data: user, error: userError } = await supabase
                .from('users')
                .select('*')
                .eq('username', username.trim())
                .single();

            if (userError || !user) {
                await registrarTentativa(supabase, username, cleanIP, deviceToken, false, 'Usuário não encontrado');
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

            if (!user.is_active) {
                await registrarTentativa(supabase, username, cleanIP, deviceToken, false, 'Usuário inativo');
                return res.status(401).json({ error: 'Usuário inativo' });
            }

            // Verifica senha (hash SHA-256 para compatibilidade com o sistema atual)
            const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
            if (user.password !== passwordHash && user.password !== password) {
                await registrarTentativa(supabase, username, cleanIP, deviceToken, false, 'Senha incorreta');
                return res.status(401).json({ error: 'Credenciais inválidas' });
            }

            // Verificação de horário (não adms: 06:00 - 22:00 BRT)
            if (!user.is_admin) {
                const now = new Date();
                const brTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
                const hour = brTime.getHours();
                if (hour < 6 || hour >= 22) {
                    await registrarTentativa(supabase, username, cleanIP, deviceToken, false, 'Fora do horário permitido');
                    return res.status(403).json({ error: 'Acesso permitido apenas entre 06:00 e 22:00 (BRT)' });
                }
            }

            // Verificação de IP (adms: sempre liberados; usuários: somente IPs autorizados)
            if (!user.is_admin && user.authorized_ips && user.authorized_ips.length > 0) {
                if (!user.authorized_ips.includes(cleanIP)) {
                    await registrarTentativa(supabase, username, cleanIP, deviceToken, false, `IP não autorizado: ${cleanIP}`);
                    return res.status(403).json({ error: 'Acesso não autorizado para este IP' });
                }
            }

            // Verifica/cadastra dispositivo
            if (deviceToken) {
                const { data: device } = await supabase
                    .from('authorized_devices')
                    .select('*')
                    .eq('device_token', deviceToken)
                    .eq('user_id', user.id)
                    .single();

                if (!device) {
                    await supabase.from('authorized_devices').insert([{
                        user_id: user.id,
                        device_token: deviceToken,
                        device_fingerprint: deviceFingerprint,
                        device_name: deviceName || 'Dispositivo',
                        ip_address: cleanIP,
                        user_agent: userAgent,
                        is_active: true
                    }]);
                } else if (!device.is_active) {
                    await registrarTentativa(supabase, username, cleanIP, deviceToken, false, 'Dispositivo bloqueado');
                    return res.status(403).json({ error: 'Dispositivo não autorizado' });
                } else {
                    // Atualiza último acesso
                    supabase.from('authorized_devices')
                        .update({ last_access: new Date().toISOString(), ip_address: cleanIP })
                        .eq('id', device.id)
                        .then(() => {});
                }
            }

            // Gera sessão
            const sessionToken = crypto.randomBytes(48).toString('hex');
            const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 horas

            const { error: sessionError } = await supabase
                .from('active_sessions')
                .insert([{
                    user_id: user.id,
                    device_token: deviceToken || crypto.randomBytes(16).toString('hex'),
                    ip_address: cleanIP,
                    session_token: sessionToken,
                    expires_at: expiresAt.toISOString(),
                    is_active: true,
                    last_activity: new Date().toISOString()
                }]);

            if (sessionError) {
                console.error('Erro ao criar sessão:', sessionError.message);
                return res.status(500).json({ error: 'Erro ao criar sessão' });
            }

            await registrarTentativa(supabase, username, cleanIP, deviceToken, true, null);

            return res.json({
                success: true,
                sessionToken,
                expiresAt: expiresAt.toISOString(),
                user: {
                    id: user.id,
                    username: user.username,
                    name: user.name,
                    isAdmin: user.is_admin,
                    sector: user.sector,
                    apps: user.apps
                }
            });
        } catch (error) {
            console.error('Erro no login:', error.message);
            return res.status(500).json({ error: 'Erro interno' });
        }
    });

    // ─── LOGOUT ────────────────────────────────────────────────────────────────
    router.post('/logout', async (req, res) => {
        const sessionToken = req.headers['x-session-token'] || req.body.sessionToken;

        if (!sessionToken) {
            return res.status(400).json({ error: 'Token não fornecido' });
        }

        try {
            await supabase
                .from('active_sessions')
                .update({
                    is_active: false,
                    logout_at: new Date().toISOString()
                })
                .eq('session_token', sessionToken);

            return res.json({ success: true });
        } catch (error) {
            return res.status(500).json({ error: 'Erro ao fazer logout' });
        }
    });

    // ─── LISTAR USUÁRIOS (admin) ───────────────────────────────────────────────
    router.get('/users', verificarAdmin, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('id, username, name, is_admin, is_active, sector, apps, authorized_ips, created_at')
                .order('name');

            if (error) throw error;
            res.json(data || []);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao listar usuários' });
        }
    });

    // ─── CRIAR USUÁRIO (admin) ─────────────────────────────────────────────────
    router.post('/users', verificarAdmin, async (req, res) => {
        const { username, password, name, is_admin, sector, apps, authorized_ips } = req.body;

        if (!username || !password || !name) {
            return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
        }

        try {
            const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

            const { data, error } = await supabase
                .from('users')
                .insert([{
                    username: username.trim(),
                    password: passwordHash,
                    name: name.trim(),
                    is_admin: is_admin || false,
                    is_active: true,
                    sector: sector || null,
                    apps: apps || 'precos',
                    authorized_ips: authorized_ips || []
                }])
                .select('id, username, name, is_admin, sector, apps, authorized_ips')
                .single();

            if (error) {
                if (error.code === '23505') {
                    return res.status(409).json({ error: 'Username já existe' });
                }
                throw error;
            }

            res.status(201).json(data);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao criar usuário' });
        }
    });

    // ─── ATUALIZAR USUÁRIO (admin) ─────────────────────────────────────────────
    router.put('/users/:id', verificarAdmin, async (req, res) => {
        const { name, is_admin, is_active, sector, apps, authorized_ips, password } = req.body;

        try {
            const updateData = { name, is_admin, is_active, sector, apps, authorized_ips };

            if (password) {
                updateData.password = crypto.createHash('sha256').update(password).digest('hex');
            }

            const { data, error } = await supabase
                .from('users')
                .update(updateData)
                .eq('id', req.params.id)
                .select('id, username, name, is_admin, is_active, sector, apps, authorized_ips')
                .single();

            if (error) throw error;
            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao atualizar usuário' });
        }
    });

    // ─── SESSÕES ATIVAS (admin) ────────────────────────────────────────────────
    router.get('/sessions', verificarAdmin, async (req, res) => {
        try {
            const { data, error } = await supabase
                .from('active_sessions')
                .select(`*, users(name, username)`)
                .eq('is_active', true)
                .gt('expires_at', new Date().toISOString())
                .order('last_activity', { ascending: false });

            if (error) throw error;
            res.json(data || []);
        } catch (error) {
            res.status(500).json({ error: 'Erro ao listar sessões' });
        }
    });

    // ─── ENCERRAR SESSÃO (admin) ───────────────────────────────────────────────
    router.delete('/sessions/:id', verificarAdmin, async (req, res) => {
        try {
            await supabase
                .from('active_sessions')
                .update({ is_active: false, logout_at: new Date().toISOString() })
                .eq('id', req.params.id);

            res.status(204).end();
        } catch (error) {
            res.status(500).json({ error: 'Erro ao encerrar sessão' });
        }
    });

    // ─── MIDDLEWARE ADMIN ──────────────────────────────────────────────────────
    async function verificarAdmin(req, res, next) {
        const sessionToken = req.headers['x-session-token'];
        if (!sessionToken) return res.status(401).json({ error: 'Não autenticado' });

        try {
            const { data: session } = await supabase
                .from('active_sessions')
                .select('users(is_admin, is_active)')
                .eq('session_token', sessionToken)
                .eq('is_active', true)
                .gt('expires_at', new Date().toISOString())
                .single();

            if (!session?.users?.is_admin) {
                return res.status(403).json({ error: 'Acesso negado' });
            }
            next();
        } catch {
            res.status(500).json({ error: 'Erro de autenticação' });
        }
    }

    return router;
};

// ─── HELPER: registrar tentativa de login ─────────────────────────────────────
async function registrarTentativa(supabase, username, ip, deviceToken, success, reason) {
    try {
        await supabase.from('login_attempts').insert([{
            username: username || 'desconhecido',
            ip_address: ip,
            device_token: deviceToken,
            success,
            failure_reason: reason
        }]);
    } catch (e) {
        // Silencioso
    }
}
