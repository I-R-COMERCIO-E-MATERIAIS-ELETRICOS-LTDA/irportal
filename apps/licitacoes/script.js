// ============================================================
// LICITAÇÕES — script.js
// ============================================================
const API_URL = window.location.origin + '/api';

let licitacoes     = [];
let allLicitacoes  = [];
let isOnline       = false;
let sessionToken   = null;
let editingId      = null;

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

async function verificarAutenticacao() {
    const urlParams    = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('irModuleSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('irModuleSession');
    }

    if (!sessionToken) return;
    inicializarApp();
}

function inicializarApp() {
    loadLicitacoes();
    setInterval(() => { if (isOnline) loadLicitacoes(); }, 30000);
}

// ── CONEXÃO ───────────────────────────────────────────────────
function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    el.className = isOnline ? 'connection-status online' : 'connection-status offline';
}

function getHeaders() {
    const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) h['X-Session-Token'] = sessionToken;
    return h;
}

// ── CARREGAR DADOS ─────────────────────────────────────────────
async function loadLicitacoes() {
    try {
        const res = await fetch(`${API_URL}/licitacoes`, { headers: getHeaders() });
        if (res.status === 401) { sessionToken = null; sessionStorage.removeItem('irModuleSession'); return; }
        if (!res.ok) { isOnline = false; updateConnectionStatus(); return; }

        allLicitacoes = await res.json();
        isOnline = true;
        updateConnectionStatus();
        populateAnoFilter();
        filterLicitacoes();
    } catch {
        isOnline = false;
        updateConnectionStatus();
    }
}

function populateAnoFilter() {
    const select = document.getElementById('filterAno');
    const current = select.value;
    const anos = [...new Set(allLicitacoes
        .map(l => l.data ? new Date(l.data + 'T00:00:00').getFullYear() : null)
        .filter(Boolean)
    )].sort((a, b) => b - a);

    select.innerHTML = '<option value="">Todos os anos</option>';
    anos.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a; opt.textContent = a;
        select.appendChild(opt);
    });
    select.value = current;
}

// ── FILTRAR ────────────────────────────────────────────────────
function filterLicitacoes() {
    const term   = (document.getElementById('search')?.value || '').toLowerCase();
    const status = document.getElementById('filterStatus')?.value || '';
    const ano    = document.getElementById('filterAno')?.value || '';

    licitacoes = allLicitacoes.filter(l => {
        const matchTerm   = !term || (l.numero||'').toLowerCase().includes(term) ||
                            (l.orgao||'').toLowerCase().includes(term) ||
                            (l.objeto||'').toLowerCase().includes(term);
        const matchStatus = !status || (l.status||'') === status;
        const matchAno    = !ano || (l.data && new Date(l.data + 'T00:00:00').getFullYear() == ano);
        return matchTerm && matchStatus && matchAno;
    });

    updateStats();
    renderTable();
}

// ── STATS ──────────────────────────────────────────────────────
function updateStats() {
    const base = allLicitacoes;
    document.getElementById('statTotal').textContent     = base.length;
    document.getElementById('statAbertas').textContent   = base.filter(l => l.status === 'ABERTA').length;
    document.getElementById('statGanhas').textContent    = base.filter(l => l.status === 'GANHA').length;
    document.getElementById('statSuspensas').textContent = base.filter(l => l.status === 'SUSPENSA').length;
    document.getElementById('statEncerradas').textContent = base.filter(l => ['ENCERRADA','CANCELADA','PERDIDA'].includes(l.status)).length;
}

// ── RENDERIZAR TABELA ──────────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('licitacoesContainer');
    if (!tbody) return;

    if (licitacoes.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8">
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <path d="m14 13-8.381 8.38a1 1 0 0 1-3.001-3l8.384-8.381"/><path d="m16 16 6-6"/>
                    <path d="m21.5 10.5-8-8"/><path d="m8 8 6-6"/><path d="m8.5 7.5 8 8"/>
                </svg>
                <p>${isOnline ? 'Nenhuma licitação encontrada.' : 'Sem conexão com o servidor.'}</p>
            </div>
        </td></tr>`;
        return;
    }

    tbody.innerHTML = licitacoes.map(l => `
        <tr onclick="openFormModal('${l.id}')">
            <td><strong>${escHtml(l.numero || '-')}</strong></td>
            <td>${escHtml(l.orgao || '-')}</td>
            <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(l.objeto || '-')}</td>
            <td>${l.data ? formatDate(l.data) : '-'}</td>
            <td>${escHtml(l.modalidade || '-')}</td>
            <td>${l.valor ? formatMoeda(l.valor) : '-'}</td>
            <td>${badgeStatus(l.status)}</td>
            <td style="text-align:center;">
                <button class="btn-cancel" style="font-size:0.75rem;padding:0.35rem 0.7rem;" onclick="event.stopPropagation();openFormModal('${l.id}')">Editar</button>
            </td>
        </tr>
    `).join('');
}

function badgeStatus(status) {
    const map = {
        'ABERTA':    'badge-aberta',
        'SUSPENSA':  'badge-suspensa',
        'CANCELADA': 'badge-cancelada',
        'ENCERRADA': 'badge-encerrada',
        'GANHA':     'badge-ganha',
        'PERDIDA':   'badge-perdida'
    };
    const cls = map[status] || 'badge-encerrada';
    return `<span class="badge ${cls}">${status || '-'}</span>`;
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
}

function formatMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── MODAL FORM ─────────────────────────────────────────────────
function openFormModal(id = null) {
    editingId = id || null;
    document.getElementById('modalTitle').textContent = id ? 'Editar Licitação' : 'Nova Licitação';
    document.getElementById('btnDelete').style.display = id ? 'block' : 'none';

    if (id) {
        const l = allLicitacoes.find(x => String(x.id) === String(id));
        if (l) {
            document.getElementById('editId').value             = l.id;
            document.getElementById('inputNumero').value        = l.numero || '';
            document.getElementById('inputModalidade').value    = l.modalidade || '';
            document.getElementById('inputOrgao').value         = l.orgao || '';
            document.getElementById('inputObjeto').value        = l.objeto || '';
            document.getElementById('inputData').value          = l.data || '';
            document.getElementById('inputDataAbertura').value  = l.data_abertura || '';
            document.getElementById('inputValor').value         = l.valor || '';
            document.getElementById('inputValorOfertado').value = l.valor_ofertado || '';
            document.getElementById('inputStatus').value        = l.status || 'ABERTA';
            document.getElementById('inputResponsavel').value   = l.responsavel || '';
            document.getElementById('inputLink').value          = l.link || '';
            document.getElementById('inputObservacoes').value   = l.observacoes || '';
        }
    } else {
        clearForm();
    }

    document.getElementById('formModal').classList.add('show');
    document.getElementById('inputNumero').focus();
}

function closeFormModal() {
    document.getElementById('formModal').classList.remove('show');
    clearForm();
    editingId = null;
}

function clearForm() {
    ['editId','inputNumero','inputOrgao','inputObjeto','inputData','inputDataAbertura',
     'inputValor','inputValorOfertado','inputResponsavel','inputLink','inputObservacoes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const mod = document.getElementById('inputModalidade');
    if (mod) mod.value = '';
    const sta = document.getElementById('inputStatus');
    if (sta) sta.value = 'ABERTA';
}

async function saveLicitacao() {
    const numero = (document.getElementById('inputNumero').value || '').trim();
    const orgao  = (document.getElementById('inputOrgao').value || '').trim();
    if (!numero) { showMessage('Número/Processo é obrigatório.', 'error'); return; }
    if (!orgao)  { showMessage('Órgão é obrigatório.', 'error'); return; }

    const payload = {
        numero:          numero.toUpperCase(),
        modalidade:      (document.getElementById('inputModalidade').value || '').trim(),
        orgao:           orgao.toUpperCase(),
        objeto:          (document.getElementById('inputObjeto').value || '').trim().toUpperCase(),
        data:            document.getElementById('inputData').value || null,
        data_abertura:   document.getElementById('inputDataAbertura').value || null,
        valor:           parseFloat(document.getElementById('inputValor').value) || null,
        valor_ofertado:  parseFloat(document.getElementById('inputValorOfertado').value) || null,
        status:          document.getElementById('inputStatus').value || 'ABERTA',
        responsavel:     (document.getElementById('inputResponsavel').value || '').trim().toUpperCase(),
        link:            (document.getElementById('inputLink').value || '').trim(),
        observacoes:     (document.getElementById('inputObservacoes').value || '').trim()
    };

    const btnSave = document.getElementById('btnSave');
    btnSave.disabled = true;
    btnSave.textContent = 'Salvando...';

    try {
        const url    = editingId ? `${API_URL}/licitacoes/${editingId}` : `${API_URL}/licitacoes`;
        const method = editingId ? 'PUT' : 'POST';
        const res = await fetch(url, { method, headers: getHeaders(), body: JSON.stringify(payload) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Erro ao salvar'); }

        showMessage(editingId ? 'Licitação atualizada!' : 'Licitação cadastrada!', 'success');
        closeFormModal();
        await loadLicitacoes();
    } catch (e) {
        showMessage('Erro: ' + e.message, 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Salvar';
    }
}

async function deleteLicitacao() {
    if (!editingId) return;
    if (!confirm('Deseja excluir esta licitação?')) return;

    try {
        const res = await fetch(`${API_URL}/licitacoes/${editingId}`, { method: 'DELETE', headers: getHeaders() });
        if (!res.ok) throw new Error('Erro ao excluir');
        showMessage('Licitação excluída.', 'success');
        closeFormModal();
        await loadLicitacoes();
    } catch (e) {
        showMessage('Erro: ' + e.message, 'error');
    }
}

// ── MENSAGEM FLUTUANTE ─────────────────────────────────────────
function showMessage(message, type = 'success') {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 2500);
}

// Fechar modal ao clicar fora / ESC
document.addEventListener('click', e => { if (e.target.id === 'formModal') closeFormModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFormModal(); });
