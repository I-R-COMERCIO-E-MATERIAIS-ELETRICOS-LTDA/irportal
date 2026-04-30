// ============================================
// CONTAS A RECEBER - SCRIPT COMPLETO
// ============================================
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let contas = [];
let isOnline = false;
let sessionToken = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let showAllMonths = false;
let _editingParcelasTemp = [];

const meses = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const SPECIAL_STATUS = ['DEVOLUCAO', 'DEVOLVIDA', 'SIMPLES REMESSA', 'REMESSA DE AMOSTRA', 'CANCELADA'];

function normalizarTexto(str) {
    if (!str) return '';
    return str.trim().toUpperCase().replace(/_/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function isContaEspecial(conta) {
    const s = normalizarTexto(conta.status || '');
    const t = normalizarTexto(conta.tipo_nf || '');
    return SPECIAL_STATUS.some(sp => s === sp || t === sp);
}

function getStatusDinamico(conta) {
    if (isContaEspecial(conta)) {
        return conta.status && conta.status !== 'A RECEBER' ? conta.status : (conta.tipo_nf || 'ESPECIAL');
    }
    if (conta.status === 'PAGO') return 'PAGO';
    const hoje = new Date().toISOString().split('T')[0];
    if (conta.data_vencimento && conta.data_vencimento < hoje) return 'VENCIDO';
    return 'A RECEBER';
}

function getStatusBadge(conta) {
    const status = getStatusDinamico(conta);
    if (isContaEspecial(conta)) {
        return `<span class="badge status-especial">${status}</span>`;
    }
    const map = {
        'PAGO': { class: 'status-pago', text: 'PAGO' },
        'VENCIDO': { class: 'status-vencido', text: 'VENCIDO' },
        'A RECEBER': { class: 'status-a-receber', text: 'A RECEBER' }
    };
    const s = map[status] || { class: 'status-a-receber', text: status };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('receberSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('receberSession');
    }
    if (!sessionToken) {
        document.body.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;flex-direction:column;"><h1>Não autorizado</h1><a href="${PORTAL_URL}">Ir para o Portal</a></div>`;
        return;
    }
    inicializarApp();
});

async function inicializarApp() {
    updateMonthDisplay();
    await checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/receber`, { headers: { 'X-Session-Token': sessionToken } });
        isOnline = response.ok;
        if (isOnline) await loadContas();
    } catch { isOnline = false; }
}

async function loadContas() {
    try {
        const response = await fetch(`${API_URL}/receber`, { headers: { 'X-Session-Token': sessionToken } });
        if (!response.ok) throw new Error();
        contas = await response.json();
        updateFilters();
        updateDashboard();
        filterContas();
    } catch (error) { console.error('Erro ao carregar contas:', error); }
}

function startPolling() { loadContas(); setInterval(() => { if (isOnline) loadContas(); }, 15000); }

function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = showAllMonths ? `Todos — ${currentYear}` : `${meses[currentMonth]} ${currentYear}`;
    updateDashboard();
    filterContas();
}

window.changeMonth = function(direction) {
    showAllMonths = false;
    let m = currentMonth + direction;
    let y = currentYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0) { m = 11; y--; }
    currentMonth = m;
    currentYear = y;
    updateMonthDisplay();
};

function updateDashboard() {
    const hoje = new Date().toISOString().split('T')[0];
    const vencido = contas.filter(c => c.status === 'A RECEBER' && !isContaEspecial(c) && c.data_vencimento && c.data_vencimento < hoje).length;
    const filtered = getContasFiltradas();
    const pago = filtered.filter(c => c.status === 'PAGO').reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const receber = filtered.filter(c => c.status === 'A RECEBER' && !isContaEspecial(c)).reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const faturado = pago + receber;
    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('statPago').textContent = fmt(pago);
    document.getElementById('statReceber').textContent = fmt(receber);
    document.getElementById('statFaturado').textContent = fmt(faturado);
    document.getElementById('statVencido').textContent = vencido;
    document.getElementById('cardVencido').classList.toggle('has-alert', vencido > 0);
    document.getElementById('pulseBadgeVencido').style.display = vencido > 0 ? 'flex' : 'none';
}

function getContasFiltradas() {
    return contas.filter(c => {
        if (!c.data_emissao) return false;
        if (showAllMonths) return new Date(c.data_emissao + 'T00:00:00').getFullYear() === currentYear;
        const d = new Date(c.data_emissao + 'T00:00:00');
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
}

function updateFilters() {
    const vendedores = [...new Set(contas.map(c => c.vendedor).filter(Boolean))];
    const bancos = [...new Set(contas.map(c => c.banco).filter(Boolean))];
    const selVend = document.getElementById('filterVendedor');
    if (selVend) {
        const cur = selVend.value;
        selVend.innerHTML = '<option value="">Todos Vendedores</option>';
        vendedores.sort().forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; selVend.appendChild(o); });
        selVend.value = cur;
    }
    const selBanco = document.getElementById('filterBanco');
    if (selBanco) {
        const cur = selBanco.value;
        selBanco.innerHTML = '<option value="">Todos Bancos</option>';
        bancos.sort().forEach(b => { const o = document.createElement('option'); o.value = b; o.textContent = b; selBanco.appendChild(o); });
        selBanco.value = cur;
    }
}

window.filterContas = function() {
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const vendedor = document.getElementById('filterVendedor')?.value || '';
    const banco = document.getElementById('filterBanco')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    let filtered = getContasFiltradas();
    if (vendedor) filtered = filtered.filter(c => c.vendedor === vendedor);
    if (banco) filtered = filtered.filter(c => c.banco === banco);
    if (status) filtered = filtered.filter(c => c.status === status);
    if (search) filtered = filtered.filter(c => [c.numero_nf, c.orgao, c.vendedor, c.banco, c.status].some(f => f && f.toLowerCase().includes(search)));
    filtered.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderContas(filtered);
    updateDashboard();
};

function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if (!container) return;
    if (!lista.length) { container.innerHTML = '<div style="text-align:center;padding:2rem;">Nenhuma conta encontrada</div>'; return; }
    const hoje = new Date().toISOString().split('T')[0];
    container.innerHTML = `<div style="overflow-x:auto;"><table><thead><tr><th style="width:50px;">✓</th><th>NF</th><th>Órgão</th><th>Vendedor</th><th>Banco</th><th>Valor</th><th>Valor Pago</th><th>Vencimento</th><th>Dt. Pagamento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${lista.map(c => renderRow(c, hoje)).join('')}</tbody></table></div>`;
}

function renderRow(c, hoje) {
    const isPago = c.status === 'PAGO';
    const valorPago = parseFloat(c.valor_pago) || 0;
    const dataPgto = c.data_pagamento ? formatDate(c.data_pagamento) : '-';
    const statusBadge = getStatusBadge(c);
    const rowClass = isPago ? 'row-pago' : '';
    return `<tr class="${rowClass} row-clickable" data-id="${c.id}" onclick="handleRowClick(event, '${c.id}')">
        <td style="text-align:center;"><div class="checkbox-wrapper"><input type="checkbox" class="styled-checkbox" id="chk-${c.id}" ${isPago?'checked':''} onchange="togglePagamento('${c.id}', this.checked)" onclick="event.stopPropagation()"><label for="chk-${c.id}" class="checkbox-label-styled"></label></div></td>
        <td><strong>${c.numero_nf||'-'}</strong></td>
        <td>${c.orgao||'-'}</td>
        <td>${c.vendedor||'-'}</td>
        <td>${c.banco||'-'}</td>
        <td><strong>R$ ${parseFloat(c.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></td>
        <td>${valorPago>0?`R$ ${valorPago.toLocaleString('pt-BR',{minimumFractionDigits:2})}`:'-'}</td>
        <td>${c.data_vencimento?formatDate(c.data_vencimento):'-'}</td>
        <td>${dataPgto}</td>
        <td>${statusBadge}</td>
        <td class="actions-cell"><button class="action-btn edit" onclick="event.stopPropagation();handleEditClick('${c.id}')">Editar</button><button class="action-btn delete" onclick="event.stopPropagation();handleDeleteClick('${c.id}')">Excluir</button></td>
    </tr>`;
}

function handleRowClick(event, id) {
    if (event.target.tagName === 'BUTTON' || event.target.closest('button')) return;
    const conta = contas.find(x => String(x.id) === String(id));
    if (conta) showViewModal(conta);
}

function handleEditClick(id) { showFormModal(id); }
function handleDeleteClick(id) { showDeleteConfirmation(id); }

function showViewModal(conta) {
    const fmt = v => v ? `R$ ${parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : '-';
    const d = v => v ? formatDate(v) : '-';
    const statusBadge = getStatusBadge(conta);
    const html = `<div class="modal-overlay show" id="viewModal"><div class="modal-content"><div class="modal-header"><h3>NF ${conta.numero_nf}</h3><button class="close-modal" onclick="document.getElementById('viewModal').remove()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn active" onclick="switchViewTab('vtab-geral',this)">Geral</button><button class="tab-btn" onclick="switchViewTab('vtab-valores',this)">Valores</button></div><div id="vtab-geral" class="tab-content active"><div class="info-row"><span class="info-label">Órgão:</span><span class="info-value">${conta.orgao||'-'}</span></div><div class="info-row"><span class="info-label">Vendedor:</span><span class="info-value">${conta.vendedor||'-'}</span></div><div class="info-row"><span class="info-label">Banco:</span><span class="info-value">${conta.banco||'-'}</span></div><div class="info-row"><span class="info-label">Tipo NF:</span><span class="info-value">${conta.tipo_nf||'-'}</span></div><div class="info-row"><span class="info-label">Status:</span><span class="info-value">${statusBadge}</span></div></div><div id="vtab-valores" class="tab-content"><div class="info-row"><span class="info-label">Valor NF:</span><span class="info-value">${fmt(conta.valor)}</span></div><div class="info-row"><span class="info-label">Valor Pago:</span><span class="info-value">${fmt(conta.valor_pago)}</span></div><div class="info-row"><span class="info-label">Emissão:</span><span class="info-value">${d(conta.data_emissao)}</span></div><div class="info-row"><span class="info-label">Vencimento:</span><span class="info-value">${d(conta.data_vencimento)}</span></div><div class="info-row"><span class="info-label">Pagamento:</span><span class="info-value">${d(conta.data_pagamento)}</span></div></div></div><div class="modal-actions"><button class="secondary" onclick="document.getElementById('viewModal').remove()">Fechar</button></div></div></div>`;
    document.getElementById('viewModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
}

function switchViewTab(tabId, btn) {
    document.querySelectorAll('#viewModal .tab-content').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('#viewModal .tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
}

// ============================================
// FORMULÁRIO DE CRIAÇÃO/EDIÇÃO (com parcelas)
// ============================================
window.showFormModal = async function(editingId = null, focusPagamento = false, focusValores = false) {
    const isEditing = editingId !== null;
    let c = null;
    let parcelasTemp = [];
    if (isEditing) {
        c = contas.find(x => String(x.id) === String(editingId));
        if (!c) { showToast('Conta não encontrada!', 'error'); return; }
        parcelasTemp = c.parcelas ? [...c.parcelas] : [];
    }
    _editingParcelasTemp = parcelasTemp.map(p => ({ ...p }));

    const valorPagoAtual = _editingParcelasTemp.reduce((s,p) => s + parseFloat(p.valor||0), 0);
    let dataPgAtual = c?.data_pagamento || '';
    if (_editingParcelasTemp.length > 0) {
        const datas = _editingParcelasTemp.map(p => p.data_pagamento).filter(Boolean).sort();
        if (datas.length > 0) dataPgAtual = datas[datas.length-1];
    }
    const activeTab = focusPagamento ? 2 : (focusValores ? 1 : 0);
    const tabActive = (idx) => activeTab === idx ? 'active' : '';

    const html = `<div class="modal-overlay show" id="formModal"><div class="modal-content"><div class="modal-header"><h3>${isEditing?'Editar Conta':'Nova Conta a Receber'}</h3><button class="close-modal" onclick="closeFormModal()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn ${tabActive(0)}" onclick="switchFormTab('ftab-geral',this)">Geral</button><button class="tab-btn ${tabActive(1)}" onclick="switchFormTab('ftab-valores',this)">Valores</button><button class="tab-btn ${tabActive(2)}" onclick="switchFormTab('ftab-parcelas',this)">Parcelas</button></div>
    <div id="ftab-geral" class="tab-content ${tabActive(0)}"><div class="form-grid"><div class="form-group"><label>Número NF *</label><input type="text" id="f_numero_nf" value="${c?.numero_nf||''}" required></div><div class="form-group"><label>Órgão *</label><input type="text" id="f_orgao" value="${c?.orgao||''}" required></div><div class="form-group"><label>Vendedor *</label><select id="f_vendedor"><option value="">Selecione...</option><option value="ROBERTO" ${c?.vendedor==='ROBERTO'?'selected':''}>ROBERTO</option><option value="ISAQUE" ${c?.vendedor==='ISAQUE'?'selected':''}>ISAQUE</option><option value="MIGUEL" ${c?.vendedor==='MIGUEL'?'selected':''}>MIGUEL</option></select></div><div class="form-group"><label>Banco</label><input type="text" id="f_banco" value="${c?.banco||''}"></div><div class="form-group"><label>Tipo NF</label><select id="f_tipo_nf"><option value="ENVIO" ${(!c||c.tipo_nf==='ENVIO')?'selected':''}>Envio</option><option value="CANCELADA" ${c?.tipo_nf==='CANCELADA'?'selected':''}>Cancelada</option><option value="REMESSA DE AMOSTRA" ${c?.tipo_nf==='REMESSA DE AMOSTRA'?'selected':''}>Remessa de Amostra</option><option value="SIMPLES REMESSA" ${c?.tipo_nf==='SIMPLES REMESSA'?'selected':''}>Simples Remessa</option><option value="DEVOLUÇÃO" ${c?.tipo_nf==='DEVOLUÇÃO'?'selected':''}>Devolução</option></select></div><div class="form-group"><label>Status</label><select id="f_status"><option value="A RECEBER" ${(!c||c.status==='A RECEBER')?'selected':''}>A Receber</option><option value="PAGO" ${c?.status==='PAGO'?'selected':''}>Pago</option></select></div></div></div>
    <div id="ftab-valores" class="tab-content ${tabActive(1)}"><div class="form-grid"><div class="form-group"><label>Valor NF (R$)</label><input type="number" id="f_valor" step="0.01" min="0" value="${c?.valor||''}"></div><div class="form-group"><label>Valor Pago Total (R$)</label><input type="number" id="f_valor_pago" step="0.01" min="0" value="${valorPagoAtual>0?valorPagoAtual.toFixed(2):''}" onchange="atualizarValorPagoForm()"></div><div class="form-group"><label>Data Emissão *</label><input type="date" id="f_data_emissao" value="${c?.data_emissao||''}" required></div><div class="form-group"><label>Vencimento</label><input type="date" id="f_data_vencimento" value="${c?.data_vencimento||''}"></div><div class="form-group"><label>Data Pagamento</label><input type="date" id="f_data_pagamento" value="${dataPgAtual}"></div></div></div>
    <div id="ftab-parcelas" class="tab-content ${tabActive(2)}"><div style="margin-bottom:1rem;"><button type="button" class="btn-add-obs" onclick="adicionarParcelaForm()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Adicionar Parcela</button></div><div id="parcelasFormList"></div></div>
    </div><div class="modal-actions"><button type="button" id="btnFormPrev" class="secondary" onclick="navFormTab(-1)" style="display:none;">Anterior</button><button type="button" id="btnFormNext" class="secondary" onclick="navFormTab(1)">Próximo</button><button type="button" id="btnFormSave" class="save" onclick="handleSubmitForm('${editingId||''}')">${isEditing?'Atualizar':'Salvar'}</button><button type="button" class="secondary" onclick="closeFormModal()">Cancelar</button></div></div></div>`;

    document.getElementById('formModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
    ['f_numero_nf','f_orgao','f_banco'].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener('input', e => { const s = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); e.target.setSelectionRange(s, s); }); });
    renderParcelasForm();
    window._formTabIndex = activeTab;
    updateFormNavState();
};

const FORM_TABS = ['ftab-geral','ftab-valores','ftab-parcelas'];
function switchFormTab(tabId, btn) {
    document.getElementById('formModal').querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById('formModal').querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
    window._formTabIndex = FORM_TABS.indexOf(tabId);
    updateFormNavState();
}
function navFormTab(dir) { const idx = (window._formTabIndex || 0) + dir; if (idx < 0 || idx >= FORM_TABS.length) return; const tabId = FORM_TABS[idx]; const btn = document.querySelector(`#formModal .tab-btn:nth-child(${idx+1})`); switchFormTab(tabId, btn); }
function updateFormNavState() { const idx = window._formTabIndex || 0; const prev = document.getElementById('btnFormPrev'); const next = document.getElementById('btnFormNext'); if (prev) prev.style.display = idx === 0 ? 'none' : 'inline-flex'; if (next) next.style.display = idx === FORM_TABS.length-1 ? 'none' : 'inline-flex'; }
window.closeFormModal = function() { document.getElementById('formModal')?.remove(); _editingParcelasTemp = []; };

function renderParcelasForm() {
    const container = document.getElementById('parcelasFormList');
    if (!container) return;
    if (_editingParcelasTemp.length === 0) { container.innerHTML = `<p style="color:var(--text-secondary);font-style:italic;">Nenhuma parcela adicionada.</p>`; return; }
    container.innerHTML = _editingParcelasTemp.map((p,i) => `<div class="observacao-item"><div class="observacao-header"><span>${p.numero}ª Parcela</span><button type="button" class="btn-remove-obs" onclick="removerParcelaForm(${i})">✕</button></div><div class="form-grid" style="margin-top:.5rem;"><div class="form-group"><label>Valor (R$)</label><input type="number" step="0.01" min="0" value="${p.valor||''}" onchange="_editingParcelasTemp[${i}].valor = parseFloat(this.value)||0; atualizarValorPagoForm();"></div><div class="form-group"><label>Data Pagamento</label><input type="date" value="${p.data_pagamento||''}" onchange="_editingParcelasTemp[${i}].data_pagamento = this.value; atualizarValorPagoForm();"></div></div></div>`).join('');
}
function adicionarParcelaForm() { const novoNumero = _editingParcelasTemp.length + 1; _editingParcelasTemp.push({ numero: novoNumero, valor: 0, data_pagamento: '' }); renderParcelasForm(); atualizarValorPagoForm(); }
function removerParcelaForm(i) { _editingParcelasTemp.splice(i,1); _editingParcelasTemp.forEach((p,idx) => p.numero = idx+1); renderParcelasForm(); atualizarValorPagoForm(); }
function atualizarValorPagoForm() { const total = _editingParcelasTemp.reduce((s,p) => s + parseFloat(p.valor||0), 0); const elVP = document.getElementById('f_valor_pago'); if (elVP && !elVP.dataset.manualEdit) elVP.value = total > 0 ? total.toFixed(2) : ''; const datas = _editingParcelasTemp.map(p => p.data_pagamento).filter(Boolean).sort(); const elData = document.getElementById('f_data_pagamento'); if (elData && !elData.dataset.manualEdit) elData.value = datas.length > 0 ? datas[datas.length-1] : ''; }
document.addEventListener('change', function(e) { if (e.target.id === 'f_valor_pago' || e.target.id === 'f_data_pagamento') e.target.dataset.manualEdit = '1'; });

window.handleSubmitForm = async function(editId) {
    const numero_nf = document.getElementById('f_numero_nf')?.value.trim();
    const orgao = document.getElementById('f_orgao')?.value.trim();
    const vendedor = document.getElementById('f_vendedor')?.value;
    const banco = document.getElementById('f_banco')?.value.trim() || null;
    const tipo_nf = document.getElementById('f_tipo_nf')?.value;
    const valor = parseFloat(document.getElementById('f_valor')?.value) || 0;
    const data_emissao = document.getElementById('f_data_emissao')?.value;
    const data_vencimento = document.getElementById('f_data_vencimento')?.value || null;
    if (!numero_nf || !orgao || !vendedor || !data_emissao) { showToast('Preencha os campos obrigatórios', 'error'); return; }
    const parcelas = _editingParcelasTemp.filter(p => p.valor > 0);
    for (const p of parcelas) { if (p.valor > 0 && !p.data_pagamento) { showToast(`Preencha data de pagamento da ${p.numero}ª parcela`, 'error'); return; } }
    const valorPago = parcelas.length > 0 ? parcelas.reduce((s,p)=>s+parseFloat(p.valor||0),0) : parseFloat(document.getElementById('f_valor_pago')?.value) || 0;
    let data_pagamento = document.getElementById('f_data_pagamento')?.value || null;
    if (parcelas.length > 0 && !document.getElementById('f_data_pagamento')?.dataset.manualEdit) { const datas = parcelas.map(p => p.data_pagamento).filter(Boolean).sort(); if (datas.length) data_pagamento = datas[datas.length-1]; }
    let status = document.getElementById('f_status')?.value || 'A RECEBER';
    if (parcelas.length > 0) { if (valorPago >= valor && valor > 0) status = 'PAGO'; else if (valorPago > 0) status = `${parcelas.length}ª PARCELA`; }
    else if (valorPago > 0 && valor > 0 && valorPago >= valor) status = 'PAGO';
    const formData = { numero_nf, orgao, vendedor, banco, tipo_nf, valor, data_emissao, data_vencimento, data_pagamento, status, valor_pago: valorPago, parcelas: parcelas.map(p => ({ numero: p.numero, valor: p.valor, data_pagamento: p.data_pagamento, data_vencimento: data_vencimento })) };
    await salvarConta(editId || null, formData);
};

async function salvarConta(id, data) {
    if (!isOnline) { showToast('Sistema offline', 'error'); return; }
    try {
        const url = id ? `${API_URL}/receber/${id}` : `${API_URL}/receber`;
        const method = id ? 'PUT' : 'POST';
        const r = await fetch(url, { method, headers: { 'Content-Type':'application/json', 'X-Session-Token': sessionToken }, body: JSON.stringify(data) });
        if (!r.ok) throw new Error();
        const saved = await r.json();
        if (id) { const idx = contas.findIndex(x => String(x.id) === String(id)); if (idx !== -1) contas[idx] = saved; } else contas.push(saved);
        updateFilters(); updateDashboard(); filterContas();
        showToast(id ? `NF ${data.numero_nf} atualizada` : `NF ${data.numero_nf} registrada`, 'success');
        closeFormModal();
    } catch (err) { showToast('Erro ao salvar', 'error'); }
}

// ============================================
// TOGGLE PAGAMENTO
// ============================================
window.togglePagamento = async function(id, checked) {
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return;
    if (checked) {
        document.getElementById(`chk-${id}`).checked = false;
        showConfirmacaoPagamentoModal(id, conta);
    } else {
        if (!confirm(`Reverter pagamento da NF ${conta.numero_nf} para "A Receber"?`)) { document.getElementById(`chk-${id}`).checked = true; return; }
        try {
            const r = await fetch(`${API_URL}/receber/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken }, body: JSON.stringify({ status: 'A RECEBER', data_pagamento: null, valor_pago: 0 }) });
            if (!r.ok) throw new Error();
            const saved = await r.json();
            const idx = contas.findIndex(x => String(x.id) === String(id));
            if (idx !== -1) contas[idx] = saved;
            updateDashboard(); filterContas();
            showToast(`Pagamento da NF ${conta.numero_nf} revertido`, 'info');
        } catch (e) { showToast('Erro ao reverter', 'error'); }
    }
};

function showConfirmacaoPagamentoModal(id, conta) {
    const modalHTML = `<div class="modal-overlay" id="confirmPagModal" style="display:flex;"><div class="modal-content confirm-modal-content"><button class="close-modal" onclick="document.getElementById('confirmPagModal').remove()">✕</button><div class="confirm-modal-body"><h3>O pagamento da NF ${conta.numero_nf} será parcelado?</h3></div><div class="confirm-modal-actions"><button class="success" id="btnSim">Sim</button><button class="danger" id="btnNao">Não</button><button class="secondary" id="btnCancelar">Cancelar</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('confirmPagModal');
    document.getElementById('btnSim').onclick = () => { modal.remove(); showFormModal(id, true); };
    document.getElementById('btnNao').onclick = () => { modal.remove(); showFormModalPagamentoIntegral(id, conta); };
    document.getElementById('btnCancelar').onclick = () => modal.remove();
    modal.querySelector('.close-modal').onclick = () => modal.remove();
}
function showFormModalPagamentoIntegral(editingId, conta) { showFormModal(editingId, false, true); }

// ============================================
// EXCLUSÃO
// ============================================
function showDeleteConfirmation(id) {
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return;
    const modalHTML = `<div class="modal-overlay" id="confirmDeleteModal" style="display:flex;"><div class="modal-content confirm-modal-content"><button class="close-modal" onclick="document.getElementById('confirmDeleteModal').remove()">✕</button><div class="confirm-modal-body"><h3>Excluir NF ${conta.numero_nf}?</h3></div><div class="confirm-modal-actions"><button class="success" id="confirmDeleteYes">Sim</button><button class="danger" id="confirmDeleteNo">Cancelar</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    const modal = document.getElementById('confirmDeleteModal');
    document.getElementById('confirmDeleteYes').onclick = async () => {
        modal.remove();
        contas = contas.filter(x => String(x.id) !== String(id));
        filterContas();
        showToast(`NF ${conta.numero_nf} excluída`, 'error');
        if (isOnline) { try { await fetch(`${API_URL}/receber/${id}`, { method: 'DELETE', headers: { 'X-Session-Token': sessionToken } }); } catch (e) { console.error(e); } }
    };
    document.getElementById('confirmDeleteNo').onclick = () => modal.remove();
    modal.querySelector('.close-modal').onclick = () => modal.remove();
}

// ============================================
// MODAL DE VENCIDOS
// ============================================
let vencidosModalPage = 1;
const VENCIDOS_PAGE_SIZE = 4;
let vencidosModalData = [];
window.showVencidosModal = function() {
    const hoje = new Date().toISOString().split('T')[0];
    vencidosModalData = contas.filter(c => c.status === 'A RECEBER' && !isContaEspecial(c) && c.data_vencimento && c.data_vencimento < hoje).sort((a,b) => a.data_vencimento.localeCompare(b.data_vencimento));
    vencidosModalPage = 1;
    renderVencidosModalPage();
    document.getElementById('vencidosModal').style.display = 'flex';
};
function renderVencidosModalPage() {
    const body = document.getElementById('vencidosModalBody');
    const totalPages = Math.ceil(vencidosModalData.length / VENCIDOS_PAGE_SIZE);
    const start = (vencidosModalPage-1) * VENCIDOS_PAGE_SIZE;
    const pageData = vencidosModalData.slice(start, start+VENCIDOS_PAGE_SIZE);
    let html = '';
    if (!pageData.length) html = '<div style="text-align:center;padding:2rem;">Nenhuma conta vencida</div>';
    else html = `<div style="overflow-x:auto;"><table><thead><tr><th>NF</th><th>Órgão</th><th>Vendedor</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>${pageData.map(c => `<tr><td><strong>${c.numero_nf}</strong></td><td>${c.orgao}</td><td>${c.vendedor}</td><td style="color:#EF4444;">${formatDate(c.data_vencimento)}</td><td>R$ ${parseFloat(c.valor).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>`).join('')}</tbody></table></div>`;
    if (totalPages > 1) html += `<div class="alert-pagination"><button class="alert-page-btn" onclick="changeVencidosPage(-1)" ${vencidosModalPage===1?'disabled':''}>‹</button><span>${vencidosModalPage}/${totalPages}</span><button class="alert-page-btn" onclick="changeVencidosPage(1)" ${vencidosModalPage===totalPages?'disabled':''}>›</button></div>`;
    body.innerHTML = html;
}
function changeVencidosPage(d) { const total = Math.ceil(vencidosModalData.length / VENCIDOS_PAGE_SIZE); vencidosModalPage = Math.min(total, Math.max(1, vencidosModalPage + d)); renderVencidosModalPage(); }
window.closeVencidosModal = function() { document.getElementById('vencidosModal').style.display = 'none'; };

// ============================================
// UTILITÁRIOS
// ============================================
function formatDate(d) { return d ? new Date(d+'T00:00:00').toLocaleDateString('pt-BR') : '-'; }
function showToast(msg, type) { const div = document.createElement('div'); div.className = `floating-message ${type}`; div.textContent = msg; document.body.appendChild(div); setTimeout(() => div.remove(), 3000); }

window.sincronizarDados = loadContas;
window.toggleCalendar = function() { /* implementar se necessário */ };
window.changeCalendarYear = function() {};
