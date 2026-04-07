// ============================================================
// IR COMÉRCIO E MATERIAIS ELÉTRICOS — SERVIDOR CENTRAL
// ============================================================
require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 }   = require('uuid');

const app  = express();
const PORT = process.env.PORT || 10000;

// ── SUPABASE ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── MIDDLEWARES ───────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── AUTENTICAÇÃO MIDDLEWARE ───────────────────────────────
async function requireAuth(req, res, next) {
  const token = req.headers['x-session-token'];
  if (!token) return res.status(401).json({ error: 'Token não fornecido' });

  const { data, error } = await supabase
    .from('active')
    .select('*')
    .eq('session_token', token)
    .eq('is_active', true)
    .single();

  if (error || !data) return res.status(401).json({ error: 'Sessão inválida ou expirada' });

  const expiresAt = new Date(data.expires_at);
  if (expiresAt < new Date()) {
    await supabase.from('active').update({ is_active: false }).eq('session_token', token);
    return res.status(401).json({ error: 'Sessão expirada' });
  }

  req.sessionData = data;
  next();
}

// ── STATIC: SERVIR CADA MÓDULO ────────────────────────────
app.use('/',               express.static(path.join(__dirname, 'apps/portal')));
app.use('/licitacoes',     express.static(path.join(__dirname, 'apps/licitacoes')));
app.use('/precos',         express.static(path.join(__dirname, 'apps/precos')));
app.use('/compra',         express.static(path.join(__dirname, 'apps/compra')));
app.use('/transportadoras',express.static(path.join(__dirname, 'apps/transportadoras')));
app.use('/cotacoes',       express.static(path.join(__dirname, 'apps/cotacoes')));
app.use('/faturamento',    express.static(path.join(__dirname, 'apps/faturamento')));
app.use('/estoque',        express.static(path.join(__dirname, 'apps/estoque')));
app.use('/frete',          express.static(path.join(__dirname, 'apps/frete')));
app.use('/receber',        express.static(path.join(__dirname, 'apps/receber')));
app.use('/vendas',         express.static(path.join(__dirname, 'apps/vendas')));
app.use('/pagar',          express.static(path.join(__dirname, 'apps/pagar')));
app.use('/lucro',          express.static(path.join(__dirname, 'apps/lucro')));

// ============================================================
// ROTAS DO PORTAL — LOGIN / SESSÃO
// ============================================================

// GET IP do cliente
app.get('/api/ip', (req, res) => {
  const ip =
    req.headers['x-forwarded-for']?.split(',')[0].trim() ||
    req.socket.remoteAddress ||
    'unknown';
  res.json({ ip });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { username, password, deviceToken } = req.body;
  if (!username || !password)
    return res.status(400).json({ success: false, message: 'Usuário e senha obrigatórios' });

  const usernameLower = username.toLowerCase().trim();

  try {
    // Buscar usuário na tabela users (ilike = case-insensitive)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('*')
      .ilike('username', usernameLower)
      .eq('is_active', true)
      .single();

    if (userError || !userData)
      return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos' });

    if (userData.password !== password)
      return res.status(401).json({ success: false, message: 'Usuário ou senha inválidos' });

    // Criar sessão
    const sessionToken = uuidv4();
    const expiresAt    = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 horas

    const sessionPayload = {
      user_id:       userData.id,
      session_token: sessionToken,
      device_token:  deviceToken || null,
      expires_at:    expiresAt.toISOString(),
      is_active:     true,
      created_at:    new Date().toISOString()
    };

    const { error: insertError } = await supabase
      .from('active')
      .insert([sessionPayload]);

    if (insertError) {
      console.error('Erro ao criar sessão:', insertError);
      return res.status(500).json({ success: false, message: 'Erro ao criar sessão' });
    }

    return res.json({
      success: true,
      session: {
        sessionToken,
        username:    usernameLower,
        name:        userData.name || username,
        sector:      userData.sector || 'Usuário',
        deviceToken: deviceToken || null,
        expiresAt:   expiresAt.toISOString()
      }
    });
  } catch (e) {
    console.error('Erro no login:', e);
    return res.status(500).json({ success: false, message: 'Erro interno do servidor' });
  }
});

// POST /api/logout
app.post('/api/logout', async (req, res) => {
  const { sessionToken } = req.body;
  if (sessionToken) {
    await supabase.from('active').update({ is_active: false, logout_at: new Date().toISOString() }).eq('session_token', sessionToken);
  }
  res.json({ success: true });
});

// POST /api/verify-session
app.post('/api/verify-session', async (req, res) => {
  const { sessionToken } = req.body;
  if (!sessionToken) return res.json({ valid: false });

  const { data, error } = await supabase
    .from('active')
    .select('*')
    .eq('session_token', sessionToken)
    .eq('is_active', true)
    .single();

  if (error || !data) return res.json({ valid: false });

  const expiresAt = new Date(data.expires_at);
  if (expiresAt < new Date()) {
    await supabase.from('active').update({ is_active: false }).eq('session_token', sessionToken);
    return res.json({ valid: false });
  }

  // Buscar dados do usuário
  const { data: userData } = await supabase
    .from('users')
    .select('username, name, sector')
    .eq('id', data.user_id)
    .single();

  return res.json({
    valid: true,
    session: {
      sessionToken,
      username:  userData?.username || '',
      name:      userData?.name || '',
      sector:    userData?.sector || 'Usuário',
      expiresAt: data.expires_at
    }
  });
});

// ============================================================
// ROTAS — COMPRA (tabela: compra, itens, fornecedores)
// ============================================================

// GET /api/fornecedores
app.get('/api/fornecedores', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compra')
      .select('fornecedor')
      .not('fornecedor', 'is', null);

    if (error) throw error;

    const unique = [...new Set(data.map(d => d.fornecedor).filter(Boolean))].sort();
    res.json(unique.map(nome => ({ nome })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ordens/ultimo-numero
app.get('/api/ordens/ultimo-numero', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compra')
      .select('numero')
      .order('numero', { ascending: false })
      .limit(1);

    if (error) throw error;
    const ultimo = data && data.length > 0 ? (data[0].numero || 0) : 0;
    res.json({ ultimo });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ordens?mes=&ano=
app.get('/api/ordens', requireAuth, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    let query = supabase.from('compra').select('*').order('numero', { ascending: false });

    if (mes !== undefined && ano !== undefined) {
      const mesNum = parseInt(mes);
      const anoNum = parseInt(ano);
      const inicio = new Date(anoNum, mesNum, 1).toISOString().split('T')[0];
      const fim    = new Date(anoNum, mesNum + 1, 0).toISOString().split('T')[0];
      query = query.gte('data', inicio).lte('data', fim);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ordens
app.post('/api/ordens', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compra')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/ordens/:id
app.get('/api/ordens/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compra')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Ordem não encontrada' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/ordens/:id
app.put('/api/ordens/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compra')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/ordens/:id/status
app.patch('/api/ordens/:id/status', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compra')
      .update({ status: req.body.status })
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/ordens/:id  (atualização parcial genérica)
app.patch('/api/ordens/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('compra')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/ordens/:id
app.delete('/api/ordens/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('compra')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — TRANSPORTADORAS (tabela: transportadoras)
// ============================================================

// GET /api/transportadoras
app.get('/api/transportadoras', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 200, search } = req.query;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to   = from + parseInt(limit) - 1;

    let query = supabase.from('transportadoras').select('*', { count: 'exact' }).range(from, to);

    if (search) {
      query = query.or(
        `nome.ilike.%${search}%,representante.ilike.%${search}%,email.ilike.%${search}%,regiao.ilike.%${search}%,estado.ilike.%${search}%`
      );
    }

    const { data, error, count } = await query.order('nome', { ascending: true });
    if (error) throw error;
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/transportadoras
app.post('/api/transportadoras', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transportadoras')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/transportadoras/:id
app.put('/api/transportadoras/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('transportadoras')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/transportadoras/:id
app.delete('/api/transportadoras/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('transportadoras')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — COTAÇÕES DE FRETE (tabela: cotacoes)
// ============================================================

// GET /api/cotacoes?mes=&ano=
app.get('/api/cotacoes', requireAuth, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    let query = supabase.from('cotacoes').select('*').order('created_at', { ascending: false });

    if (mes !== undefined && ano !== undefined) {
      const mesNum = parseInt(mes);
      const anoNum = parseInt(ano);
      const inicio = new Date(anoNum, mesNum, 1).toISOString().split('T')[0];
      const fim    = new Date(anoNum, mesNum + 1, 0).toISOString().split('T')[0];
      query = query.gte('data', inicio).lte('data', fim);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/cotacoes
app.post('/api/cotacoes', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cotacoes')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/cotacoes/:id
app.get('/api/cotacoes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cotacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Cotação não encontrada' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/cotacoes/:id
app.patch('/api/cotacoes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('cotacoes')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/cotacoes/:id
app.delete('/api/cotacoes/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('cotacoes')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — ESTOQUE (tabela: estoque, grupos)
// ============================================================

// GET /api/grupos
app.get('/api/grupos', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('grupos')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/grupos
app.post('/api/grupos', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('grupos')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/grupos/:codigo
app.get('/api/grupos/:codigo', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('grupos')
      .select('*')
      .eq('codigo', req.params.codigo)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Grupo não encontrado' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/grupos/:codigo
app.put('/api/grupos/:codigo', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('grupos')
      .update(req.body)
      .eq('codigo', req.params.codigo)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/grupos/:codigo
app.delete('/api/grupos/:codigo', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('grupos')
      .delete()
      .eq('codigo', req.params.codigo);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/estoque?page=&limit=&search=&grupo=
app.get('/api/estoque', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, grupo } = req.query;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to   = from + parseInt(limit) - 1;

    let query = supabase.from('estoque').select('*', { count: 'exact' }).range(from, to);

    if (search) {
      query = query.or(`nome.ilike.%${search}%,codigo.ilike.%${search}%`);
    }
    if (grupo) {
      query = query.eq('grupo', grupo);
    }

    const { data, error, count } = await query.order('nome', { ascending: true });
    if (error) throw error;
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/estoque
app.post('/api/estoque', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('estoque')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/estoque/:codigo
app.get('/api/estoque/:codigo', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('estoque')
      .select('*')
      .eq('codigo', req.params.codigo)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Item não encontrado' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/estoque/:codigo
app.put('/api/estoque/:codigo', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('estoque')
      .update(req.body)
      .eq('codigo', req.params.codigo)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/estoque/:codigo
app.delete('/api/estoque/:codigo', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('estoque')
      .delete()
      .eq('codigo', req.params.codigo);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/estoque/:codigo/entrada
app.post('/api/estoque/:codigo/entrada', requireAuth, async (req, res) => {
  try {
    const { quantidade, observacao } = req.body;

    const { data: item, error: fetchError } = await supabase
      .from('estoque')
      .select('quantidade')
      .eq('codigo', req.params.codigo)
      .single();

    if (fetchError || !item) return res.status(404).json({ error: 'Item não encontrado' });

    const novaQtd = (item.quantidade || 0) + parseInt(quantidade);

    const { data, error } = await supabase
      .from('estoque')
      .update({ quantidade: novaQtd, ultima_entrada: new Date().toISOString(), observacao_entrada: observacao || null })
      .eq('codigo', req.params.codigo)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/estoque/:codigo/saida
app.post('/api/estoque/:codigo/saida', requireAuth, async (req, res) => {
  try {
    const { quantidade, observacao } = req.body;

    const { data: item, error: fetchError } = await supabase
      .from('estoque')
      .select('quantidade')
      .eq('codigo', req.params.codigo)
      .single();

    if (fetchError || !item) return res.status(404).json({ error: 'Item não encontrado' });

    const novaQtd = (item.quantidade || 0) - parseInt(quantidade);
    if (novaQtd < 0) return res.status(400).json({ error: 'Quantidade insuficiente em estoque' });

    const { data, error } = await supabase
      .from('estoque')
      .update({ quantidade: novaQtd, ultima_saida: new Date().toISOString(), observacao_saida: observacao || null })
      .eq('codigo', req.params.codigo)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — FATURAMENTO (tabela: faturamento)
// ============================================================

// GET /api/pedidos?mes=&ano=
app.get('/api/pedidos', requireAuth, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    let query = supabase.from('faturamento').select('*').order('created_at', { ascending: false });

    if (mes !== undefined && ano !== undefined) {
      const mesNum = parseInt(mes);
      const anoNum = parseInt(ano);
      const inicio = new Date(anoNum, mesNum, 1).toISOString().split('T')[0];
      const fim    = new Date(anoNum, mesNum + 1, 0).toISOString().split('T')[0];
      query = query.gte('data', inicio).lte('data', fim);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/pedidos
app.post('/api/pedidos', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('faturamento')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pedidos/:id
app.get('/api/pedidos/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('faturamento')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Pedido não encontrado' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/pedidos/:id
app.put('/api/pedidos/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('faturamento')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/pedidos/:id
app.delete('/api/pedidos/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('faturamento')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — CONTROLE DE FRETE (tabela: frete)
// ============================================================

// GET /api/fretes
app.get('/api/fretes', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('frete')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/fretes
app.post('/api/fretes', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('frete')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/fretes/:id
app.get('/api/fretes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('frete')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Frete não encontrado' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/fretes/:id
app.put('/api/fretes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('frete')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/fretes/:id
app.patch('/api/fretes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('frete')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/fretes/:id
app.delete('/api/fretes/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('frete')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — CONTAS A RECEBER (tabela: receber)
// ============================================================

// GET /api/receber/contas
app.get('/api/receber/contas', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('receber')
      .select('*')
      .order('data_vencimento', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/receber/contas
app.post('/api/receber/contas', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('receber')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/receber/contas/:id
app.get('/api/receber/contas/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('receber')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/receber/contas/:id
app.put('/api/receber/contas/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('receber')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/receber/contas/:id
app.delete('/api/receber/contas/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('receber')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — CONTAS A PAGAR (tabela: pagar)
// ============================================================

// GET /api/pagar/contas
app.get('/api/pagar/contas', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pagar')
      .select('*')
      .order('data_vencimento', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/pagar/contas
app.post('/api/pagar/contas', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pagar')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pagar/contas/grupo/:grupoId
app.get('/api/pagar/contas/grupo/:grupoId', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pagar')
      .select('*')
      .eq('grupo_id', req.params.grupoId)
      .order('data_vencimento', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/pagar/contas/:id
app.get('/api/pagar/contas/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pagar')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/pagar/contas/:id
app.put('/api/pagar/contas/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pagar')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/pagar/contas/:id
app.patch('/api/pagar/contas/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('pagar')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/pagar/contas/:id
app.delete('/api/pagar/contas/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('pagar')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — VENDAS (tabela: vendas)
// ============================================================

// GET /api/vendas?mes=&ano=&vendedor=
app.get('/api/vendas', requireAuth, async (req, res) => {
  try {
    const { mes, ano, vendedor } = req.query;
    let query = supabase.from('vendas').select('*').order('data_emissao', { ascending: false });

    if (mes !== undefined && ano !== undefined) {
      const mesNum = parseInt(mes);
      const anoNum = parseInt(ano);
      const inicio = new Date(anoNum, mesNum, 1).toISOString().split('T')[0];
      const fim    = new Date(anoNum, mesNum + 1, 0).toISOString().split('T')[0];
      query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
    }
    if (vendedor) {
      query = query.eq('vendedor', vendedor);
    }

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/vendas
app.post('/api/vendas', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendas')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/vendas/:id
app.get('/api/vendas/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendas')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Venda não encontrada' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/vendas/:id
app.put('/api/vendas/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('vendas')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/vendas/:id
app.delete('/api/vendas/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('vendas')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — LUCRO REAL (tabela: lucro)
// ============================================================

// GET /api/lucro-real?mes=&ano=
app.get('/api/lucro-real', requireAuth, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    let query = supabase.from('lucro').select('*');

    if (mes !== undefined && ano !== undefined) {
      const mesNum = parseInt(mes);
      const anoNum = parseInt(ano);
      const inicio = new Date(anoNum, mesNum, 1).toISOString().split('T')[0];
      const fim    = new Date(anoNum, mesNum + 1, 0).toISOString().split('T')[0];
      query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
    } else if (ano !== undefined) {
      const anoNum = parseInt(ano);
      const inicio = new Date(anoNum, 0, 1).toISOString().split('T')[0];
      const fim    = new Date(anoNum, 11, 31).toISOString().split('T')[0];
      query = query.gte('data_emissao', inicio).lte('data_emissao', fim);
    }

    const { data, error } = await query.order('data_emissao', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/lucro-real/:codigo
app.patch('/api/lucro-real/:codigo', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('lucro')
      .update(req.body)
      .eq('codigo', req.params.codigo)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/custo-fixo?mes=&ano=
app.get('/api/custo-fixo', requireAuth, async (req, res) => {
  try {
    const { mes, ano } = req.query;
    const { data, error } = await supabase
      .from('custo_fixo')
      .select('*')
      .eq('mes', parseInt(mes))
      .eq('ano', parseInt(ano))
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    res.json(data || { valor: 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/custo-fixo
app.post('/api/custo-fixo', requireAuth, async (req, res) => {
  try {
    const { mes, ano, valor } = req.body;

    const { data: existing } = await supabase
      .from('custo_fixo')
      .select('id')
      .eq('mes', mes)
      .eq('ano', ano)
      .single();

    let result;
    if (existing) {
      const { data, error } = await supabase
        .from('custo_fixo')
        .update({ valor })
        .eq('id', existing.id)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      const { data, error } = await supabase
        .from('custo_fixo')
        .insert([{ mes, ano, valor }])
        .select()
        .single();
      if (error) throw error;
      result = data;
    }

    res.json(result);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/monitorar-pedidos (sincroniza vendas → lucro)
app.post('/api/monitorar-pedidos', requireAuth, async (req, res) => {
  try {
    const { data: vendas, error: vendaError } = await supabase
      .from('vendas')
      .select('*');

    if (vendaError) throw vendaError;

    const { data: lucroExistente } = await supabase
      .from('lucro')
      .select('codigo');

    const codigosExistentes = new Set((lucroExistente || []).map(l => l.codigo));

    const novas = (vendas || []).filter(v => v.codigo && !codigosExistentes.has(v.codigo));

    if (novas.length > 0) {
      const inserir = novas.map(v => ({
        codigo:          v.codigo,
        nf:              v.nf || null,
        vendedor:        v.vendedor || null,
        data_emissao:    v.data_emissao || null,
        venda:           v.valor_total || v.venda || 0,
        custo:           0,
        frete:           v.frete || 0,
        comissao:        0,
        imposto_federal: 0
      }));

      const { error: insertError } = await supabase.from('lucro').insert(inserir);
      if (insertError) throw insertError;
    }

    res.json({ success: true, sincronizados: novas.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — TABELA DE PREÇOS (tabela: itens, marcas)
// ============================================================

// GET /api/marcas
app.get('/api/marcas', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('marcas')
      .select('*')
      .order('nome', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/marcas
app.post('/api/marcas', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('marcas')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/precos?page=&limit=&search=&marca=
app.get('/api/precos', requireAuth, async (req, res) => {
  try {
    const { page = 1, limit = 50, search, marca } = req.query;
    const from = (parseInt(page) - 1) * parseInt(limit);
    const to   = from + parseInt(limit) - 1;

    let query = supabase.from('itens').select('*', { count: 'exact' }).range(from, to);

    if (search) {
      query = query.or(`nome.ilike.%${search}%,codigo.ilike.%${search}%,descricao.ilike.%${search}%`);
    }
    if (marca && marca !== 'TODAS') {
      query = query.eq('marca', marca);
    }

    const { data, error, count } = await query.order('nome', { ascending: true });
    if (error) throw error;
    res.json({ data: data || [], total: count || 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/precos
app.post('/api/precos', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('itens')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/precos/:id
app.get('/api/precos/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('itens')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Item não encontrado' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/precos/:id
app.put('/api/precos/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('itens')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/precos/:id
app.delete('/api/precos/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('itens')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// ROTAS — LICITAÇÕES (tabela: licitacoes)
// ============================================================

// GET /api/licitacoes?mes=&ano=&status=
app.get('/api/licitacoes', requireAuth, async (req, res) => {
  try {
    const { mes, ano, status, search } = req.query;
    let query = supabase.from('licitacoes').select('*').order('data', { ascending: false });

    if (mes !== undefined && ano !== undefined) {
      const mesNum = parseInt(mes);
      const anoNum = parseInt(ano);
      const inicio = new Date(anoNum, mesNum, 1).toISOString().split('T')[0];
      const fim    = new Date(anoNum, mesNum + 1, 0).toISOString().split('T')[0];
      query = query.gte('data', inicio).lte('data', fim);
    }
    if (status) query = query.eq('status', status);
    if (search)  query = query.or(`numero.ilike.%${search}%,orgao.ilike.%${search}%,objeto.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/licitacoes
app.post('/api/licitacoes', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('licitacoes')
      .insert([req.body])
      .select()
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/licitacoes/:id
app.get('/api/licitacoes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('licitacoes')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Licitação não encontrada' });
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/licitacoes/:id
app.put('/api/licitacoes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('licitacoes')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// PATCH /api/licitacoes/:id
app.patch('/api/licitacoes/:id', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('licitacoes')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/licitacoes/:id
app.delete('/api/licitacoes/:id', requireAuth, async (req, res) => {
  try {
    const { error } = await supabase
      .from('licitacoes')
      .delete()
      .eq('id', req.params.id);

    if (error) throw error;
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── SPA FALLBACK — serve portal para rotas desconhecidas ──
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'apps/portal/index.html'));
});

// ── START ─────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Servidor IR Comércio rodando na porta ${PORT}`);
  console.log(`📦 Supabase: ${process.env.SUPABASE_URL ? 'configurado' : '⚠️  NÃO CONFIGURADO'}`);
});
