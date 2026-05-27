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
    isLoading: false
};

let isOnline = true;
let sessionToken = null;

document.addEventListener('DOMContentLoaded', function() { verificarAutenticacao(); });

// ─── AUTENTICAÇÃO ─────────────────────────────────────────────────────────────
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
            if (stored) {
                var session = JSON.parse(stored);
                sessionToken = session.sessionToken || null;
            }
        } catch (e) {}
        if (!sessionToken) sessionToken = sessionStorage.getItem('tabelaPrecosSession');
    }

    if (!sessionToken) { mostrarTelaAcessoNegado(); return; }
    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem) {
    mensagem = mensagem || 'NÃO AUTORIZADO';
    var portalUrl = window.location.origin + '/portal';
    document.body.innerHTML =
        '<div class="access-denied">' +
        '<h1>' + escHtml(mensagem) + '</h1>' +
        '<p>Somente usuários autenticados podem acessar esta área.</p>' +
        '<a href="' + portalUrl + '">Ir para o Portal</a>' +
        '</div>';
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
function inicializarApp() {
    carregarTudo();

    // Verifica conexão a cada 15s
    setInterval(async function() {
        var online = await verificarConexao();
        if (online && !isOnline) {
            isOnline = true;
            carregarTudo();
        } else if (!online) {
            isOnline = false;
        }
    }, 15000);

    // Atualiza dados a cada 30s se online e sem carregamento em andamento
    setInterval(function() {
        if (isOnline && !state.isLoading) loadPrecos(state.currentPage);
    }, 30000);
}

function getHeaders() {
    var headers = { 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    return headers;
}

// ─── FETCH COM TIMEOUT ────────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeout) {
    options  = options  || {};
    timeout  = timeout  || 10000;
    var controller = new AbortController();
    var timeoutId  = setTimeout(function() { controller.abort(); }, timeout);
    try {
        var response = await fetch(url, Object.assign({}, options, { signal: controller.signal }));
        clearTimeout(timeoutId);
        return response;
    } catch (err) {
        clearTimeout(timeoutId);
        throw err;
    }
}

// ─── VERIFICAR CONEXÃO ────────────────────────────────────────────────────────
async function verificarConexao() {
    try {
        var response = await fetchWithTimeout(
            API_URL + '/precos?page=1&limit=1',
            { method: 'GET', headers: getHeaders() },
            8000
        );
        if (response.status === 401) {
            sessionStorage.removeItem(SESSION_KEY);
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }
        return response.ok;
    } catch (e) {
        return false;
    }
}

// ─── SINCRONIZAR DADOS ────────────────────────────────────────────────────────
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

// ─── ATUALIZA LISTA DE MARCAS ─────────────────────────────────────────────────
async function atualizarMarcasDisponiveis() {
    try {
        var response = await fetchWithTimeout(
            API_URL + '/precos/marcas',
            { method: 'GET', headers: getHeaders() },
            8000
        );

        if (response.status === 401) {
            sessionStorage.removeItem(SESSION_KEY);
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (response.ok) {
            var marcas = await response.json();
            state.marcasDisponiveis = Array.isArray(marcas) ? marcas : [];
        } else {
            // Fallback: extrai marcas dos preços já carregados
            var nomes = {};
            state.precos.forEach(function(p) {
                var nome = (p.marca_nome || p.marca || '').trim().toUpperCase();
                if (nome) nomes[nome] = true;
            });
            state.marcasDisponiveis = Object.keys(nomes).sort();
        }
    } catch (e) {
        console.error('Erro ao atualizar marcas:', e);
        // Fallback silencioso — não bloqueia o fluxo
    }
    renderMarcaSelect();
}

// ─── RENDER DO SELETOR DE MARCA ────────────────────────────────────────────────
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

// ─── SELECIONAR MARCA ─────────────────────────────────────────────────────────
window.selecionarMarca = function(nome) {
    state.marcaSelecionada = nome || 'TODAS';
    state.searchTerm = '';
    var searchInput = document.getElementById('search');
    if (searchInput) searchInput.value = '';
    renderMarcaSelect();
    loadPrecos(1);
};

// ─── CARREGAR TUDO (inicial) ───────────────────────────────────────────────────
async function carregarTudo() {
    try {
        // Carrega preços primeiro, depois extrai marcas do resultado como fallback
        await loadPrecos(state.currentPage);
        await atualizarMarcasDisponiveis();
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
    }
}

// ─── LOAD PRECOS ──────────────────────────────────────────────────────────────
async function loadPrecos(page) {
    page = page || 1;
    if (state.isLoading) return;
    state.isLoading = true;
    state.currentPage = page;

    try {
        var params = new URLSearchParams({ page: page, limit: PAGE_SIZE });
        if (state.marcaSelecionada && state.marcaSelecionada !== 'TODAS') {
            params.set('marca', state.marcaSelecionada);
        }
        if (state.searchTerm) {
            params.set('search', state.searchTerm);
        }

        var response = await fetchWithTimeout(
            API_URL + '/precos?' + params.toString(),
            { method: 'GET', headers: getHeaders() },
            10000
        );

        if (response.status === 401) {
            sessionStorage.removeItem(SESSION_KEY);
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            var errBody = {};
            try { errBody = await response.json(); } catch (_) {}
            console.error('Erro ao carregar preços:', response.status, errBody);
            isOnline = false;
            showToast('Erro ao carregar preços (' + response.status + ')', 'error');
            return;
        }

        var result = await response.json();

        if (Array.isArray(result)) {
            state.precos      = result.map(normalizePreco);
            state.totalRecords = result.length;
            state.totalPages  = 1;
            state.currentPage = 1;
        } else {
            state.precos      = (result.data || []).map(normalizePreco);
            state.totalRecords = typeof result.total === 'number' ? result.total : state.precos.length;
            state.totalPages  = result.totalPages || 1;
            state.currentPage = result.page || page;
        }

        isOnline = true;
        renderPrecos();
        renderPaginacao();
    } catch (error) {
        isOnline = false;
        if (error.name === 'AbortError') {
            console.error('Timeout ao carregar preços');
            showToast('Timeout: servidor demorou a responder', 'error');
        } else {
            console.error('Erro ao carregar preços:', error);
        }
    } finally {
        state.isLoading = false;
    }
}

function normalizePreco(p) {
    return {
        id:         p.id,
        marca:      (p.marca     || '').trim().toUpperCase(),
        codigo:     (p.codigo    || '').trim(),
        preco:      parseFloat(p.preco) || 0,
        descricao:  (p.descricao || '').trim().toUpperCase(),
        timestamp:  p.timestamp  || null,
        marca_nome: (p.marca_nome || p.marca || '').trim().toUpperCase()
    };
}

// ─── FILTRO / BUSCA ───────────────────────────────────────────────────────────
var searchDebounceTimer = null;
window.filterPrecos = function() {
    var input = document.getElementById('search');
    state.searchTerm = input ? (input.value || '').trim() : '';
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(function() { loadPrecos(1); }, 300);
};

// ─── RENDER DA TABELA ─────────────────────────────────────────────────────────
function renderPrecos() {
    var container = document.getElementById('precosTableBody');
    if (!container) return;

    if (!state.precos.length) {
        container.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;">Nenhum preço encontrado</td></tr>';
        return;
    }

    container.innerHTML = state.precos.map(function(p) {
        var precoFormatado = 'R$ ' + parseFloat(p.preco).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        return '<tr>' +
            '<td><strong>' + escHtml(p.marca_nome || p.marca || '') + '</strong></td>' +
            '<td>' + escHtml(p.codigo) + '</td>' +
            '<td>' + precoFormatado + '</td>' +
            '<td>' + escHtml(p.descricao) + '</td>' +
            '<td style="color:var(--text-secondary);font-size:0.85rem;">' + getTimeAgo(p.timestamp) + '</td>' +
            '<td class="actions-cell" style="text-align:center;">' +
            '<button onclick="window.editPreco(\'' + escHtml(String(p.id)) + '\')" class="action-btn edit">Editar</button>' +
            '<button onclick="window.deletePreco(\'' + escHtml(String(p.id)) + '\')" class="action-btn delete">Excluir</button>' +
            '</td></tr>';
    }).join('');
}

// ─── ESCAPE HTML ──────────────────────────────────────────────────────────────
function escHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ─── PAGINAÇÃO ────────────────────────────────────────────────────────────────
function renderPaginacao() {
    var existing = document.getElementById('paginacaoContainer');
    if (existing) existing.remove();

    var tableCard = document.querySelector('.table-card');
    if (!tableCard) return;

    var total = state.totalPages;
    var atual  = state.currentPage;
    var inicio = state.totalRecords === 0 ? 0 : (atual - 1) * PAGE_SIZE + 1;
    var fim    = Math.min(atual * PAGE_SIZE, state.totalRecords);

    // Gera array de páginas com reticências
    var paginas = [];
    if (total <= 7) {
        for (var i = 1; i <= total; i++) paginas.push(i);
    } else {
        paginas.push(1);
        if (atual > 3) paginas.push('...');
        for (var i = Math.max(2, atual - 1); i <= Math.min(total - 1, atual + 1); i++) paginas.push(i);
        if (atual < total - 2) paginas.push('...');
        paginas.push(total);
    }

    var botoesHTML = paginas.map(function(p) {
        if (p === '...') return '<span class="pag-ellipsis">&hellip;</span>';
        var cls = 'pag-btn' + (p === atual ? ' pag-btn-active' : '');
        return '<button class="' + cls + '" onclick="loadPrecos(' + p + ')">' + p + '</button>';
    }).join('');

    var infoText = state.totalRecords > 0
        ? 'Exibindo ' + inicio + '&ndash;' + fim + ' de ' + state.totalRecords + ' registros'
        : 'Nenhum registro';

    var div = document.createElement('div');
    div.id = 'paginacaoContainer';
    div.className = 'paginacao-wrapper';
    div.innerHTML =
        '<div class="paginacao-info">' + infoText + '</div>' +
        '<div class="paginacao-btns">' +
        '<button class="pag-btn pag-nav" onclick="loadPrecos(' + (atual - 1) + ')" ' + (atual === 1 ? 'disabled' : '') + '>&lsaquo;</button>' +
        botoesHTML +
        '<button class="pag-btn pag-nav" onclick="loadPrecos(' + (atual + 1) + ')" ' + (atual === total ? 'disabled' : '') + '>&rsaquo;</button>' +
        '</div>';
    tableCard.appendChild(div);
}

// ─── MODAL DE FORMULÁRIO ──────────────────────────────────────────────────────
window.toggleForm = function() { showFormModal(null); };

function showFormModal(editingId) {
    // Remove modal anterior se existir
    var modalExistente = document.getElementById('formModal');
    if (modalExistente) modalExistente.remove();

    var isEditing = editingId !== null && editingId !== undefined && editingId !== '';
    var preco = isEditing ? state.precos.find(function(p) { return String(p.id) === String(editingId); }) : null;

    var marcaAtual   = preco ? escHtml(preco.marca_nome || preco.marca || '') : '';
    var codigoAtual  = preco ? escHtml(preco.codigo    || '') : '';
    var precoAtual   = preco ? parseFloat(preco.preco).toFixed(2) : '';
    var descAtual    = preco ? escHtml(preco.descricao  || '') : '';

    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="formModal" style="display:flex;">' +
        '<div class="modal-content large">' +
        '<div class="modal-header">' +
        '<h3 class="modal-title">' + (isEditing ? 'Editar Preço' : 'Novo Preço') + '</h3>' +
        '<button class="close-modal" onclick="closeFormModal(true)">&#x2715;</button>' +
        '</div>' +
        '<form id="modalPrecoForm" onsubmit="handleSubmit(event)">' +
        '<input type="hidden" id="modalEditId" value="' + escHtml(String(editingId || '')) + '">' +
        '<div class="form-grid">' +
        '<div class="form-group"><label for="modalMarca">Marca *</label>' +
        '<input type="text" id="modalMarca" value="' + marcaAtual + '" required autocomplete="off"></div>' +
        '<div class="form-group"><label for="modalCodigo">Código *</label>' +
        '<input type="text" id="modalCodigo" value="' + codigoAtual + '" required autocomplete="off"></div>' +
        '<div class="form-group"><label for="modalPreco">Preço (R$) *</label>' +
        '<input type="number" id="modalPreco" step="0.01" min="0.01" value="' + precoAtual + '" required></div>' +
        '<div class="form-group" style="grid-column:1/-1;">' +
        '<label for="modalDescricao">Descrição *</label>' +
        '<textarea id="modalDescricao" rows="4" style="resize:vertical;min-height:80px;width:100%;box-sizing:border-box;" required>' + descAtual + '</textarea>' +
        '</div>' +
        '</div>' +
        '<div class="modal-actions modal-actions-right">' +
        '<button type="submit" class="save">' + (isEditing ? 'Atualizar' : 'Salvar') + '</button>' +
        '<button type="button" onclick="closeFormModal(true)" class="danger">Cancelar</button>' +
        '</div></form></div></div>');

    setTimeout(function() {
        function autoResize(el) {
            el.style.height = 'auto';
            el.style.height = el.scrollHeight + 'px';
        }

        var ta = document.getElementById('modalDescricao');
        if (ta) {
            autoResize(ta);
            ta.addEventListener('input', function(e) {
                var start = e.target.selectionStart;
                e.target.value = e.target.value.toUpperCase();
                try { e.target.setSelectionRange(start, start); } catch (_) {}
                autoResize(e.target);
            });
        }

        var marcaInput = document.getElementById('modalMarca');
        if (marcaInput) {
            marcaInput.addEventListener('input', function(e) {
                var start = e.target.selectionStart;
                e.target.value = e.target.value.toUpperCase();
                try { e.target.setSelectionRange(start, start); } catch (_) {}
            });
        }

        // Foca no primeiro campo
        var firstInput = document.getElementById('modalMarca');
        if (firstInput) firstInput.focus();
    }, 50);
}

function closeFormModal(showCancelMessage) {
    var modal = document.getElementById('formModal');
    if (!modal) return;
    var editId = document.getElementById('modalEditId') ? document.getElementById('modalEditId').value : '';
    if (showCancelMessage) showToast(editId ? 'Atualização cancelada' : 'Registro cancelado', 'error');
    modal.style.animation = 'fadeOut 0.2s ease forwards';
    setTimeout(function() { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 200);
}

// ─── SUBMIT DO FORMULÁRIO ─────────────────────────────────────────────────────
async function handleSubmit(event) {
    event.preventDefault();

    var editId = (document.getElementById('modalEditId').value || '').trim();

    var marcaVal    = (document.getElementById('modalMarca').value    || '').trim().toUpperCase();
    var codigoVal   = (document.getElementById('modalCodigo').value   || '').trim();
    var precoVal    = parseFloat(document.getElementById('modalPreco').value);
    var descricaoVal = (document.getElementById('modalDescricao').value || '').trim().toUpperCase();

    if (!marcaVal || !codigoVal || !descricaoVal) {
        showToast('Preencha todos os campos obrigatórios', 'error');
        return;
    }

    if (isNaN(precoVal) || precoVal <= 0) {
        showToast('Informe um preço válido maior que zero', 'error');
        return;
    }

    if (!isOnline) {
        showToast('Sistema offline. Verifique sua conexão.', 'error');
        return;
    }

    var formData = {
        marca:     marcaVal,
        codigo:    codigoVal,
        preco:     precoVal,
        descricao: descricaoVal
    };

    var submitBtn = document.querySelector('#modalPrecoForm button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Aguarde...'; }

    try {
        var url     = editId ? API_URL + '/precos/' + editId : API_URL + '/precos';
        var method  = editId ? 'PUT' : 'POST';
        var headers = Object.assign({ 'Content-Type': 'application/json' }, getHeaders());

        var response = await fetchWithTimeout(
            url,
            { method: method, headers: headers, body: JSON.stringify(formData) },
            15000
        );

        if (response.status === 401) {
            sessionStorage.removeItem(SESSION_KEY);
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (response.status === 409) {
            var errData = await response.json().catch(function() { return {}; });
            showToast(errData.error || 'Código já cadastrado', 'error');
            if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editId ? 'Atualizar' : 'Salvar'; }
            return;
        }

        if (!response.ok) {
            var err = await response.json().catch(function() { return {}; });
            throw new Error(err.error || 'Erro ' + response.status);
        }

        closeFormModal(false);
        showToast(editId ? 'Item atualizado com sucesso' : 'Item cadastrado com sucesso', 'success');

        // Atualiza marcas e recarrega a página atual (ou volta pra 1 em novo registro)
        await atualizarMarcasDisponiveis();
        await loadPrecos(editId ? state.currentPage : 1);
    } catch (error) {
        var msg = error.name === 'AbortError'
            ? 'Timeout: operação demorou muito'
            : 'Erro: ' + (error.message || 'desconhecido');
        showToast(msg, 'error');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = editId ? 'Atualizar' : 'Salvar'; }
    }
}

// ─── EDITAR / EXCLUIR ─────────────────────────────────────────────────────────
window.editPreco = function(id) {
    if (!id) return;
    showFormModal(id);
};

window.deletePreco = function(id) {
    if (!id) return;
    showDeleteModal(id);
};

function showDeleteModal(id) {
    var existente = document.getElementById('deleteModal');
    if (existente) existente.remove();

    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="deleteModal" style="display:flex;">' +
        '<div class="modal-content modal-delete">' +
        '<button class="close-modal" onclick="closeDeleteModal()">&#x2715;</button>' +
        '<div class="modal-message-delete">Tem certeza que deseja excluir este preço?</div>' +
        '<div class="modal-actions modal-actions-no-border">' +
        '<button type="button" onclick="confirmDelete(\'' + escHtml(String(id)) + '\')" class="danger">Sim</button>' +
        '<button type="button" onclick="closeDeleteModal()" class="success">Cancelar</button>' +
        '</div></div></div>');
}

function closeDeleteModal() {
    var modal = document.getElementById('deleteModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(function() { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 200);
    }
}

async function confirmDelete(id) {
    closeDeleteModal();

    if (!isOnline) {
        showToast('Sistema offline. Não foi possível excluir.', 'error');
        return;
    }

    try {
        var response = await fetchWithTimeout(
            API_URL + '/precos/' + id,
            { method: 'DELETE', headers: getHeaders() },
            10000
        );

        if (response.status === 401) {
            sessionStorage.removeItem(SESSION_KEY);
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (response.status === 404) {
            showToast('Preço não encontrado (pode já ter sido excluído)', 'error');
            await loadPrecos(state.currentPage);
            return;
        }

        if (!response.ok) {
            throw new Error('Erro ' + response.status);
        }

        showToast('Preço excluído com sucesso!', 'success');

        // Se era o único item da página atual, volta pra página anterior
        var pageToLoad = (state.precos.length === 1 && state.currentPage > 1)
            ? state.currentPage - 1
            : state.currentPage;

        await atualizarMarcasDisponiveis();
        await loadPrecos(pageToLoad);
    } catch (error) {
        var msg = error.name === 'AbortError'
            ? 'Timeout: operação demorou muito'
            : 'Erro ao excluir preço';
        showToast(msg, 'error');
    }
}

// ─── FECHA MODAL GENÉRICO ─────────────────────────────────────────────────────
window.closeModal = function(id) {
    var modal = document.getElementById(id);
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(function() { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 200);
    }
};

// ─── TEMPO RELATIVO ───────────────────────────────────────────────────────────
function getTimeAgo(timestamp) {
    if (!timestamp) return 'Sem data';
    var past = new Date(timestamp);
    if (isNaN(past.getTime())) return 'Data inválida';
    var diff = Math.floor((Date.now() - past.getTime()) / 1000);
    if (diff < 0)      return 'agora';
    if (diff < 60)     return diff + 's';
    if (diff < 3600)   return Math.floor(diff / 60) + 'min';
    if (diff < 86400)  return Math.floor(diff / 3600) + 'h';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd';
    return past.toLocaleDateString('pt-BR');
}

// ─── TOAST ────────────────────────────────────────────────────────────────────
function showToast(message, type) {
    type = type || 'success';
    document.querySelectorAll('.floating-message').forEach(function(m) { m.remove(); });
    var div = document.createElement('div');
    div.className = 'floating-message ' + type;
    div.textContent = String(message || '');
    document.body.appendChild(div);
    setTimeout(function() {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(function() { if (div.parentNode) div.parentNode.removeChild(div); }, 300);
    }, 3000);
}
