const express = require('express');

module.exports = function(supabase) {
  const router = express.Router();

  router.get('/contas', async (req, res) => {
    try {
      let query = supabase.from('contas_pagar').select('*');
      const { data, error } = await query.order('data_vencimento', { ascending: true });
      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get('/contas/grupo/:grupoId', async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('contas_pagar')
        .select('*')
        .eq('grupo_id', req.params.grupoId)
        .order('parcela_numero', { ascending: true });
      if (error) throw error;
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/contas', async (req, res) => {
    try {
      const body = { ...req.body };
      delete body.id;
      delete body.created_at;
      delete body.updated_at;
      const { data, error } = await supabase.from('contas_pagar').insert([body]).select().single();
      if (error) throw error;
      res.status(201).json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/contas/:id', async (req, res) => {
    try {
      const body = { ...req.body, updated_at: new Date().toISOString() };
      delete body.id;
      delete body.created_at;
      const { data, error } = await supabase
        .from('contas_pagar')
        .update(body)
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.patch('/contas/:id', async (req, res) => {
    try {
      const updates = { ...req.body, updated_at: new Date().toISOString() };
      delete updates.id;
      delete updates.created_at;
      const { data, error } = await supabase
        .from('contas_pagar')
        .update(updates)
        .eq('id', req.params.id)
        .select()
        .single();
      if (error) throw error;
      if (!data) return res.status(404).json({ error: 'Conta não encontrada' });
      res.json(data);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/contas/:id', async (req, res) => {
    try {
      const { error } = await supabase
        .from('contas_pagar')
        .delete()
        .eq('id', req.params.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
