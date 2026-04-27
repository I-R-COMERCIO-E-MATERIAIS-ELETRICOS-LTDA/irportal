// ============================================
// CONFIGURAÇÃO
// ============================================
const DEVELOPMENT_MODE = false;
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let contas = [];
let isOnline = false;
let sessionToken = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let showAllMonths = false;
let _editingParcelasTemp = [];

const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

console.log('✅ Contas a Receber iniciado');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', () => {
    if (DEVELOPMENT_MODE) { sessionToken = 'dev-mode'; inicializarApp(); }
    else { verificarAutenticacao(); }
});

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) { sessionToken = tokenFromUrl; sessionStorage.setItem('receberSession', tokenFromUrl); window.history.replaceState({}, document.title, window.location.pathname); }
    else { sessionToken = sessionStorage.getItem('receberSession'); }
    if (!sessionToken) { mostrarTelaAcessoNegado(); return; }
    inicializarApp();
}
function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:var(--bg-primary);color:var(--text-primary);text-align:center;padding:2rem;"><h1 style="font-size:2.2rem;margin-bottom:1rem;">${mensagem}</h1><p style="color:var(--text-secondary);margin-bottom:2rem;">Somente usuários autenticados podem acessar esta área.</p><a href="${PORTAL_URL}" style="display:inline-block;background:var(--btn-register);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Ir para o Portal</a></div>`;
}
function inicializarApp() { updateMonthDisplay(); checkServerStatus(); setInterval(checkServerStatus, 15000); startPolling(); }

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/receber`, { method:'GET', headers:{ 'X-Session-Token': sessionToken, 'Accept':'application/json' }, mode:'cors' });
        if (!DEVELOPMENT_MODE && response.status === 401) { sessionStorage.removeItem('receberSession'); mostrarTelaAcessoNegado('Sua sessão expirou'); return false; }
        const wasOffline = !isOnline;
        isOnline = response.ok;
        if (wasOffline && isOnline) await loadContas();
        return isOnline;
    } catch (error) { isOnline = false; return false; }
}

async function loadContas(showMsg = false) { /* ... idêntico ... */ }
window.sincronizarDados = async function () { /* ... idêntico ... */ };
function startPolling() { loadContas(); setInterval(() => { if (isOnline) loadContas(); }, 15000); }

function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = showAllMonths ? `Todos — ${currentYear}` : `${meses[currentMonth]} ${currentYear}`;
    updateDashboard(); filterContas();
}
window.changeMonth = function (direction) { /* ... idêntico ... */ };
window.updateMonthDisplay = updateMonthDisplay;

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() { /* ... idêntico ... */ }
function isStatusPago(status) { return status === 'PAGO' || /parcela/i.test(status); }

// ============================================
// FILTROS E TABELA
// ============================================
function getContasFiltradas(applyMonthFilter = true) { /* ... idêntico ... */ }
function updateFilters() { /* ... idêntico ... */ }
window.filterContas = function () { /* ... idêntico ... */ };

function renderContas(lista) { /* ... idêntico ... */ }
function renderRow(c, hoje) { /* ... idêntico ... */ }
function getStatusBadge(conta, hoje) { /* ... idêntico ... */ }

function getParcelas(conta) { /* ... idêntico ... */ }
function getObservacoesTexto(conta) { /* ... idêntico ... */ }
function buildObservacoesJson(notas, parcelas) { return { notas: notas||[], parcelas: parcelas||[] }; }

// ============================================
// TOGGLE PAGAMENTO
// ============================================
window.togglePagamento = async function(id, checked) { /* ... idêntico ... */ };

// ============================================
// MODAL DE CONFIRMAÇÃO GENÉRICO (não usado mais para exclusão)
// ============================================
function showConfirm(message, options = {}) { /* ... mantido para reverter pagamento ... */ }

// ============================================
// MODAL DE EXCLUSÃO PERSONALIZADO (Sim=vermelho, Cancelar=verde)
// ============================================
function showDeleteConfirmation(message, onConfirm) {
    const modalHTML = `<div class="modal-overlay" id="customDeleteModal" style="display:flex!important;z-index:10001!important;"><div class="modal-content confirm-modal-content" style="max-width:450px!important;"><button class="close-modal" onclick="document.getElementById('customDeleteModal').remove()">✕</button><div class="confirm-modal-body"><h3 class="confirm-modal-title">${message}</h3></div><div class="modal-actions confirm-modal-actions"><button class="danger" id="customDeleteConfirmBtn">Sim</button><button class="success" id="customDeleteCancelBtn">Cancelar</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('customDeleteModal');
    const confirmBtn = document.getElementById('customDeleteConfirmBtn');
    const cancelBtn = document.getElementById('customDeleteCancelBtn');
    const closeBtn = modal.querySelector('.close-modal');
    const closeModal = () => modal.remove();
    confirmBtn.addEventListener('click', () => { closeModal(); onConfirm(); });
    cancelBtn.addEventListener('click', closeModal);
    closeBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
}

window.handleDeleteClick = async function(id) {
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return showToast('Conta não encontrada!', 'error');
    showDeleteConfirmation(`Excluir NF ${conta.numero_nf}?`, async () => {
        contas = contas.filter(x => String(x.id) !== String(id));
        filterContas();
        showToast(`NF ${conta.numero_nf} excluída`, 'error');
        if (isOnline || DEVELOPMENT_MODE) {
            try {
                const r = await fetch(`${API_URL}/receber/${id}`, { method:'DELETE', headers:{ 'X-Session-Token': sessionToken } });
                if (!r.ok) throw new Error('Erro no servidor');
            } catch { contas.push(conta); filterContas(); showToast('Erro ao excluir no servidor', 'error'); }
        }
    });
};

// ============================================
// CONFIRMAÇÃO DE PAGAMENTO (Sim=verde, Não=vermelho, Cancelar=cinza)
// ============================================
function showConfirmacaoPagamentoModal(id, conta) {
    document.getElementById('confirmPagModal')?.remove();
    const modalHTML = `<div class="modal-overlay" id="confirmPagModal" style="display:flex!important;z-index:10001!important;"><div class="modal-content confirm-modal-content" style="max-width:450px!important;"><button class="close-modal" id="confirmPagClose">✕</button><div class="confirm-modal-body"><h3 class="confirm-modal-title">O pagamento da NF ${conta.numero_nf} será parcelado?</h3></div><div class="modal-actions confirm-modal-actions"><button class="save" id="btnSim">Sim</button><button class="danger" id="btnNao">Não</button><button class="secondary" id="btnCancelar">Cancelar</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('confirmPagModal');
    const btnSim = document.getElementById('btnSim');
    const btnNao = document.getElementById('btnNao');
    const btnCancelar = document.getElementById('btnCancelar');
    const btnClose = document.getElementById('confirmPagClose');
    const fechar = () => modal && modal.remove();
    btnSim.addEventListener('click', () => { fechar(); showFormModal(id, true); });
    btnNao.addEventListener('click', () => { fechar(); confirmarPagamentoTotal(id); });
    btnCancelar.addEventListener('click', fechar);
    btnClose.addEventListener('click', fechar);
    modal.addEventListener('click', (e) => { if (e.target === modal) fechar(); });
}
window.confirmarPagamentoTotal = async function(id) { const conta = contas.find(x => String(x.id) === String(id)); if (!conta) return; showFormModalPagamentoIntegral(id, conta); };
window.showFormModalPagamentoIntegral = function(editingId, conta) { showFormModal(editingId, false, true); };

// ============================================
// AÇÕES DA TABELA
// ============================================
window.handleRowClick = function(event, id) { /* ... idêntico ... */ };
window.handleEditClick = function(id) { /* ... idêntico ... */ };

// ============================================
// MODAL DE VISUALIZAÇÃO (padrão similar a Ordem de Compra)
// ============================================
function showViewModal(c) {
    const hoje = new Date().toISOString().split('T')[0];
    const fmt  = v => v ? `R$ ${parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : '-';
    const d    = v => v ? formatDate(v) : '-';
    const parcelas = getParcelas(c);
    const notas    = getObservacoesTexto(c);
    const valorPagoTotal = parcelas.length > 0 ? parcelas.reduce((s,p) => s + parseFloat(p.valor||0), 0) : parseFloat(c.valor_pago||0);
    const statusBadge = getStatusBadge(c, hoje);

    const tabGeral = `<div class="info-section"><h4>Dados da Conta</h4><div class="info-row"><span class="info-label">Número NF:</span><span class="info-value">${c.numero_nf||'-'}</span></div><div class="info-row"><span class="info-label">Órgão:</span><span class="info-value">${c.orgao||'-'}</span></div><div class="info-row"><span class="info-label">Vendedor:</span><span class="info-value">${c.vendedor||'-'}</span></div><div class="info-row"><span class="info-label">Banco:</span><span class="info-value">${c.banco||'-'}</span></div><div class="info-row"><span class="info-label">Tipo NF:</span><span class="info-value">${c.tipo_nf||'-'}</span></div><div class="info-row"><span class="info-label">Status:</span><span class="info-value">${statusBadge}</span></div></div>`;
    const tabValores = `<div class="info-section"><h4>Valores e Datas</h4><div class="info-row"><span class="info-label">Valor NF:</span><span class="info-value">${fmt(c.valor)}</span></div><div class="info-row"><span class="info-label">Valor Pago Total:</span><span class="info-value">${valorPagoTotal>0?fmt(valorPagoTotal):'-'}</span></div><div class="info-row"><span class="info-label">Data Emissão:</span><span class="info-value">${d(c.data_emissao)}</span></div><div class="info-row"><span class="info-label">Vencimento:</span><span class="info-value">${d(c.data_vencimento)}</span></div><div class="info-row"><span class="info-label">Data Pagamento:</span><span class="info-value">${d(c.data_pagamento)}</span></div></div>`;
    let tabParcelas = `<div class="info-section"><h4>Pagamento Parcelado</h4>`;
    if (parcelas.length === 0) tabParcelas += `<p style="color:var(--text-secondary);font-style:italic;">Nenhuma parcela registrada.</p>`;
    else { tabParcelas += `<table style="width:100%;margin-top:.5rem;"><thead><tr><th>Parcela</th><th>Valor</th><th>Data Pagamento</th></tr></thead><tbody>`; parcelas.forEach((p,i) => { tabParcelas += `<tr><td>${p.numero||(i+1)+'ª'}</td><td>R$ ${parseFloat(p.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td><td>${p.data?formatDate(p.data):'-'}</td></tr>`; }); tabParcelas += `</tbody></table>`; }
    tabParcelas += `</div>`;
    let tabObs = `<div class="info-section"><h4>Observações</h4>`;
    if (notas.length === 0) tabObs += `<p style="color:var(--text-secondary);font-style:italic;">Nenhuma observação registrada.</p>`;
    else { tabObs += `<div class="observacoes-list-view">`; notas.forEach(n => { tabObs += `<div class="observacao-item-view"><div class="observacao-header"><span class="observacao-data">${n.data||''}</span></div><p class="observacao-texto">${n.texto||''}</p></div>`; }); tabObs += `</div>`; }
    tabObs += `</div>`;

    const html = `<div class="modal-overlay show" id="viewModal"><div class="modal-content"><div class="modal-header"><h3 class="modal-title">NF ${c.numero_nf||''}</h3><button class="close-modal" onclick="document.getElementById('viewModal').remove()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn active" onclick="switchViewTab('vtab-geral',this)">Geral</button><button class="tab-btn" onclick="switchViewTab('vtab-valores',this)">Valores e Datas</button><button class="tab-btn" onclick="switchViewTab('vtab-parcelas',this)">Pagamento Parcelado</button><button class="tab-btn" onclick="switchViewTab('vtab-obs',this)">Observações</button></div><div id="vtab-geral" class="tab-content active">${tabGeral}</div><div id="vtab-valores" class="tab-content">${tabValores}</div><div id="vtab-parcelas" class="tab-content">${tabParcelas}</div><div id="vtab-obs" class="tab-content">${tabObs}</div></div><div class="modal-actions"><button type="button" id="viewPrev" class="secondary" onclick="navigateViewTab(-1)" style="display:none;">Anterior</button><button type="button" id="viewNext" class="secondary" onclick="navigateViewTab(1)">Próximo</button><button type="button" class="cancel-close" onclick="document.getElementById('viewModal').remove()">Fechar</button></div></div></div>`;
    document.getElementById('viewModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    updateViewNavButtons();
}

window.switchViewTab = function(tabId, btn) {
    const modal = document.getElementById('viewModal');
    modal.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
    updateViewNavButtons();
};

function getCurrentViewTabIndex() { const active = document.querySelector('#viewModal .tab-content.active'); if (!active) return 0; const tabs = ['vtab-geral','vtab-valores','vtab-parcelas','vtab-obs']; return tabs.indexOf(active.id); }
function updateViewNavButtons() { const idx = getCurrentViewTabIndex(); const prev = document.getElementById('viewPrev'); const next = document.getElementById('viewNext'); if (prev) prev.style.display = idx === 0 ? 'none' : 'inline-flex'; if (next) next.style.display = idx === 3 ? 'none' : 'inline-flex'; }
window.navigateViewTab = function(direction) { const tabs = ['vtab-geral','vtab-valores','vtab-parcelas','vtab-obs']; const currentIdx = getCurrentViewTabIndex(); const newIdx = currentIdx + direction; if (newIdx < 0 || newIdx >= tabs.length) return; const newTabId = tabs[newIdx]; const btn = document.querySelector(`#viewModal .tab-btn:nth-child(${newIdx+1})`); switchViewTab(newTabId, btn); };

// ============================================
// MODAL DE FORMULÁRIO
// ============================================
window.toggleForm = function() { showFormModal(null); };
window.showFormModal = function(editingId = null, focusPagamento = false, focusValores = false) {
    const isEditing = editingId !== null;
    const c = isEditing ? contas.find(x => String(x.id) === String(editingId)) : null;
    const notas = c ? getObservacoesTexto(c) : [];
    const parcelas = c ? getParcelas(c) : [];
    _editingParcelasTemp = JSON.parse(JSON.stringify(parcelas));
    const valorPagoAtual = _editingParcelasTemp.length > 0 ? _editingParcelasTemp.reduce((s,p) => s + parseFloat(p.valor||0), 0) : parseFloat(c?.valor_pago||0);
    let dataPgAtual = c?.data_pagamento || '';
    if (_editingParcelasTemp.length > 0) { const datas = _editingParcelasTemp.map(p => p.data).filter(Boolean).sort(); if (datas.length > 0) dataPgAtual = datas[datas.length-1]; }
    const activeTab = focusPagamento ? 2 : (focusValores ? 1 : 0);
    const tabActive = (idx) => activeTab === idx ? 'active' : '';
    const html = `<div class="modal-overlay show" id="formModal"><div class="modal-content"><div class="modal-header"><h3 class="modal-title">${isEditing?'Editar Conta':'Nova Conta a Receber'}</h3><button class="close-modal" onclick="closeFormModal()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn ${tabActive(0)}" onclick="switchFormTab('ftab-geral',this)">Geral</button><button class="tab-btn ${tabActive(1)}" onclick="switchFormTab('ftab-valores',this)">Valores e Datas</button><button class="tab-btn ${tabActive(2)}" onclick="switchFormTab('ftab-parcelas',this)">Pagamento Parcelado</button><button class="tab-btn ${tabActive(3)}" onclick="switchFormTab('ftab-obs',this)">Observações</button></div><div id="ftab-geral" class="tab-content ${tabActive(0)}"><div class="form-grid"><div class="form-group"><label>Número NF *</label><input type="text" id="f_numero_nf" value="${c?.numero_nf||''}" required></div><div class="form-group"><label>Órgão *</label><input type="text" id="f_orgao" value="${c?.orgao||''}" required></div><div class="form-group"><label>Vendedor *</label><select id="f_vendedor"><option value="">Selecione...</option><option value="ROBERTO" ${c?.vendedor==='ROBERTO'?'selected':''}>ROBERTO</option><option value="ISAQUE" ${c?.vendedor==='ISAQUE'?'selected':''}>ISAQUE</option><option value="MIGUEL" ${c?.vendedor==='MIGUEL'?'selected':''}>MIGUEL</option></select></div><div class="form-group"><label>Banco</label><input type="text" id="f_banco" value="${c?.banco||''}"></div><div class="form-group"><label>Tipo NF</label><select id="f_tipo_nf"><option value="ENVIO" ${(!c||c.tipo_nf==='ENVIO')?'selected':''}>Envio</option><option value="CANCELADA" ${c?.tipo_nf==='CANCELADA'?'selected':''}>Cancelada</option><option value="REMESSA DE AMOSTRA" ${c?.tipo_nf==='REMESSA DE AMOSTRA'?'selected':''}>Remessa de Amostra</option><option value="SIMPLES REMESSA" ${c?.tipo_nf==='SIMPLES REMESSA'?'selected':''}>Simples Remessa</option><option value="DEVOLUÇÃO" ${c?.tipo_nf==='DEVOLUÇÃO'?'selected':''}>Devolução</option></select></div><div class="form-group"><label>Status</label><select id="f_status"><option value="A RECEBER" ${(!c||c.status==='A RECEBER')?'selected':''}>A Receber</option><option value="PAGO" ${c?.status==='PAGO'?'selected':''}>Pago</option></select></div></div></div><div id="ftab-valores" class="tab-content ${tabActive(1)}"><div class="form-grid"><div class="form-group"><label>Valor NF (R$)</label><input type="number" id="f_valor" step="0.01" min="0" value="${c?.valor||''}"></div><div class="form-group"><label>Valor Pago Total (R$)</label><input type="number" id="f_valor_pago" step="0.01" min="0" value="${valorPagoAtual>0?valorPagoAtual.toFixed(2):(c?.valor_pago||'')}"></div><div class="form-group"><label>Data Emissão *</label><input type="date" id="f_data_emissao" value="${c?.data_emissao||''}" required></div><div class="form-group"><label>Vencimento</label><input type="date" id="f_data_vencimento" value="${c?.data_vencimento||''}"></div><div class="form-group"><label>Data Pagamento</label><input type="date" id="f_data_pagamento" value="${dataPgAtual}"></div></div></div><div id="ftab-parcelas" class="tab-content ${tabActive(2)}"><div style="margin-bottom:1rem;"><button type="button" class="btn-add-obs" onclick="adicionarParcelaForm()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Adicionar Parcela</button></div><div id="parcelasFormList"></div></div><div id="ftab-obs" class="tab-content ${tabActive(3)}"><div class="observacoes-section"><div class="observacoes-list" id="obsFormList">${notas.map((n,i) => `<div class="observacao-item" id="obs-form-${i}"><div class="observacao-header"><span class="observacao-data">${n.data||''}</span><button type="button" class="btn-remove-obs" onclick="removerObsForm(${i})">✕</button></div><p class="observacao-texto">${n.texto||''}</p></div>`).join('')}</div><div class="nova-observacao"><h4>Nova Observação</h4><textarea id="novaObsInput" placeholder="Digite uma observação..."></textarea><button type="button" class="btn-add-obs" onclick="adicionarObsForm()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Adicionar Observação</button></div></div></div></div><div class="modal-actions"><button type="button" id="btnFormPrev" class="secondary" onclick="navFormTab(-1)" style="display:none;">Anterior</button><button type="button" id="btnFormNext" class="secondary" onclick="navFormTab(1)">Próximo</button><button type="button" id="btnFormSave" class="save" onclick="handleSubmitForm('${editingId||''}')">${isEditing?'Atualizar':'Salvar'}</button><button type="button" class="cancel-close" onclick="closeFormModal()">Cancelar</button></div></div></div>`;
    document.getElementById('formModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    ['f_numero_nf','f_orgao','f_banco'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', e => { const s = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); e.target.setSelectionRange(s, s); }); });
    renderParcelasForm();
    window._formTabIndex = activeTab;
    updateFormNavState();
};
const FORM_TABS = ['ftab-geral','ftab-valores','ftab-parcelas','ftab-obs'];
window.switchFormTab = function(tabId, btn) { const modal = document.getElementById('formModal'); if (!modal) return; modal.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active')); modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active')); document.getElementById(tabId)?.classList.add('active'); btn?.classList.add('active'); window._formTabIndex = FORM_TABS.indexOf(tabId); updateFormNavState(); };
window.navFormTab = function(dir) { const idx = (window._formTabIndex || 0) + dir; if (idx < 0 || idx >= FORM_TABS.length) return; const tabId = FORM_TABS[idx]; const btn = document.querySelector(`#formModal .tab-btn:nth-child(${idx+1})`); switchFormTab(tabId, btn); };
function updateFormNavState() { const idx = window._formTabIndex || 0; const prev = document.getElementById('btnFormPrev'); const next = document.getElementById('btnFormNext'); const save = document.getElementById('btnFormSave'); if (prev) prev.style.display = idx === 0 ? 'none' : 'inline-flex'; if (next) next.style.display = idx === FORM_TABS.length-1 ? 'none' : 'inline-flex'; if (save) save.style.display = 'inline-flex'; }
window.closeFormModal = function() { const modal = document.getElementById('formModal'); if (modal) modal.remove(); _editingParcelasTemp = []; };

// ============================================
// PARCELAS, OBSERVAÇÕES, SUBMIT (mantidos)
// ============================================
// ... todo o código restante idêntico ao anterior, sem necessidade de alterações ...
function renderParcelasForm() { /* ... idêntico ... */ }
window.adicionarParcelaForm = function() { /* ... idêntico ... */ };
window.removerParcelaForm = function(i) { /* ... idêntico ... */ };
function atualizarValorPagoForm() { /* ... idêntico ... */ }
document.addEventListener('change', function(e) { if (e.target.id === 'f_valor_pago' || e.target.id === 'f_data_pagamento') e.target.dataset.manualEdit = '1'; });
window.adicionarObsForm = function() { /* ... idêntico ... */ };
window.removerObsForm = function(i) { /* ... idêntico ... */ };
function obterNotasForm() { /* ... idêntico ... */ }
function renderObsForm(notas) { /* ... idêntico ... */ }
window.handleSubmitForm = async function(editId) { /* ... idêntico ... */ };
async function salvarConta(id, data, silencioso = false) { /* ... idêntico ... */ }

// ============================================
// MODAL DE VENCIDOS (com paginação)
// ============================================
let vencidosModalPage = 1; const VENCIDOS_PAGE_SIZE = 4; let vencidosModalData = [];
window.showVencidosModal = function() { /* ... idêntico ... */ };
function renderVencidosModalPage() { /* ... idêntico ... */ }
window.changeVencidosPage = function(direction) { /* ... idêntico ... */ };
window.closeVencidosModal = function() { /* ... idêntico ... */ };

// ============================================
// UTILITÁRIOS
// ============================================
function formatDate(d) { if (!d) return '-'; return new Date(d+'T00:00:00').toLocaleDateString('pt-BR'); }
function showToast(message, type) { /* ... idêntico ... */ }
console.log('✅ Script contas a receber carregado com sucesso!');
