// CONFIGURAÇÃO
const API_URL = window.location.origin + '/api';

const PAGE_SIZE = 50;

let state = {
    produtos:      [],
    grupos:        [],   // [{ codigo, nome }]
    currentPage:   1,
    totalPages:    1,
    totalRecords:  0,
    grupoCodigo:   null, // null = TODOS
    searchTerm:    '',
    isLoading:     false
};

let isOnline       = false;
let sessionToken   = null;
let editingProductId = null;

console.log('🚀 Estoque iniciado');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', () => verificarAutenticacao());

// ─── AUTENTICAÇÃO ─────────────────────────────────────────────────────────────

function verificarAutenticacao() {
    const urlParams   = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('irModuleSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('irModuleSession');
    }

    if (!sessionToken) { mostrarTelaAcessoNegado(); return; }
    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    height:100vh;background:var(--bg-primary);color:var(--text-primary);
                    text-align:center;padding:2rem;">
            <h1 style="font-size:2.2rem;margin-bottom:1rem;">${mensagem}</h1>
            <p style="color:var(--text-secondary);margin-bottom:2rem;">
                Somente usuários autenticados podem acessar esta área.
            </p>
            
        </div>`;
}

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────

function inicializarApp() {
    carregarTudo();

    // Verificar conexão a cada 15 s
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

    // Auto-refresh a cada 60 s
    setInterval(() => {
        if (isOnline && !state.isLoading) loadProducts(state.currentPage, false);
    }, 60000);
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getHeaders() {
    const h = { 'Accept': 'application/json' };
    if (sessionToken) h['X-Session-Token'] = sessionToken;
    return h;
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), timeout);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal, mode: 'cors' });
        clearTimeout(tid);
        return res;
    } catch (err) { clearTimeout(tid); throw err; }
}

function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (el) el.className = isOnline ? 'connection-status online' : 'connection-status offline';
}

async function verificarConexao() {
    try {
        const res = await fetchWithTimeout(
            `${API_URL}/estoque?page=1&limit=1`,
            { method: 'GET', headers: getHeaders() }
        );
        if (res.status === 401) {
            sessionStorage.removeItem('irModuleSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }
        return res.ok;
    } catch { return false; }
}

// ─── CARGA INICIAL ────────────────────────────────────────────────────────────

async function carregarTudo() {
    try {
        const [gruposRes, produtosRes] = await Promise.all([
            fetchWithTimeout(`${API_URL}/grupos`,
                { method: 'GET', headers: getHeaders() }),
            fetchWithTimeout(`${API_URL}/estoque?page=1&limit=${PAGE_SIZE}`,
                { method: 'GET', headers: getHeaders() })
        ]);

        if (gruposRes.ok) {
            state.grupos = await gruposRes.json();
            renderGruposFilter();
            populateGrupoSelect();
        }

        if (produtosRes.ok) {
            const result      = await produtosRes.json();
            state.produtos     = result.data       || [];
            state.totalRecords = result.total      || 0;
            state.totalPages   = result.totalPages || 1;
            state.currentPage  = result.page       || 1;
            isOnline = true;
            updateConnectionStatus();
            renderTable();
            renderPaginacao();
        }
    } catch (err) {
        console.error('Erro ao carregar dados:', err);
    }
}

async function atualizarGrupos() {
    try {
        const res = await fetchWithTimeout(`${API_URL}/grupos`,
            { method: 'GET', headers: getHeaders() });
        if (res.ok) {
            state.grupos = await res.json();
            renderGruposFilter();
            populateGrupoSelect();
        }
    } catch (err) { console.error('Erro ao atualizar grupos:', err); }
}

// ─── FILTRO DE GRUPOS ─────────────────────────────────────────────────────────

function renderGruposFilter() {
    const container = document.getElementById('gruposFilter');
    if (!container) return;

    const btnTodos = `<button class="brand-button ${state.grupoCodigo === null ? 'active' : ''}"
        onclick="filtrarPorGrupo(null)">TODOS</button>`;

    const btns = state.grupos.map(g =>
        `<button class="brand-button ${state.grupoCodigo === g.codigo ? 'active' : ''}"
            onclick="filtrarPorGrupo(${g.codigo})">${g.nome}</button>`
    ).join('');

    const btnGerenciar = `
        <button class="brand-button brand-button-manage"
                onclick="openManageGroupsModal()" title="Gerenciar grupos">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83
                         l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21
                         a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0
                         -1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0
                         4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65
                         0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1
                         2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0
                         1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65
                         0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65
                         0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09
                         a1.65 1.65 0 0 0-1.51 1z"></path>
            </svg>
        </button>`;

    container.innerHTML = btnTodos + btns + btnGerenciar;
}

function populateGrupoSelect() {
    const select = document.getElementById('grupo');
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">Selecione um grupo</option>';
    state.grupos.forEach(g => {
        const opt = document.createElement('option');
        opt.value = JSON.stringify({ codigo: g.codigo, nome: g.nome });
        opt.textContent = g.nome;
        select.appendChild(opt);
    });
    if (current) select.value = current;
}

function filtrarPorGrupo(grupoCodigo) {
    state.grupoCodigo = grupoCodigo;
    state.searchTerm  = '';
    const el = document.getElementById('search');
    if (el) el.value = '';
    renderGruposFilter();
    loadProducts(1);
}

function filterProducts() {
    state.searchTerm = (document.getElementById('search')?.value || '').trim();
    loadProducts(1);
}

// ─── GERENCIAR GRUPOS ─────────────────────────────────────────────────────────

function openManageGroupsModal() {
    const rows = state.grupos.length
        ? state.grupos.map(g => `
            <tr>
                <td><strong>${g.codigo}</strong></td>
                <td>${g.nome}</td>
                <td style="text-align:center;">
                    <button onclick="confirmarExcluirGrupo(${g.codigo},'${g.nome.replace(/'/g,"\\'")}')"
                            class="action-btn delete">Excluir</button>
                </td>
            </tr>`).join('')
        : '<tr><td colspan="3" style="text-align:center;padding:1rem;">Nenhum grupo cadastrado</td></tr>';

    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay show" id="manageGroupsModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">Gerenciar Grupos</h3>
                    <button class="modal-close-btn" onclick="closeManageGroupsModal()">✕</button>
                </div>
                <p style="color:var(--alert-color);font-size:0.85rem;margin-bottom:1rem;">
                    ⚠️ Excluir um grupo remove <strong>todos os produtos</strong> pertencentes a ele.
                </p>
                <div style="overflow-x:auto;">
                    <table>
                        <thead>
                            <tr><th>Código</th><th>Nome</th><th style="text-align:center;">Ação</th></tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div class="modal-actions">
                    <button type="button" onclick="closeManageGroupsModal()" class="secondary">Fechar</button>
                </div>
            </div>
        </div>`);
}

function closeManageGroupsModal() {
    document.getElementById('manageGroupsModal')?.remove();
}

function confirmarExcluirGrupo(grupoCodigo, grupoNome) {
    closeManageGroupsModal();
    document.body.insertAdjacentHTML('beforeend', `
        <div class="modal-overlay" id="deleteGroupModal" style="display:flex;">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="closeDeleteGroupModal()">✕</button>
                <div class="modal-message-delete">
                    Tem certeza que deseja excluir o grupo <strong>${grupoNome}</strong> e todos os seus produtos?
                </div>
                <div class="modal-actions modal-actions-no-border">
                    <button type="button" onclick="excluirGrupo(${grupoCodigo})" class="danger">Sim</button>
                    <button type="button" onclick="closeDeleteGroupModal()" class="danger">Cancelar</button>
                </div>
            </div>
        </div>`);
}

function closeDeleteGroupModal() {
    const modal = document.getElementById('deleteGroupModal');
    if (modal) { modal.style.animation = 'fadeOut 0.2s ease forwards'; setTimeout(() => modal.remove(), 200); }
}

async function excluirGrupo(grupoCodigo) {
    closeDeleteGroupModal();
    try {
        const res = await fetchWithTimeout(`${API_URL}/grupos/${grupoCodigo}`,
            { method: 'DELETE', headers: getHeaders() });

        if (res.status === 401) {
            sessionStorage.removeItem('irModuleSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        if (!res.ok) throw new Error('Erro ao excluir grupo');

        const result = await res.json();
        showMessage(result.message || 'Grupo excluído com sucesso', 'success');

        if (state.grupoCodigo === grupoCodigo) state.grupoCodigo = null;
        await atualizarGrupos();
        loadProducts(1);
    } catch (error) {
        showMessage(error.name === 'AbortError' ? 'Timeout' : 'Erro ao excluir grupo', 'error');
    }
}

// ─── MODAL NOVO GRUPO ─────────────────────────────────────────────────────────

window.openNewGroupModal = function() {
    document.getElementById('nomeGrupo').value = '';
    document.getElementById('newGroupModal').classList.add('show');
};

window.closeNewGroupModal = function() {
    document.getElementById('newGroupModal').classList.remove('show');
};

window.saveNewGroup = async function(event) {
    event.preventDefault();
    const nome = document.getElementById('nomeGrupo').value.trim();
    if (!nome) { showMessage('Nome do grupo é obrigatório', 'error'); return; }

    try {
        const res = await fetchWithTimeout(`${API_URL}/grupos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify({ nome })
        }, 10000);

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao criar grupo');
        }

        const novoGrupo = await res.json();
        state.grupos.push({ codigo: novoGrupo.codigo, nome: novoGrupo.nome });
        state.grupos.sort((a, b) => a.codigo - b.codigo);
        renderGruposFilter();
        populateGrupoSelect();

        closeNewGroupModal();
        showMessage(`Grupo "${novoGrupo.nome}" criado (código ${novoGrupo.codigo})`, 'success');

        // Selecionar automaticamente no select
        const select = document.getElementById('grupo');
        if (select) {
            const opt = Array.from(select.options).find(o => {
                try { return JSON.parse(o.value).codigo === novoGrupo.codigo; } catch { return false; }
            });
            if (opt) select.value = opt.value;
        }
    } catch (error) { showMessage(error.message, 'error'); }
};

// ─── CARREGAR PRODUTOS (paginado) ─────────────────────────────────────────────

async function loadProducts(page = 1, showLoader = true) {
    if (state.isLoading) return;
    state.isLoading   = true;
    state.currentPage = page;

    if (showLoader) renderLoading();

    try {
        const params = new URLSearchParams({ page, limit: PAGE_SIZE });
        if (state.grupoCodigo !== null) params.set('grupo_codigo', state.grupoCodigo);
        if (state.searchTerm)           params.set('search', state.searchTerm);

        const res = await fetchWithTimeout(
            `${API_URL}/estoque?${params}`,
            { method: 'GET', headers: getHeaders() }
        );

        if (res.status === 401) {
            sessionStorage.removeItem('irModuleSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        if (!res.ok) { console.error('❌ Erro:', res.status); return; }

        const result       = await res.json();
        state.produtos      = result.data       || [];
        state.totalRecords  = result.total      || 0;
        state.totalPages    = result.totalPages || 1;
        state.currentPage   = result.page       || page;

        isOnline = true;
        updateConnectionStatus();
        renderTable();
        renderPaginacao();
    } catch (error) {
        console.error(error.name === 'AbortError' ? '❌ Timeout' : '❌ Erro:', error);
    } finally {
        state.isLoading = false;
    }
}

// ─── RENDER TABELA ────────────────────────────────────────────────────────────

function renderLoading() {
    const tbody = document.getElementById('estoqueTableBody');
    if (tbody) tbody.innerHTML = `
        <tr><td colspan="10" style="text-align:center;padding:2rem;color:var(--text-secondary);">
            <div style="display:flex;align-items:center;justify-content:center;gap:0.75rem;">
                <div class="loader" style="width:24px;height:24px;border-width:3px;"></div>
                Carregando...
            </div>
        </td></tr>`;
}

function renderTable() {
    const tbody = document.getElementById('estoqueTableBody');
    if (!tbody) return;

    if (!state.produtos.length) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;">Nenhum produto encontrado</td></tr>';
        return;
    }

    tbody.innerHTML = state.produtos.map(p => `
        <tr>
            <td><strong>${p.codigo}</strong></td>
            <td>${p.marca}</td>
            <td>${p.codigo_fornecedor}</td>
            <td>${p.ncm || '-'}</td>
            <td>${p.descricao}</td>
            <td>${p.unidade || 'UN'}</td>
            <td><strong>${p.quantidade}</strong></td>
            <td>R$ ${parseFloat(p.valor_unitario).toFixed(2)}</td>
            <td><strong>R$ ${(p.quantidade * parseFloat(p.valor_unitario)).toFixed(2)}</strong></td>
            <td class="actions-cell">
                <button onclick="viewProduct('${p.id}')"        class="action-btn view">Ver</button>
                <button onclick="editProduct('${p.id}')"        class="action-btn edit">Editar</button>
                <button onclick="openEntradaModal('${p.id}')"   class="action-btn success">Entrada</button>
                <button onclick="openSaidaModal('${p.id}')"     class="action-btn delete">Saída</button>
            </td>
        </tr>`).join('');
}

// ─── PAGINAÇÃO ────────────────────────────────────────────────────────────────

function renderPaginacao() {
    document.getElementById('paginacaoContainer')?.remove();

    const tableCard = document.querySelector('.table-card');
    if (!tableCard) return;

    const total = state.totalPages;
    const atual = state.currentPage;
    const inicio = state.totalRecords === 0 ? 0 : (atual - 1) * PAGE_SIZE + 1;
    const fim    = Math.min(atual * PAGE_SIZE, state.totalRecords);

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
            : `<button class="pag-btn ${p === atual ? 'pag-btn-active' : ''}"
                       onclick="loadProducts(${p})">${p}</button>`
    ).join('');

    const div = document.createElement('div');
    div.id        = 'paginacaoContainer';
    div.className = 'paginacao-wrapper';
    div.innerHTML = `
        <div class="paginacao-info">
            ${state.totalRecords > 0
                ? `Exibindo ${inicio}–${fim} de ${state.totalRecords} registros`
                : 'Nenhum registro'}
        </div>
        <div class="paginacao-btns">
            <button class="pag-btn pag-nav" onclick="loadProducts(${atual - 1})"
                    ${atual === 1 ? 'disabled' : ''}>‹</button>
            ${botoesHTML}
            <button class="pag-btn pag-nav" onclick="loadProducts(${atual + 1})"
                    ${atual === total ? 'disabled' : ''}>›</button>
        </div>`;
    tableCard.appendChild(div);
}

// ─── SINCRONIZAÇÃO MANUAL ─────────────────────────────────────────────────────

window.sincronizarManual = async function() {
    if (!isOnline) { showMessage('Sistema offline', 'error'); return; }
    const btn = document.querySelector('.sync-btn');
    const svg = btn?.querySelector('svg');
    if (btn) btn.style.pointerEvents = 'none';
    if (svg) svg.style.animation = 'spin 1s linear infinite';
    try {
        await carregarTudo();
        showMessage('Dados atualizados', 'success');
    } finally {
        if (btn) btn.style.pointerEvents = 'auto';
        if (svg) svg.style.animation = 'none';
    }
};

// ─── FORMULÁRIO PRODUTO ───────────────────────────────────────────────────────

window.switchTab = function(tabName) {
    document.querySelectorAll('.tab-button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.querySelector(`[onclick="switchTab('${tabName}')"]`).classList.add('active');
    document.getElementById(`tab-${tabName}`).classList.add('active');
};

window.toggleForm = function() {
    editingProductId = null;
    document.getElementById('formTitle').textContent = 'Novo Produto';
    document.getElementById('productForm').reset();
    document.getElementById('grupo').closest('.form-group').style.display    = 'block';
    document.getElementById('quantidade').closest('.form-group').style.display = 'block';
    switchTab('fornecedor');
    document.getElementById('formModal').classList.add('show');
};

window.closeFormModal = function(cancelado = false) {
    document.getElementById('formModal').classList.remove('show');
    if (cancelado) showMessage(editingProductId ? 'Atualização cancelada' : 'Cadastro cancelado', 'error');
    editingProductId = null;
};

window.editProduct = function(id) {
    const p = state.produtos.find(p => p.id === id);
    if (!p) return;

    editingProductId = id;
    document.getElementById('formTitle').textContent              = 'Editar Produto';
    document.getElementById('codigo_fornecedor').value            = p.codigo_fornecedor;
    document.getElementById('ncm').value                          = p.ncm || '';
    document.getElementById('marca').value                        = p.marca;
    document.getElementById('descricao').value                    = p.descricao;
    document.getElementById('unidade').value                      = p.unidade || 'UN';
    document.getElementById('valor_unitario').value               = parseFloat(p.valor_unitario).toFixed(2);
    document.getElementById('grupo').closest('.form-group').style.display    = 'none';
    document.getElementById('quantidade').closest('.form-group').style.display = 'none';

    switchTab('fornecedor');
    document.getElementById('formModal').classList.add('show');
};

window.saveProduct = async function(event) {
    event.preventDefault();

    const formData = {
        codigo_fornecedor: document.getElementById('codigo_fornecedor').value.trim(),
        ncm:               document.getElementById('ncm').value.trim(),
        marca:             document.getElementById('marca').value.trim(),
        descricao:         document.getElementById('descricao').value.trim(),
        unidade:           document.getElementById('unidade').value,
        valor_unitario:    parseFloat(document.getElementById('valor_unitario').value)
    };

    if (!editingProductId) {
        const grupoRaw = document.getElementById('grupo').value;
        if (!grupoRaw) { showMessage('Selecione um grupo', 'error'); switchTab('produto'); return; }
        const grupoObj       = JSON.parse(grupoRaw);
        formData.grupo_codigo = grupoObj.codigo;
        formData.grupo_nome   = grupoObj.nome;
        formData.quantidade   = parseInt(document.getElementById('quantidade').value);
    }

    try {
        const url    = editingProductId ? `${API_URL}/estoque/${editingProductId}` : `${API_URL}/estoque`;
        const method = editingProductId ? 'PUT' : 'POST';

        const res = await fetchWithTimeout(url, {
            method,
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify(formData)
        }, 15000);

        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Erro ao salvar');
        }

        const saved = await res.json();
        closeFormModal(false);
        showMessage(editingProductId
            ? `Produto ${saved.codigo} atualizado`
            : `Produto ${saved.codigo} cadastrado`, 'success');

        // Garante grupo nos filtros após cadastro
        if (!editingProductId && !state.grupos.find(g => g.codigo === saved.grupo_codigo)) {
            state.grupos.push({ codigo: saved.grupo_codigo, nome: saved.grupo_nome });
            state.grupos.sort((a, b) => a.codigo - b.codigo);
            renderGruposFilter();
            populateGrupoSelect();
        }

        loadProducts(editingProductId ? state.currentPage : 1);
    } catch (error) { showMessage(error.message, 'error'); }
};

// ─── VISUALIZAÇÃO ─────────────────────────────────────────────────────────────

window.viewProduct = function(id) {
    const p = state.produtos.find(p => p.id === id);
    if (!p) return;

    document.getElementById('viewDetails').innerHTML = `
        <div class="view-detail-item">
            <div class="view-detail-label">Código</div>
            <div class="view-detail-value">${p.codigo}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Grupo</div>
            <div class="view-detail-value">${p.grupo_nome}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Marca</div>
            <div class="view-detail-value">${p.marca}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Modelo (Cód. Fornecedor)</div>
            <div class="view-detail-value">${p.codigo_fornecedor}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">NCM</div>
            <div class="view-detail-value">${p.ncm || '-'}</div>
        </div>
        <div class="view-detail-item" style="grid-column:1/-1;">
            <div class="view-detail-label">Descrição</div>
            <div class="view-detail-value">${p.descricao}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Unidade</div>
            <div class="view-detail-value">${p.unidade || 'UN'}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Quantidade</div>
            <div class="view-detail-value">${p.quantidade}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Valor Unitário</div>
            <div class="view-detail-value">R$ ${parseFloat(p.valor_unitario).toFixed(2)}</div>
        </div>
        <div class="view-detail-item">
            <div class="view-detail-label">Valor Total</div>
            <div class="view-detail-value">
                R$ ${(p.quantidade * parseFloat(p.valor_unitario)).toFixed(2)}
            </div>
        </div>`;
    document.getElementById('viewModal').classList.add('show');
};

window.closeViewModal = function() {
    document.getElementById('viewModal').classList.remove('show');
};

// ─── ENTRADA ──────────────────────────────────────────────────────────────────

let entradaProductId = null;

window.openEntradaModal = function(id) {
    const p = state.produtos.find(p => p.id === id);
    if (!p) return;
    entradaProductId = id;
    document.getElementById('entradaProduto').textContent         = `${p.codigo} - ${p.codigo_fornecedor}`;
    document.getElementById('entradaQuantidadeAtual').textContent = p.quantidade;
    document.getElementById('entradaQuantidade').value            = '';
    document.getElementById('entradaModal').classList.add('show');
};

window.closeEntradaModal = function() {
    document.getElementById('entradaModal').classList.remove('show');
    entradaProductId = null;
};

window.processarEntrada = async function(event) {
    event.preventDefault();
    const quantidade = parseInt(document.getElementById('entradaQuantidade').value);
    if (quantidade <= 0) { showMessage('Quantidade inválida', 'error'); return; }

    try {
        const res = await fetchWithTimeout(`${API_URL}/estoque/${entradaProductId}/entrada`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify({ quantidade })
        }, 15000);

        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Erro'); }

        const produto = await res.json();
        closeEntradaModal();
        showMessage(`Entrada de ${quantidade} para o item ${produto.codigo}`, 'success');
        loadProducts(state.currentPage, false);
    } catch (error) { showMessage(error.message, 'error'); }
};

// ─── SAÍDA ────────────────────────────────────────────────────────────────────

let saidaProductId = null;

window.openSaidaModal = function(id) {
    const p = state.produtos.find(p => p.id === id);
    if (!p) return;
    saidaProductId = id;
    document.getElementById('saidaProduto').textContent         = `${p.codigo} - ${p.codigo_fornecedor}`;
    document.getElementById('saidaQuantidadeAtual').textContent = p.quantidade;
    document.getElementById('saidaQuantidade').value            = '';
    document.getElementById('saidaModal').classList.add('show');
};

window.closeSaidaModal = function() {
    document.getElementById('saidaModal').classList.remove('show');
    saidaProductId = null;
};

window.processarSaida = async function(event) {
    event.preventDefault();
    const quantidade = parseInt(document.getElementById('saidaQuantidade').value);
    if (quantidade <= 0) { showMessage('Quantidade inválida', 'error'); return; }

    try {
        const res = await fetchWithTimeout(`${API_URL}/estoque/${saidaProductId}/saida`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify({ quantidade })
        }, 15000);

        if (!res.ok) { const e = await res.json(); throw new Error(e.error || 'Erro'); }

        const produto = await res.json();
        closeSaidaModal();
        showMessage(`Saída de ${quantidade} do item ${produto.codigo}`, 'error');
        loadProducts(state.currentPage, false);
    } catch (error) { showMessage(error.message, 'error'); }
};

// ─── PDF ──────────────────────────────────────────────────────────────────────

window.generateInventoryPDF = async function() {
    if (!state.produtos.length) { showMessage('Nenhum produto para gerar relatório', 'error'); return; }

    // Buscar todos os produtos sem filtro para inventário completo
    let todosProdutos = state.produtos;
    if (state.grupoCodigo !== null || state.searchTerm) {
        try {
            const res = await fetchWithTimeout(`${API_URL}/estoque?page=1&limit=9999`, { method: 'GET', headers: getHeaders() });
            if (res.ok) {
                const result = await res.json();
                todosProdutos = result.data || state.produtos;
            }
        } catch(e) { todosProdutos = state.produtos; }
    }

    const { jsPDF } = window.jspdf;
    const doc        = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageWidth  = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin     = 14;
    const tableWidth = pageWidth - margin * 2;
    const footerMargin = 12;

    // ── Formatar valor ────────────────────────────────────────────────────────
    const fmtValor = (v) => 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2
    });

    // ── Cabeçalho: logo + nome empresa (idêntico ao PDF de referência) ─────────
    function adicionarCabecalho() {
        return new Promise((resolve) => {
            const headerY = 3;
            const logoX   = 5;
            const logoW   = 40;

            const img = new Image();
            img.onload = () => {
                const logoH    = (img.height / img.width) * logoW;

                // Logo com opacidade 0.3 — igual ao PDF de referência
                doc.setGState(new doc.GState({ opacity: 0.3 }));
                doc.addImage(img, 'PNG', logoX, headerY, logoW, logoH);
                doc.setGState(new doc.GState({ opacity: 1.0 }));

                // Tamanho de fonte derivado da altura do logo — igual ao PDF de referência
                const fontSize    = logoH * 0.5;
                const lineSpacing = fontSize * 0.5;
                const textX       = logoX + logoW + 1.2;
                const textY1      = headerY + fontSize * 0.85;
                const textY2      = textY1 + lineSpacing;

                doc.setFontSize(fontSize);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(150, 150, 150);
                doc.text('I.R COMÉRCIO E',           textX, textY1);
                doc.text('MATERIAIS ELÉTRICOS LTDA', textX, textY2);

                // Reset
                doc.setTextColor(0, 0, 0);
                doc.setFontSize(10);
                doc.setFont(undefined, 'normal');
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.2);

                resolve(headerY + logoH + 8);
            };
            img.onerror = () => {
                // Fallback: só texto cinza
                doc.setFontSize(11);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(150, 150, 150);
                doc.text('I.R COMÉRCIO E MATERIAIS ELÉTRICOS LTDA', logoX + logoW + 1.2, headerY + 10);
                doc.setTextColor(0, 0, 0);
                doc.setFont(undefined, 'normal');
                resolve(headerY + 18 + 8);
            };
            img.src = 'I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
        });
    }

    async function addPageWithHeader() {
        doc.addPage();
        return await adicionarCabecalho();
    }

    function paginaCheia(yAtual, espaco = 30) {
        return yAtual > pageHeight - footerMargin - espaco;
    }

    // ── Colunas da tabela ─────────────────────────────────────────────────────
    // As larguras são absolutas em mm para garantir alinhamento perfeito
    const col = {
        codigo:    tableWidth * 0.07,
        marca:     tableWidth * 0.11,
        modelo:    tableWidth * 0.11,
        ncm:       tableWidth * 0.09,
        descricao: tableWidth * 0.27,
        unidade:   tableWidth * 0.05,
        qtd:       tableWidth * 0.06,
        vunit:     tableWidth * 0.12,
        vtotal:    tableWidth * 0.12
    };
    // Calcular posição X absoluta de cada coluna (evita acúmulo de arredondamento)
    const colX = {};
    let _xAcc = margin;
    for (const [k, w] of Object.entries(col)) { colX[k] = _xAcc; _xAcc += w; }

    const rowH    = 8;   // altura padrão de linha
    const textVOff= 5.2; // offset vertical do texto dentro da linha (baseline)
    const fs      = 7.5; // font size da tabela

    // ── Cabeçalho da tabela ───────────────────────────────────────────────────
    function desenharCabecalhoTabela(y) {
        doc.setFillColor(108, 117, 125);
        doc.setDrawColor(108, 117, 125);
        doc.rect(margin, y, tableWidth, rowH, 'FD');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(fs);
        doc.setFont(undefined, 'bold');

        const defs = [
            ['CÓD.',      'codigo',   'center'],
            ['MARCA',     'marca',    'left'  ],
            ['MODELO',    'modelo',   'left'  ],
            ['NCM',       'ncm',      'center'],
            ['DESCRIÇÃO', 'descricao','left'  ],
            ['UN',        'unidade',  'center'],
            ['QTD',       'qtd',      'right' ],
            ['V. UNIT.',  'vunit',    'right' ],
            ['V. TOTAL',  'vtotal',   'right' ],
        ];
        defs.forEach(([lbl, key, align]) => {
            const x = colX[key];
            const w = col[key];
            if (align === 'center') doc.text(lbl, x + w / 2, y + textVOff, { align: 'center' });
            else if (align === 'right') doc.text(lbl, x + w - 1.5, y + textVOff, { align: 'right' });
            else doc.text(lbl, x + 1.5, y + textVOff);
            // linha divisória vertical
            doc.setDrawColor(180, 180, 180);
            doc.line(x, y, x, y + rowH);
        });
        // última borda direita
        doc.line(margin + tableWidth, y, margin + tableWidth, y + rowH);
        // bordas horizontais superior e inferior
        doc.setDrawColor(108, 117, 125);
        doc.line(margin, y, margin + tableWidth, y);
        doc.line(margin, y + rowH, margin + tableWidth, y + rowH);

        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'normal');
        return y + rowH;
    }

    // ── Linha de produto ──────────────────────────────────────────────────────
    function desenharLinhaItem(p, y, rowIndex) {
        const descLines  = doc.splitTextToSize(p.descricao  || '-', col.descricao - 3);
        const marcaLines = doc.splitTextToSize(p.marca      || '-', col.marca     - 3);
        const modLines   = doc.splitTextToSize(p.codigo_fornecedor || '-', col.modelo - 3);
        const nLines     = Math.max(descLines.length, marcaLines.length, modLines.length, 1);
        const lineH4text = 3.5;
        const h          = Math.max(rowH, nLines * lineH4text + 3);

        // Fundo zebra
        if (rowIndex % 2 === 0) {
            doc.setFillColor(248, 248, 248);
            doc.rect(margin, y, tableWidth, h, 'F');
        }

        doc.setFontSize(fs);
        doc.setFont(undefined, 'normal');
        doc.setTextColor(30, 30, 30);

        // Baseline vertical centrada para campos de 1 linha
        const cy = y + h / 2 + lineH4text / 2;

        // CÓD — centro
        doc.text(String(p.codigo || ''), colX.codigo + col.codigo / 2, cy, { align: 'center' });

        // MARCA — esquerda, wrap
        doc.setFontSize(fs);
        marcaLines.forEach((l, i) => {
            const ly = y + 2.5 + i * lineH4text;
            doc.text(l, colX.marca + 1.5, ly + lineH4text);
        });

        // MODELO — esquerda, wrap
        modLines.forEach((l, i) => {
            const ly = y + 2.5 + i * lineH4text;
            doc.text(l, colX.modelo + 1.5, ly + lineH4text);
        });

        // NCM — centro
        doc.text(p.ncm || '-', colX.ncm + col.ncm / 2, cy, { align: 'center' });

        // DESCRIÇÃO — esquerda, wrap
        descLines.forEach((l, i) => {
            const ly = y + 2.5 + i * lineH4text;
            doc.text(l, colX.descricao + 1.5, ly + lineH4text);
        });

        // UN — centro
        doc.text(p.unidade || 'UN', colX.unidade + col.unidade / 2, cy, { align: 'center' });

        // QTD — direita
        doc.text(String(p.quantidade || 0), colX.qtd + col.qtd - 1.5, cy, { align: 'right' });

        // V. UNIT — direita
        doc.text(fmtValor(p.valor_unitario), colX.vunit + col.vunit - 1.5, cy, { align: 'right' });

        // V. TOTAL — direita
        const vt = (p.quantidade || 0) * parseFloat(p.valor_unitario || 0);
        doc.text(fmtValor(vt), colX.vtotal + col.vtotal - 1.5, cy, { align: 'right' });

        // Bordas verticais das colunas
        doc.setDrawColor(210, 210, 210);
        doc.setLineWidth(0.1);
        for (const key of Object.keys(col)) {
            doc.line(colX[key], y, colX[key], y + h);
        }
        doc.line(margin + tableWidth, y, margin + tableWidth, y + h);

        // Borda horizontal inferior
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.line(margin, y + h, margin + tableWidth, y + h);

        return y + h;
    }

    // ── Total do grupo — flutuante à esquerda ─────────────────────────────────
    function desenharTotalGrupo(y, valorTotal) {
        y += 6;   // espaço generoso entre a última linha da tabela e o total
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0, 0, 0);
        const label = 'VALOR TOTAL:';
        doc.text(label, margin, y);
        doc.setFont(undefined, 'normal');
        doc.text(' ' + fmtValor(valorTotal), margin + doc.getTextWidth(label), y);
        doc.setFont(undefined, 'normal');
        return y + 7;   // espaço após o total antes do próximo grupo
    }

    // ══════════════════════════════════════════════════════════════════════════
    // GERAÇÃO
    // ══════════════════════════════════════════════════════════════════════════
    let y = await adicionarCabecalho();

    // Título
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('INVENTÁRIO DE ESTOQUE', pageWidth / 2, y, { align: 'center' });
    y += 6;

    // Data/hora de emissão
    const agora       = new Date();
    const dataEmissao = agora.toLocaleDateString('pt-BR');
    const horaEmissao = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    doc.setFontSize(9);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`Emitido em: ${dataEmissao} às ${horaEmissao}`, pageWidth / 2, y, { align: 'center' });
    y += 8;
    doc.setTextColor(0, 0, 0);

    // Agrupar produtos
    const porGrupo = {};
    todosProdutos.forEach(p => {
        const g = p.grupo_nome || 'SEM GRUPO';
        if (!porGrupo[g]) porGrupo[g] = [];
        porGrupo[g].push(p);
    });

    let valorTotalGeral = 0;

    for (const grupoNome of Object.keys(porGrupo).sort()) {
        const prods = porGrupo[grupoNome].sort((a, b) => (a.codigo || 0) - (b.codigo || 0));

        if (paginaCheia(y, rowH * 3 + 20)) { y = await addPageWithHeader(); }

        // Nome do grupo
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(255, 82, 29);
        doc.text(grupoNome.toUpperCase(), margin, y);
        doc.setTextColor(0, 0, 0);
        y += 5;

        // Cabeçalho da tabela
        y = desenharCabecalhoTabela(y);

        // Linhas de produtos
        for (let idx = 0; idx < prods.length; idx++) {
            const p = prods[idx];
            const dl = doc.splitTextToSize(p.descricao || '-', col.descricao - 3);
            const ml = doc.splitTextToSize(p.marca || '-', col.marca - 3);
            const ol = doc.splitTextToSize(p.codigo_fornecedor || '-', col.modelo - 3);
            const nL = Math.max(dl.length, ml.length, ol.length, 1);
            const h  = Math.max(rowH, nL * 3.5 + 3);

            if (paginaCheia(y, h + 12)) {
                y = await addPageWithHeader();
                y = desenharCabecalhoTabela(y);
            }
            y = desenharLinhaItem(p, y, idx);
        }

        // Total do grupo — à esquerda, logo abaixo da tabela
        const valorGrupo = prods.reduce((s, p) => s + (p.quantidade || 0) * parseFloat(p.valor_unitario || 0), 0);
        valorTotalGeral += valorGrupo;

        if (paginaCheia(y, 12)) { y = await addPageWithHeader(); }
        y = desenharTotalGrupo(y, valorGrupo);
        y += 6;
    }

    // ── TOTAL ESTOQUE — ao final de todas as tabelas ──────────────────────────
    if (paginaCheia(y, 14)) { y = await addPageWithHeader(); }

    // Linha separadora antes do total geral
    doc.setDrawColor(180, 180, 180);
    doc.setLineWidth(0.5);
    doc.line(margin, y, margin + tableWidth, y);
    y += 5;

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    const labelTotal = 'TOTAL ESTOQUE:';
    const valorTotal = '  ' + fmtValor(valorTotalGeral);
    doc.text(labelTotal, margin, y);
    doc.setFont(undefined, 'normal');
    doc.text(valorTotal, margin + doc.getTextWidth(labelTotal), y);

    const dateStr = agora.toISOString().split('T')[0];
    doc.save(`Inventario_Estoque_${dateStr}.pdf`);
    showMessage('Inventário PDF gerado com sucesso!', 'success');
};

// ─── UTILS ────────────────────────────────────────────────────────────────────

function showMessage(message, type = 'success') {
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
