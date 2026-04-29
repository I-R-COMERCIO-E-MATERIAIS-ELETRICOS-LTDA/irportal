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

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

console.log('✅ Contas a Receber iniciado');
console.log('📍 API URL:', API_URL);

// ════════════════════════════════════════════
//  STATUS ESPECIAIS (nunca são contas a receber)
// ════════════════════════════════════════════
const SPECIAL_STATUS = [
    'DEVOLUÇÃO', 'DEVOLVIDA', 'SIMPLES REMESSA', 'REMESSA DE AMOSTRA', 'CANCELADA'
];

function isContaEspecial(conta) {
    const s = (conta.status || '').trim().toUpperCase();
    const t = (conta.tipo_nf || '').trim().toUpperCase();
    return SPECIAL_STATUS.some(sp => s === sp || t === sp);
}

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    if (DEVELOPMENT_MODE) {
        sessionToken = 'dev-mode';
        inicializarApp();
    } else {
        verificarAutenticacao();
    }
});

function verificarAutenticacao() {
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
            <a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Ir para o Portal</a>
        </div>
    `;
}

function inicializarApp() {
    updateMonthDisplay();
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/receber`, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' },
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('receberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;

        if (wasOffline && isOnline) {
            await loadContas();
        }

        return isOnline;
    } catch (error) {
        isOnline = false;
        return false;
    }
}

async function loadContas(showMsg = false) {
    if (!isOnline && !DEVELOPMENT_MODE) {
        if (showMsg) showToast('Sistema offline. Não foi possível sincronizar.', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/receber?_t=${Date.now()}`, {
            method: 'GET',
            headers: {
                'X-Session-Token': sessionToken,
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            },
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('receberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            if (showMsg) showToast('Erro ao sincronizar dados', 'error');
            return;
        }

        contas = await response.json();
        console.log(`✅ ${contas.length} contas carregadas`);

        updateFilters();
        updateDashboard();
        filterContas();
    } catch (error) {
        console.error('❌ Erro ao carregar contas:', error);
        if (showMsg) showToast('Erro ao sincronizar dados', 'error');
    }
}

window.sincronizarDados = async function () {
    const btns = document.querySelectorAll('button[onclick="sincronizarDados()"]');
    btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = 'spin 1s linear infinite'; });
    await loadContas(true);
    setTimeout(() => {
        btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = ''; });
    }, 1000);
};

function startPolling() {
    loadContas();
    setInterval(() => { if (isOnline) loadContas(); }, 15000);
}

function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) {
        if (showAllMonths) {
            el.textContent = `Todos — ${currentYear}`;
        } else {
            el.textContent = `${meses[currentMonth]} ${currentYear}`;
        }
    }
    updateDashboard();
    filterContas();
}

window.changeMonth = function (direction) {
    showAllMonths = false;
    let m = currentMonth + direction;
    let y = currentYear;
    if (m > 11) { m = 0; y++; }
    if (m < 0)  { m = 11; y--; }
    currentMonth = m;
    currentYear = y;
    updateMonthDisplay();
};

window.updateMonthDisplay = updateMonthDisplay;

function updateDashboard() {
    const hoje = new Date().toISOString().split('T')[0];

    // Vencido: apenas status 'A RECEBER', data vencida e NÃO especial
    const vencido = contas.filter(c =>
        c.status === 'A RECEBER' &&
        !isContaEspecial(c) &&
        c.data_vencimento &&
        c.data_vencimento < hoje
    ).length;

    const filtered = getContasFiltradas();
    const pago = filtered.filter(c => isStatusPago(c.status)).reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    // A Receber exclui também as notas especiais
    const receber = filtered.filter(c => c.status === 'A RECEBER' && !isContaEspecial(c))
                           .reduce((s, c) => s + parseFloat(c.valor || 0), 0);
    const faturado = pago + receber;
    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const el = id => document.getElementById(id);
    if (el('statPago'))     el('statPago').textContent     = fmt(pago);
    if (el('statReceber'))  el('statReceber').textContent  = fmt(receber);
    if (el('statFaturado')) el('statFaturado').textContent = fmt(faturado);
    if (el('statVencido'))  el('statVencido').textContent  = vencido;
    const cardVencido = el('cardVencido');
    if (cardVencido) cardVencido.classList.toggle('has-alert', vencido > 0);
    const badge = document.getElementById('pulseBadgeVencido');
    if (badge) badge.style.display = vencido > 0 ? 'flex' : 'none';
}

function isStatusPago(status) {
    return status === 'PAGO' || /parcela/i.test(status);
}

function getContasFiltradas(applyMonthFilter = true) {
    if (!applyMonthFilter) return contas;
    return contas.filter(c => {
        if (!c.data_emissao) return false;
        if (showAllMonths) return new Date(c.data_emissao + 'T00:00:00').getFullYear() === currentYear;
        const d = new Date(c.data_emissao + 'T00:00:00');
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
}

function updateFilters() {
    const vendedores = new Set(contas.map(c => c.vendedor).filter(Boolean));
    const selVend = document.getElementById('filterVendedor');
    if (selVend) {
        const cur = selVend.value;
        selVend.innerHTML = '<option value="">Todos Vendedores</option>';
        [...vendedores].sort().forEach(v => { const o = document.createElement('option'); o.value = v; o.textContent = v; selVend.appendChild(o); });
        selVend.value = cur;
    }
    const bancos = new Set(contas.map(c => c.banco).filter(Boolean));
    const selBanco = document.getElementById('filterBanco');
    if (selBanco) {
        const cur = selBanco.value;
        selBanco.innerHTML = '<option value="">Todos Bancos</option>';
        [...bancos].sort().forEach(b => { const o = document.createElement('option'); o.value = b; o.textContent = b; selBanco.appendChild(o); });
        selBanco.value = cur;
    }
}

window.filterContas = function () {
    const search   = (document.getElementById('search')?.value || '').toLowerCase();
    const vendedor = document.getElementById('filterVendedor')?.value || '';
    const banco    = document.getElementById('filterBanco')?.value || '';
    const status   = document.getElementById('filterStatus')?.value || '';
    let filtered = getContasFiltradas();
    if (vendedor) filtered = filtered.filter(c => c.vendedor === vendedor);
    if (banco)    filtered = filtered.filter(c => c.banco === banco);
    if (status)   filtered = filtered.filter(c => c.status === status);
    if (search) {
        filtered = filtered.filter(c =>
            [c.numero_nf, c.orgao, c.vendedor, c.banco, c.status]
                .some(f => f && f.toString().toLowerCase().includes(search))
        );
    }
    filtered.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderContas(filtered);
    updateDashboard();
};

function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if (!container) return;
    if (!lista || lista.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma conta encontrada</div>';
        return;
    }
    const hoje = new Date().toISOString().split('T')[0];
    container.innerHTML = `<div style="overflow-x:auto;"><table><thead><tr><th style="width:50px;text-align:center;">✓</th><th>NF</th><th>Órgão</th><th>Vendedor</th><th>Banco</th><th>Valor</th><th>Valor Pago</th><th>Vencimento</th><th>Dt. Pagamento</th><th>Status</th><th style="text-align:center;">Ações</th></tr></thead><tbody>${lista.map(c => renderRow(c, hoje)).join('')}</tbody>}</div>`;
}

function renderRow(c, hoje) {
    const isPagoTotal  = c.status === 'PAGO';
    const isParcial    = /parcela/i.test(c.status || '');
    const isPagoAlgum  = isPagoTotal || isParcial;

    // Nunca é vencido se for uma conta especial (status ou tipo NF)
    const isNonPayment = isContaEspecial(c);
    const isVencido    = !isPagoAlgum && !isNonPayment && c.data_vencimento && c.data_vencimento < hoje;

    const parcelas = getParcelas(c);
    const valorPagoTotal = parcelas.length > 0 ? parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0) : parseFloat(c.valor_pago || 0);
    let dataPgto = '-';
    if (parcelas.length > 0) {
        const datas = parcelas.map(p => p.data).filter(Boolean).sort();
        if (datas.length > 0) dataPgto = formatDate(datas[datas.length - 1]);
    } else if (c.data_pagamento) {
        dataPgto = formatDate(c.data_pagamento);
    }
    const rowClass = isPagoTotal ? 'row-pago' : '';
    return `<tr class="${rowClass} row-clickable" data-id="${c.id}" onclick="handleRowClick(event, '${c.id}')"><td style="text-align:center;"><div class="checkbox-wrapper"><input type="checkbox" class="styled-checkbox" id="chk-${c.id}" ${isPagoTotal?'checked':''} onchange="togglePagamento('${c.id}', this.checked)" onclick="event.stopPropagation()"><label for="chk-${c.id}" class="checkbox-label-styled" onclick="event.stopPropagation()"></label></div></td><td><strong>${c.numero_nf||'-'}</strong></td><td style="max-width:200px;word-wrap:break-word;white-space:normal;">${c.orgao||'-'}</td><td>${c.vendedor||'-'}</td><td>${c.banco||'-'}</td><td><strong>R$ ${parseFloat(c.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></td><td>${valorPagoTotal>0?'R$ '+valorPagoTotal.toLocaleString('pt-BR',{minimumFractionDigits:2}):'-'}</td><td style="white-space:nowrap;${isVencido?'color:#EF4444;font-weight:600;':''}">${c.data_vencimento?formatDate(c.data_vencimento):'-'}</td><td style="white-space:nowrap;">${dataPgto}</td><td>${getStatusBadge(c, hoje)}</td><td class="actions-cell" style="text-align:center;white-space:nowrap;"><button class="action-btn edit" onclick="event.stopPropagation();handleEditClick('${c.id}')" title="Editar">Editar</button><button class="action-btn delete" onclick="event.stopPropagation();handleDeleteClick('${c.id}')" title="Excluir">Excluir</button></td></tr>`;
}

function getStatusBadge(conta, hoje) {
    const s = (conta.status || '').trim();

    // Pagamentos normais
    if (s.toUpperCase() === 'PAGO') return '<span class="badge status-pago">PAGO</span>';
    if (/parcela/i.test(s)) return `<span class="badge status-parcela">${s}</span>`;

    // Se for uma conta especial, exibe o texto mais específico
    if (isContaEspecial(conta)) {
        // Prioriza o campo status se ele for especial; senão usa o tipo_nf
        const rawStatus = s.toUpperCase();
        const rawTipo   = (conta.tipo_nf || '').trim().toUpperCase();
        const label = SPECIAL_STATUS.includes(rawStatus) ? s : conta.tipo_nf;
        return `<span class="badge status-especial">${label}</span>`;
    }

    // Vencido apenas para 'A RECEBER' (ou outros não mapeados)
    if (conta.data_vencimento && conta.data_vencimento < hoje) {
        return '<span class="badge status-vencido">VENCIDO</span>';
    }
    return '<span class="badge status-a-receber">A RECEBER</span>';
}

function getParcelas(conta) {
    try {
        const obs = conta.observacoes;
        if (!obs) return [];
        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
        if (parsed && Array.isArray(parsed.parcelas)) return parsed.parcelas;
        return [];
    } catch { return []; }
}

function getObservacoesTexto(conta) {
    try {
        const obs = conta.observacoes;
        if (!obs) return [];
        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
        if (parsed && Array.isArray(parsed.notas)) return parsed.notas;
        return [];
    } catch { return []; }
}

function buildObservacoesJson(notas, parcelas) {
    return { notas: notas || [], parcelas: parcelas || [] };
}

// ============================================
// HANDLER DO CLIQUE NA LINHA (abrir modal VER)
// ============================================
window.handleRowClick = function(event, id) {
    if (event.target.tagName === 'BUTTON' || event.target.closest('button')) return;
    const conta = contas.find(x => String(x.id) === String(id));
    if (conta) {
        showViewModal(conta);
    } else {
        showToast('Conta não encontrada', 'error');
    }
};

// ============================================
// HANDLER DO BOTÃO EDITAR
// ============================================
window.handleEditClick = function(id) {
    showFormModal(id);
};

// ============================================
// MODAL VER (com 4 abas)
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
    const html = `<div class="modal-overlay show" id="viewModal"><div class="modal-content"><div class="modal-header"><h3 class="modal-title">NF ${c.numero_nf||''}</h3><button class="close-modal" onclick="document.getElementById('viewModal').remove()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn active" onclick="switchViewTab('vtab-geral',this)">Geral</button><button class="tab-btn" onclick="switchViewTab('vtab-valores',this)">Valores e Datas</button><button class="tab-btn" onclick="switchViewTab('vtab-parcelas',this)">Pagamento Parcelado</button><button class="tab-btn" onclick="switchViewTab('vtab-obs',this)">Observações</button></div><div id="vtab-geral" class="tab-content active">${tabGeral}</div><div id="vtab-valores" class="tab-content">${tabValores}</div><div id="vtab-parcelas" class="tab-content">${tabParcelas}</div><div id="vtab-obs" class="tab-content">${tabObs}</div></div><div class="modal-actions"><button type="button" id="viewPrev" class="secondary" onclick="navigateViewTab(-1)" style="display:none;">Anterior</button><button type="button" id="viewNext" class="secondary" onclick="navigateViewTab(1)">Próximo</button><button type="button" class="btn-close" onclick="document.getElementById('viewModal').remove()">Fechar</button></div></div></div>`;
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
// MODAL DE FORMULÁRIO (com parcelas e abas)
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
    const html = `<div class="modal-overlay show" id="formModal"><div class="modal-content"><div class="modal-header"><h3 class="modal-title">${isEditing?'Editar Conta':'Nova Conta a Receber'}</h3><button class="close-modal" onclick="closeFormModal()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn ${tabActive(0)}" onclick="switchFormTab('ftab-geral',this)">Geral</button><button class="tab-btn ${tabActive(1)}" onclick="switchFormTab('ftab-valores',this)">Valores e Datas</button><button class="tab-btn ${tabActive(2)}" onclick="switchFormTab('ftab-parcelas',this)">Pagamento Parcelado</button><button class="tab-btn ${tabActive(3)}" onclick="switchFormTab('ftab-obs',this)">Observações</button></div><div id="ftab-geral" class="tab-content ${tabActive(0)}"><div class="form-grid"><div class="form-group"><label>Número NF *</label><input type="text" id="f_numero_nf" value="${c?.numero_nf||''}" required></div><div class="form-group"><label>Órgão *</label><input type="text" id="f_orgao" value="${c?.orgao||''}" required></div><div class="form-group"><label>Vendedor *</label><select id="f_vendedor"><option value="">Selecione...</option><option value="ROBERTO" ${c?.vendedor==='ROBERTO'?'selected':''}>ROBERTO</option><option value="ISAQUE" ${c?.vendedor==='ISAQUE'?'selected':''}>ISAQUE</option><option value="MIGUEL" ${c?.vendedor==='MIGUEL'?'selected':''}>MIGUEL</option></select></div><div class="form-group"><label>Banco</label><input type="text" id="f_banco" value="${c?.banco||''}"></div><div class="form-group"><label>Tipo NF</label><select id="f_tipo_nf"><option value="ENVIO" ${(!c||c.tipo_nf==='ENVIO')?'selected':''}>Envio</option><option value="CANCELADA" ${c?.tipo_nf==='CANCELADA'?'selected':''}>Cancelada</option><option value="REMESSA DE AMOSTRA" ${c?.tipo_nf==='REMESSA DE AMOSTRA'?'selected':''}>Remessa de Amostra</option><option value="SIMPLES REMESSA" ${c?.tipo_nf==='SIMPLES REMESSA'?'selected':''}>Simples Remessa</option><option value="DEVOLUÇÃO" ${c?.tipo_nf==='DEVOLUÇÃO'?'selected':''}>Devolução</option></select></div><div class="form-group"><label>Status</label><select id="f_status"><option value="A RECEBER" ${(!c||c.status==='A RECEBER')?'selected':''}>A Receber</option><option value="PAGO" ${c?.status==='PAGO'?'selected':''}>Pago</option></select></div></div></div><div id="ftab-valores" class="tab-content ${tabActive(1)}"><div class="form-grid"><div class="form-group"><label>Valor NF (R$)</label><input type="number" id="f_valor" step="0.01" min="0" value="${c?.valor||''}"></div><div class="form-group"><label>Valor Pago Total (R$)</label><input type="number" id="f_valor_pago" step="0.01" min="0" value="${valorPagoAtual>0?valorPagoAtual.toFixed(2):(c?.valor_pago||'')}"></div><div class="form-group"><label>Data Emissão *</label><input type="date" id="f_data_emissao" value="${c?.data_emissao||''}" required></div><div class="form-group"><label>Vencimento</label><input type="date" id="f_data_vencimento" value="${c?.data_vencimento||''}"></div><div class="form-group"><label>Data Pagamento</label><input type="date" id="f_data_pagamento" value="${dataPgAtual}"></div></div></div><div id="ftab-parcelas" class="tab-content ${tabActive(2)}"><div style="margin-bottom:1rem;"><button type="button" class="btn-add-obs" onclick="adicionarParcelaForm()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Adicionar Parcela</button></div><div id="parcelasFormList"></div></div><div id="ftab-obs" class="tab-content ${tabActive(3)}"><div class="observacoes-section"><div class="observacoes-list" id="obsFormList">${notas.map((n,i) => `<div class="observacao-item" id="obs-form-${i}"><div class="observacao-header"><span class="observacao-data">${n.data||''}</span><button type="button" class="btn-remove-obs" onclick="removerObsForm(${i})">✕</button></div><p class="observacao-texto">${n.texto||''}</p></div>`).join('')}</div><div class="nova-observacao"><h4>Nova Observação</h4><textarea id="novaObsInput" placeholder="Digite uma observação..."></textarea><button type="button" class="btn-add-obs" onclick="adicionarObsForm()"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>Adicionar Observação</button></div></div></div></div><div class="modal-actions"><button type="button" id="btnFormPrev" class="secondary" onclick="navFormTab(-1)" style="display:none;">Anterior</button><button type="button" id="btnFormNext" class="secondary" onclick="navFormTab(1)">Próximo</button><button type="button" id="btnFormSave" class="save" onclick="handleSubmitForm('${editingId||''}')">${isEditing?'Atualizar':'Salvar'}</button><button type="button" class="btn-cancel" onclick="closeFormModal()">Cancelar</button></div></div></div>`;
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

function renderParcelasForm() {
    const container = document.getElementById('parcelasFormList');
    if (!container) return;
    if (_editingParcelasTemp.length === 0) { container.innerHTML = `<p style="color:var(--text-secondary);font-style:italic;text-align:center;padding:1rem 0;">Nenhuma parcela adicionada ainda.</p>`; return; }
    container.innerHTML = _editingParcelasTemp.map((p,i) => `<div class="observacao-item" style="margin-bottom:.75rem;"><div class="observacao-header"><span class="observacao-data" style="font-weight:600;color:var(--text-primary);">${p.numero||(i+1)+'ª Parcela'}</span><button type="button" class="btn-remove-obs" onclick="removerParcelaForm(${i})">✕</button></div><div class="form-grid" style="margin-top:.5rem;"><div class="form-group"><label>Valor (R$)</label><input type="number" step="0.01" min="0" value="${p.valor||''}" onchange="_editingParcelasTemp[${i}].valor = parseFloat(this.value)||0; atualizarValorPagoForm();"></div><div class="form-group"><label>Data de Pagamento</label><input type="date" value="${p.data||''}" onchange="_editingParcelasTemp[${i}].data = this.value; atualizarValorPagoForm();"></div></div></div>`).join('');
}
window.adicionarParcelaForm = function() { const numero = (_editingParcelasTemp.length + 1); _editingParcelasTemp.push({ numero: numero + 'ª Parcela', valor: 0, data: '' }); renderParcelasForm(); atualizarValorPagoForm(); };
window.removerParcelaForm = function(i) { _editingParcelasTemp.splice(i,1); _editingParcelasTemp.forEach((p,idx) => p.numero = (idx+1)+'ª Parcela'); renderParcelasForm(); atualizarValorPagoForm(); };
function atualizarValorPagoForm() { const total = _editingParcelasTemp.reduce((s,p) => s + parseFloat(p.valor||0), 0); const elVP = document.getElementById('f_valor_pago'); if (elVP && !elVP.dataset.manualEdit) elVP.value = total > 0 ? total.toFixed(2) : ''; const datas = _editingParcelasTemp.map(p => p.data).filter(Boolean).sort(); const elData = document.getElementById('f_data_pagamento'); if (elData && !elData.dataset.manualEdit) elData.value = datas.length > 0 ? datas[datas.length-1] : ''; }
document.addEventListener('change', function(e) { if (e.target.id === 'f_valor_pago' || e.target.id === 'f_data_pagamento') e.target.dataset.manualEdit = '1'; });

window.adicionarObsForm = function() { const input = document.getElementById('novaObsInput'); if (!input || !input.value.trim()) return showToast('Digite uma observação primeiro', 'error'); const notas = obterNotasForm(); notas.push({ texto: input.value.trim(), data: new Date().toLocaleString('pt-BR') }); input.value = ''; renderObsForm(notas); };
window.removerObsForm = function(i) { const notas = obterNotasForm(); notas.splice(i,1); renderObsForm(notas); };
function obterNotasForm() { const list = document.getElementById('obsFormList'); if (!list) return []; const notas = []; list.querySelectorAll('.observacao-item').forEach(item => { notas.push({ texto: item.querySelector('.observacao-texto')?.textContent || '', data: item.querySelector('.observacao-data')?.textContent || '' }); }); return notas; }
function renderObsForm(notas) { const list = document.getElementById('obsFormList'); if (!list) return; list.innerHTML = notas.map((n,i) => `<div class="observacao-item" id="obs-form-${i}"><div class="observacao-header"><span class="observacao-data">${n.data||''}</span><button type="button" class="btn-remove-obs" onclick="removerObsForm(${i})">✕</button></div><p class="observacao-texto">${n.texto||''}</p></div>`).join(''); }

window.handleSubmitForm = async function(editId) {
    const numero_nf = document.getElementById('f_numero_nf')?.value.trim();
    const orgao = document.getElementById('f_orgao')?.value.trim();
    const vendedor = document.getElementById('f_vendedor')?.value;
    const banco = document.getElementById('f_banco')?.value.trim() || null;
    const tipo_nf = document.getElementById('f_tipo_nf')?.value;
    const valor = parseFloat(document.getElementById('f_valor')?.value) || 0;
    const data_emissao = document.getElementById('f_data_emissao')?.value;
    const data_vencimento = document.getElementById('f_data_vencimento')?.value || null;
    if (!numero_nf || !orgao || !vendedor || !data_emissao) { showToast('Preencha os campos obrigatórios: NF, Órgão, Vendedor e Data Emissão', 'error'); return; }
    const parcelas = _editingParcelasTemp.filter(p => p.valor > 0 || p.data);
    const totalParcelas = parcelas.reduce((s,p) => s + parseFloat(p.valor||0), 0);
    for (const p of parcelas) { if (p.valor > 0 && !p.data) { showToast(`Preencha a data de pagamento da ${p.numero}`, 'error'); return; } }
    const valorPagoCampo = parseFloat(document.getElementById('f_valor_pago')?.value) || 0;
    const valorPago = parcelas.length > 0 ? totalParcelas : valorPagoCampo;
    let data_pagamento = document.getElementById('f_data_pagamento')?.value || null;
    if (parcelas.length > 0 && !document.getElementById('f_data_pagamento')?.dataset.manualEdit) { const datas = parcelas.map(p => p.data).filter(Boolean).sort(); data_pagamento = datas.length > 0 ? datas[datas.length-1] : null; }
    let status = document.getElementById('f_status')?.value || 'A RECEBER';
    if (parcelas.length > 0) { if (totalParcelas >= valor && valor > 0) status = 'PAGO'; else if (totalParcelas > 0) status = parcelas.length + 'ª PARCELA'; }
    else if (valorPago > 0 && valor > 0 && valorPago >= valor) status = 'PAGO';
    const notas = obterNotasForm();
    const observacoes = buildObservacoesJson(notas, parcelas);
    const formData = { numero_nf, orgao, vendedor, banco, tipo_nf, valor, valor_pago: valorPago, data_emissao, data_vencimento, data_pagamento, status, observacoes };
    await salvarConta(editId || null, formData, false);
};

async function salvarConta(id, data, silencioso = false) {
    if (!isOnline && !DEVELOPMENT_MODE) { showToast('Sistema offline. Não foi possível salvar.', 'error'); return; }
    try {
        const url = id ? `${API_URL}/receber/${id}` : `${API_URL}/receber`;
        const method = id ? 'PUT' : 'POST';
        const r = await fetch(url, { method, headers: { 'Content-Type':'application/json', 'X-Session-Token': sessionToken }, body: JSON.stringify(data) });
        if (!DEVELOPMENT_MODE && r.status === 401) { sessionStorage.removeItem('receberSession'); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        if (!r.ok) { const err = await r.json(); throw new Error(err.details || err.error || 'Erro ao salvar'); }
        const saved = await r.json();
        if (id) { const idx = contas.findIndex(x => String(x.id) === String(id)); if (idx !== -1) contas[idx] = saved; }
        else contas.push(saved);
        updateFilters(); updateDashboard(); filterContas();
        if (!silencioso) { showToast(id ? `NF ${data.numero_nf||''} atualizada` : `NF ${data.numero_nf||''} registrada`, 'success'); closeFormModal(); }
    } catch (err) { console.error('❌ Erro:', err); showToast(`Erro: ${err.message}`, 'error'); }
}

// ============================================
// TOGGLE PAGAMENTO (com confirmação customizada)
// ============================================
window.togglePagamento = async function(id, checked) {
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return;

    if (checked) {
        const chk = document.getElementById(`chk-${id}`);
        if (chk) chk.checked = false;
        showConfirmacaoPagamentoModal(id, conta);
    } else {
        const confirm = await showConfirm(`Reverter pagamento da NF ${conta.numero_nf} para "A Receber"?`);
        if (!confirm) {
            const chk = document.getElementById(`chk-${id}`);
            if (chk) chk.checked = true;
            return;
        }
        try {
            const r = await fetch(`${API_URL}/receber/${id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
                body: JSON.stringify({ status: 'A RECEBER', data_pagamento: null, valor_pago: 0 })
            });
            if (!r.ok) throw new Error('Erro ao atualizar');
            const saved = await r.json();
            const idx = contas.findIndex(x => String(x.id) === String(id));
            if (idx !== -1) contas[idx] = saved;
            updateDashboard();
            filterContas();
            showToast(`Pagamento da NF ${conta.numero_nf} revertido`, 'info');
        } catch (e) {
            showToast('Erro ao reverter pagamento', 'error');
        }
    }
};

// ============================================
// MODAL DE CONFIRMAÇÃO GENÉRICO (Sim verde / Cancelar vermelho)
// ============================================
function showConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const { confirmText = 'Sim', cancelText = 'Cancelar', type = 'danger' } = options;
        const modalHTML = `
            <div class="modal-overlay" id="confirmModal" style="display: flex !important; z-index: 10001 !important;">
                <div class="modal-content confirm-modal-content" style="max-width: 450px !important;">
                    <button class="close-modal" id="confirmModalClose">✕</button>
                    <div class="confirm-modal-body">
                        <h3 class="confirm-modal-title">${message}</h3>
                    </div>
                    <div class="confirm-modal-actions">
                        <button class="success" id="modalConfirmBtn">${confirmText}</button>
                        <button class="danger" id="modalCancelBtn">${cancelText}</button>
                    </div>
                </div>
            </div>`;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('confirmModal');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');
        const closeBtn = document.getElementById('confirmModalClose');
        if (modal) { modal.style.display = 'flex'; modal.style.opacity = '1'; }
        const closeModal = (result) => {
            if (modal) { modal.style.animation = 'fadeOut 0.2s ease forwards'; setTimeout(() => { modal.remove(); resolve(result); }, 200); }
            else resolve(result);
        };
        if (confirmBtn) confirmBtn.addEventListener('click', () => closeModal(true));
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(false));
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal(false));
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(false); });
        if (!document.querySelector('#modalAnimations')) {
            const style = document.createElement('style');
            style.id = 'modalAnimations';
            style.textContent = `@keyframes fadeOut { to { opacity: 0; } }`;
            document.head.appendChild(style);
        }
    });
}

// ============================================
// EXCLUSÃO (Sim verde / Cancelar vermelho)
// ============================================
function showDeleteConfirmation(message, onConfirm) {
    const modalHTML = `
        <div class="modal-overlay" id="customDeleteModal" style="display: flex !important; z-index: 10001 !important;">
            <div class="modal-content confirm-modal-content" style="max-width: 450px !important;">
                <button class="close-modal" onclick="document.getElementById('customDeleteModal').remove()">✕</button>
                <div class="confirm-modal-body"><h3 class="confirm-modal-title">${message}</h3></div>
                <div class="confirm-modal-actions">
                    <button class="success" id="customDeleteConfirmBtn">Sim</button>
                    <button class="danger" id="customDeleteCancelBtn">Cancelar</button>
                </div>
            </div>
        </div>`;
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
                const r = await fetch(`${API_URL}/receber/${id}`, { method: 'DELETE', headers: { 'X-Session-Token': sessionToken } });
                if (!r.ok) throw new Error('Erro no servidor');
            } catch {
                contas.push(conta);
                filterContas();
                showToast('Erro ao excluir no servidor', 'error');
            }
        }
    });
};

// ============================================
// CONFIRMAÇÃO DE PAGAMENTO (Sim verde / Não vermelho / Cancelar cinza)
// ============================================
function showConfirmacaoPagamentoModal(id, conta) {
    document.getElementById('confirmPagModal')?.remove();
    const modalHTML = `
        <div class="modal-overlay" id="confirmPagModal" style="display: flex !important; z-index: 10001 !important;">
            <div class="modal-content confirm-modal-content" style="max-width: 450px !important;">
                <button class="close-modal" id="confirmPagClose">✕</button>
                <div class="confirm-modal-body"><h3 class="confirm-modal-title">O pagamento da NF ${conta.numero_nf} será parcelado?</h3></div>
                <div class="confirm-modal-actions">
                    <button class="success" id="btnSim">Sim</button>
                    <button class="danger" id="btnNao">Não</button>
                    <button class="secondary" id="btnCancelar">Cancelar</button>
                </div>
            </div>
        </div>`;
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

window.confirmarPagamentoTotal = async function(id) {
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return;
    showFormModalPagamentoIntegral(id, conta);
};

window.showFormModalPagamentoIntegral = function(editingId, conta) {
    showFormModal(editingId, false, true);
};

// ============================================
// MODAL DE VENCIDOS (com paginação)
// ============================================
let vencidosModalPage = 1;
const VENCIDOS_PAGE_SIZE = 4;
let vencidosModalData = [];
window.showVencidosModal = function() {
    const hoje = new Date().toISOString().split('T')[0];
    vencidosModalData = contas.filter(c =>
        c.status === 'A RECEBER' &&
        !isContaEspecial(c) &&
        c.data_vencimento &&
        c.data_vencimento < hoje
    ).sort((a,b) => a.data_vencimento.localeCompare(b.data_vencimento));
    vencidosModalPage = 1;
    renderVencidosModalPage();
    const modal = document.getElementById('vencidosModal'); if (modal) modal.style.display = 'flex';
};
function renderVencidosModalPage() {
    const body = document.getElementById('vencidosModalBody'); if (!body) return;
    const totalPages = Math.ceil(vencidosModalData.length / VENCIDOS_PAGE_SIZE);
    const start = (vencidosModalPage-1) * VENCIDOS_PAGE_SIZE;
    const pageData = vencidosModalData.slice(start, start+VENCIDOS_PAGE_SIZE);
    let html = '';
    if (pageData.length === 0) html = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma conta vencida</div>';
    else { html = `<div style="overflow-x:auto;"><table><thead><tr><th>NF</th><th>Órgão</th><th>Vendedor</th><th>Vencimento</th><th>Valor</th></tr></thead><tbody>${pageData.map(c => `<tr><td><strong>${c.numero_nf||'-'}</strong></td><td>${c.orgao||'-'}</td><td>${c.vendedor||'-'}</td><td style="color:#EF4444;font-weight:600;">${formatDate(c.data_vencimento)}</td><td>R$ ${parseFloat(c.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td></tr>`).join('')}</tbody></table></div>`; }
    if (totalPages > 1) html += `<div class="alert-pagination"><button class="alert-page-btn" onclick="changeVencidosPage(-1)" ${vencidosModalPage===1?'disabled':''}>‹</button><span class="alert-page-info">${vencidosModalPage} / ${totalPages}</span><button class="alert-page-btn" onclick="changeVencidosPage(1)" ${vencidosModalPage===totalPages?'disabled':''}>›</button></div>`;
    body.innerHTML = html;
}
window.changeVencidosPage = function(direction) { const totalPages = Math.ceil(vencidosModalData.length / VENCIDOS_PAGE_SIZE); vencidosModalPage = Math.max(1, Math.min(totalPages, vencidosModalPage + direction)); renderVencidosModalPage(); };
window.closeVencidosModal = function() { const modal = document.getElementById('vencidosModal'); if (modal) modal.style.display = 'none'; };

function formatDate(d) { if (!d) return '-'; return new Date(d+'T00:00:00').toLocaleDateString('pt-BR'); }
function showToast(message, type) { document.querySelectorAll('.floating-message').forEach(m => m.remove()); const div = document.createElement('div'); div.className = `floating-message ${type}`; div.textContent = message; document.body.appendChild(div); setTimeout(() => { div.style.animation = 'slideOutBottom 0.3s ease forwards'; setTimeout(() => div.remove(), 300); }, 3000); }
console.log('✅ Script contas a receber carregado com sucesso!');
