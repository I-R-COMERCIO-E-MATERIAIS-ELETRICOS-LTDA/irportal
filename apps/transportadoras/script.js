// ============================================
// TRANSPORTADORAS - script.js
// ============================================
const PORTAL_URL = window.location.origin;
const API_URL = `${window.location.origin}/api`;

let transportadoras = [];
let isOnline = false;
let editingId = null;
let sessionToken = null;
let currentUser = null;

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

async function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('transpSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('transpSession');
    }

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    try {
        const verifyRes = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        if (verifyRes.ok) {
            const sessionData = await verifyRes.json();
            if (sessionData.valid && sessionData.session) {
                currentUser = sessionData.session;
                sessionStorage.setItem('transpUserData', JSON.stringify(currentUser));
            } else {
                mostrarTelaAcessoNegado('Sua sessão expirou');
                return;
            }
        }
    } catch (e) {
        try {
            const userData = sessionStorage.getItem('transpUserData');
            if (userData) currentUser = JSON.parse(userData);
        } catch (e2) {}
    }
    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="
            display: flex; flex-direction: column; align-items: center;
            justify-content: center; height: 100vh; background: var(--bg-primary);
            color: var(--text-primary); text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">
                Somente usuários autenticados podem acessar esta área.
            </p>
            <a href="${PORTAL_URL}" style="
                display: inline-block; background: var(--btn-register); color: white;
                padding: 14px 32px; border-radius: 8px; text-decoration: none;
                font-weight: 600; text-transform: uppercase;">IR PARA O PORTAL</a>
        </div>`;
}

function inicializarApp() {
    loadTransportadoras();
    setInterval(() => { if (isOnline) loadTransportadoras(); }, 30000);
}

// ============================================
// CONEXÃO
// ============================================
function updateConnectionStatus() {
    const status = document.getElementById('connectionStatus');
    if (status) {
        status.className = isOnline ? 'connection-status online' : 'connection-status offline';
    }
}

function showMessage(message, type = 'success') {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 2000);
}

// ============================================
// CARREGAR TRANSPORTADORAS
// ============================================
async function loadTransportadoras() {
    try {
        const response = await fetch(`${API_URL}/transportadoras`, {
            headers: { 'X-Session-Token': sessionToken },
            cache: 'no-cache'
        });
        if (response.status === 401) {
            sessionStorage.removeItem('transpSession');
            mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU');
            return;
        }
        if (!response.ok) {
            isOnline = false;
            updateConnectionStatus();
            return;
        }
        transportadoras = await response.json();
        isOnline = true;
        updateConnectionStatus();
        renderTable();
    } catch (e) {
        isOnline = false;
        updateConnectionStatus();
    }
}

// ============================================
// FILTRO
// ============================================
function filterTransportadoras() {
    renderTable();
}

function renderTable() {
    const container = document.getElementById('transportadorasContainer');
    const search = (document.getElementById('search')?.value || '').toLowerCase();

    let filtered = transportadoras;
    if (search) {
        filtered = transportadoras.filter(t =>
            (t.nome || '').toLowerCase().includes(search) ||
            (t.representante || '').toLowerCase().includes(search) ||
            (t.email || '').toLowerCase().includes(search) ||
            (t.regioes || []).join(' ').toLowerCase().includes(search) ||
            (t.estados || []).join(' ').toLowerCase().includes(search)
        );
    }

    if (filtered.length === 0) {
        container.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;">Nenhuma transportadora encontrada</td></tr>`;
        return;
    }

    container.innerHTML = filtered.map(t => `
        <tr>
            <td><strong>${t.nome}</strong></td>
            <td>${t.representante || '-'}</td>
            <td>${(t.telefones || []).join(', ') || '-'}</td>
            <td>${(t.celulares || []).join(', ') || '-'}</td>
            <td>${t.email}</td>
            <td>
                <div class="actions">
                    <button onclick="editTransportadora('${t.id}')" class="action-btn" style="background:#6B7280;">Editar</button>
                    <button onclick="deleteTransportadora('${t.id}', '${t.nome}')" class="action-btn" style="background:#EF4444;">Excluir</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ============================================
// MODAL DE FORMULÁRIO
// ============================================
function openFormModal() {
    editingId = null;
    document.getElementById('formTitle').textContent = 'Nova Transportadora';
    resetForm();
    document.getElementById('formModal').classList.add('show');
}

function closeFormModal() {
    document.getElementById('formModal').classList.remove('show');
    resetForm();
}

function resetForm() {
    document.querySelectorAll('#formModal input, #formModal textarea').forEach(el => el.value = '');
}

function editTransportadora(id) {
    const t = transportadoras.find(x => x.id === id);
    if (!t) return;
    editingId = id;
    document.getElementById('formTitle').textContent = `Editar: ${t.nome}`;

    document.getElementById('nome').value = t.nome || '';
    document.getElementById('representante').value = t.representante || '';
    document.getElementById('email').value = t.email || '';
    document.getElementById('telefones').value = (t.telefones || []).join(', ');
    document.getElementById('celulares').value = (t.celulares || []).join(', ');
    document.getElementById('regioes').value = (t.regioes || []).join(', ');
    document.getElementById('estados').value = (t.estados || []).join(', ');

    document.getElementById('formModal').classList.add('show');
}

function parseArray(str) {
    if (!str || !str.trim()) return [];
    return str.split(',').map(s => s.trim()).filter(Boolean);
}

async function saveTransportadora() {
    const nome  = document.getElementById('nome').value.trim();
    const email = document.getElementById('email').value.trim();

    if (!nome || !email) {
        showMessage('Nome e e-mail são obrigatórios!', 'error');
        return;
    }

    const payload = {
        nome,
        representante: document.getElementById('representante').value.trim(),
        email,
        telefones: parseArray(document.getElementById('telefones').value),
        celulares: parseArray(document.getElementById('celulares').value),
        regioes:   parseArray(document.getElementById('regioes').value),
        estados:   parseArray(document.getElementById('estados').value)
    };

    try {
        const url    = editingId ? `${API_URL}/transportadoras/${editingId}` : `${API_URL}/transportadoras`;
        const method = editingId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error('Erro ao salvar');

        await loadTransportadoras();
        closeFormModal();
        showMessage(editingId ? 'Transportadora atualizada!' : 'Transportadora cadastrada!', 'success');
    } catch (e) {
        showMessage('Erro ao salvar transportadora!', 'error');
    }
}

async function deleteTransportadora(id, nome) {
    if (!confirm(`Excluir a transportadora "${nome}"?`)) return;
    try {
        const response = await fetch(`${API_URL}/transportadoras/${id}`, {
            method: 'DELETE',
            headers: { 'X-Session-Token': sessionToken }
        });
        if (!response.ok) throw new Error('Erro ao excluir');
        await loadTransportadoras();
        showMessage('Transportadora excluída!', 'success');
    } catch (e) {
        showMessage('Erro ao excluir transportadora!', 'error');
    }
}
