require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================
// ======== CONFIGURAÇÃO - IPS AUTORIZADOS ==
// ==========================================
const AUTHORIZED_IPS = process.env.AUTHORIZED_IPS 
  ? process.env.AUTHORIZED_IPS.split(',').map(ip => ip.trim())
  : ['187.36.172.217'];

// ==========================================
// ======== CONFIGURAÇÃO DO SUPABASE ========
// ==========================================
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ==========================================
// ======== RATE LIMITING MANUAL ============
// ==========================================
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

// ==========================================
// ======== FUNÇÕES AUXILIARES ==============
// ==========================================
function getClientIP(req) {
  const xForwardedFor = req.headers['x-forwarded-for'];
  const clientIP = xForwardedFor
    ? xForwardedFor.split(',')[0].trim()
    : req.socket.remoteAddress;
  return clientIP.replace('::ffff:', '');
}

function isBusinessHours() {
  const now = new Date();
  const brasiliaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  const dayOfWeek = brasiliaTime.getDay();
  const hour = brasiliaTime.getHours();
  return dayOfWeek >= 1 && dayOfWeek <= 5 && hour >= 8 && hour < 18;
}

function generateSecureToken() {
  return 'sess_' + crypto.randomBytes(32).toString('hex');
}

function sanitizeString(str) {
  if (typeof str !== 'string') return '';
  return str.trim().replace(/[<>]/g, '');
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9._-]{3,50}$/.test(username);
}

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

// ==========================================
// ======== MIDDLEWARES =====================
// ==========================================
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token'],
  credentials: true
}));
app.options('*', cors());
app.use(express.json({ limit: '10mb' }));

// ==========================================
// ======== SERVIÇO DE MÓDULOS ESTÁTICOS ====
// ==========================================
const MODULES = [
  'licitacoes', 'precos', 'compra', 'transportadoras', 'cotacoes',
  'faturamento', 'estoque', 'frete', 'receber', 'vendas', 'pagar', 'lucro', 'dexter'
];

// Portal na raiz
app.use('/', express.static(path.join(__dirname, 'apps', 'portal')));

// Cada módulo na sua rota
MODULES.forEach(module => {
  const modulePath = path.join(__dirname, 'apps', module);
  if (fs.existsSync(modulePath)) {
    app.use(`/${module}`, express.static(modulePath));
    console.log(`✅ Módulo "${module}" disponível em /${module}`);
  } else {
    console.warn(`⚠️ Pasta do módulo "${module}" não encontrada em apps/${module}`);
  }
});

// ==========================================
// ======== ROTAS DA API (PORTAL) ===========
// ==========================================
app.get('/api/ip', (req, res) => {
  res.json({ ip: getClientIP(req) });
});

app.get('/api/check-ip-access', (req, res) => {
  const cleanIP = getClientIP(req);
  const authorized = AUTHORIZED_IPS.includes(cleanIP);
  res.json({ authorized, ip: cleanIP, message: authorized ? 'IP na lista global' : 'IP não está na lista global (pode ser permitido por usuário)' });
});

app.get('/api/business-hours', (req, res) => {
  const now = new Date();
  const brasiliaTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  res.json({
    isBusinessHours: isBusinessHours(),
    currentTime: brasiliaTime.toLocaleString('pt-BR'),
    day: brasiliaTime.getDay(),
    hour: brasiliaTime.getHours()
  });
});

app.post('/api/login', async (req, res) => {
  // ... (mesmo código do portal, inalterado - use o mesmo que já estava funcionando)
  // Para economizar espaço, mantenha o código do login idêntico ao anterior.
  // Como é extenso, você pode copiar do seu server.js anterior.
  // Vou resumir aqui, mas no arquivo final estará completo.
  try {
    const { username, password, deviceToken } = req.body;
    if (!username || !password || !deviceToken) {
      return res.status(400).json({ error: 'Campos obrigatórios ausentes' });
    }

    const cleanIP = getClientIP(req);
    if (!checkRateLimit(cleanIP)) {
      return res.status(429).json({ error: 'Muitas tentativas de login', message: 'Tente novamente em 5 minutos.' });
    }

    const sanitizedUsername = sanitizeString(username);
    const sanitizedDeviceToken = sanitizeString(deviceToken);

    if (!isValidUsername(sanitizedUsername)) {
      return res.status(400).json({ error: 'Formato de usuário inválido' });
    }
    if (password.length < 1 || password.length > 100) {
      return res.status(400).json({ error: 'Senha inválida' });
    }

    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, username, password, name, is_admin, is_active, sector, authorized_ips')
      .ilike('username', sanitizedUsername.toLowerCase())
      .single();

    if (userError || !userData) {
      await logLoginAttempt(sanitizedUsername, false, 'Usuário não encontrado', sanitizedDeviceToken, cleanIP);
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    if (userData.is_active === false) {
      await logLoginAttempt(sanitizedUsername, false, 'Usuário inativo', sanitizedDeviceToken, cleanIP);
      return res.status(401).json({ error: 'Usuário inativo' });
    }

    const unrestrictedUsers = ['roberto', 'rosemeire'];
    const isUnrestricted = unrestrictedUsers.includes(userData.username.toLowerCase());

    if (!isUnrestricted) {
      const userIps = userData.authorized_ips || [];
      const allowedIps = userIps.length > 0 ? userIps : AUTHORIZED_IPS;
      if (!allowedIps.includes(cleanIP)) {
        await logLoginAttempt(sanitizedUsername, false, 'IP não autorizado', sanitizedDeviceToken, cleanIP);
        return res.status(403).json({ error: 'Acesso negado', message: 'Acesso não autorizado! Tentativa de login registrada.' });
      }
    }

    if (!userData.is_admin && !isBusinessHours()) {
      await logLoginAttempt(sanitizedUsername, false, 'Fora do horário comercial', sanitizedDeviceToken, cleanIP);
      return res.status(403).json({ error: 'Fora do horário comercial', message: 'Este acesso é disponibilizado em conformidade com o horário comercial da empresa.' });
    }

    if (password !== userData.password) {
      await logLoginAttempt(sanitizedUsername, false, 'Senha incorreta', sanitizedDeviceToken, cleanIP);
      return res.status(401).json({ error: 'Usuário ou senha incorretos' });
    }

    const deviceFingerprint = crypto.createHash('sha256')
      .update(sanitizedDeviceToken + cleanIP)
      .digest('hex');
    const userAgent = req.headers['user-agent'] || 'Unknown';
    const truncatedUserAgent = sanitizeString(userAgent.substring(0, 95));
    const truncatedDeviceName = sanitizeString(userAgent.substring(0, 95));

    const { error: deviceError } = await supabase
      .from('authorized')
      .upsert({
        user_id: userData.id,
        device_token: sanitizedDeviceToken,
        device_fingerprint: deviceFingerprint,
        device_name: truncatedDeviceName,
        ip_address: cleanIP,
        user_agent: truncatedUserAgent,
        is_active: true,
        last_access: new Date().toISOString()
      }, { onConflict: 'device_token', ignoreDuplicates: false });

    if (deviceError) {
      console.error('❌ Erro ao registrar dispositivo:', deviceError);
      return res.status(500).json({ error: 'Erro ao registrar dispositivo' });
    }

    const sessionToken = generateSecureToken();
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 24);

    const { data: existingSession } = await supabase
      .from('active')
      .select('*')
      .eq('user_id', userData.id)
      .eq('device_token', sanitizedDeviceToken)
      .eq('is_active', true)
      .maybeSingle();

    if (existingSession) {
      await supabase
        .from('active')
        .update({
          ip_address: cleanIP,
          session_token: sessionToken,
          expires_at: expiresAt.toISOString(),
          last_activity: new Date().toISOString()
        })
        .eq('id', existingSession.id);
    } else {
      await supabase
        .from('active')
        .update({ is_active: false })
        .eq('user_id', userData.id)
        .eq('device_token', sanitizedDeviceToken);

      await supabase
        .from('active')
        .insert({
          user_id: userData.id,
          device_token: sanitizedDeviceToken,
          ip_address: cleanIP,
          session_token: sessionToken,
          expires_at: expiresAt.toISOString(),
          is_active: true,
          last_activity: new Date().toISOString()
        });
    }

    await logLoginAttempt(sanitizedUsername, true, null, sanitizedDeviceToken, cleanIP);

    res.json({
      success: true,
      session: {
        userId: userData.id,
        username: userData.username,
        name: userData.name,
        sector: userData.sector,
        isAdmin: userData.is_admin,
        sessionToken: sessionToken,
        deviceToken: sanitizedDeviceToken,
        ip: cleanIP,
        expiresAt: expiresAt.toISOString()
      }
    });
  } catch (error) {
    console.error('❌ Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ error: 'Session token ausente' });
    const sanitizedToken = sanitizeString(sessionToken);
    await supabase
      .from('active')
      .update({ is_active: false, logout_at: new Date().toISOString() })
      .eq('session_token', sanitizedToken);
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro no logout:', error);
    res.status(500).json({ error: 'Erro ao fazer logout' });
  }
});

app.post('/api/verify-session', async (req, res) => {
  try {
    const { sessionToken } = req.body;
    if (!sessionToken) return res.status(400).json({ valid: false, reason: 'token_missing' });
    const sanitizedToken = sanitizeString(sessionToken);

    const { data: session, error } = await supabase
      .from('active')
      .select(`
        *,
        users:user_id (id, username, name, sector, is_admin, is_active)
      `)
      .eq('session_token', sanitizedToken)
      .eq('is_active', true)
      .single();

    if (error || !session) {
      return res.status(401).json({ valid: false, reason: 'session_not_found' });
    }

    const currentIP = getClientIP(req);

    if (!session.users.is_active) {
      await supabase.from('active').update({ is_active: false }).eq('session_token', sanitizedToken);
      return res.status(401).json({ valid: false, reason: 'user_inactive' });
    }

    if (new Date(session.expires_at) < new Date()) {
      await supabase.from('active').update({ is_active: false }).eq('session_token', sanitizedToken);
      return res.status(401).json({ valid: false, reason: 'session_expired' });
    }

    await supabase
      .from('active')
      .update({ last_activity: new Date().toISOString(), ip_address: currentIP })
      .eq('session_token', sanitizedToken);

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
  } catch (error) {
    console.error('❌ Erro ao verificar sessão:', error);
    res.status(500).json({ valid: false, reason: 'server_error', error: 'Erro ao verificar sessão' });
  }
});

// ==========================================
// ======== ROTAS DA API - LICITAÇÕES ========
// ==========================================
// (cópia das rotas de pregoes, adaptadas para as tabelas licitacoes e licitacoes_itens)

// Middleware de autenticação para licitações
app.use('/api/licitacoes', async (req, res, next) => {
  const sessionToken = req.headers['x-session-token'] || req.query.sessionToken;
  if (!sessionToken) {
    return res.status(401).json({ error: 'Não autenticado', redirectToLogin: true });
  }
  try {
    const verifyResponse = await fetch(`${process.env.PORTAL_URL || 'https://ir-comercio-portal-zcan.onrender.com'}/api/verify-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken })
    });
    if (!verifyResponse.ok) return res.status(401).json({ error: 'Sessão inválida', redirectToLogin: true });
    const sessionData = await verifyResponse.json();
    if (!sessionData.valid) return res.status(401).json({ error: 'Sessão inválida', redirectToLogin: true });
    req.user = sessionData.session;
    req.sessionToken = sessionToken;
    next();
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao verificar autenticação' });
  }
});

// HEAD para verificar conectividade
app.head('/api/licitacoes', (req, res) => res.status(200).end());

// Listar licitações
app.get('/api/licitacoes', async (req, res) => {
  try {
    let query = supabase.from('licitacoes').select('*');
    const { mes, ano } = req.query;
    if (mes && ano) {
      const startDate = `${ano}-${mes.toString().padStart(2,'0')}-01`;
      const endDate = new Date(ano, mes, 1);
      endDate.setMonth(endDate.getMonth() + 1);
      const endDateStr = endDate.toISOString().split('T')[0];
      query = query.filter('data', 'gte', startDate).filter('data', 'lt', endDateStr);
    }
    const { data, error } = await query.order('data', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('❌ Erro ao listar licitações:', error.message);
    res.status(500).json({ error: 'Erro ao listar licitações' });
  }
});

// Buscar uma licitação por ID
app.get('/api/licitacoes/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('licitacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Licitação não encontrada' });
      throw error;
    }
    res.json(data);
  } catch (error) {
    console.error('❌ Erro ao buscar licitação:', error.message);
    res.status(500).json({ error: 'Erro ao buscar licitação' });
  }
});

// Criar nova licitação
app.post('/api/licitacoes', async (req, res) => {
  try {
    const { 
      responsavel, data, hora, numero_licitacao, uasg, nome_orgao, municipio, uf,
      telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
      detalhes, banco, status, ganho, disputa_por
    } = req.body;

    const nova = {
      responsavel,
      data,
      hora: hora || null,
      numero_licitacao,
      uasg: uasg || null,
      nome_orgao: nome_orgao || null,
      municipio: municipio || null,
      uf: uf || null,
      telefones: telefones || [],
      emails: emails || [],
      validade_proposta: validade_proposta || null,
      prazo_entrega: prazo_entrega || null,
      prazo_pagamento: prazo_pagamento || null,
      detalhes: detalhes || [],
      banco: banco || null,
      status: status || 'ABERTO',
      ganho: ganho || false,
      disputa_por: disputa_por || 'ITEM'
    };
    const { data: inserted, error } = await supabase
      .from('licitacoes')
      .insert([nova])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(inserted);
  } catch (error) {
    console.error('❌ Erro ao criar licitação:', error.message);
    res.status(500).json({ error: 'Erro ao criar licitação' });
  }
});

// Atualizar licitação
app.put('/api/licitacoes/:id', async (req, res) => {
  try {
    const { 
      responsavel, data, hora, numero_licitacao, uasg, nome_orgao, municipio, uf,
      telefones, emails, validade_proposta, prazo_entrega, prazo_pagamento,
      detalhes, banco, status, ganho, disputa_por
    } = req.body;
    const atualizada = {
      responsavel,
      data,
      hora: hora || null,
      numero_licitacao,
      uasg: uasg || null,
      nome_orgao: nome_orgao || null,
      municipio: municipio || null,
      uf: uf || null,
      telefones: telefones || [],
      emails: emails || [],
      validade_proposta: validade_proposta || null,
      prazo_entrega: prazo_entrega || null,
      prazo_pagamento: prazo_pagamento || null,
      detalhes: detalhes || [],
      banco: banco || null,
      status: status || 'ABERTO',
      ganho: ganho || false,
      disputa_por: disputa_por || 'ITEM',
      updated_at: new Date().toISOString()
    };
    const { data: updated, error } = await supabase
      .from('licitacoes')
      .update(atualizada)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Licitação não encontrada' });
      throw error;
    }
    res.json(updated);
  } catch (error) {
    console.error('❌ Erro ao atualizar licitação:', error.message);
    res.status(500).json({ error: 'Erro ao atualizar licitação' });
  }
});

// Deletar licitação (e seus itens)
app.delete('/api/licitacoes/:id', async (req, res) => {
  try {
    const { error: itensError } = await supabase
      .from('licitacoes_itens')
      .delete()
      .eq('licitacao_id', req.params.id);
    if (itensError) console.warn('Erro ao excluir itens:', itensError.message);
    const { error } = await supabase
      .from('licitacoes')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao deletar licitação:', error.message);
    res.status(500).json({ error: 'Erro ao deletar licitação' });
  }
});

// ========== ITENS DA LICITAÇÃO ==========
// Listar itens
app.get('/api/licitacoes/:licitacao_id/itens', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('licitacoes_itens')
      .select('*')
      .eq('licitacao_id', req.params.licitacao_id)
      .order('numero', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (error) {
    console.error('❌ Erro ao listar itens:', error.message);
    res.status(500).json({ error: 'Erro ao listar itens' });
  }
});

// Criar item
app.post('/api/licitacoes/:licitacao_id/itens', async (req, res) => {
  try {
    const { 
      numero, descricao, qtd, unidade, marca, modelo,
      estimado_unt, estimado_total, custo_unt, custo_total,
      porcentagem, venda_unt, venda_total, ganho,
      grupo_tipo, grupo_numero
    } = req.body;
    const novoItem = {
      licitacao_id: req.params.licitacao_id,
      numero: String(numero || 1),
      descricao: descricao || null,
      qtd: parseInt(qtd) || 1,
      unidade: unidade || 'UN',
      marca: marca || null,
      modelo: modelo || null,
      estimado_unt: parseFloat(estimado_unt) || 0,
      estimado_total: parseFloat(estimado_total) || 0,
      custo_unt: parseFloat(custo_unt) || 0,
      custo_total: parseFloat(custo_total) || 0,
      porcentagem: parseFloat(porcentagem) || 149,
      venda_unt: parseFloat(venda_unt) || 0,
      venda_total: parseFloat(venda_total) || 0,
      ganho: ganho === true || ganho === 'true' || false,
      grupo_tipo: grupo_tipo || null,
      grupo_numero: grupo_numero ? parseInt(grupo_numero) : null
    };
    const { data, error } = await supabase
      .from('licitacoes_itens')
      .insert([novoItem])
      .select()
      .single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('❌ Erro ao criar item:', error.message);
    res.status(500).json({ error: 'Erro ao criar item' });
  }
});

// Atualizar item
app.put('/api/licitacoes/:licitacao_id/itens/:id', async (req, res) => {
  try {
    const { 
      numero, descricao, qtd, unidade, marca, modelo,
      estimado_unt, estimado_total, custo_unt, custo_total,
      porcentagem, venda_unt, venda_total, ganho,
      grupo_tipo, grupo_numero
    } = req.body;
    const itemAtualizado = {
      numero: String(numero || 1),
      descricao: descricao || null,
      qtd: parseInt(qtd) || 1,
      unidade: unidade || 'UN',
      marca: marca || null,
      modelo: modelo || null,
      estimado_unt: parseFloat(estimado_unt) || 0,
      estimado_total: parseFloat(estimado_total) || 0,
      custo_unt: parseFloat(custo_unt) || 0,
      custo_total: parseFloat(custo_total) || 0,
      porcentagem: parseFloat(porcentagem) || 149,
      venda_unt: parseFloat(venda_unt) || 0,
      venda_total: parseFloat(venda_total) || 0,
      ganho: ganho === true || ganho === 'true' || false,
      grupo_tipo: grupo_tipo || null,
      grupo_numero: grupo_numero ? parseInt(grupo_numero) : null,
      updated_at: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('licitacoes_itens')
      .update(itemAtualizado)
      .eq('id', req.params.id)
      .select()
      .single();
    if (error) {
      if (error.code === 'PGRST116') return res.status(404).json({ error: 'Item não encontrado' });
      throw error;
    }
    res.json(data);
  } catch (error) {
    console.error('❌ Erro ao atualizar item:', error.message);
    res.status(500).json({ error: 'Erro ao atualizar item' });
  }
});

// Deletar item
app.delete('/api/licitacoes/:licitacao_id/itens/:id', async (req, res) => {
  try {
    const { error } = await supabase
      .from('licitacoes_itens')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (error) {
    console.error('❌ Erro ao deletar item:', error.message);
    res.status(500).json({ error: 'Erro ao deletar item' });
  }
});

// Deletar múltiplos itens
app.post('/api/licitacoes/:licitacao_id/itens/delete-multiple', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: 'IDs inválidos' });
    }
    const { error } = await supabase
      .from('licitacoes_itens')
      .delete()
      .in('id', ids);
    if (error) throw error;
    res.json({ success: true, message: `${ids.length} itens removidos` });
  } catch (error) {
    console.error('❌ Erro ao deletar itens:', error.message);
    res.status(500).json({ error: 'Erro ao deletar itens' });
  }
});

// ==========================================
// ======== HEALTH CHECK ====================
// ==========================================
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    supabase: supabaseUrl ? 'configured' : 'not configured',
    authorizedIPs: AUTHORIZED_IPS.length > 0 ? 'configured' : 'not configured'
  });
});

// ==========================================
// ======== ROTA 404 ========================
// ==========================================
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// ==========================================
// ======== ERROR HANDLER ===================
// ==========================================
app.use((err, req, res, next) => {
  console.error('❌ Erro não tratado:', err);
  const errorMessage = process.env.NODE_ENV === 'production' ? 'Erro interno do servidor' : err.message;
  res.status(500).json({ error: errorMessage });
});

// ==========================================
// ======== INICIAR SERVIDOR ================
// ==========================================
app.listen(PORT, () => {
  console.log('='.repeat(50));
  console.log(`🚀 Portal Central rodando na porta ${PORT}`);
  console.log(`💾 Supabase (Service Role) configurado: ${supabaseUrl ? 'Sim ✅' : 'Não ❌'}`);
  console.log(`🔒 IPs autorizados (fallback global): ${AUTHORIZED_IPS.join(', ')}`);
  console.log('⏰ Horário comercial: Seg-Sex, 8h-18h (apenas LOGIN)');
  console.log(`🛡️ Rate limiting ativo: 5 tentativas/15min por IP`);
  console.log(`🌍 Ambiente: ${process.env.NODE_ENV || 'development'}`);
  console.log('✅ Tokens seguros, sanitização, validação');
  console.log('🔓 Sessão: 24 horas | Sem verificação de IP/horário após login');
  console.log('👤 Verificação de IP: por usuário (com fallback global)');
  console.log('🌟 Usuários com acesso irrestrito: Roberto, Rosemeire');
  console.log('📦 Módulos estáticos servidos:', MODULES.join(', '));
  console.log('📄 Rotas API de licitações disponíveis em /api/licitacoes');
  console.log('='.repeat(50));
});
