// ============================================================
// TRANSPORTADORAS — script.js
// ============================================================
const API_URL = window.location.origin + '/api';

let transportadoras = [];
let allTransportadoras = [];
let isOnline = false;
let sessionToken = null;
let deleteTargetId = null;

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

async function verificarAutenticacao() {
    const urlParams   = new URLSearchParams(window.location.search);
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
    loadTransportadoras();
    setInterval(() => { if (isOnline) loadTransportadoras(); }, 30000);
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
async function loadTransportadoras() {
    try {
        const res = await fetch(`${API_URL}/transportadoras?page=1&limit=500`, {
            headers: getHeaders()
        });

        if (res.status === 401) { sessionToken = null; sessionStorage.removeItem('irModuleSession'); return; }
        if (!res.ok) { isOnline = false; updateConnectionStatus(); return; }

        const result = await res.json();
        allTransportadoras = Array.isArray(result) ? result : (result.data || []);
        isOnline = true;
        updateConnectionStatus();
        filterTransportadoras();
    } catch (e) {
        isOnline = false;
        updateConnectionStatus();
    }
}

// ── FILTRAR / RENDERIZAR ───────────────────────────────────────
function filterTransportadoras() {
    const term = (document.getElementById('search')?.value || '').toLowerCase();
    transportadoras = term
        ? allTransportadoras.filter(t =>
            (t.nome || '').toLowerCase().includes(term) ||
            (t.representante || '').toLowerCase().includes(term) ||
            (t.email || '').toLowerCase().includes(term) ||
            (t.regiao || '').toLowerCase().includes(term) ||
            (t.estado || '').toLowerCase().includes(term)
          )
        : [...allTransportadoras];

    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('transportadorasContainer');
    if (!tbody) return;

    if (transportadoras.length === 0) {
        tbody.innerHTML = `
            <tr><td colspan="7">
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/>
                        <path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/>
                        <circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>
                    </svg>
                    <p>${isOnline ? 'Nenhuma transportadora encontrada.' : 'Sem conexão com o servidor.'}</p>
                </div>
            </td></tr>`;
        return;
    }

    tbody.innerHTML = transportadoras.map(t => `
        <tr>
            <td><strong>${escHtml(t.nome || '-')}</strong></td>
            <td>${escHtml(t.representante || '-')}</td>
            <td>${escHtml(t.telefone || '-')}</td>
            <td>${escHtml(t.celular || '-')}</td>
            <td>${escHtml(t.email || '-')}</td>
            <td>${escHtml(t.regiao || '')}${t.estado ? ' / ' + t.estado.toUpperCase() : ''}</td>
            <td>
                <div class="actions-cell">
                    <button class="action-btn edit"   onclick="openFormModal('${t.id}')">Editar</button>
                    <button class="action-btn delete" onclick="openConfirmModal('${t.id}')">Excluir</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── MODAL FORM ─────────────────────────────────────────────────
function openFormModal(id = null) {
    document.getElementById('editId').value     = id || '';
    document.getElementById('modalTitle').textContent = id ? 'Editar Transportadora' : 'Nova Transportadora';

    if (id) {
        const t = allTransportadoras.find(x => String(x.id) === String(id));
        if (t) {
            document.getElementById('inputNome').value           = t.nome || '';
            document.getElementById('inputRepresentante').value  = t.representante || '';
            document.getElementById('inputEmail').value          = t.email || '';
            document.getElementById('inputTelefone').value       = t.telefone || '';
            document.getElementById('inputCelular').value        = t.celular || '';
            document.getElementById('inputRegiao').value         = t.regiao || '';
            document.getElementById('inputEstado').value         = t.estado || '';
            document.getElementById('inputObservacoes').value    = t.observacoes || '';
        }
    } else {
        clearForm();
    }

    document.getElementById('formModal').classList.add('show');
    document.getElementById('inputNome').focus();
}

function closeFormModal() {
    document.getElementById('formModal').classList.remove('show');
    clearForm();
}

function clearForm() {
    ['inputNome','inputRepresentante','inputEmail','inputTelefone',
     'inputCelular','inputRegiao','inputEstado','inputObservacoes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    document.getElementById('editId').value = '';
}

async function saveTransportadora() {
    const nome = (document.getElementById('inputNome').value || '').trim();
    if (!nome) { showMessage('Nome é obrigatório.', 'error'); return; }

    const editId = document.getElementById('editId').value;
    const payload = {
        nome:          nome.toUpperCase(),
        representante: (document.getElementById('inputRepresentante').value || '').trim().toUpperCase(),
        email:         (document.getElementById('inputEmail').value || '').trim().toLowerCase(),
        telefone:      (document.getElementById('inputTelefone').value || '').trim(),
        celular:       (document.getElementById('inputCelular').value || '').trim(),
        regiao:        (document.getElementById('inputRegiao').value || '').trim().toUpperCase(),
        estado:        (document.getElementById('inputEstado').value || '').trim().toUpperCase(),
        observacoes:   (document.getElementById('inputObservacoes').value || '').trim()
    };

    const btnSave = document.getElementById('btnSave');
    btnSave.disabled = true;
    btnSave.textContent = 'Salvando...';

    try {
        const url    = editId ? `${API_URL}/transportadoras/${editId}` : `${API_URL}/transportadoras`;
        const method = editId ? 'PUT' : 'POST';

        const res = await fetch(url, {
            method,
            headers: getHeaders(),
            body: JSON.stringify(payload)
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Erro ao salvar');
        }

        showMessage(editId ? 'Transportadora atualizada!' : 'Transportadora cadastrada!', 'success');
        closeFormModal();
        await loadTransportadoras();
    } catch (e) {
        showMessage('Erro ao salvar: ' + e.message, 'error');
    } finally {
        btnSave.disabled = false;
        btnSave.textContent = 'Salvar';
    }
}

// ── EXCLUSÃO ───────────────────────────────────────────────────
function openConfirmModal(id) {
    deleteTargetId = id;
    document.getElementById('confirmModal').classList.add('show');
}

function closeConfirmModal() {
    deleteTargetId = null;
    document.getElementById('confirmModal').classList.remove('show');
}

async function confirmDelete() {
    if (!deleteTargetId) return;
    closeConfirmModal();

    try {
        const res = await fetch(`${API_URL}/transportadoras/${deleteTargetId}`, {
            method: 'DELETE',
            headers: getHeaders()
        });

        if (!res.ok) throw new Error('Erro ao excluir');

        showMessage('Transportadora excluída.', 'success');
        await loadTransportadoras();
    } catch (e) {
        showMessage('Erro ao excluir: ' + e.message, 'error');
    } finally {
        deleteTargetId = null;
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

// Fechar modal clicando fora
document.addEventListener('click', (e) => {
    if (e.target.id === 'formModal')    closeFormModal();
    if (e.target.id === 'confirmModal') closeConfirmModal();
});

// Enter no formulário
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeFormModal(); closeConfirmModal(); }
});
