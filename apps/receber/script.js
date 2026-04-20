// ============================================
// CONFIGURAÇÃO
// ============================================
const DEVELOPMENT_MODE = false;
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let contas = [];
let isOnline = false;
let sessionToken = null;
let currentMonth = new Date();
let currentYear = new Date().getFullYear();
let showAllMonths = false;

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
async function loadContas(showMessage = false) {
    if (!isOnline && !DEVELOPMENT_MODE) {
        if (showMessage) showToast('Sistema offline. Não foi possível sincronizar.', 'error');
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
            if (showMessage) showToast('Erro ao sincronizar dados', 'error');
            return;
        }

        contas = await response.json();
        console.log(`✅ ${contas.length} contas carregadas`);

        updateFilters();
        updateDashboard();
        filterContas();

        // Alerta de vencidos (apenas uma vez por sessão)
        if (!sessionStorage.getItem('alertaVencidosExibido')) {
            setTimeout(verificarVencidos, 1000);
            sessionStorage.setItem('alertaVencidosExibido', 'true');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar contas:', error);
        if (showMessage) showToast('Erro ao sincronizar dados', 'error');
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
            el.textContent = `${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
        }
    }
    updateDashboard();
    filterContas();
}

window.changeMonth = function (direction) {
    showAllMonths = false;
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);
    currentYear = currentMonth.getFullYear();
    updateMonthDisplay();
};

window.updateMonthDisplay = updateMonthDisplay;

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const filtered = getContasFiltradas();

    const pago = filtered
        .filter(c => c.status === 'PAGO')
        .reduce((s, c) => s + parseFloat(c.valor || 0), 0);

    const receber = filtered
        .filter(c => c.status === 'A RECEBER')
        .reduce((s, c) => s + parseFloat(c.valor || 0), 0);

    const hoje = new Date().toISOString().split('T')[0];
    const vencido = filtered.filter(c =>
        c.status === 'A RECEBER' && c.data_vencimento && c.data_vencimento < hoje
    ).length;

    const faturado = pago + receber;

    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const el = id => document.getElementById(id);
    if (el('statPago')) el('statPago').textContent = fmt(pago);
    if (el('statReceber')) el('statReceber').textContent = fmt(receber);
    if (el('statFaturado')) el('statFaturado').textContent = fmt(faturado);
    if (el('statVencido')) el('statVencido').textContent = vencido;

    const cardVencido = el('cardVencido');
    if (cardVencido) {
        if (vencido > 0) {
            cardVencido.classList.add('has-alert');
        } else {
            cardVencido.classList.remove('has-alert');
        }
    }
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
        return d.getMonth() === currentMonth.getMonth() &&
               d.getFullYear() === currentMonth.getFullYear();
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
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const vendedor = document.getElementById('filterVendedor')?.value || '';
    const banco = document.getElementById('filterBanco')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';

    let filtered = getContasFiltradas();

    if (vendedor) filtered = filtered.filter(c => c.vendedor === vendedor);
    if (banco) filtered = filtered.filter(c => c.banco === banco);
    if (status) filtered = filtered.filter(c => c.status === status);
    if (search) {
        filtered = filtered.filter(c => {
            return [c.numero_nf, c.orgao, c.vendedor, c.banco, c.status]
                .some(f => f && f.toString().toLowerCase().includes(search));
        });
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
// RENDERIZAÇÃO
// ============================================
function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if (!container) return;

    if (!lista || lista.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhuma conta encontrada</div>';
        return;
    }

    const hoje = new Date().toISOString().split('T')[0];

    container.innerHTML = `
        <div style="overflow-x: auto;">
            <table>
                <thead>
                    <tr>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Vendedor</th>
                        <th>Banco</th>
                        <th>Valor</th>
                        <th>Vencimento</th>
                        <th>Status</th>
                        <th style="text-align: center;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${lista.map(c => {
                        const isPago = c.status === 'PAGO';
                        const isVencido = !isPago && c.data_vencimento && c.data_vencimento < hoje;
                        return `
                        <tr class="${isPago ? 'row-entregue' : ''}" data-id="${c.id}">
                            <td><strong>${c.numero_nf || '-'}</strong></td>
                            <td style="max-width: 200px; word-wrap: break-word; white-space: normal;">${c.orgao || '-'}</td>
                            <td>${c.vendedor || '-'}</td>
                            <td>${c.banco || '-'}</td>
                            <td><strong>R$ ${parseFloat(c.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></td>
                            <td style="white-space: nowrap; ${isVencido ? 'color: #EF4444; font-weight: 600;' : ''}">${c.data_vencimento ? formatDate(c.data_vencimento) : '-'}</td>
                            <td>${getStatusBadge(c, hoje)}</td>
                            <td class="actions-cell" style="text-align: center; white-space: nowrap;">
                                <button class="action-btn view" onclick="handleViewClick('${c.id}')" title="Ver detalhes">Ver</button>
                                <button class="action-btn edit" onclick="handleEditClick('${c.id}')" title="Editar">Editar</button>
                                <button class="action-btn delete" onclick="handleDeleteClick('${c.id}')" title="Excluir">Excluir</button>
                            </td>
                        </tr>`;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getStatusBadge(conta, hoje) {
    if (conta.status === 'PAGO') {
        return '<span class="badge entregue">PAGO</span>';
    }
    if (conta.data_vencimento && conta.data_vencimento < hoje) {
        return '<span class="badge devolvido">VENCIDO</span>';
    }
    return '<span class="badge transito">A RECEBER</span>';
}

// ============================================
// AÇÕES
// ============================================
window.handleViewClick = function (id) {
    const c = contas.find(x => String(x.id) === String(id));
    if (!c) return showToast('Conta não encontrada!', 'error');

    const fmt = v => v ? `R$ ${parseFloat(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';
    const d = v => v ? formatDate(v) : '-';

    const html = `
        <div class="info-section">
            <h4>Dados da Conta</h4>
            <p><strong>Número NF:</strong> ${c.numero_nf || '-'}</p>
            <p><strong>Órgão:</strong> ${c.orgao || '-'}</p>
            <p><strong>Vendedor:</strong> ${c.vendedor || '-'}</p>
            <p><strong>Banco:</strong> ${c.banco || '-'}</p>
            <p><strong>Valor:</strong> ${fmt(c.valor)}</p>
            <p><strong>Valor Pago:</strong> ${fmt(c.valor_pago)}</p>
            <p><strong>Data Emissão:</strong> ${d(c.data_emissao)}</p>
            <p><strong>Vencimento:</strong> ${d(c.data_vencimento)}</p>
            <p><strong>Data Pagamento:</strong> ${d(c.data_pagamento)}</p>
            <p><strong>Status:</strong> ${c.status || '-'}</p>
            <p><strong>Tipo NF:</strong> ${c.tipo_nf || '-'}</p>
        </div>
    `;

    // Reutilizar modal de vencidos com conteúdo dinâmico
    const modal = document.getElementById('vencidosModal');
    const body = document.getElementById('vencidosModalBody');
    if (modal && body) {
        body.innerHTML = html;
        modal.style.display = 'flex';
    }
};

window.handleEditClick = function (id) {
    const c = contas.find(x => String(x.id) === String(id));
    if (!c) return showToast('Conta não encontrada!', 'error');
    showFormModal(id);
};

window.handleDeleteClick = async function (id) {
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
// FORMULÁRIO
// ============================================
window.toggleForm = function () { showFormModal(null); };

window.showFormModal = function (editingId = null) {
    const isEditing = editingId !== null;
    const c = isEditing ? contas.find(x => String(x.id) === String(editingId)) : null;

    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Conta' : 'Nova Conta a Receber'}</h3>
                    <button class="close-modal" onclick="closeFormModal(true)">✕</button>
                </div>
                <form id="contaForm" onsubmit="handleSubmit(event)">
                    <input type="hidden" id="editId" value="${editingId || ''}">
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="numero_nf">Número NF *</label>
                            <input type="text" id="numero_nf" value="${c?.numero_nf || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="orgao">Órgão *</label>
                            <input type="text" id="orgao" value="${c?.orgao || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="vendedor">Vendedor *</label>
                            <select id="vendedor">
                                <option value="">Selecione...</option>
                                <option value="ROBERTO" ${c?.vendedor === 'ROBERTO' ? 'selected' : ''}>ROBERTO</option>
                                <option value="ISAQUE" ${c?.vendedor === 'ISAQUE' ? 'selected' : ''}>ISAQUE</option>
                                <option value="MIGUEL" ${c?.vendedor === 'MIGUEL' ? 'selected' : ''}>MIGUEL</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="banco">Banco</label>
                            <input type="text" id="banco" value="${c?.banco || ''}">
                        </div>
                        <div class="form-group">
                            <label for="valor">Valor (R$)</label>
                            <input type="number" id="valor" step="0.01" min="0" value="${c?.valor || ''}">
                        </div>
                        <div class="form-group">
                            <label for="valor_pago">Valor Pago (R$)</label>
                            <input type="number" id="valor_pago" step="0.01" min="0" value="${c?.valor_pago || '0'}">
                        </div>
                        <div class="form-group">
                            <label for="data_emissao">Data Emissão *</label>
                            <input type="date" id="data_emissao" value="${c?.data_emissao || ''}" required>
                        </div>
                        <div class="form-group">
                            <label for="data_vencimento">Vencimento</label>
                            <input type="date" id="data_vencimento" value="${c?.data_vencimento || ''}">
                        </div>
                        <div class="form-group">
                            <label for="data_pagamento">Data Pagamento</label>
                            <input type="date" id="data_pagamento" value="${c?.data_pagamento || ''}">
                        </div>
                        <div class="form-group">
                            <label for="status">Status</label>
                            <select id="status">
                                <option value="A RECEBER" ${!c || c.status === 'A RECEBER' ? 'selected' : ''}>A Receber</option>
                                <option value="PAGO" ${c?.status === 'PAGO' ? 'selected' : ''}>Pago</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="tipo_nf">Tipo NF</label>
                            <select id="tipo_nf">
                                <option value="ENVIO" ${!c || c.tipo_nf === 'ENVIO' ? 'selected' : ''}>Envio</option>
                                <option value="CANCELADA" ${c?.tipo_nf === 'CANCELADA' ? 'selected' : ''}>Cancelada</option>
                                <option value="REMESSA DE AMOSTRA" ${c?.tipo_nf === 'REMESSA DE AMOSTRA' ? 'selected' : ''}>Remessa de Amostra</option>
                                <option value="SIMPLES REMESSA" ${c?.tipo_nf === 'SIMPLES REMESSA' ? 'selected' : ''}>Simples Remessa</option>
                                <option value="DEVOLUÇÃO" ${c?.tipo_nf === 'DEVOLUÇÃO' ? 'selected' : ''}>Devolução</option>
                            </select>
                        </div>
                    </div>
                    <div class="modal-actions">
                        <button type="submit" class="save">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        <button type="button" class="secondary" onclick="closeFormModal(true)">Cancelar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

    document.getElementById('formModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Maiúsculas automáticas
    ['numero_nf', 'orgao', 'banco'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', e => {
            const s = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(s, s);
        });
    });
};

window.closeFormModal = function (showMsg = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        const editId = document.getElementById('editId')?.value;
        if (showMsg) showToast(editId ? 'Atualização cancelada' : 'Registro cancelado', 'error');
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
};

window.handleSubmit = async function (event) {
    event.preventDefault();

    const editId = document.getElementById('editId').value;
    const formData = {
        numero_nf: document.getElementById('numero_nf').value.trim(),
        orgao: document.getElementById('orgao').value.trim(),
        vendedor: document.getElementById('vendedor').value,
        banco: document.getElementById('banco').value.trim() || null,
        valor: parseFloat(document.getElementById('valor').value) || 0,
        valor_pago: parseFloat(document.getElementById('valor_pago').value) || 0,
        data_emissao: document.getElementById('data_emissao').value,
        data_vencimento: document.getElementById('data_vencimento').value || null,
        data_pagamento: document.getElementById('data_pagamento').value || null,
        status: document.getElementById('status').value,
        tipo_nf: document.getElementById('tipo_nf').value
    };

    if (!isOnline && !DEVELOPMENT_MODE) {
        showToast('Sistema offline. Não foi possível salvar.', 'error');
        closeFormModal();
        return;
    }

    try {
        const url = editId ? `${API_URL}/receber/${editId}` : `${API_URL}/receber`;
        const method = editId ? 'PUT' : 'POST';

        const r = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify(formData)
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

        if (editId) {
            const idx = contas.findIndex(x => String(x.id) === String(editId));
            if (idx !== -1) contas[idx] = saved;
            showToast(`NF ${formData.numero_nf} atualizada`, 'success');
        } else {
            contas.push(saved);
            showToast(`NF ${formData.numero_nf} registrada`, 'success');
        }

        updateFilters();
        updateDashboard();
        filterContas();
        closeFormModal();
    } catch (err) {
        console.error('❌ Erro:', err);
        showToast(`Erro: ${err.message}`, 'error');
        closeFormModal();
    }
};

// ============================================
// MODAL DE VENCIDOS
// ============================================
window.showVencidosModal = function () {
    const hoje = new Date().toISOString().split('T')[0];
    const vencidos = contas.filter(c =>
        c.status === 'A RECEBER' && c.data_vencimento && c.data_vencimento < hoje
    ).sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));

    const body = document.getElementById('vencidosModalBody');
    if (!body) return;

    if (vencidos.length === 0) {
        body.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhuma conta vencida</div>';
    } else {
        body.innerHTML = `
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>NF</th>
                            <th>Órgão</th>
                            <th>Vendedor</th>
                            <th>Vencimento</th>
                            <th>Valor</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${vencidos.map(c => `
                            <tr>
                                <td><strong>${c.numero_nf || '-'}</strong></td>
                                <td>${c.orgao || '-'}</td>
                                <td>${c.vendedor || '-'}</td>
                                <td style="color: #EF4444; font-weight: 600;">${formatDate(c.data_vencimento)}</td>
                                <td>R$ ${parseFloat(c.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    const modal = document.getElementById('vencidosModal');
    if (modal) modal.style.display = 'flex';
};

window.closeVencidosModal = function () {
    const modal = document.getElementById('vencidosModal');
    if (modal) modal.style.display = 'none';
};

function verificarVencidos() {
    const hoje = new Date().toISOString().split('T')[0];
    const vencidos = contas.filter(c =>
        c.status === 'A RECEBER' && c.data_vencimento && c.data_vencimento < hoje
    );
    if (vencidos.length > 0) {
        showToast(`⚠️ ${vencidos.length} conta(s) vencida(s)!`, 'error');
    }
}

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
