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
let _editingParcelasTemp = []; // parcelas sendo editadas no modal

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

console.log('✅ Contas a Receber iniciado');
console.log('📍 API URL:', API_URL);

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

// ============================================
// AUTENTICAÇÃO
// ============================================
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

// ============================================
// CONEXÃO E STATUS
// ============================================
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

        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
}

function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (el) el.className = isOnline ? 'connection-status online' : 'connection-status offline';
}

// ============================================
// CARREGAMENTO DE DADOS
// ============================================
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

// ============================================
// NAVEGAÇÃO POR MESES
// ============================================
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

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    // Para o dashboard de vencidos: sempre universal (todos os registros)
    const hoje = new Date().toISOString().split('T')[0];

    const vencido = contas.filter(c =>
        c.status === 'A RECEBER' && c.data_vencimento && c.data_vencimento < hoje
    ).length;

    // Demais cards: filtrados pelo mês/ano selecionado
    const filtered = getContasFiltradas();

    const pago = filtered
        .filter(c => isStatusPago(c.status))
        .reduce((s, c) => s + parseFloat(c.valor || 0), 0);

    const receber = filtered
        .filter(c => c.status === 'A RECEBER')
        .reduce((s, c) => s + parseFloat(c.valor || 0), 0);

    const faturado = pago + receber;

    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const el = id => document.getElementById(id);

    if (el('statPago'))     el('statPago').textContent     = fmt(pago);
    if (el('statReceber'))  el('statReceber').textContent  = fmt(receber);
    if (el('statFaturado')) el('statFaturado').textContent = fmt(faturado);
    if (el('statVencido'))  el('statVencido').textContent  = vencido;

    const cardVencido = el('cardVencido');
    if (cardVencido) {
        cardVencido.classList.toggle('has-alert', vencido > 0);
    }
}

// Verifica se o status representa um pagamento (total ou parcial)
function isStatusPago(status) {
    if (!status) return false;
    return status === 'PAGO' || /parcela/i.test(status);
}

// ============================================
// FILTROS
// ============================================
function getContasFiltradas(applyMonthFilter = true) {
    if (!applyMonthFilter) return contas;

    return contas.filter(c => {
        if (!c.data_emissao) return false;
        if (showAllMonths) {
            return new Date(c.data_emissao + 'T00:00:00').getFullYear() === currentYear;
        }
        const d = new Date(c.data_emissao + 'T00:00:00');
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
}

function updateFilters() {
    // Vendedores
    const vendedores = new Set(contas.map(c => c.vendedor).filter(Boolean));
    const selVend = document.getElementById('filterVendedor');
    if (selVend) {
        const cur = selVend.value;
        selVend.innerHTML = '<option value="">Todos Vendedores</option>';
        [...vendedores].sort().forEach(v => {
            const o = document.createElement('option');
            o.value = v; o.textContent = v;
            selVend.appendChild(o);
        });
        selVend.value = cur;
    }

    // Bancos
    const bancos = new Set(contas.map(c => c.banco).filter(Boolean));
    const selBanco = document.getElementById('filterBanco');
    if (selBanco) {
        const cur = selBanco.value;
        selBanco.innerHTML = '<option value="">Todos Bancos</option>';
        [...bancos].sort().forEach(b => {
            const o = document.createElement('option');
            o.value = b; o.textContent = b;
            selBanco.appendChild(o);
        });
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

    filtered.sort((a, b) => {
        const nA = parseInt(a.numero_nf) || 0;
        const nB = parseInt(b.numero_nf) || 0;
        return nA - nB;
    });

    renderContas(filtered);
    updateDashboard();
};

// ============================================
// RENDERIZAÇÃO DA TABELA
// ============================================
function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if (!container) return;

    if (!lista || lista.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma conta encontrada</div>';
        return;
    }

    const hoje = new Date().toISOString().split('T')[0];

    container.innerHTML = `
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th style="width:50px;text-align:center;">✓</th>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Vendedor</th>
                        <th>Banco</th>
                        <th>Valor</th>
                        <th>Valor Pago</th>
                        <th>Vencimento</th>
                        <th>Dt. Pagamento</th>
                        <th>Status</th>
                        <th style="text-align:center;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${lista.map(c => renderRow(c, hoje)).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function renderRow(c, hoje) {
    const isPagoTotal  = c.status === 'PAGO';
    const isParcial    = /parcela/i.test(c.status || '');
    const isPagoAlgum  = isPagoTotal || isParcial;
    const isVencido    = !isPagoAlgum && c.data_vencimento && c.data_vencimento < hoje;

    // Calcular valor pago total (soma parcelas ou valor_pago simples)
    const parcelas = getParcelas(c);
    const valorPagoTotal = parcelas.length > 0
        ? parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0)
        : parseFloat(c.valor_pago || 0);

    // Data de pagamento: última parcela paga (ou data_pagamento simples)
    let dataPgto = '-';
    if (parcelas.length > 0) {
        const datas = parcelas.map(p => p.data).filter(Boolean).sort();
        if (datas.length > 0) dataPgto = formatDate(datas[datas.length - 1]);
    } else if (c.data_pagamento) {
        dataPgto = formatDate(c.data_pagamento);
    }

    const rowClass = isPagoTotal ? 'row-pago' : '';

    return `
        <tr class="${rowClass} row-clickable" data-id="${c.id}" onclick="handleRowClick(event, '${c.id}')">
            <td style="text-align:center;">
                <div class="checkbox-wrapper">
                    <input type="checkbox" class="styled-checkbox" id="chk-${c.id}"
                        ${isPagoTotal ? 'checked' : ''}
                        onchange="togglePagamento('${c.id}', this.checked)"
                        onclick="event.stopPropagation()">
                    <label for="chk-${c.id}" class="checkbox-label-styled" onclick="event.stopPropagation()"></label>
                </div>
            </td>
            <td><strong>${c.numero_nf || '-'}</strong></td>
            <td style="max-width:200px;word-wrap:break-word;white-space:normal;">${c.orgao || '-'}</td>
            <td>${c.vendedor || '-'}</td>
            <td>${c.banco || '-'}</td>
            <td><strong>R$ ${parseFloat(c.valor || 0).toLocaleString('pt-BR', {minimumFractionDigits:2})}</strong></td>
            <td>${valorPagoTotal > 0 ? 'R$ ' + valorPagoTotal.toLocaleString('pt-BR', {minimumFractionDigits:2}) : '-'}</td>
            <td style="white-space:nowrap;${isVencido ? 'color:#EF4444;font-weight:600;' : ''}">${c.data_vencimento ? formatDate(c.data_vencimento) : '-'}</td>
            <td style="white-space:nowrap;">${dataPgto}</td>
            <td>${getStatusBadge(c, hoje)}</td>
            <td class="actions-cell" style="text-align:center;white-space:nowrap;">
                <button class="action-btn edit"   onclick="event.stopPropagation();handleEditClick('${c.id}')"   title="Editar">Editar</button>
                <button class="action-btn delete" onclick="event.stopPropagation();handleDeleteClick('${c.id}')" title="Excluir">Excluir</button>
            </td>
        </tr>
    `;
}

function getStatusBadge(conta, hoje) {
    const s = conta.status || '';
    if (s === 'PAGO') {
        return '<span class="badge status-pago">PAGO</span>';
    }
    if (/parcela/i.test(s)) {
        return `<span class="badge status-parcela">${s}</span>`;
    }
    if (conta.data_vencimento && conta.data_vencimento < hoje) {
        return '<span class="badge status-vencido">VENCIDO</span>';
    }
    return '<span class="badge status-a-receber">A RECEBER</span>';
}

// ============================================
// PARCELAS — helpers
// ============================================
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
// TOGGLE PAGAMENTO (checkbox)
// ============================================
window.togglePagamento = async function(id, checked) {
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return;

    if (checked) {
        // Reverter checkbox até confirmar
        const chk = document.getElementById(`chk-${id}`);
        if (chk) chk.checked = false;

        // Modal de confirmação: parcelado ou não?
        showConfirmacaoPagamentoModal(id, conta);
    } else {
        // Desmarcar pagamento — reverter para A RECEBER
        if (!confirm('Reverter este pagamento para "A RECEBER"?')) {
            const chk = document.getElementById(`chk-${id}`);
            if (chk) chk.checked = true;
            return;
        }
        await salvarConta(id, { status: 'A RECEBER', data_pagamento: null, valor_pago: 0 }, true);
    }
};

function showConfirmacaoPagamentoModal(id, conta) {
    document.getElementById('confirmPagModal')?.remove();

    const html = `
        <div class="modal-overlay show" id="confirmPagModal">
            <div class="modal-content" style="max-width:420px;">
                <div class="modal-header">
                    <h3 class="modal-title">Confirmar Pagamento</h3>
                    <button class="close-modal" onclick="document.getElementById('confirmPagModal').remove()">✕</button>
                </div>
                <div style="padding:1.5rem 0 0.5rem;">
                    <p style="font-size:1rem;color:var(--text-primary);margin-bottom:1.5rem;text-align:center;">
                        O pagamento da NF <strong>${conta.numero_nf}</strong> será parcelado?
                    </p>
                    <div class="modal-actions" style="justify-content:center;gap:1rem;">
                        <button class="action-btn edit" style="min-width:110px;" onclick="document.getElementById('confirmPagModal').remove(); showFormModal('${id}', true);">Sim</button>
                        <button class="action-btn success" style="min-width:110px;background:var(--btn-save);" onclick="confirmarPagamentoTotal('${id}')">Não</button>
                        <button class="btn-cancel" style="min-width:110px;" onclick="document.getElementById('confirmPagModal').remove()">Cancelar</button>
                    </div>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', html);
}

window.confirmarPagamentoTotal = async function(id) {
    document.getElementById('confirmPagModal')?.remove();
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return;

    // Abrir modal de edição na aba Valores e Datas com valor_pago = valor NF
    showFormModalPagamentoIntegral(id, conta);
};

window.showFormModalPagamentoIntegral = function(editingId, conta) {
    // Abre o modal na aba de Valores e Datas, foco no pagamento
    showFormModal(editingId, false, true);
};

// ============================================
// AÇÕES DA TABELA
// ============================================
window.handleRowClick = function(event, id) {
    // Não abrir se clicou em botão ou checkbox
    if (event.target.closest('button') || event.target.closest('input') || event.target.closest('label')) return;
    const c = contas.find(x => String(x.id) === String(id));
    if (!c) return showToast('Conta não encontrada!', 'error');
    showViewModal(c);
};

window.handleViewClick = function(id) {
    const c = contas.find(x => String(x.id) === String(id));
    if (!c) return showToast('Conta não encontrada!', 'error');
    showViewModal(c);
};

window.handleEditClick = function(id) {
    const c = contas.find(x => String(x.id) === String(id));
    if (!c) return showToast('Conta não encontrada!', 'error');
    showFormModal(id);
};

window.handleDeleteClick = async function(id) {
    const conta = contas.find(x => String(x.id) === String(id));
    if (!conta) return showToast('Conta não encontrada!', 'error');
    if (!confirm(`Excluir NF ${conta.numero_nf}?`)) return;

    contas = contas.filter(x => String(x.id) !== String(id));
    filterContas();
    showToast(`NF ${conta.numero_nf} excluída`, 'success');

    if (isOnline || DEVELOPMENT_MODE) {
        try {
            const r = await fetch(`${API_URL}/receber/${id}`, {
                method: 'DELETE',
                headers: { 'X-Session-Token': sessionToken }
            });
            if (!r.ok) throw new Error('Erro no servidor');
        } catch {
            contas.push(conta);
            filterContas();
            showToast('Erro ao excluir no servidor', 'error');
        }
    }
};

// ============================================
// MODAL DE VISUALIZAÇÃO (por abas)
// ============================================
function showViewModal(c) {
    const hoje = new Date().toISOString().split('T')[0];
    const fmt  = v => v ? `R$ ${parseFloat(v).toLocaleString('pt-BR', {minimumFractionDigits:2})}` : '-';
    const d    = v => v ? formatDate(v) : '-';

    const parcelas = getParcelas(c);
    const notas    = getObservacoesTexto(c);
    const valorPagoTotal = parcelas.length > 0
        ? parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0)
        : parseFloat(c.valor_pago || 0);

    const statusBadge = getStatusBadge(c, hoje);

    // Aba Geral
    const tabGeral = `
        <div class="info-section">
            <h4>Dados da Conta</h4>
            <div class="info-row"><span class="info-label">Número NF:</span><span class="info-value">${c.numero_nf || '-'}</span></div>
            <div class="info-row"><span class="info-label">Órgão:</span><span class="info-value">${c.orgao || '-'}</span></div>
            <div class="info-row"><span class="info-label">Vendedor:</span><span class="info-value">${c.vendedor || '-'}</span></div>
            <div class="info-row"><span class="info-label">Banco:</span><span class="info-value">${c.banco || '-'}</span></div>
            <div class="info-row"><span class="info-label">Tipo NF:</span><span class="info-value">${c.tipo_nf || '-'}</span></div>
            <div class="info-row"><span class="info-label">Status:</span><span class="info-value">${statusBadge}</span></div>
        </div>`;

    // Aba Valores e Datas
    const tabValores = `
        <div class="info-section">
            <h4>Valores e Datas</h4>
            <div class="info-row"><span class="info-label">Valor NF:</span><span class="info-value">${fmt(c.valor)}</span></div>
            <div class="info-row"><span class="info-label">Valor Pago Total:</span><span class="info-value">${valorPagoTotal > 0 ? fmt(valorPagoTotal) : '-'}</span></div>
            <div class="info-row"><span class="info-label">Data Emissão:</span><span class="info-value">${d(c.data_emissao)}</span></div>
            <div class="info-row"><span class="info-label">Vencimento:</span><span class="info-value">${d(c.data_vencimento)}</span></div>
            <div class="info-row"><span class="info-label">Data Pagamento:</span><span class="info-value">${d(c.data_pagamento)}</span></div>
        </div>`;

    // Aba Pagamento Parcelado
    let tabParcelas = `<div class="info-section"><h4>Pagamento Parcelado</h4>`;
    if (parcelas.length === 0) {
        tabParcelas += `<p style="color:var(--text-secondary);font-style:italic;">Nenhuma parcela registrada.</p>`;
    } else {
        tabParcelas += `<table style="width:100%;margin-top:.5rem;"><thead><tr><th>Parcela</th><th>Valor</th><th>Data Pagamento</th></tr></thead><tbody>`;
        parcelas.forEach((p, i) => {
            tabParcelas += `<tr><td>${p.numero || (i+1) + 'ª'}</td><td>R$ ${parseFloat(p.valor||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td><td>${p.data ? formatDate(p.data) : '-'}</td></tr>`;
        });
        tabParcelas += `</tbody></table>`;
    }
    tabParcelas += `</div>`;

    // Aba Observações
    let tabObs = `<div class="info-section"><h4>Observações</h4>`;
    if (notas.length === 0) {
        tabObs += `<p style="color:var(--text-secondary);font-style:italic;">Nenhuma observação registrada.</p>`;
    } else {
        tabObs += `<div class="observacoes-list-view">`;
        notas.forEach(n => {
            tabObs += `
                <div class="observacao-item-view">
                    <div class="observacao-header">
                        <span class="observacao-data">${n.data || ''}</span>
                    </div>
                    <p class="observacao-texto">${n.texto || ''}</p>
                </div>`;
        });
        tabObs += `</div>`;
    }
    tabObs += `</div>`;

    const html = `
        <div class="modal-overlay show" id="viewModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">NF ${c.numero_nf || ''}</h3>
                    <button class="close-modal" onclick="document.getElementById('viewModal').remove()">✕</button>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchViewTab('vtab-geral',this)">Geral</button>
                        <button class="tab-btn" onclick="switchViewTab('vtab-valores',this)">Valores e Datas</button>
                        <button class="tab-btn" onclick="switchViewTab('vtab-parcelas',this)">Pagamento Parcelado</button>
                        <button class="tab-btn" onclick="switchViewTab('vtab-obs',this)">Observações</button>
                    </div>
                    <div id="vtab-geral"    class="tab-content active">${tabGeral}</div>
                    <div id="vtab-valores"  class="tab-content">${tabValores}</div>
                    <div id="vtab-parcelas" class="tab-content">${tabParcelas}</div>
                    <div id="vtab-obs"      class="tab-content">${tabObs}</div>
                </div>
                <div class="modal-actions">
                    <button class="btn-cancel" onclick="document.getElementById('viewModal').remove()">Fechar</button>
                </div>
            </div>
        </div>`;

    document.getElementById('viewModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);
}

window.switchViewTab = function(tabId, btn) {
    const modal = document.getElementById('viewModal');
    modal.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    btn.classList.add('active');
};

// ============================================
// MODAL DE FORMULÁRIO (por abas)
// ============================================
window.toggleForm    = function() { showFormModal(null); };
window.showFormModal = function(editingId = null, focusPagamento = false, focusValores = false) {
    const isEditing = editingId !== null;
    const c = isEditing ? contas.find(x => String(x.id) === String(editingId)) : null;

    const notas    = c ? getObservacoesTexto(c) : [];
    const parcelas = c ? getParcelas(c) : [];
    _editingParcelasTemp = JSON.parse(JSON.stringify(parcelas));

    // Calcular valor pago total das parcelas existentes
    const valorPagoAtual = _editingParcelasTemp.length > 0
        ? _editingParcelasTemp.reduce((s, p) => s + parseFloat(p.valor || 0), 0)
        : parseFloat(c?.valor_pago || 0);

    // Data de pagamento atual
    let dataPgAtual = c?.data_pagamento || '';
    if (_editingParcelasTemp.length > 0) {
        const datas = _editingParcelasTemp.map(p => p.data).filter(Boolean).sort();
        if (datas.length > 0) dataPgAtual = datas[datas.length - 1];
    }

    // Aba inicial
    const activeTab = focusPagamento ? 2 : (focusValores ? 1 : 0);
    const tabActive = (idx) => activeTab === idx ? 'active' : '';

    const html = `
        <div class="modal-overlay show" id="formModal">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Conta' : 'Nova Conta a Receber'}</h3>
                    <button class="close-modal" onclick="closeFormModal()">✕</button>
                </div>

                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn ${tabActive(0)}" onclick="switchFormTab('ftab-geral',this)">Geral</button>
                        <button class="tab-btn ${tabActive(1)}" onclick="switchFormTab('ftab-valores',this)">Valores e Datas</button>
                        <button class="tab-btn ${tabActive(2)}" onclick="switchFormTab('ftab-parcelas',this)">Pagamento Parcelado</button>
                        <button class="tab-btn ${tabActive(3)}" onclick="switchFormTab('ftab-obs',this)">Observações</button>
                    </div>

                    <!-- ABA: GERAL -->
                    <div id="ftab-geral" class="tab-content ${tabActive(0)}">
                        <div class="form-grid">
                            <div class="form-group">
                                <label>Número NF *</label>
                                <input type="text" id="f_numero_nf" value="${c?.numero_nf || ''}" required>
                            </div>
                            <div class="form-group">
                                <label>Órgão *</label>
                                <input type="text" id="f_orgao" value="${c?.orgao || ''}" required>
                            </div>
                            <div class="form-group">
                                <label>Vendedor *</label>
                                <select id="f_vendedor">
                                    <option value="">Selecione...</option>
                                    <option value="ROBERTO" ${c?.vendedor==='ROBERTO'?'selected':''}>ROBERTO</option>
                                    <option value="ISAQUE"  ${c?.vendedor==='ISAQUE' ?'selected':''}>ISAQUE</option>
                                    <option value="MIGUEL"  ${c?.vendedor==='MIGUEL' ?'selected':''}>MIGUEL</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Banco</label>
                                <input type="text" id="f_banco" value="${c?.banco || ''}">
                            </div>
                            <div class="form-group">
                                <label>Tipo NF</label>
                                <select id="f_tipo_nf">
                                    <option value="ENVIO"             ${(!c||c.tipo_nf==='ENVIO')              ?'selected':''}>Envio</option>
                                    <option value="CANCELADA"         ${c?.tipo_nf==='CANCELADA'               ?'selected':''}>Cancelada</option>
                                    <option value="REMESSA DE AMOSTRA"${c?.tipo_nf==='REMESSA DE AMOSTRA'      ?'selected':''}>Remessa de Amostra</option>
                                    <option value="SIMPLES REMESSA"   ${c?.tipo_nf==='SIMPLES REMESSA'         ?'selected':''}>Simples Remessa</option>
                                    <option value="DEVOLUÇÃO"         ${c?.tipo_nf==='DEVOLUÇÃO'               ?'selected':''}>Devolução</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Status</label>
                                <select id="f_status">
                                    <option value="A RECEBER" ${(!c||c.status==='A RECEBER')?'selected':''}>A Receber</option>
                                    <option value="PAGO"      ${c?.status==='PAGO'         ?'selected':''}>Pago</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <!-- ABA: VALORES E DATAS -->
                    <div id="ftab-valores" class="tab-content ${tabActive(1)}">
                        <div class="form-grid">
                            <div class="form-group">
                                <label>Valor NF (R$)</label>
                                <input type="number" id="f_valor" step="0.01" min="0" value="${c?.valor || ''}">
                            </div>
                            <div class="form-group">
                                <label>Valor Pago Total (R$)</label>
                                <input type="number" id="f_valor_pago" step="0.01" min="0" value="${valorPagoAtual > 0 ? valorPagoAtual.toFixed(2) : (c?.valor_pago || '')}">
                            </div>
                            <div class="form-group">
                                <label>Data Emissão *</label>
                                <input type="date" id="f_data_emissao" value="${c?.data_emissao || ''}" required>
                            </div>
                            <div class="form-group">
                                <label>Vencimento</label>
                                <input type="date" id="f_data_vencimento" value="${c?.data_vencimento || ''}">
                            </div>
                            <div class="form-group">
                                <label>Data Pagamento</label>
                                <input type="date" id="f_data_pagamento" value="${dataPgAtual}">
                            </div>
                        </div>
                    </div>

                    <!-- ABA: PAGAMENTO PARCELADO -->
                    <div id="ftab-parcelas" class="tab-content ${tabActive(2)}">
                        <div style="margin-bottom:1rem;">
                            <button type="button" class="btn-add-obs" onclick="adicionarParcelaForm()">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                Adicionar Parcela
                            </button>
                        </div>
                        <div id="parcelasFormList"></div>
                    </div>

                    <!-- ABA: OBSERVAÇÕES -->
                    <div id="ftab-obs" class="tab-content ${tabActive(3)}">
                        <div class="observacoes-section">
                            <div class="observacoes-list" id="obsFormList">
                                ${notas.map((n, i) => `
                                    <div class="observacao-item" id="obs-form-${i}">
                                        <div class="observacao-header">
                                            <span class="observacao-data">${n.data || ''}</span>
                                            <button type="button" class="btn-remove-obs" onclick="removerObsForm(${i})">✕</button>
                                        </div>
                                        <p class="observacao-texto">${n.texto || ''}</p>
                                    </div>`).join('')}
                            </div>
                            <div class="nova-observacao">
                                <h4>Nova Observação</h4>
                                <textarea id="novaObsInput" placeholder="Digite uma observação..."></textarea>
                                <button type="button" class="btn-add-obs" onclick="adicionarObsForm()">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    Adicionar Observação
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- AÇÕES DO MODAL -->
                <div class="modal-actions">
                    <div style="display:flex;gap:.75rem;flex-wrap:wrap;">
                        <button type="button" id="btnFormPrev" class="btn-tab-nav btn-prev" onclick="navFormTab(-1)">← Anterior</button>
                        <button type="button" id="btnFormNext" class="btn-tab-nav btn-next" onclick="navFormTab(1)">Próximo →</button>
                        <button type="button" id="btnFormSave" class="btn-save-form" onclick="handleSubmitForm('${editingId || ''}')">
                            ${isEditing ? 'Atualizar' : 'Salvar'}
                        </button>
                    </div>
                    <button type="button" class="btn-cancel" onclick="closeFormModal()">Cancelar</button>
                </div>
            </div>
        </div>`;

    document.getElementById('formModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', html);

    // Maiúsculas automáticas
    ['f_numero_nf', 'f_orgao', 'f_banco'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', e => {
            const s = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(s, s);
        });
    });

    // Renderizar parcelas existentes
    renderParcelasForm();
    window._formTabIndex = activeTab;
    updateFormNavState();
};

// Abas do formulário
const FORM_TABS = ['ftab-geral', 'ftab-valores', 'ftab-parcelas', 'ftab-obs'];

window.switchFormTab = function(tabId, btn) {
    const modal = document.getElementById('formModal');
    if (!modal) return;
    modal.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    modal.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.getElementById(tabId)?.classList.add('active');
    btn?.classList.add('active');
    window._formTabIndex = FORM_TABS.indexOf(tabId);
    updateFormNavState();
};

window.navFormTab = function(dir) {
    const idx = (window._formTabIndex || 0) + dir;
    if (idx < 0 || idx >= FORM_TABS.length) return;
    const tabId = FORM_TABS[idx];
    const btn = document.querySelector(`#formModal .tab-btn:nth-child(${idx+1})`);
    switchFormTab(tabId, btn);
};

function updateFormNavState() {
    const idx  = window._formTabIndex || 0;
    const prev = document.getElementById('btnFormPrev');
    const next = document.getElementById('btnFormNext');
    const save = document.getElementById('btnFormSave');
    if (prev) prev.style.display = idx === 0 ? 'none' : 'inline-flex';
    if (next) next.style.display = idx === FORM_TABS.length - 1 ? 'none' : 'inline-flex';
    if (save) save.style.display = 'inline-flex'; // sempre visível
}

window.closeFormModal = function() {
    const modal = document.getElementById('formModal');
    if (modal) modal.remove();
    _editingParcelasTemp = [];
};

// ============================================
// PARCELAS NO FORMULÁRIO
// ============================================
function renderParcelasForm() {
    const container = document.getElementById('parcelasFormList');
    if (!container) return;

    if (_editingParcelasTemp.length === 0) {
        container.innerHTML = `<p style="color:var(--text-secondary);font-style:italic;text-align:center;padding:1rem 0;">Nenhuma parcela adicionada ainda.</p>`;
        return;
    }

    container.innerHTML = _editingParcelasTemp.map((p, i) => `
        <div class="observacao-item" style="margin-bottom:.75rem;">
            <div class="observacao-header">
                <span class="observacao-data" style="font-weight:600;color:var(--text-primary);">${p.numero || (i+1) + 'ª Parcela'}</span>
                <button type="button" class="btn-remove-obs" onclick="removerParcelaForm(${i})">✕</button>
            </div>
            <div class="form-grid" style="margin-top:.5rem;">
                <div class="form-group">
                    <label>Valor (R$)</label>
                    <input type="number" step="0.01" min="0" value="${p.valor || ''}"
                        onchange="_editingParcelasTemp[${i}].valor = parseFloat(this.value)||0; atualizarValorPagoForm();">
                </div>
                <div class="form-group">
                    <label>Data de Pagamento</label>
                    <input type="date" value="${p.data || ''}"
                        onchange="_editingParcelasTemp[${i}].data = this.value; atualizarValorPagoForm();">
                </div>
            </div>
        </div>`).join('');
}

window.adicionarParcelaForm = function() {
    const numero = (_editingParcelasTemp.length + 1);
    const sufixos = ['ª','ª','ª','ª','ª','ª','ª','ª','ª','ª'];
    const label = numero + (sufixos[numero-1] || 'ª') + ' Parcela';
    _editingParcelasTemp.push({ numero: label, valor: 0, data: '' });
    renderParcelasForm();
    atualizarValorPagoForm();
};

window.removerParcelaForm = function(i) {
    _editingParcelasTemp.splice(i, 1);
    // Renumerar
    _editingParcelasTemp.forEach((p, idx) => {
        p.numero = (idx + 1) + 'ª Parcela';
    });
    renderParcelasForm();
    atualizarValorPagoForm();
};

function atualizarValorPagoForm() {
    const total = _editingParcelasTemp.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
    const elVP = document.getElementById('f_valor_pago');
    if (elVP && !elVP.dataset.manualEdit) {
        elVP.value = total > 0 ? total.toFixed(2) : '';
    }

    // Data de pagamento = última parcela com data preenchida
    const datas = _editingParcelasTemp.map(p => p.data).filter(Boolean).sort();
    const elData = document.getElementById('f_data_pagamento');
    if (elData && !elData.dataset.manualEdit) {
        elData.value = datas.length > 0 ? datas[datas.length - 1] : '';
    }
}

// Marcar como edição manual ao digitar diretamente nos campos
document.addEventListener('change', function(e) {
    if (e.target.id === 'f_valor_pago' || e.target.id === 'f_data_pagamento') {
        e.target.dataset.manualEdit = '1';
    }
});

// ============================================
// OBSERVAÇÕES NO FORMULÁRIO
// ============================================
window.adicionarObsForm = function() {
    const input = document.getElementById('novaObsInput');
    if (!input || !input.value.trim()) return showToast('Digite uma observação primeiro', 'error');

    const notas = obterNotasForm();
    notas.push({
        texto: input.value.trim(),
        data: new Date().toLocaleString('pt-BR')
    });
    input.value = '';
    renderObsForm(notas);
};

window.removerObsForm = function(i) {
    const notas = obterNotasForm();
    notas.splice(i, 1);
    renderObsForm(notas);
};

function obterNotasForm() {
    const list = document.getElementById('obsFormList');
    if (!list) return [];
    const notas = [];
    list.querySelectorAll('.observacao-item').forEach(item => {
        notas.push({
            texto: item.querySelector('.observacao-texto')?.textContent || '',
            data:  item.querySelector('.observacao-data')?.textContent || ''
        });
    });
    return notas;
}

function renderObsForm(notas) {
    const list = document.getElementById('obsFormList');
    if (!list) return;
    list.innerHTML = notas.map((n, i) => `
        <div class="observacao-item" id="obs-form-${i}">
            <div class="observacao-header">
                <span class="observacao-data">${n.data || ''}</span>
                <button type="button" class="btn-remove-obs" onclick="removerObsForm(${i})">✕</button>
            </div>
            <p class="observacao-texto">${n.texto || ''}</p>
        </div>`).join('');
}

// ============================================
// SUBMIT DO FORMULÁRIO
// ============================================
window.handleSubmitForm = async function(editId) {
    const numero_nf     = document.getElementById('f_numero_nf')?.value.trim();
    const orgao         = document.getElementById('f_orgao')?.value.trim();
    const vendedor      = document.getElementById('f_vendedor')?.value;
    const banco         = document.getElementById('f_banco')?.value.trim() || null;
    const tipo_nf       = document.getElementById('f_tipo_nf')?.value;
    const valor         = parseFloat(document.getElementById('f_valor')?.value) || 0;
    const data_emissao  = document.getElementById('f_data_emissao')?.value;
    const data_vencimento = document.getElementById('f_data_vencimento')?.value || null;

    if (!numero_nf || !orgao || !vendedor || !data_emissao) {
        showToast('Preencha os campos obrigatórios: NF, Órgão, Vendedor e Data Emissão', 'error');
        return;
    }

    // Parcelas
    const parcelas = _editingParcelasTemp.filter(p => p.valor > 0 || p.data);
    const totalParcelas = parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);

    // Validação: se há parcelas, todas precisam de data
    for (const p of parcelas) {
        if (p.valor > 0 && !p.data) {
            showToast(`Preencha a data de pagamento da ${p.numero}`, 'error');
            return;
        }
    }

    // Valor pago: lê o campo (pode ser manual ou calculado pelas parcelas)
    const valorPagoCampo = parseFloat(document.getElementById('f_valor_pago')?.value) || 0;
    const valorPago = parcelas.length > 0 ? totalParcelas : valorPagoCampo;

    // Data de pagamento: lê o campo (pode ser manual ou automático)
    let data_pagamento = document.getElementById('f_data_pagamento')?.value || null;
    if (parcelas.length > 0 && !document.getElementById('f_data_pagamento')?.dataset.manualEdit) {
        const datas = parcelas.map(p => p.data).filter(Boolean).sort();
        data_pagamento = datas.length > 0 ? datas[datas.length - 1] : null;
    }

    // Status
    let status = document.getElementById('f_status')?.value || 'A RECEBER';
    if (parcelas.length > 0) {
        if (totalParcelas >= valor && valor > 0) {
            status = 'PAGO';
        } else if (totalParcelas > 0) {
            // Ordinal: "1ª PARCELA", "2ª PARCELA"...
            status = parcelas.length + 'ª PARCELA';
        }
    } else if (valorPago > 0 && valor > 0 && valorPago >= valor) {
        status = 'PAGO';
    }

    const notas = obterNotasForm();
    const observacoes = buildObservacoesJson(notas, parcelas);

    const formData = {
        numero_nf, orgao, vendedor, banco, tipo_nf,
        valor, valor_pago: valorPago,
        data_emissao, data_vencimento, data_pagamento,
        status, observacoes
    };

    await salvarConta(editId || null, formData, false);
};

// ============================================
// SALVAR CONTA (API)
// ============================================
async function salvarConta(id, data, silencioso = false) {
    if (!isOnline && !DEVELOPMENT_MODE) {
        showToast('Sistema offline. Não foi possível salvar.', 'error');
        return;
    }

    try {
        const url    = id ? `${API_URL}/receber/${id}` : `${API_URL}/receber`;
        const method = id ? 'PUT' : 'POST';

        const r = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify(data)
        });

        if (!DEVELOPMENT_MODE && r.status === 401) {
            sessionStorage.removeItem('receberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!r.ok) {
            const err = await r.json();
            throw new Error(err.details || err.error || 'Erro ao salvar');
        }

        const saved = await r.json();

        if (id) {
            const idx = contas.findIndex(x => String(x.id) === String(id));
            if (idx !== -1) contas[idx] = saved;
        } else {
            contas.push(saved);
        }

        updateFilters();
        updateDashboard();
        filterContas();

        if (!silencioso) {
            showToast(id ? `NF ${data.numero_nf || ''} atualizada` : `NF ${data.numero_nf || ''} registrada`, 'success');
            closeFormModal();
        }
    } catch (err) {
        console.error('❌ Erro:', err);
        showToast(`Erro: ${err.message}`, 'error');
    }
}

// ============================================
// MODAL DE VENCIDOS
// ============================================
window.showVencidosModal = function() {
    const hoje = new Date().toISOString().split('T')[0];
    const vencidos = contas.filter(c =>
        c.status === 'A RECEBER' && c.data_vencimento && c.data_vencimento < hoje
    ).sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));

    const body = document.getElementById('vencidosModalBody');
    if (!body) return;

    if (vencidos.length === 0) {
        body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma conta vencida</div>';
    } else {
        body.innerHTML = `
            <div style="overflow-x:auto;">
                <table>
                    <thead><tr><th>NF</th><th>Órgão</th><th>Vendedor</th><th>Vencimento</th><th>Valor</th></tr></thead>
                    <tbody>
                        ${vencidos.map(c => `
                            <tr>
                                <td><strong>${c.numero_nf || '-'}</strong></td>
                                <td>${c.orgao || '-'}</td>
                                <td>${c.vendedor || '-'}</td>
                                <td style="color:#EF4444;font-weight:600;">${formatDate(c.data_vencimento)}</td>
                                <td>R$ ${parseFloat(c.valor || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</td>
                            </tr>`).join('')}
                    </tbody>
                </table>
            </div>`;
    }

    const modal = document.getElementById('vencidosModal');
    if (modal) modal.style.display = 'flex';
};

window.closeVencidosModal = function() {
    const modal = document.getElementById('vencidosModal');
    if (modal) modal.style.display = 'none';
};

// ============================================
// UTILITÁRIOS
// ============================================
function formatDate(d) {
    if (!d) return '-';
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

function showToast(message, type) {
    document.querySelectorAll('.floating-message').forEach(m => m.remove());
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOutBottom 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

console.log('✅ Script contas a receber carregado com sucesso!');
