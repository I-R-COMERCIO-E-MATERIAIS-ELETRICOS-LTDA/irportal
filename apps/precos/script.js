// CONFIGURAÇÃO
const API_URL = window.location.origin + '/api';

const PAGE_SIZE = 50;

let state = {
    precos: [],
    currentPage: 1,
    totalPages: 1,
    totalRecords: 0,
    marcaSelecionada: 'TODAS',
    searchTerm: '',
    marcasDisponiveis: [],
    isLoading: false
};

let isOnline = false;
let sessionToken = null;

console.log('🚀 Tabela de Preços iniciada');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

// ─── AUTENTICAÇÃO ─────────────────────────────────────────────────────────────

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('irModuleSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('irModuleSession');
    }

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p>
            
        </div>
    `;
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

function inicializarApp() {
    // Carga inicial: marcas + primeira página
    carregarTudo();

    // Verifica conexão a cada 15s; se reconectar, recarrega tudo
    setInterval(async () => {
        const online = await verificarConexao();
        if (online && !isOnline) {
            isOnline = true;
            updateConnectionStatus();
            carregarTudo();
        } else if (!online && isOnline) {
            isOnline = false;
            updateConnectionStatus();
        }
    }, 15000);

    // Polling leve a cada 30s para atualizar a página atual
    setInterval(() => {
        if (isOnline && !state.isLoading) loadPrecos(state.currentPage);
    }, 30000);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getHeaders() {
    const headers = { 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    return headers;
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal, mode: 'cors' });
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (el) el.className = isOnline ? 'connection-status online' : 'connection-status offline';
}

async function verificarConexao() {
    try {
        const response = await fetchWithTimeout(`${API_URL}/precos?page=1&limit=1`, {
            method: 'GET',
            headers: getHeaders()
        });
        if (response.status === 401) {
            sessionStorage.removeItem('irModuleSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }
        return response.ok;
    } catch {
        return false;
    }
}

// ─── CARGA INICIAL (marcas + dados) ──────────────────────────────────────────

async function carregarTudo() {
    try {
        // Marcas: usa /api/marcas (retorna todas sem limite de paginação)
        // Dados: usa /api/precos paginado
        const [marcasRes, precosRes] = await Promise.all([
            fetchWithTimeout(`${API_URL}/marcas`, { method: 'GET', headers: getHeaders() }),
            fetchWithTimeout(`${API_URL}/precos?page=1&limit=${PAGE_SIZE}`, { method: 'GET', headers: getHeaders() })
        ]);

        // Marcas
        if (marcasRes.ok) {
            const marcas = await marcasRes.json();
            // /api/marcas retorna array de strings; /api/precos retorna array de objetos (servidor antigo)
            if (Array.isArray(marcas) && typeof marcas[0] === 'string') {
                state.marcasDisponiveis = marcas;
            } else if (Array.isArray(marcas)) {
                // fallback: array de objetos
                const set = new Set();
                marcas.forEach(p => { if (p.marca?.trim()) set.add(p.marca.trim()); });
                state.marcasDisponiveis = [...set].sort();
            }
            renderMarcasFilter();
        }

        // Dados paginados
        if (precosRes.ok) {
            const result = await precosRes.json();
            if (Array.isArray(result)) {
                // Servidor antigo sem paginação
                state.precos = result.map(item => ({ ...item, descricao: item.descricao.toUpperCase() }));
                state.totalRecords = result.length;
                state.totalPages = 1;
                state.currentPage = 1;
                // Extrai marcas do array completo se /api/marcas falhou
                if (!marcasRes.ok) {
                    const set = new Set();
                    result.forEach(p => { if (p.marca?.trim()) set.add(p.marca.trim()); });
                    state.marcasDisponiveis = [...set].sort();
                    renderMarcasFilter();
                }
            } else {
                state.precos = (result.data || []).map(item => ({ ...item, descricao: item.descricao.toUpperCase() }));
                state.totalRecords = result.total || 0;
                state.totalPages = result.totalPages || 1;
                state.currentPage = result.page || 1;
            }
            isOnline = true;
            updateConnectionStatus();
            renderPrecos();
            renderPaginacao();
        }
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
    }
}

// Busca marcas disponíveis extraindo da listagem completa
async function atualizarMarcas() {
    try {
        const response = await fetchWithTimeout(`${API_URL}/marcas`, {
            method: 'GET',
            headers: getHeaders()
        });
        if (response.ok) {
            const marcas = await response.json();
            if (Array.isArray(marcas) && typeof marcas[0] === 'string') {
                state.marcasDisponiveis = marcas;
            } else if (Array.isArray(marcas)) {
                const set = new Set();
                marcas.forEach(p => { if (p.marca?.trim()) set.add(p.marca.trim()); });
                state.marcasDisponiveis = [...set].sort();
            }
            renderMarcasFilter();
        }
    } catch (err) {
        console.error('Erro ao atualizar marcas:', err);
    }
}

// ─── MARCAS ───────────────────────────────────────────────────────────────────

function renderMarcasFilter() {
    const container = document.getElementById('marcasFilter');
    if (!container) return;

    container.innerHTML = '';

    ['TODAS', ...state.marcasDisponiveis].forEach(marca => {
        const button = document.createElement('button');
        button.className = `brand-button ${marca === state.marcaSelecionada ? 'active' : ''}`;
        button.textContent = marca;
        button.onclick = () => selecionarMarca(marca);
        container.appendChild(button);
    });
}

function selecionarMarca(marca) {
    state.marcaSelecionada = marca;
    state.searchTerm = '';
    const searchInput = document.getElementById('search');
    if (searchInput) searchInput.value = '';
    renderMarcasFilter();
    loadPrecos(1);
}

// ─── PAGINAÇÃO / DADOS ────────────────────────────────────────────────────────

async function loadPrecos(page = 1) {
    if (state.isLoading) return;
    state.isLoading = true;
    state.currentPage = page;

    try {
        const params = new URLSearchParams({ page, limit: PAGE_SIZE });
        if (state.marcaSelecionada !== 'TODAS') params.set('marca', state.marcaSelecionada);
        if (state.searchTerm) params.set('search', state.searchTerm);

        const response = await fetchWithTimeout(`${API_URL}/precos?${params}`, {
            method: 'GET',
            headers: getHeaders()
        });

        if (response.status === 401) {
            sessionStorage.removeItem('irModuleSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            console.error('❌ Erro ao carregar preços:', response.status);
            return;
        }

        const result = await response.json();

        if (Array.isArray(result)) {
            // Servidor antigo: array direto
            state.precos = result.map(item => ({ ...item, descricao: item.descricao.toUpperCase() }));
            state.totalRecords = result.length;
            state.totalPages = 1;
            state.currentPage = 1;
        } else {
            // Servidor novo: objeto paginado
            state.precos = (result.data || []).map(item => ({ ...item, descricao: item.descricao.toUpperCase() }));
            state.totalRecords = result.total || 0;
            state.totalPages = result.totalPages || 1;
            state.currentPage = result.page || page;
        }
        isOnline = true;
        updateConnectionStatus();

        renderPrecos();
        renderPaginacao();

    } catch (error) {
        console.error(error.name === 'AbortError' ? '❌ Timeout' : '❌ Erro:', error);
    } finally {
        state.isLoading = false;
    }
}

let searchDebounceTimer = null;

function filterPrecos() {
    state.searchTerm = document.getElementById('search').value.trim();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
        loadPrecos(1);
    }, 200);
}

// ─── RENDER ───────────────────────────────────────────────────────────────────

function renderPrecos() {
    const container = document.getElementById('precosTableBody');
    if (!container) return;

    if (!state.precos.length) {
        container.innerHTML = `
            <tr>
                <td colspan="6" style="text-align: center; padding: 2rem;">Nenhum preço encontrado</td>
            </tr>
        `;
        return;
    }

    container.innerHTML = state.precos.map(p => `
        <tr>
            <td><strong>${p.marca}</strong></td>
            <td>${p.codigo}</td>
            <td>R$ ${parseFloat(p.preco).toFixed(2)}</td>
            <td>${p.descricao}</td>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">${getTimeAgo(p.timestamp)}</td>
            <td class="actions-cell" style="text-align: center;">
                <button onclick="window.editPreco('${p.id}')" class="action-btn edit">Editar</button>
                <button onclick="window.deletePreco('${p.id}')" class="action-btn delete">Excluir</button>
            </td>
        </tr>
    `).join('');
}

function renderPaginacao() {
    const existing = document.getElementById('paginacaoContainer');
    if (existing) existing.remove();

    const tableCard = document.querySelector('.table-card');
    if (!tableCard) return;

    const total = state.totalPages;
    const atual = state.currentPage;
    const inicio = state.totalRecords === 0 ? 0 : (atual - 1) * PAGE_SIZE + 1;
    const fim = Math.min(atual * PAGE_SIZE, state.totalRecords);

    let paginas = [];
    if (total <= 7) {
        for (let i = 1; i <= total; i++) paginas.push(i);
    } else {
        paginas.push(1);
        if (atual > 3) paginas.push('...');
        for (let i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) paginas.push(i);
        if (atual < total - 2) paginas.push('...');
        paginas.push(total);
    }

    const botoesHTML = paginas.map(p =>
        p === '...'
            ? `<span class="pag-ellipsis">…</span>`
            : `<button class="pag-btn ${p === atual ? 'pag-btn-active' : ''}" onclick="loadPrecos(${p})">${p}</button>`
    ).join('');

    const div = document.createElement('div');
    div.id = 'paginacaoContainer';
    div.className = 'paginacao-wrapper';
    div.innerHTML = `
        <div class="paginacao-info">
            ${state.totalRecords > 0 ? `Exibindo ${inicio}–${fim} de ${state.totalRecords} registros` : 'Nenhum registro'}
        </div>
        <div class="paginacao-btns">
            <button class="pag-btn pag-nav" onclick="loadPrecos(${atual - 1})" ${atual === 1 ? 'disabled' : ''}>‹</button>
            ${botoesHTML}
            <button class="pag-btn pag-nav" onclick="loadPrecos(${atual + 1})" ${atual === total ? 'disabled' : ''}>›</button>
        </div>
    `;
    tableCard.appendChild(div);
}

// ─── FORMULÁRIO ───────────────────────────────────────────────────────────────

window.toggleForm = function() { showFormModal(null); };

function showFormModal(editingId = null) {
    const isEditing = editingId !== null;
    const preco = isEditing ? state.precos.find(p => p.id === editingId) : null;

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content large">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Preço' : 'Novo Preço'}</h3>
                    <button class="close-modal" onclick="closeFormModal(true)">✕</button>
                </div>
                <form id="modalPrecoForm" onsubmit="handleSubmit(event)">
                    <input type="hidden" id="modalEditId" value="${editingId || ''}">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="modalMarca">Marca *</label>
                            <input type="text" id="modalMarca" value="${preco?.marca || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="modalCodigo">Código *</label>
                            <input type="text" id="modalCodigo" value="${preco?.codigo || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="modalPreco">Preço (R$) *</label>
                            <input type="number" id="modalPreco" step="0.01" min="0" value="${preco?.preco || ''}" required>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label for="modalDescricao">Descrição *</label>
                            <textarea id="modalDescricao" rows="3" required>${preco?.descricao || ''}</textarea>
                        </div>
                    </div>
                    <div class="modal-actions modal-actions-right">
                        <button type="submit" class="save">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        <button type="button" onclick="closeFormModal(true)" class="danger">Cancelar</button>
                    </div>
                </form>
            </div>
        </div>
    `);

    setTimeout(() => {
        document.getElementById('modalDescricao').addEventListener('input', (e) => {
            const start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
        });
        document.getElementById('modalMarca')?.focus();
    }, 100);
}

function closeFormModal(showCancelMessage = false) {
    const modal = document.getElementById('formModal');
    if (!modal) return;
    const editId = document.getElementById('modalEditId')?.value;
    if (showCancelMessage) showToast(editId ? 'Atualização cancelada' : 'Registro cancelado', 'error');
    modal.style.animation = 'fadeOut 0.2s ease forwards';
    setTimeout(() => modal.remove(), 200);
}

async function handleSubmit(event) {
    event.preventDefault();

    const editId = document.getElementById('modalEditId').value;
    const formData = {
        marca: document.getElementById('modalMarca').value.trim(),
        codigo: document.getElementById('modalCodigo').value.trim(),
        preco: parseFloat(document.getElementById('modalPreco').value),
        descricao: document.getElementById('modalDescricao').value.trim().toUpperCase()
    };

    if (!isOnline) { showToast('Sistema offline', 'error'); closeFormModal(); return; }

    try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;

        const response = await fetchWithTimeout(
            editId ? `${API_URL}/precos/${editId}` : `${API_URL}/precos`,
            { method: editId ? 'PUT' : 'POST', headers, body: JSON.stringify(formData) },
            15000
        );

        if (response.status === 401) {
            sessionStorage.removeItem('irModuleSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Erro ${response.status}`);
        }

        closeFormModal();
        showToast(editId ? 'Item atualizado' : 'Item registrado', 'success');

        // Recarrega marcas extraindo da listagem completa
        atualizarMarcas();
        loadPrecos(editId ? state.currentPage : 1);

    } catch (error) {
        showToast(error.name === 'AbortError' ? 'Timeout: Operação demorou muito' : `Erro: ${error.message}`, 'error');
    }
}

// ─── EDITAR / EXCLUIR ─────────────────────────────────────────────────────────

window.editPreco = function(id) { showFormModal(id); };
window.deletePreco = function(id) { showDeleteModal(id); };

function showDeleteModal(id) {
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="deleteModal" style="display: flex;">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="closeDeleteModal()">✕</button>
                <div class="modal-message-delete">Tem certeza que deseja excluir este preço?</div>
                <div class="modal-actions modal-actions-no-border">
                    <button type="button" onclick="confirmDelete('${id}')" class="danger">Sim</button>
                    <button type="button" onclick="closeDeleteModal()" class="danger">Cancelar</button>
                </div>
            </div>
        </div>
    `);
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    if (modal) { modal.style.animation = 'fadeOut 0.2s ease forwards'; setTimeout(() => modal.remove(), 200); }
}

async function confirmDelete(id) {
    closeDeleteModal();
    if (!isOnline) { showToast('Sistema offline. Não foi possível excluir.', 'error'); return; }

    try {
        const response = await fetchWithTimeout(`${API_URL}/precos/${id}`, {
            method: 'DELETE',
            headers: getHeaders()
        });

        if (response.status === 401) {
            sessionStorage.removeItem('irModuleSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao deletar');

        showToast('Preço excluído com sucesso!', 'success');

        const pageToLoad = state.precos.length === 1 && state.currentPage > 1
            ? state.currentPage - 1
            : state.currentPage;

        atualizarMarcas();
        loadPrecos(pageToLoad);

    } catch (error) {
        showToast(error.name === 'AbortError' ? 'Timeout: Operação demorou muito' : 'Erro ao excluir preço', 'error');
    }
}

// ─── UTILS ────────────────────────────────────────────────────────────────────

function getTimeAgo(timestamp) {
    if (!timestamp) return 'Sem data';
    const now = new Date();
    const past = new Date(timestamp);
    const diff = Math.floor((now - past) / 1000);
    if (diff < 60) return `${diff}s`;
    if (diff < 3600) return `${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d`;
    return past.toLocaleDateString('pt-BR');
}

function showToast(message, type = 'success') {
    document.querySelectorAll('.floating-message').forEach(m => m.remove());
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}
