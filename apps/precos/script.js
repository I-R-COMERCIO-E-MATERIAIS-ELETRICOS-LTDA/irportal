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
    document.body.innerHTML =
        '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;' +
        'height:100vh;background:var(--bg-primary);color:var(--text-primary);text-align:center;padding:2rem;">' +
        '<h1 style="font-size:2.2rem;margin-bottom:1rem;">' + mensagem + '</h1>' +
        '<p style="color:var(--text-secondary);margin-bottom:2rem;">Somente usuários autenticados podem acessar esta área.</p>' +
        '<a href="' + portalUrl + '" style="display:inline-block;background:var(--btn-register);color:white;' +
        'padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Ir para o Portal</a></div>';
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

window.toggleFilterSection = function() {
    state.filterCollapsed = !state.filterCollapsed;
    var wrapper = document.getElementById('marcasFilterWrapper');
    var btn = document.getElementById('collapseBtn');
    if (!wrapper || !btn) return;
    if (state.filterCollapsed) {
        wrapper.classList.add('collapsed'); btn.textContent = '\u25BC'; btn.title = 'Maximizar';
    } else {
        wrapper.classList.remove('collapsed'); btn.textContent = '\u25B2'; btn.title = 'Minimizar';
    }
};

// ─── CORRIGIDO: parseia a resposta de /marcas de forma robusta e,
//     se vier vazia, extrai as marcas únicas dos próprios registros já carregados ──
function normalizarMarcas(marcas) {
    if (!Array.isArray(marcas) || marcas.length === 0) return [];
    if (typeof marcas[0] === 'object' && marcas[0] !== null) {
        // formato esperado: [{ id, nome }, ...]
        return marcas.filter(function(m) { return m && m.nome; });
    }
    // formato legado: array de strings
    return marcas.map(function(m) { return { id: m, nome: String(m) }; });
}

function extrairMarcasDosPrecos(precos) {
    var vistas = {};
    var resultado = [];
    precos.forEach(function(p) {
        var nome = (p.marca_nome || p.marca || '').trim().toUpperCase();
        if (nome && !vistas[nome]) {
            vistas[nome] = true;
            resultado.push({ id: nome, nome: nome });
        }
    });
    resultado.sort(function(a, b) { return a.nome.localeCompare(b.nome); });
    return resultado;
}

async function carregarTudo() {
    try {
        var results = await Promise.all([
            fetchWithTimeout(API_URL + '/marcas', { method: 'GET', headers: getHeaders() }),
            fetchWithTimeout(API_URL + '/precos?page=1&limit=' + PAGE_SIZE, { method: 'GET', headers: getHeaders() })
        ]);
        var marcasRes = results[0], precosRes = results[1];

        // --- preços primeiro para ter fallback disponível ---
        var precosCarregados = [];
        if (precosRes.ok) {
            var result = await precosRes.json();
            if (Array.isArray(result)) {
                precosCarregados = result.map(function(item) {
                    return Object.assign({}, item, { descricao: item.descricao.toUpperCase() });
                });
                state.precos = precosCarregados;
                state.totalRecords = result.length; state.totalPages = 1; state.currentPage = 1;
            } else {
                precosCarregados = (result.data || []).map(function(item) {
                    return Object.assign({}, item, { descricao: item.descricao.toUpperCase() });
                });
                state.precos = precosCarregados;
                state.totalRecords = result.total || 0;
                state.totalPages = result.totalPages || 1;
                state.currentPage = result.page || 1;
            }
            isOnline = true;
            renderPrecos();
            renderPaginacao();
        }

        // --- marcas: usa a tabela dedicada; se vier vazia extrai dos preços ---
        if (marcasRes.ok) {
            var marcasBruto = await marcasRes.json();
            var marcasNorm = normalizarMarcas(marcasBruto);
            if (marcasNorm.length > 0) {
                state.marcasDisponiveis = marcasNorm;
            } else {
                // Tabela marcas vazia ou retorno inesperado: deriva das linhas de preços
                state.marcasDisponiveis = extrairMarcasDosPrecos(precosCarregados);
            }
        } else {
            // Endpoint falhou: deriva das linhas de preços
            state.marcasDisponiveis = extrairMarcasDosPrecos(precosCarregados);
        }
        renderMarcasFilter();

    } catch (err) { console.error('Erro ao carregar dados:', err); }
}

async function atualizarMarcas() {
    try {
        var response = await fetchWithTimeout(API_URL + '/marcas', { method: 'GET', headers: getHeaders() });
        if (response.ok) {
            var marcasBruto = await response.json();
            var marcasNorm = normalizarMarcas(marcasBruto);
            if (marcasNorm.length > 0) {
                state.marcasDisponiveis = marcasNorm;
            } else {
                state.marcasDisponiveis = extrairMarcasDosPrecos(state.precos);
            }
            renderMarcasFilter();
        }
    } catch (err) { console.error('Erro ao atualizar marcas:', err); }
}

function renderMarcasFilter() {
    var container = document.getElementById('marcasFilter');
    if (!container) return;
    container.innerHTML = '';

    var btnTodas = document.createElement('button');
    btnTodas.className = 'brand-button' + (state.marcaSelecionada === 'TODAS' ? ' active' : '');
    btnTodas.textContent = 'TODAS';
    btnTodas.onclick = function() { selecionarMarca('TODAS', null); };
    container.appendChild(btnTodas);

    state.marcasDisponiveis.forEach(function(marca) {
        var nome = marca.nome || marca;
        var id   = marca.id   || marca;
        var button = document.createElement('button');
        button.className = 'brand-button' + (state.marcaSelecionada === nome ? ' active' : '');
        button.textContent = nome;
        button.onclick = function() { selecionarMarca(nome, id); };
        container.appendChild(button);
    });

    var addBtn = document.createElement('button');
    addBtn.className = 'add-brand-btn';
    addBtn.title = 'Adicionar nova marca';
    addBtn.textContent = '+';
    addBtn.onclick = function() { showAddMarcaModal(); };
    container.appendChild(addBtn);

    var gearBtn = document.createElement('button');
    gearBtn.className = 'icon-btn gear-btn';
    gearBtn.title = 'Gerenciar marcas';
    gearBtn.textContent = '\u2699';
    gearBtn.onclick = function() { showGerenciarMarcasModal(); };
    container.appendChild(gearBtn);
}

function selecionarMarca(nome, id) {
    state.marcaSelecionada = nome;
    state.searchTerm = '';
    var searchInput = document.getElementById('search');
    if (searchInput) searchInput.value = '';
    renderMarcasFilter();
    loadPrecos(1);
}

function showAddMarcaModal() {
    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="addMarcaModal" style="display:flex;">' +
        '<div class="modal-content">' +
        '<div class="modal-header">' +
        '<h3 class="modal-title">Nova Marca</h3>' +
        '<button class="close-modal" onclick="closeModal(\'addMarcaModal\')">&#x2715;</button>' +
        '</div>' +
        '<div class="form-group">' +
        '<label for="novaMarcaNome">Nome da Marca *</label>' +
        '<input type="text" id="novaMarcaNome" placeholder="Ex: SAMSUNG">' +
        '</div>' +
        '<div class="modal-actions modal-actions-right">' +
        '<button type="button" class="save" onclick="confirmarAddMarca()">Salvar</button>' +
        '<button type="button" class="success" onclick="closeModal(\'addMarcaModal\')">Cancelar</button>' +
        '</div></div></div>');
    setTimeout(function() { var el = document.getElementById('novaMarcaNome'); if (el) el.focus(); }, 100);
}

window.confirmarAddMarca = async function() {
    var el = document.getElementById('novaMarcaNome');
    var nome = el ? el.value.trim().toUpperCase() : '';
    if (!nome) { showToast('Informe o nome da marca', 'error'); return; }
    try {
        var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        var response = await fetchWithTimeout(API_URL + '/marcas', { method: 'POST', headers: headers, body: JSON.stringify({ nome: nome }) });
        if (!response.ok) { var err = await response.json().catch(function() { return {}; }); throw new Error(err.error || 'Erro ' + response.status); }
        closeModal('addMarcaModal');
        showToast('Marca adicionada', 'success');
        atualizarMarcas();
    } catch (error) { showToast('Erro: ' + error.message, 'error'); }
};

function showGerenciarMarcasModal() {
    var listaHTML = state.marcasDisponiveis.map(function(m) {
        var nome = (m.nome || m).replace(/'/g, '&#39;');
        var id   = String(m.id || m).replace(/'/g, '&#39;');
        return '<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.6rem;">' +
            '<input type="text" value="' + nome + '" id="marca-nome-' + id + '" style="flex:1;padding:8px 12px;font-size:0.9rem;">' +
            '<button class="action-btn save" style="min-width:auto;padding:8px 12px;" onclick="confirmarRenameMarca(\'' + id + '\')">&#10003;</button>' +
            '<button class="action-btn delete" style="min-width:auto;padding:8px 12px;" onclick="confirmarDeleteMarca(\'' + id + '\',\'' + nome + '\')">&#x2715;</button>' +
            '</div>';
    }).join('');
    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="gerenciarMarcasModal" style="display:flex;">' +
        '<div class="modal-content">' +
        '<div class="modal-header"><h3 class="modal-title">Gerenciar Marcas</h3>' +
        '<button class="close-modal" onclick="closeModal(\'gerenciarMarcasModal\')">&#x2715;</button></div>' +
        '<div style="max-height:60vh;overflow-y:auto;padding-right:0.25rem;">' +
        (listaHTML || '<p style="color:var(--text-secondary);text-align:center;">Nenhuma marca cadastrada</p>') +
        '</div><div class="modal-actions modal-actions-right" style="margin-top:1rem;">' +
        '<button type="button" class="secondary" onclick="closeModal(\'gerenciarMarcasModal\')">Fechar</button>' +
        '</div></div></div>');
}

window.confirmarRenameMarca = async function(id) {
    var el = document.getElementById('marca-nome-' + id);
    var novoNome = el ? el.value.trim().toUpperCase() : '';
    if (!novoNome) { showToast('Informe o novo nome', 'error'); return; }
    try {
        var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        var response = await fetchWithTimeout(API_URL + '/marcas/' + id, { method: 'PUT', headers: headers, body: JSON.stringify({ nome: novoNome }) });
        if (!response.ok) { var err = await response.json().catch(function() { return {}; }); throw new Error(err.error || 'Erro ' + response.status); }
        closeModal('gerenciarMarcasModal');
        showToast('Marca renomeada', 'success');
        if (state.marcaSelecionada !== 'TODAS') state.marcaSelecionada = novoNome;
        atualizarMarcas();
        loadPrecos(state.currentPage);
    } catch (error) { showToast('Erro: ' + error.message, 'error'); }
};

window.confirmarDeleteMarca = function(id, nome) {
    closeModal('gerenciarMarcasModal');
    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="deleteMarcaModal" style="display:flex;">' +
        '<div class="modal-content modal-delete">' +
        '<button class="close-modal" onclick="closeModal(\'deleteMarcaModal\')">&#x2715;</button>' +
        '<div class="modal-message-delete">Excluir a marca <strong>' + nome + '</strong> e todos os seus itens?</div>' +
        '<div class="modal-actions modal-actions-no-border">' +
        '<button type="button" class="danger" onclick="executarDeleteMarca(\'' + id + '\')">Sim, excluir</button>' +
        '<button type="button" class="success" onclick="closeModal(\'deleteMarcaModal\')">Cancelar</button>' +
        '</div></div></div>');
};

window.executarDeleteMarca = async function(id) {
    closeModal('deleteMarcaModal');
    try {
        var response = await fetchWithTimeout(API_URL + '/marcas/' + id, { method: 'DELETE', headers: getHeaders() });
        if (!response.ok) throw new Error('Erro ao excluir marca');
        showToast('Marca e itens excluídos', 'success');
        if (state.marcaSelecionada !== 'TODAS') state.marcaSelecionada = 'TODAS';
        atualizarMarcas();
        loadPrecos(1);
    } catch (error) { showToast('Erro: ' + error.message, 'error'); }
};

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

function buildMarcaSelectHTML(selectedNome) {
    var options = state.marcasDisponiveis.map(function(m) {
        var nome = m.nome || m;
        var sel  = nome === selectedNome ? ' selected' : '';
        return '<option value="' + nome + '"' + sel + '>' + nome + '</option>';
    }).join('');
    return '<select id="modalMarca" required><option value="">Selecione...</option>' + options + '</select>';
}

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
        '<div class="input-with-action">' + buildMarcaSelectHTML(marcaAtual) +
        '<button type="button" class="btn-add-inline" title="Adicionar nova marca" onclick="showAddMarcaModalInline()">+</button>' +
        '</div></div>' +
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
    }, 100);
}

window.showAddMarcaModalInline = function() {
    var editId    = document.getElementById('modalEditId') ? document.getElementById('modalEditId').value : null;
    var codigo    = encodeURIComponent(document.getElementById('modalCodigo') ? document.getElementById('modalCodigo').value : '');
    var precoVal  = encodeURIComponent(document.getElementById('modalPreco') ? document.getElementById('modalPreco').value : '');
    var descricao = encodeURIComponent(document.getElementById('modalDescricao') ? document.getElementById('modalDescricao').value : '');
    var marcaAtu  = encodeURIComponent(document.getElementById('modalMarca') ? document.getElementById('modalMarca').value : '');
    closeFormModal(false);
    document.body.insertAdjacentHTML('beforeend',
        '<div class="modal-overlay" id="addMarcaInlineModal" style="display:flex;">' +
        '<div class="modal-content">' +
        '<div class="modal-header"><h3 class="modal-title">Nova Marca</h3>' +
        '<button class="close-modal" onclick="closeModal(\'addMarcaInlineModal\')">&#x2715;</button></div>' +
        '<div class="form-group"><label for="novaMarcaNomeInline">Nome da Marca *</label>' +
        '<input type="text" id="novaMarcaNomeInline" placeholder="Ex: SAMSUNG"></div>' +
        '<div class="modal-actions modal-actions-right">' +
        '<button type="button" class="save" onclick="confirmarAddMarcaInline(\'' + editId + '\',\'' + codigo + '\',\'' + precoVal + '\',\'' + descricao + '\',\'' + marcaAtu + '\')">Salvar</button>' +
        '<button type="button" class="success" onclick="closeModal(\'addMarcaInlineModal\')">Cancelar</button>' +
        '</div></div></div>');
    setTimeout(function() { var el = document.getElementById('novaMarcaNomeInline'); if (el) el.focus(); }, 100);
};

window.confirmarAddMarcaInline = async function(editId, codigoEnc, precoEnc, descEnc, marcaEnc) {
    var el = document.getElementById('novaMarcaNomeInline');
    var nome = el ? el.value.trim().toUpperCase() : '';
    if (!nome) { showToast('Informe o nome da marca', 'error'); return; }
    try {
        var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        var response = await fetchWithTimeout(API_URL + '/marcas', { method: 'POST', headers: headers, body: JSON.stringify({ nome: nome }) });
        if (!response.ok) { var err = await response.json().catch(function() { return {}; }); throw new Error(err.error || 'Erro ' + response.status); }
        closeModal('addMarcaInlineModal');
        showToast('Marca adicionada', 'success');
        await atualizarMarcas();
        var idNum = editId && editId !== 'null' ? editId : null;
        showFormModal(idNum);
        setTimeout(function() {
            var s = document.getElementById('modalMarca');
            var c = document.getElementById('modalCodigo');
            var p = document.getElementById('modalPreco');
            var d = document.getElementById('modalDescricao');
            if (s) s.value = nome;
            if (c) c.value = decodeURIComponent(codigoEnc);
            if (p) p.value = decodeURIComponent(precoEnc);
            if (d) d.value = decodeURIComponent(descEnc);
        }, 50);
    } catch (error) { showToast('Erro: ' + error.message, 'error'); }
};

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
        marca:     document.getElementById('modalMarca').value.trim(),
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
        atualizarMarcas();
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
        atualizarMarcas();
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
