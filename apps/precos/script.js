const API_URL = window.location.origin + '/api';
const SESSION_KEY = 'irUserSession';
const PAGE_SIZE = 50;

let state = {
    precos: [],
    currentPage: 1,
    totalPages: 1,
    totalRecords: 0,
    marcaSelecionada: 'TODAS',
    searchTerm: '',
    marcasDisponiveis: [],
    isLoading: false,
    filterCollapsed: false
};

let isOnline = false;
let sessionToken = null;

document.addEventListener('DOMContentLoaded', function() { verificarAutenticacao(); });

function verificarAutenticacao() {
    var urlParams = new URLSearchParams(window.location.search);
    var tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        try {
            var stored = sessionStorage.getItem(SESSION_KEY);
            var session = stored ? JSON.parse(stored) : {};
            session.sessionToken = tokenFromUrl;
            sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (e) {}
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        try {
            var stored = sessionStorage.getItem(SESSION_KEY);
            if (stored) { var session = JSON.parse(stored); sessionToken = session.sessionToken || null; }
        } catch (e) {}
        if (!sessionToken) sessionToken = sessionStorage.getItem('tabelaPrecosSession');
    }
    if (!sessionToken) { mostrarTelaAcessoNegado(); return; }
    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem) {
    mensagem = mensagem || 'NÃO AUTORIZADO';
    var portalUrl = window.location.origin + '/portal';
    document.body.innerHTML = `
        <div class="access-denied">
            <h1>${mensagem}</h1>
            <p>Somente usuários autenticados podem acessar esta área.</p>
            <a href="${portalUrl}">Ir para o Portal</a>
        </div>
    `;
}

function inicializarApp() {
    carregarTudo();
    setInterval(async function() {
        var online = await verificarConexao();
        if (online && !isOnline) { isOnline = true; carregarTudo(); }
        else if (!online && isOnline) { isOnline = false; }
    }, 15000);
    setInterval(function() {
        if (isOnline && !state.isLoading) loadPrecos(state.currentPage);
    }, 30000);
}

function getHeaders() {
    var headers = { 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    return headers;
}

async function fetchWithTimeout(url, options, timeout) {
    options = options || {};
    timeout = timeout || 10000;
    var controller = new AbortController();
    var timeoutId = setTimeout(function() { controller.abort(); }, timeout);
    try {
        var response = await fetch(url, Object.assign({}, options, { signal: controller.signal, mode: 'cors' }));
        clearTimeout(timeoutId);
        return response;
    } catch (err) { clearTimeout(timeoutId); throw err; }
}

async function verificarConexao() {
    try {
        var response = await fetchWithTimeout(API_URL + '/precos?page=1&limit=1', { method: 'GET', headers: getHeaders() });
        if (response.status === 401) {
            sessionStorage.removeItem(SESSION_KEY);
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }
        return response.ok;
    } catch (e) { return false; }
}

window.sincronizarDados = async function() {
    var btn = document.querySelector('.sync-btn');
    if (btn) { btn.classList.add('spinning'); btn.style.pointerEvents = 'none'; }
    try {
        await carregarTudo();
        showToast('Dados sincronizados', 'success');
    } catch (e) {
        showToast('Erro ao sincronizar', 'error');
    } finally {
        if (btn) setTimeout(function() { btn.classList.remove('spinning'); btn.style.pointerEvents = ''; }, 600);
    }
};

// ─── ATUALIZA LISTA COMPLETA DE MARCAS A PARTIR DO ENDPOINT ────────────────
async function atualizarMarcasDisponiveis() {
    try {
        var response = await fetchWithTimeout(API_URL + '/precos/marcas', { method: 'GET', headers: getHeaders() });
        if (response.ok) {
            var marcas = await response.json();
            state.marcasDisponiveis = marcas;
        } else {
            // fallback: extrai localmente da página atual (menos ideal)
            var nomes = {};
            state.precos.forEach(function(p) {
                var nome = (p.marca_nome || p.marca || '').trim().toUpperCase();
                if (nome) nomes[nome] = true;
            });
            state.marcasDisponiveis = Object.keys(nomes).sort();
        }
    } catch (e) {
        console.error('Erro ao atualizar marcas:', e);
    }
    renderMarcaSelect();
}

// ─── RENDER DO SELETOR DE MARCA ────────────────────────────────────────────
function renderMarcaSelect() {
    var select = document.getElementById('marcaSelect');
    if (!select) return;
    var selecionada = state.marcaSelecionada;
    select.innerHTML = '<option value="TODAS">TODAS</option>';
    state.marcasDisponiveis.forEach(function(nome) {
        var option = document.createElement('option');
        option.value = nome;
        option.textContent = nome;
        if (nome === selecionada) option.selected = true;
        select.appendChild(option);
    });
}

// ─── SELEÇÃO DE MARCA ──────────────────────────────────────────────────────
function selecionarMarca(nome) {
    state.marcaSelecionada = nome;
    state.searchTerm = '';
    var searchInput = document.getElementById('search');
    if (searchInput) searchInput.value = '';
    renderMarcaSelect();
    loadPrecos(1);
}

// ─── CARREGAR TUDO (inicial) ───────────────────────────────────────────────
async function carregarTudo() {
    try {
        await Promise.all([
            atualizarMarcasDisponiveis(),
            loadPrecos(state.currentPage)
        ]);
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
    }
}

// ─── LOAD PRECOS ──────────────────────────────────────────────────────────
async function loadPrecos(page) {
    page = page || 1;
    if (state.isLoading) return;
    state.isLoading = true;
    state.currentPage = page;
    try {
        var params = new URLSearchParams({ page: page, limit: PAGE_SIZE });
        if (state.marcaSelecionada !== 'TODAS') params.set('marca', state.marcaSelecionada);
        if (state.searchTerm) params.set('search', state.searchTerm);
        var response = await fetchWithTimeout(API_URL + '/precos?' + params.toString(), { method: 'GET', headers: getHeaders() });
        if (response.status === 401) { sessionStorage.removeItem(SESSION_KEY); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        if (!response.ok) { console.error('Erro ao carregar preços:', response.status); return; }
        var result = await response.json();
        if (Array.isArray(result)) {
            state.precos = result.map(function(item) { return Object.assign({}, item, { descricao: item.descricao.toUpperCase() }); });
            state.totalRecords = result.length; state.totalPages = 1; state.currentPage = 1;
        } else {
            state.precos = (result.data || []).map(function(item) { return Object.assign({}, item, { descricao: item.descricao.toUpperCase() }); });
            state.totalRecords = result.total || 0;
            state.totalPages = result.totalPages || 1;
            state.currentPage = result.page || page;
        }
        isOnline = true;
        renderPrecos();
        renderPaginacao();
    } catch (error) {
        console.error(error.name === 'AbortError' ? 'Timeout' : 'Erro:', error);
    } finally { state.isLoading = false; }
}

var searchDebounceTimer = null;
window.filterPrecos = function() {
    state.searchTerm = document.getElementById('search').value.trim();
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function() { loadPrecos(1); }, 200);
};

function renderPrecos() {
    var container = document.getElementById('precosTableBody');
    if (!container) return;
    if (!state.precos.length) {
        container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;">Nenhum preço encontrado</td></tr>';
        return;
    }
    container.innerHTML = state.precos.map(function(p) {
        return '<tr>' +
            '<td><strong>' + (p.marca_nome || p.marca || '') + '</strong></td>' +
            '<td>' + p.codigo + '</td>' +
            '<td>R$ ' + parseFloat(p.preco).toFixed(2) + '</td>' +
            '<td>' + p.descricao + '</td>' +
            '<td style="color:var(--text-secondary);font-size:0.85rem;">' + getTimeAgo(p.timestamp) + '</td>' +
            '<td class="actions-cell" style="text-align:center;">' +
            '<button onclick="window.editPreco(\'' + p.id + '\')" class="action-btn edit">Editar</button>' +
            '<button onclick="window.deletePreco(\'' + p.id + '\')" class="action-btn delete">Excluir</button>' +
            '</td></tr>';
    }).join('');
}

function renderPaginacao() {
    var existing = document.getElementById('paginacaoContainer');
    if (existing) existing.remove();
    var tableCard = document.querySelector('.table-card');
    if (!tableCard) return;
    var total = state.totalPages, atual = state.currentPage;
    var inicio = state.totalRecords === 0 ? 0 : (atual - 1) * PAGE_SIZE + 1;
    var fim = Math.min(atual * PAGE_SIZE, state.totalRecords);
    var paginas = [];
    if (total <= 7) { for (var i = 1; i <= total; i++) paginas.push(i); }
    else {
        paginas.push(1);
        if (atual > 3) paginas.push('...');
        for (var i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) paginas.push(i);
        if (atual < total - 2) paginas.push('...');
        paginas.push(total);
    }
    var botoesHTML = paginas.map(function(p) {
        return p === '...' ? '<span class="pag-ellipsis">&hellip;</span>'
            : '<button class="pag-btn' + (p === atual ? ' pag-btn-active' : '') + '" onclick="loadPrecos(' + p + ')">' + p + '</button>';
    }).join('');
    var div = document.createElement('div');
    div.id = 'paginacaoContainer';
    div.className = 'paginacao-wrapper';
    div.innerHTML =
        '<div class="paginacao-info">' + (state.totalRecords > 0 ? 'Exibindo ' + inicio + '&ndash;' + fim + ' de ' + state.totalRecords + ' registros' : 'Nenhum registro') + '</div>' +
        '<div class="paginacao-btns">' +
        '<button class="pag-btn pag-nav" onclick="loadPrecos(' + (atual - 1) + ')" ' + (atual === 1 ? 'disabled' : '') + '>&lsaquo;</button>' +
        botoesHTML +
        '<button class="pag-btn pag-nav" onclick="loadPrecos(' + (atual + 1) + ')" ' + (atual === total ? 'disabled' : '') + '>&rsaquo;</button>' +
        '</div>';
    tableCard.appendChild(div);
}

window.toggleForm = function() { showFormModal(null); };

function showFormModal(editingId) {
    var isEditing = editingId !== null && editingId !== undefined;
    var preco = isEditing ? state.precos.find(function(p) { return p.id === editingId; }) : null;
    var marcaAtual = preco ? (preco.marca_nome || preco.marca || '') : '';
    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="formModal" style="display:flex;">' +
        '<div class="modal-content large">' +
        '<div class="modal-header">' +
        '<h3 class="modal-title">' + (isEditing ? 'Editar Preço' : 'Novo Preço') + '</h3>' +
        '<button class="close-modal" onclick="closeFormModal(true)">&#x2715;</button>' +
        '</div>' +
        '<form id="modalPrecoForm" onsubmit="handleSubmit(event)">' +
        '<input type="hidden" id="modalEditId" value="' + (editingId || '') + '">' +
        '<div class="form-grid">' +
        '<div class="form-group"><label for="modalMarca">Marca *</label>' +
        '<input type="text" id="modalMarca" value="' + marcaAtual + '" required></div>' +
        '<div class="form-group"><label for="modalCodigo">Código *</label>' +
        '<input type="text" id="modalCodigo" value="' + (preco && preco.codigo ? preco.codigo : '') + '" required></div>' +
        '<div class="form-group"><label for="modalPreco">Preço (R$) *</label>' +
        '<input type="number" id="modalPreco" step="0.01" min="0" value="' + (preco && preco.preco ? preco.preco : '') + '" required></div>' +
        '<div class="form-group" style="grid-column:1/-1;"><label for="modalDescricao">Descrição *</label>' +
        '<textarea id="modalDescricao" rows="3" required>' + (preco && preco.descricao ? preco.descricao : '') + '</textarea></div>' +
        '</div>' +
        '<div class="modal-actions modal-actions-right">' +
        '<button type="submit" class="save">' + (isEditing ? 'Atualizar' : 'Salvar') + '</button>' +
        '<button type="button" onclick="closeFormModal(true)" class="danger">Cancelar</button>' +
        '</div></form></div></div>');
    setTimeout(function() {
        var ta = document.getElementById('modalDescricao');
        if (ta) ta.addEventListener('input', function(e) {
            var start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
        });
        var marcaInput = document.getElementById('modalMarca');
        if (marcaInput) marcaInput.addEventListener('input', function(e) {
            var start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
        });
    }, 100);
}

function closeFormModal(showCancelMessage) {
    var modal = document.getElementById('formModal');
    if (!modal) return;
    var editId = document.getElementById('modalEditId') ? document.getElementById('modalEditId').value : '';
    if (showCancelMessage) showToast(editId ? 'Atualização cancelada' : 'Registro cancelado', 'error');
    modal.style.animation = 'fadeOut 0.2s ease forwards';
    setTimeout(function() { modal.remove(); }, 200);
}

async function handleSubmit(event) {
    event.preventDefault();
    var editId = document.getElementById('modalEditId').value;
    var formData = {
        marca:     document.getElementById('modalMarca').value.trim().toUpperCase(),
        codigo:    document.getElementById('modalCodigo').value.trim(),
        preco:     parseFloat(document.getElementById('modalPreco').value),
        descricao: document.getElementById('modalDescricao').value.trim().toUpperCase()
    };
    if (!isOnline) { showToast('Sistema offline', 'error'); closeFormModal(false); return; }
    try {
        var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        var response = await fetchWithTimeout(
            editId ? API_URL + '/precos/' + editId : API_URL + '/precos',
            { method: editId ? 'PUT' : 'POST', headers: headers, body: JSON.stringify(formData) }, 15000);
        if (response.status === 401) { sessionStorage.removeItem(SESSION_KEY); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        if (!response.ok) { var err = await response.json().catch(function() { return {}; }); throw new Error(err.error || 'Erro ' + response.status); }
        closeFormModal(false);
        showToast(editId ? 'Item atualizado' : 'Item registrado', 'success');
        await atualizarMarcasDisponiveis();
        loadPrecos(editId ? state.currentPage : 1);
    } catch (error) { showToast(error.name === 'AbortError' ? 'Timeout: Operação demorou muito' : 'Erro: ' + error.message, 'error'); }
}

window.editPreco   = function(id) { showFormModal(id); };
window.deletePreco = function(id) { showDeleteModal(id); };

function showDeleteModal(id) {
    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="deleteModal" style="display:flex;">' +
        '<div class="modal-content modal-delete">' +
        '<button class="close-modal" onclick="closeDeleteModal()">&#x2715;</button>' +
        '<div class="modal-message-delete">Tem certeza que deseja excluir este preço?</div>' +
        '<div class="modal-actions modal-actions-no-border">' +
        '<button type="button" onclick="confirmDelete(\'' + id + '\')" class="danger">Sim</button>' +
        '<button type="button" onclick="closeDeleteModal()" class="success">Cancelar</button>' +
        '</div></div></div>');
}

function closeDeleteModal() {
    var modal = document.getElementById('deleteModal');
    if (modal) { modal.style.animation = 'fadeOut 0.2s ease forwards'; setTimeout(function() { modal.remove(); }, 200); }
}

async function confirmDelete(id) {
    closeDeleteModal();
    if (!isOnline) { showToast('Sistema offline. Não foi possível excluir.', 'error'); return; }
    try {
        var response = await fetchWithTimeout(API_URL + '/precos/' + id, { method: 'DELETE', headers: getHeaders() });
        if (response.status === 401) { sessionStorage.removeItem(SESSION_KEY); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        if (!response.ok) throw new Error('Erro ao deletar');
        showToast('Preço excluído com sucesso!', 'success');
        var pageToLoad = state.precos.length === 1 && state.currentPage > 1 ? state.currentPage - 1 : state.currentPage;
        await atualizarMarcasDisponiveis();
        loadPrecos(pageToLoad);
    } catch (error) { showToast(error.name === 'AbortError' ? 'Timeout: Operação demorou muito' : 'Erro ao excluir preço', 'error'); }
}

window.closeModal = function(id) {
    var modal = document.getElementById(id);
    if (modal) { modal.style.animation = 'fadeOut 0.2s ease forwards'; setTimeout(function() { modal.remove(); }, 200); }
};

function getTimeAgo(timestamp) {
    if (!timestamp) return 'Sem data';
    var now = new Date(), past = new Date(timestamp);
    var diff = Math.floor((now - past) / 1000);
    if (diff < 60)     return diff + 's';
    if (diff < 3600)   return Math.floor(diff / 60) + 'min';
    if (diff < 86400)  return Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    return past.toLocaleDateString('pt-BR');
}

function showToast(message, type) {
    type = type || 'success';
    document.querySelectorAll('.floating-message').forEach(function(m) { m.remove(); });
    var div = document.createElement('div');
    div.className = 'floating-message ' + type;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(function() {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(function() { div.remove(); }, 300);
    }, 3000);
}
