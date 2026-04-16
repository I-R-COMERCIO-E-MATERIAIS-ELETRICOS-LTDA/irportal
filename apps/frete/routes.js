// ============================================
// ROUTES — CONTROLE DE FRETE
// ============================================
const express = require('express');
const router  = express.Router();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── LISTAR FRETES ───────────────────────────────────────────────────────────
router.get('/fretes', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('controle_frete')
            .select('*')
            .order('data_emissao', { ascending: false });
        if (error) throw error;
        res.json(data);
    } catch (err) {
        console.error('[frete] GET /fretes:', err.message);
        res.status(500).json({ error: 'Erro ao listar fretes' });
    }
});

// ─── BUSCAR FRETE POR ID ─────────────────────────────────────────────────────
router.get('/fretes/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('controle_frete')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Frete não encontrado' });
        res.json(data);
    } catch (err) {
        console.error('[frete] GET /fretes/:id:', err.message);
        res.status(500).json({ error: 'Erro ao buscar frete' });
    }
});

// ─── CRIAR FRETE ─────────────────────────────────────────────────────────────
router.post('/fretes', async (req, res) => {
    try {
        const {
            numero_nf, data_emissao, documento, valor_nf, tipo_nf,
            nome_orgao, contato_orgao, vendedor, transportadora,
            valor_frete, data_coleta, cidade_destino, previsao_entrega,
            data_entrega, observacoes
        } = req.body;

        if (!numero_nf || !nome_orgao)
            return res.status(400).json({ error: 'numero_nf e nome_orgao são obrigatórios' });

        const tiposSemStatus = ['CANCELADA', 'DEVOLUCAO'];
        let status;
        if (tiposSemStatus.includes(tipo_nf)) {
            status = null;
        } else if (data_entrega) {
            status = 'ENTREGUE';
        } else {
            status = 'EM_TRANSITO';
        }

        let obsJson = '[]';
        if (observacoes) {
            try {
                obsJson = typeof observacoes === 'string' ? observacoes : JSON.stringify(observacoes);
                JSON.parse(obsJson);
            } catch { obsJson = '[]'; }
        }

        const payload = {
            numero_nf:        (numero_nf || '').toUpperCase().trim(),
            data_emissao:     data_emissao || new Date().toISOString().split('T')[0],
            documento:        (documento || 'NÃO INFORMADO').toUpperCase().trim(),
            valor_nf:         parseFloat(valor_nf) || 0,
            tipo_nf:          tipo_nf || 'ENVIO',
            nome_orgao:       (nome_orgao || '').toUpperCase().trim(),
            contato_orgao:    (contato_orgao || 'NÃO INFORMADO').toUpperCase().trim(),
            vendedor:         (vendedor || 'NÃO INFORMADO').toUpperCase().trim(),
            transportadora:   (transportadora || 'NÃO INFORMADO').toUpperCase().trim(),
            valor_frete:      parseFloat(valor_frete) || 0,
            data_coleta:      data_coleta || null,
            cidade_destino:   (cidade_destino || 'NÃO INFORMADO').toUpperCase().trim(),
            previsao_entrega: previsao_entrega || null,
            data_entrega:     data_entrega || null,
            status,
            observacoes:      JSON.parse(obsJson)
        };

        const { data, error } = await supabase
            .from('controle_frete')
            .insert([payload])
            .select()
            .single();
        if (error) throw error;

        sincronizarVendas(supabase, data).catch(console.error);
        res.status(201).json(data);
    } catch (err) {
        console.error('[frete] POST /fretes:', err.message);
        res.status(500).json({ error: 'Erro ao criar frete', details: err.message });
    }
});

// ─── ATUALIZAR FRETE (PUT) ───────────────────────────────────────────────────
router.put('/fretes/:id', async (req, res) => {
    try {
        const {
            numero_nf, data_emissao, documento, valor_nf, tipo_nf,
            nome_orgao, contato_orgao, vendedor, transportadora,
            valor_frete, data_coleta, cidade_destino, previsao_entrega,
            data_entrega, observacoes
        } = req.body;

        const tiposSemStatus = ['CANCELADA', 'DEVOLUCAO'];
        let status;
        if (tiposSemStatus.includes(tipo_nf)) {
            status = null;
        } else if (data_entrega) {
            status = 'ENTREGUE';
        } else {
            status = 'EM_TRANSITO';
        }

        let obsJson = '[]';
        if (observacoes) {
            try {
                obsJson = typeof observacoes === 'string' ? observacoes : JSON.stringify(observacoes);
                JSON.parse(obsJson);
            } catch { obsJson = '[]'; }
        }

        const payload = {
            numero_nf:        (numero_nf || '').toUpperCase().trim(),
            data_emissao:     data_emissao || new Date().toISOString().split('T')[0],
            documento:        (documento || 'NÃO INFORMADO').toUpperCase().trim(),
            valor_nf:         parseFloat(valor_nf) || 0,
            tipo_nf:          tipo_nf || 'ENVIO',
            nome_orgao:       (nome_orgao || '').toUpperCase().trim(),
            contato_orgao:    (contato_orgao || 'NÃO INFORMADO').toUpperCase().trim(),
            vendedor:         (vendedor || 'NÃO INFORMADO').toUpperCase().trim(),
            transportadora:   (transportadora || 'NÃO INFORMADO').toUpperCase().trim(),
            valor_frete:      parseFloat(valor_frete) || 0,
            data_coleta:      data_coleta || null,
            cidade_destino:   (cidade_destino || 'NÃO INFORMADO').toUpperCase().trim(),
            previsao_entrega: previsao_entrega || null,
            data_entrega:     data_entrega || null,
            status,
            observacoes:      JSON.parse(obsJson),
            updated_at:       new Date().toISOString()
        };

        const { data, error } = await supabase
            .from('controle_frete')
            .update(payload)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Frete não encontrado' });

        sincronizarVendas(supabase, data).catch(console.error);
        res.json(data);
    } catch (err) {
        console.error('[frete] PUT /fretes/:id:', err.message);
        res.status(500).json({ error: 'Erro ao atualizar frete', details: err.message });
    }
});

// ─── PATCH — atualização parcial ────────────────────────────────────────────
router.patch('/fretes/:id', async (req, res) => {
    try {
        const updates = { ...req.body, updated_at: new Date().toISOString() };
        const { data, error } = await supabase
            .from('controle_frete')
            .update(updates)
            .eq('id', req.params.id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Frete não encontrado' });

        sincronizarVendas(supabase, data).catch(console.error);
        res.json(data);
    } catch (err) {
        console.error('[frete] PATCH /fretes/:id:', err.message);
        res.status(500).json({ error: 'Erro ao atualizar frete', details: err.message });
    }
});

// ─── DELETAR FRETE ───────────────────────────────────────────────────────────
router.delete('/fretes/:id', async (req, res) => {
    try {
        const { error } = await supabase
            .from('controle_frete')
            .delete()
            .eq('id', req.params.id);
        if (error) throw error;

        supabase
            .from('vendas')
            .delete()
            .eq('id_controle_frete', req.params.id)
            .then(() => {}).catch(console.error);

        res.json({ success: true, message: 'Frete excluído com sucesso' });
    } catch (err) {
        console.error('[frete] DELETE /fretes/:id:', err.message);
        res.status(500).json({ error: 'Erro ao deletar frete' });
    }
});

// ─── SINCRONIZAÇÃO COM TABELA VENDAS ─────────────────────────────────────────
async function sincronizarVendas(supabase, frete) {
    if (!frete || !frete.numero_nf || !frete.vendedor) return;

    const statusFreteMap = {
        'EM_TRANSITO': 'EM TRÂNSITO', 'ENTREGUE': 'ENTREGUE',
        'AGUARDANDO_COLETA': 'AGUARDANDO COLETA',
        'EXTRAVIADO': 'EXTRAVIADO', 'DEVOLVIDO': 'DEVOLVIDO'
    };
    const tipoNfMap = {
        'ENVIO': 'ENVIO', 'CANCELADA': 'CANCELADA',
        'REMESSA_AMOSTRA': 'REMESSA DE AMOSTRA',
        'SIMPLES_REMESSA': 'SIMPLES REMESSA', 'DEVOLUCAO': 'DEVOLUÇÃO'
    };

    const payload = {
        numero_nf:        frete.numero_nf,
        origem:           'CONTROLE_FRETE',
        data_emissao:     frete.data_emissao,
        valor_nf:         parseFloat(frete.valor_nf) || 0,
        tipo_nf:          tipoNfMap[frete.tipo_nf] || frete.tipo_nf,
        nome_orgao:       frete.nome_orgao,
        vendedor:         frete.vendedor,
        documento:        frete.documento || null,
        contato_orgao:    frete.contato_orgao || null,
        transportadora:   frete.transportadora || null,
        valor_frete:      parseFloat(frete.valor_frete) || 0,
        data_coleta:      frete.data_coleta || null,
        cidade_destino:   frete.cidade_destino || null,
        previsao_entrega: frete.previsao_entrega || null,
        status_frete:     statusFreteMap[frete.status] || frete.status || null,
        id_controle_frete: frete.id,
        updated_at:       new Date().toISOString()
    };

    const { data: existente } = await supabase
        .from('vendas').select('id')
        .eq('id_controle_frete', frete.id).single();

    if (existente) {
        await supabase.from('vendas').update(payload).eq('id_controle_frete', frete.id);
    } else {
        await supabase.from('vendas').insert([{ ...payload, prioridade: 1 }]);
    }
}

module.exports = router;
