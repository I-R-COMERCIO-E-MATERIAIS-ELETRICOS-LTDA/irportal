// ============================================
// COTAÇÕES DE FRETE - script.js
// ============================================
const PORTAL_URL = window.location.origin;
const API_URL = `${window.location.origin}/api`;

let cotacoes = [];
let isOnline = false;
let editingId = null;
let sessionToken = null;
let currentUser = null;
let currentMonth = new Date();
let transportadorasCache = [];
let currentFetchController = null;
let pendingDeleteId = null;
const infoTabs = ['info-tab-geral', 'info-tab-transportadora', 'info-tab-detalhes'];
let currentInfoTabIndex = 0;

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

async function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('cotacoesSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('cotacoesSession');
    }
    if (!sessionToken) { mostrarTelaAcessoNegado(); return; }
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
                sessionStorage.setItem('cotacoesUserData', JSON.stringify(currentUser));
            } else {
                mostrarTelaAcessoNegado('Sua sessão expirou');
                return;
            }
        }
    } catch (e) {
        try {
            const userData = sessionStorage.getItem('cotacoesUserData');
            if (userData) currentUser = JSON.parse(userData);
        } catch (e2) {}
    }
    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;"><h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1><p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p><a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Ir para o Portal</a></div>`;
}

function inicializarApp() {
    updateDisplay();
    loadTransportadorasCache();
    loadCotacoes();
    setInterval(() => { if (isOnline) loadCotacoes(); }, 30000);
}

function showMessage(message, type = 'success') {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => { div.style.animation = 'slideOutBottom 0.3s ease forwards'; setTimeout(() => div.remove(), 300); }, 2000);
}
function formatarMoeda(valor) { const num = parseFloat(valor) || 0; return 'R$ ' + num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
function formatarData(data) { if (!data) return '-'; if (typeof data === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(data)) return data; const d = new Date(data); if (isNaN(d.getTime())) return data; return d.toLocaleDateString('pt-BR'); }
function getDataAtual() { const hoje = new Date(); return `${String(hoje.getDate()).padStart(2,'0')}/${String(hoje.getMonth()+1).padStart(2,'0')}/${hoje.getFullYear()}`; }

async function syncData() {
    const btn = document.getElementById('syncBtn');
    if (btn) { btn.classList.add('syncing'); btn.disabled = true; }
    try { await loadTransportadorasCache(); await loadCotacoes(); showMessage('Dados sincronizados', 'success'); }
    catch (e) { showMessage('Erro ao sincronizar', 'error'); }
    finally { if (btn) { btn.classList.remove('syncing'); btn.disabled = false; } }
}

function changeMonth(direction) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);
    updateDisplay();
    loadCotacoes();
}
function updateDisplay() { updateMonthDisplay(); renderTable(); updateDashboard(); }
function updateMonthDisplay() {
    const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${months[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
}

async function loadTransportadorasCache() {
    try {
        const response = await fetch(`${API_URL}/transportadoras?limit=200`, { headers: { 'X-Session-Token': sessionToken } });
        if (!response.ok) return;
        const data = await response.json();
        const lista = Array.isArray(data) ? data : (data.data || []);
        transportadorasCache = lista.map(t => t.nome.trim().toUpperCase()).filter(Boolean).sort();
        updateTransportadoraSelects();
    } catch (e) { console.error('Erro ao carregar transportadoras:', e); }
}
function updateTransportadoraSelects() {
    const selFilter = document.getElementById('filterTransportadora');
    if (selFilter) {
        const current = selFilter.value;
        selFilter.innerHTML = '<option value="">Transportadora</option>' + transportadorasCache.map(n => `<option value="${n}">${n}</option>`).join('');
        if (current) selFilter.value = current;
    }
    const selForm = document.getElementById('transportadora');
    if (selForm) {
        const current = selForm.value;
        selForm.innerHTML = '<option value="">Selecione...</option>' + transportadorasCache.map(n => `<option value="${n}">${n}</option>`).join('');
        if (current) selForm.value = current;
    }
}

async function loadCotacoes() {
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;
    const mes = currentMonth.getMonth();
    const ano = currentMonth.getFullYear();
    try {
        const response = await fetch(`${API_URL}/cotacoes?mes=${mes}&ano=${ano}`, { headers: { 'X-Session-Token': sessionToken }, cache: 'no-cache', signal });
        if (response.status === 401) { sessionStorage.removeItem('cotacoesSession'); mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU'); return; }
        if (!response.ok) { isOnline = false; setTimeout(() => loadCotacoes(), 5000); return; }
        cotacoes = await response.json();
        isOnline = true;
        currentFetchController = null;
        updateDisplay();
        updateResponsavelSelect();
    } catch (e) { if (e.name === 'AbortError') return; isOnline = false; setTimeout(() => loadCotacoes(), 5000); }
}

function updateDashboard() {
    const total = cotacoes.length;
    const aprovadas = cotacoes.filter(c => c.negocioFechado === true).length;
    const reprovadas = cotacoes.filter(c => c.negocioFechado === false).length;
    if (document.getElementById('totalCotacoes')) document.getElementById('totalCotacoes').textContent = total;
    if (document.getElementById('totalAprovadas')) document.getElementById('totalAprovadas').textContent = aprovadas;
    if (document.getElementById('totalReprovadas')) document.getElementById('totalReprovadas').textContent = reprovadas;
}
function filterCotacoes() { renderTable(); }
function updateResponsavelSelect() {
    const responsaveis = new Set();
    cotacoes.forEach(c => { if (c.responsavel?.trim()) responsaveis.add(c.responsavel.trim()); });
    const sel = document.getElementById('filterResponsavel');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = '<option value="">Responsável</option>' + Array.from(responsaveis).sort().map(r => `<option value="${r}">${r}</option>`).join('');
    sel.value = current;
}

function renderTable() {
    const container = document.getElementById('cotacoesContainer');
    if (!container) return;
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const filterTransp = document.getElementById('filterTransportadora')?.value || '';
    const filterResp = document.getElementById('filterResponsavel')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    let filtered = [...cotacoes];
    if (search) { filtered = filtered.filter(c => (c.transportadora || '').toLowerCase().includes(search) || (c.destino || '').toLowerCase().includes(search) || (c.documento || '').toLowerCase().includes(search) || (c.numeroCotacao || '').toLowerCase().includes(search) || (c.responsavel || '').toLowerCase().includes(search)); }
    if (filterTransp) filtered = filtered.filter(c => c.transportadora === filterTransp);
    if (filterResp) filtered = filtered.filter(c => c.responsavel === filterResp);
    if (filterStatus === 'aprovada') filtered = filtered.filter(c => c.negocioFechado === true);
    if (filterStatus === 'reprovada') filtered = filtered.filter(c => c.negocioFechado === false);
    if (filtered.length === 0) { if (currentFetchController) return; container.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:2rem;">Nenhuma cotação encontrada</td></tr>`; return; }
    container.innerHTML = filtered.map(c => {
        const aprovada = c.negocioFechado === true;
        const reprovada = c.negocioFechado === false;
        const statusClass = aprovada ? 'fechada' : (reprovada ? 'aberta' : '');
        const statusText  = aprovada ? 'APROVADA' : (reprovada ? 'REPROVADA' : 'PENDENTE');
        return `<tr data-id="${c.id}" class="${aprovada ? 'row-fechada' : ''}" style="cursor:pointer;" onclick="viewCotacao(${c.id})"><td style="text-align:center;"><div class="checkbox-wrapper"><input type="checkbox" class="styled-checkbox" id="check-${c.id}" ${aprovada ? 'checked' : ''} onchange="toggleStatus(${c.id}, this.checked)" onclick="event.stopPropagation()"><label for="check-${c.id}" class="checkbox-label-styled" onclick="event.stopPropagation()"></label></div></td><td>${formatarData(c.dataCotacao)}</td><td><strong>${c.transportadora || '-'}</strong></td><td>${c.destino || '-'}</td><td style="max-width:120px;word-break:break-word;white-space:normal;">${c.documento || c.numeroCotacao || '-'}</td><td>${c.valorFrete ? formatarMoeda(c.valorFrete) : '-'}</td><td><span class="badge ${statusClass}">${statusText}</span></td><td onclick="event.stopPropagation()"><div class="actions" style="display:flex;gap:6px;justify-content:center;"><button onclick="editCotacao(${c.id})" class="action-btn" style="background:#6B7280;margin:0;">Editar</button><button onclick="showDeleteModal(${c.id})" class="action-btn" style="background:#EF4444;margin:0;">Excluir</button></div></td></tr>`;
    }).join('');
}

async function toggleStatus(id, checked) {
    const cotacao = cotacoes.find(c => c.id === id);
    if (!cotacao) return;
    const nomeTransportadora = cotacao.transportadora || 'Cotação';
    try {
        const response = await fetch(`${API_URL}/cotacoes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: JSON.stringify({ negocioFechado: checked }) });
        if (!response.ok) throw new Error('Erro');
        await loadCotacoes();
        const msg = checked ? `${nomeTransportadora} aprovada` : `${nomeTransportadora} reprovada`;
        const tipo = checked ? 'success' : 'error';
        showMessage(msg, tipo);
    } catch (e) { showMessage('Erro ao atualizar status!', 'error'); const cb = document.getElementById(`check-${id}`); if (cb) cb.checked = !checked; }
}

function showDeleteModal(id) {
    pendingDeleteId = id;
    document.getElementById('deleteModal').classList.add('show');
    const confirmBtn = document.getElementById('confirmDeleteBtn');
    confirmBtn.className = 'danger';
    const cancelBtn = document.querySelector('#deleteModal .modal-actions-no-border button:last-child');
    if (cancelBtn) cancelBtn.className = 'success';
    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    newConfirmBtn.onclick = () => confirmDelete();
}
function closeDeleteModal() { document.getElementById('deleteModal').classList.remove('show'); pendingDeleteId = null; }
async function confirmDelete() {
    if (!pendingDeleteId) return;
    try {
        const response = await fetch(`${API_URL}/cotacoes/${pendingDeleteId}`, { method: 'DELETE', headers: { 'X-Session-Token': sessionToken } });
        if (!response.ok) throw new Error('Erro');
        await loadCotacoes();
        showMessage('Cotação excluída', 'success');
        closeDeleteModal();
    } catch (e) { showMessage('Erro ao excluir cotação!', 'error'); closeDeleteModal(); }
}

function openFormModal() {
    editingId = null;
    document.getElementById('formTitle').textContent = 'Nova Cotação';
    const saveBtn = document.getElementById('btnFormSave'); if (saveBtn) saveBtn.textContent = 'Salvar';
    resetForm();
    document.getElementById('dataCotacao').value = getDataAtual();
    updateTransportadoraSelects();
    document.getElementById('formModal').classList.add('show');
    switchFormTab('form-tab-geral');
}
function closeFormModal() { document.getElementById('formModal').classList.remove('show'); resetForm(); }
function resetForm() { document.querySelectorAll('#formModal input, #formModal select, #formModal textarea').forEach(el => { if (el.type === 'checkbox') el.checked = false; else el.value = ''; }); }

function editCotacao(id) {
    const c = cotacoes.find(x => x.id === id);
    if (!c) return;
    editingId = id;
    document.getElementById('formTitle').textContent = `Editar Cotação`;
    const saveBtn = document.getElementById('btnFormSave'); if (saveBtn) saveBtn.textContent = 'Atualizar';
    resetForm();
    updateTransportadoraSelects();
    document.getElementById('dataCotacao').value = c.dataCotacao || '';
    document.getElementById('transportadora').value = c.transportadora || '';
    document.getElementById('destino').value = c.destino || '';
    document.getElementById('documento').value = c.documento || '';
    document.getElementById('numeroCotacao').value = c.numeroCotacao || '';
    document.getElementById('valorFrete').value = c.valorFrete || '';
    document.getElementById('previsaoEntrega').value = c.previsaoEntrega || '';
    document.getElementById('responsavel').value = c.responsavel || '';
    document.getElementById('vendedor').value = c.vendedor || '';
    document.getElementById('responsavelTransportadora').value = c.responsavelTransportadora || '';
    document.getElementById('canalComunicacao').value = c.canalComunicacao || '';
    document.getElementById('codigoColeta').value = c.codigoColeta || '';
    document.getElementById('observacoes').value = c.observacoes || '';
    document.getElementById('formModal').classList.add('show');
    switchFormTab('form-tab-geral');
}

async function saveCotacao() {
    const transportadora = document.getElementById('transportadora').value.trim();
    const destino = document.getElementById('destino').value.trim();
    if (!transportadora) { showMessage('Selecione uma transportadora!', 'error'); return; }
    const payload = {
        dataCotacao: document.getElementById('dataCotacao').value,
        transportadora,
        destino,
        documento: document.getElementById('documento').value.trim(),
        numeroCotacao: document.getElementById('numeroCotacao').value.trim(),
        valorFrete: parseFloat(document.getElementById('valorFrete').value) || null,
        previsaoEntrega: document.getElementById('previsaoEntrega').value,
        responsavel: document.getElementById('responsavel').value.trim(),
        vendedor: document.getElementById('vendedor').value.trim(),
        responsavelTransportadora: document.getElementById('responsavelTransportadora').value.trim(),
        canalComunicacao: document.getElementById('canalComunicacao').value.trim(),
        codigoColeta: document.getElementById('codigoColeta').value.trim(),
        observacoes: document.getElementById('observacoes').value.trim()
    };
    try {
        const url = editingId ? `${API_URL}/cotacoes/${editingId}` : `${API_URL}/cotacoes`;
        const method = editingId ? 'PUT' : 'POST';
        const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: JSON.stringify(payload) });
        if (!response.ok) throw new Error('Erro ao salvar');
        await loadCotacoes();
        closeFormModal();
        const msg = editingId ? 'Cotação atualizada' : 'Cotação registrada';
        showMessage(msg, 'success');
    } catch (e) { showMessage('Erro ao salvar cotação!', 'error'); }
}

// Navegação de abas (formulário)
const formTabs = ['form-tab-geral', 'form-tab-transportadora', 'form-tab-detalhes'];
let currentFormTabIndex = 0;
function switchFormTab(tabId) {
    document.querySelectorAll('#formModal .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#formModal .tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    currentFormTabIndex = formTabs.indexOf(tabId);
    const btn = Array.from(document.querySelectorAll('#formModal .tab-btn')).find(b => b.getAttribute('onclick')?.includes(tabId));
    if (btn) btn.classList.add('active');
    updateFormNavButtons();
}
function nextFormTab() { if (currentFormTabIndex < formTabs.length - 1) switchFormTab(formTabs[currentFormTabIndex + 1]); }
function previousFormTab() { if (currentFormTabIndex > 0) switchFormTab(formTabs[currentFormTabIndex - 1]); }
function updateFormNavButtons() {
    const btnPrev = document.getElementById('btnFormPrevious');
    const btnNext = document.getElementById('btnFormNext');
    const btnSave = document.getElementById('btnFormSave');
    if (btnPrev) btnPrev.style.display = currentFormTabIndex === 0 ? 'none' : 'inline-block';
    if (btnNext) btnNext.style.display = currentFormTabIndex === formTabs.length - 1 ? 'none' : 'inline-block';
    if (btnSave) btnSave.style.display = 'inline-block';
}

// Modal de visualização
function viewCotacao(id) {
    const c = cotacoes.find(x => x.id === id);
    if (!c) return;
    document.getElementById('modalDocumento').textContent = c.documento || c.numeroCotacao || `#${id}`;
    const aprovada = c.negocioFechado === true;
    const reprovada = c.negocioFechado === false;
    const statusClass = aprovada ? 'fechada' : (reprovada ? 'aberta' : '');
    const statusText  = aprovada ? 'APROVADA' : (reprovada ? 'REPROVADA' : 'PENDENTE');
    document.getElementById('info-tab-geral').innerHTML = `<div class="info-section"><h4>Informações Gerais</h4><div class="info-row"><span class="info-label">Data:</span><span class="info-value">${formatarData(c.dataCotacao)}</span></div><div class="info-row"><span class="info-label">Documento:</span><span class="info-value">${c.documento || '-'}</span></div><div class="info-row"><span class="info-label">Nº Cotação:</span><span class="info-value">${c.numeroCotacao || '-'}</span></div><div class="info-row"><span class="info-label">Destino:</span><span class="info-value">${c.destino || '-'}</span></div><div class="info-row"><span class="info-label">Responsável:</span><span class="info-value">${c.responsavel || '-'}</span></div><div class="info-row"><span class="info-label">Vendedor:</span><span class="info-value">${c.vendedor || '-'}</span></div><div class="info-row"><span class="info-label">Status:</span><span class="badge ${statusClass}">${statusText}</span></div></div>`;
    document.getElementById('info-tab-transportadora').innerHTML = `<div class="info-section"><h4>Transportadora</h4><div class="info-row"><span class="info-label">Transportadora:</span><span class="info-value">${c.transportadora || '-'}</span></div><div class="info-row"><span class="info-label">Resp. Transp.:</span><span class="info-value">${c.responsavelTransportadora || '-'}</span></div><div class="info-row"><span class="info-label">Canal Comunicação:</span><span class="info-value">${c.canalComunicacao || '-'}</span></div><div class="info-row"><span class="info-label">Código Coleta:</span><span class="info-value">${c.codigoColeta || '-'}</span></div></div>`;
    document.getElementById('info-tab-detalhes').innerHTML = `<div class="info-section"><h4>Detalhes da Cotação</h4><div class="info-row"><span class="info-label">Valor do Frete:</span><span class="info-value">${c.valorFrete ? formatarMoeda(c.valorFrete) : '-'}</span></div><div class="info-row"><span class="info-label">Previsão Entrega:</span><span class="info-value">${c.previsaoEntrega ? formatarData(c.previsaoEntrega) : '-'}</span></div><div class="info-row"><span class="info-label">Observações:</span><span class="info-value">${c.observacoes || '-'}</span></div></div>`;
    currentInfoTabIndex = 0;
    switchInfoTab('info-tab-geral');
    document.getElementById('infoModal').classList.add('show');
}
function closeInfoModal() { document.getElementById('infoModal').classList.remove('show'); }
function switchInfoTab(tabId) {
    document.querySelectorAll('#infoModal .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#infoModal .tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');
    currentInfoTabIndex = infoTabs.indexOf(tabId);
    const btn = Array.from(document.querySelectorAll('#infoModal .tab-btn')).find(b => b.getAttribute('onclick')?.includes(tabId));
    if (btn) btn.classList.add('active');
    updateInfoNavButtons();
}
function nextInfoTab() { if (currentInfoTabIndex < infoTabs.length - 1) switchInfoTab(infoTabs[currentInfoTabIndex + 1]); }
function previousInfoTab() { if (currentInfoTabIndex > 0) switchInfoTab(infoTabs[currentInfoTabIndex - 1]); }
function updateInfoNavButtons() {
    const btnPrev = document.getElementById('btnInfoPrevious');
    const btnNext = document.getElementById('btnInfoNext');
    if (btnPrev) btnPrev.style.display = currentInfoTabIndex === 0 ? 'none' : 'inline-block';
    if (btnNext) btnNext.style.display = currentInfoTabIndex === infoTabs.length - 1 ? 'none' : 'inline-block';
}
