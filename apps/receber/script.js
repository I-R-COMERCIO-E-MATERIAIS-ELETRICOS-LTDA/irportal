// ============================================
// CONFIGURAÇÃO
// ============================================
const PORTAL_URL = 'https://ir-comercio-portal-zcan.onrender.com';
const API_URL = 'https://contas-receber-m1xw.onrender.com/api';
const NOTIFICATION_KEY = 'contasReceberNotificationShown';

let contas = [];
let isOnline = false;
let lastDataHash = '';
let sessionToken = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let showAllMonths = false;
let currentTabIndex = 0;
const tabs = ['tab-basico', 'tab-valores', 'tab-parcelas', 'tab-observacoes'];

// Variáveis temporárias para parcelas no formulário
let editingParcelasTemp = [];

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

console.log('🚀 Contas a Receber iniciada');

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', verificarAutenticacao);
} else {
    verificarAutenticacao();
}

// ============================================
// FORMATAÇÃO
// ============================================
function formatCurrency(valor) {
    return 'R$ ' + valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
}

function formatDateTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

// ============================================
// NAVEGAÇÃO MENSAL
// ============================================
function updateMonthDisplay() {
    const display = document.getElementById('currentMonth');
    if (display) {
        if (showAllMonths) {
            display.textContent = `Todos os meses de ${currentYear}`;
        } else {
            display.textContent = `${meses[currentMonth]} ${currentYear}`;
        }
    }
    updateDashboard();
    filterContas();
}

window.changeMonth = function(direction) {
    showAllMonths = false;
    currentMonth += direction;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    } else if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    updateMonthDisplay();
};

window.toggleAllMonths = function() {
    showAllMonths = !showAllMonths;
    updateMonthDisplay();
};

// ============================================
// AUTENTICAÇÃO
// ============================================
function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('contasReceberSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('contasReceberSession');
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

async function inicializarApp() {
    updateMonthDisplay();
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    await loadContas();
    startPolling();
}

// ============================================
// CONEXÃO
// ============================================
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' },
            mode: 'cors'
        });
        if (response.status === 401) {
            sessionStorage.removeItem('contasReceberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }
        const wasOffline = !isOnline;
        isOnline = response.ok;
        if (wasOffline && isOnline) await loadContas();
        updateConnectionStatus();
        return isOnline;
    } catch {
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
async function loadContas() {
    if (!isOnline) return;
    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' },
            mode: 'cors'
        });
        if (response.status === 401) {
            sessionStorage.removeItem('contasReceberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        if (!response.ok) return;
        const data = await response.json();
        contas = data.map(mapearConta);
        const newHash = JSON.stringify(contas.map(c => c.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            console.log(`${contas.length} contas carregadas`);
            updateAllFilters();
            updateDashboard();
            filterContas();
            verificarContasVencidas();
        }
    } catch (error) {
        console.error('Erro ao carregar:', error);
    }
}

function mapearConta(conta) {
    let observacoesObj = { notas: [], parcelas: [] };
    if (conta.observacoes) {
        if (typeof conta.observacoes === 'string') {
            try {
                const parsed = JSON.parse(conta.observacoes);
                if (parsed.notas) observacoesObj.notas = parsed.notas;
                if (parsed.parcelas) observacoesObj.parcelas = parsed.parcelas;
                else if (Array.isArray(parsed)) observacoesObj.notas = parsed;
            } catch { observacoesObj.notas = [{ texto: conta.observacoes, data: new Date().toISOString() }]; }
        } else if (typeof conta.observacoes === 'object') {
            if (conta.observacoes.notas) observacoesObj.notas = conta.observacoes.notas;
            if (conta.observacoes.parcelas) observacoesObj.parcelas = conta.observacoes.parcelas;
            else if (Array.isArray(conta.observacoes)) observacoesObj.notas = conta.observacoes;
            else observacoesObj.notas = [conta.observacoes];
        }
    }
    return {
        id: conta.id,
        numero_nf: conta.numero_nf || '',
        orgao: conta.orgao || '',
        vendedor: conta.vendedor || '',
        banco: conta.banco || '',
        valor: parseFloat(conta.valor) || 0,
        valor_pago: parseFloat(conta.valor_pago) || 0,
        data_emissao: conta.data_emissao || '',
        data_vencimento: conta.data_vencimento || '',
        data_pagamento: conta.data_pagamento || null,
        status: conta.status || 'A RECEBER',
        tipo_nf: conta.tipo_nf || 'ENVIO',
        observacoes: observacoesObj,
        created_at: conta.created_at || new Date().toISOString()
    };
}

window.sincronizarDados = async function() {
    const btns = document.querySelectorAll('button[onclick="sincronizarDados()"]');
    btns.forEach(b => { const s = b.querySelector('svg'); if(s) s.style.animation = 'spin 1s linear infinite'; });
    await loadContas();
    showMessage('Dados sincronizados', 'success');
    setTimeout(() => {
        btns.forEach(b => { const s = b.querySelector('svg'); if(s) s.style.animation = ''; });
    }, 1000);
};

function startPolling() {
    setInterval(() => { if (isOnline) loadContas(); }, 30000);
}

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const contasPeriodo = contas.filter(c => {
        if (showAllMonths) {
            const data = new Date(c.data_emissao + 'T00:00:00');
            return data.getFullYear() === currentYear;
        } else {
            const data = new Date(c.data_emissao + 'T00:00:00');
            return data.getMonth() === currentMonth && data.getFullYear() === currentYear;
        }
    });

    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const totalFaturado = contasPeriodo.filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO').reduce((s,c) => s + c.valor, 0);
    const totalPago = contasPeriodo.filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO').reduce((s,c) => s + (c.valor_pago || 0), 0);
    
    const todasEnvio = contas.filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO');
    const quantidadeVencidas = todasEnvio.filter(c => {
        if (c.status === 'PAGO') return false;
        const venc = new Date(c.data_vencimento + 'T00:00:00');
        return venc < hoje;
    }).length;
    
    const totalReceber = totalFaturado - totalPago;
    document.getElementById('statFaturado').textContent = formatCurrency(totalFaturado);
    document.getElementById('statPago').textContent = formatCurrency(totalPago);
    document.getElementById('statReceber').textContent = formatCurrency(totalReceber);
    document.getElementById('statVencido').textContent = quantidadeVencidas;
    
    const badge = document.getElementById('pulseBadgeVencido');
    const card = document.getElementById('cardVencido');
    if (quantidadeVencidas > 0) {
        badge.style.display = 'flex';
        card.classList.add('has-alert');
    } else {
        badge.style.display = 'none';
        card.classList.remove('has-alert');
    }
}

function verificarContasVencidas() {
    if (sessionStorage.getItem(NOTIFICATION_KEY)) return;
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const vencidas = contas.filter(c => {
        if (c.tipo_nf && c.tipo_nf !== 'ENVIO') return false;
        if (c.status === 'PAGO') return false;
        const venc = new Date(c.data_vencimento + 'T00:00:00');
        return venc < hoje;
    });
    if (vencidas.length > 0) {
        mostrarNotificacaoVencidos(vencidas);
        sessionStorage.setItem(NOTIFICATION_KEY, 'true');
    }
}

function mostrarNotificacaoVencidos(contasVencidas) {
    const total = contasVencidas.reduce((s,c) => s + c.valor, 0);
    const modal = document.createElement('div');
    modal.id = 'notificationModal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:500px; border:3px solid #EF4444;">
            <div class="modal-header" style="background:#EF4444; color:white;">
                <h3 style="margin:0;">⚠️ Contas Vencidas</h3>
                <button class="close-modal" onclick="fecharNotificacaoVencidos()">✕</button>
            </div>
            <div style="padding:1.5rem;">
                <p>Você possui <strong>${contasVencidas.length} ${contasVencidas.length === 1 ? 'conta vencida' : 'contas vencidas'}</strong></p>
                <div style="background:#FEE; border-left:4px solid #EF4444; padding:1rem; margin:1rem 0;">
                    <strong>Total vencido:</strong> ${formatCurrency(total)}
                </div>
                <button onclick="fecharNotificacaoVencidos()" style="width:100%; background:#EF4444;">Entendi</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}
window.fecharNotificacaoVencidos = function() {
    const modal = document.getElementById('notificationModal');
    if (modal) modal.remove();
};

// ============================================
// MODAL DE VENCIDOS (lista)
// ============================================
let vencidosPage = 1;
const VENCIDOS_PER_PAGE = 5;
let vencidosData = [];

function renderVencidosTable() {
    const start = (vencidosPage-1)*VENCIDOS_PER_PAGE;
    const page = vencidosData.slice(start, start+VENCIDOS_PER_PAGE);
    const totalPages = Math.ceil(vencidosData.length / VENCIDOS_PER_PAGE);
    const body = document.getElementById('vencidosModalBody');
    if (!body) return;
    body.innerHTML = `
        <h3 style="color:#EF4444;">Contas Vencidas (${vencidosData.length})</h3>
        <div style="overflow-x:auto;">
            <table style="width:100%">
                <thead><tr><th>NF</th><th>Órgão</th><th>Valor</th><th>Vencimento</th></tr></thead>
                <tbody>
                    ${page.map(c => `
                        <tr>
                            <td><strong>${c.numero_nf}</strong></td>
                            <td>${c.orgao}</td>
                            <td>${formatCurrency(c.valor)}</td>
                            <td>${formatDate(c.data_vencimento)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div style="display:flex; justify-content:center; gap:1rem; margin-top:1rem;">
            <button class="secondary" onclick="changeVencidosPage(-1)" ${vencidosPage===1?'disabled':''}>Anterior</button>
            <span>Página ${vencidosPage} de ${totalPages}</span>
            <button class="secondary" onclick="changeVencidosPage(1)" ${vencidosPage===totalPages?'disabled':''}>Próximo</button>
        </div>
    `;
}
window.changeVencidosPage = function(delta) {
    const total = Math.ceil(vencidosData.length / VENCIDOS_PER_PAGE);
    const newPage = vencidosPage + delta;
    if (newPage >=1 && newPage <= total) {
        vencidosPage = newPage;
        renderVencidosTable();
    }
};
window.showVencidosModal = function() {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    vencidosData = contas.filter(c => {
        if (c.tipo_nf && c.tipo_nf !== 'ENVIO') return false;
        if (c.status === 'PAGO') return false;
        const venc = new Date(c.data_vencimento + 'T00:00:00');
        return venc < hoje;
    });
    if (vencidosData.length === 0) {
        showMessage('Nenhuma conta vencida', 'error');
        return;
    }
    vencidosPage = 1;
    renderVencidosTable();
    document.getElementById('vencidosModal').style.display = 'flex';
};
window.closeVencidosModal = function() {
    document.getElementById('vencidosModal').style.display = 'none';
};

// ============================================
// FORMULÁRIO (com abas e parcelas)
// ============================================
window.toggleForm = () => showFormModal(null);

function showFormModal(editingId = null) {
    // Remove modal existente
    const existingModal = document.getElementById('formModal');
    if (existingModal) existingModal.remove();
    
    const isEditing = !!editingId;
    let conta = null;
    if (isEditing) conta = contas.find(c => c.id === editingId);
    
    // Inicializa parcelas temporárias
    editingParcelasTemp = conta?.observacoes?.parcelas ? JSON.parse(JSON.stringify(conta.observacoes.parcelas)) : [];
    const notas = conta?.observacoes?.notas || [];
    
    currentTabIndex = 0;
    
    const obsHTML = notas.map((obs, idx) => `
        <div class="observacao-item">
            <div class="observacao-header">
                <span class="observacao-data">${formatDateTime(obs.data)}</span>
                <button type="button" class="btn-remove-obs" onclick="removerObservacao(${idx})">✕</button>
            </div>
            <p class="observacao-texto">${obs.texto}</p>
        </div>
    `).join('');
    
    const parcelasHTML = renderParcelasFormTemp();
    
    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display:flex;">
            <div class="modal-content" style="max-width: 950px;">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Conta' : 'Nova Conta'}</h3>
                    <button class="close-modal" onclick="closeFormModal()">✕</button>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchFormTab(0)">Geral</button>
                        <button class="tab-btn" onclick="switchFormTab(1)">Valores e Datas</button>
                        <button class="tab-btn" onclick="switchFormTab(2)">Pagamento Parcelado</button>
                        <button class="tab-btn" onclick="switchFormTab(3)">Observações</button>
                    </div>
                    <form id="contaForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="${editingId || ''}">
                        <input type="hidden" id="observacoesNotas" value='${JSON.stringify(notas)}'>
                        <div class="tab-content active" id="tab-basico">
                            <div class="form-grid">
                                <div class="form-group"><label>Número NF *</label><input type="text" id="numero_nf" value="${conta?.numero_nf || ''}" required></div>
                                <div class="form-group"><label>Órgão *</label><input type="text" id="orgao" value="${conta?.orgao || ''}" required></div>
                                <div class="form-group"><label>Vendedor *</label>
                                    <select id="vendedor" required>
                                        <option value="">Selecione</option>
                                        <option value="ROBERTO" ${conta?.vendedor==='ROBERTO'?'selected':''}>ROBERTO</option>
                                        <option value="ISAQUE" ${conta?.vendedor==='ISAQUE'?'selected':''}>ISAQUE</option>
                                        <option value="MIGUEL" ${conta?.vendedor==='MIGUEL'?'selected':''}>MIGUEL</option>
                                    </select>
                                </div>
                                <div class="form-group"><label>Banco *</label>
                                    <select id="banco" required>
                                        <option value="">Selecione</option>
                                        <option value="BANCO DO BRASIL" ${conta?.banco==='BANCO DO BRASIL'?'selected':''}>BANCO DO BRASIL</option>
                                        <option value="BRADESCO" ${conta?.banco==='BRADESCO'?'selected':''}>BRADESCO</option>
                                        <option value="SICOOB" ${conta?.banco==='SICOOB'?'selected':''}>SICOOB</option>
                                    </select>
                                </div>
                                <div class="form-group"><label>Tipo NF *</label>
                                    <select id="tipo_nf">
                                        <option value="ENVIO" ${!conta?.tipo_nf||conta.tipo_nf==='ENVIO'?'selected':''}>Envio</option>
                                        <option value="CANCELADA" ${conta?.tipo_nf==='CANCELADA'?'selected':''}>Cancelada</option>
                                        <option value="REMESSA_AMOSTRA" ${conta?.tipo_nf==='REMESSA_AMOSTRA'?'selected':''}>Remessa Amostra</option>
                                        <option value="SIMPLES_REMESSA" ${conta?.tipo_nf==='SIMPLES_REMESSA'?'selected':''}>Simples Remessa</option>
                                        <option value="DEVOLUCAO" ${conta?.tipo_nf==='DEVOLUCAO'?'selected':''}>Devolução</option>
                                        <option value="DEVOLVIDA" ${conta?.tipo_nf==='DEVOLVIDA'?'selected':''}>Devolvida</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                        <div class="tab-content" id="tab-valores">
                            <div class="form-grid">
                                <div class="form-group"><label>Valor NF (R$) *</label><input type="number" id="valor" step="0.01" value="${conta?.valor || ''}" required></div>
                                <div class="form-group"><label>Valor Pago Total (R$)</label><input type="number" id="valor_pago" step="0.01" value="${conta?.valor_pago || 0}" readonly style="background:#f0f0f0;"></div>
                                <div class="form-group"><label>Data Emissão *</label><input type="date" id="data_emissao" value="${conta?.data_emissao || new Date().toISOString().split('T')[0]}" required></div>
                                <div class="form-group"><label>Data Vencimento *</label><input type="date" id="data_vencimento" value="${conta?.data_vencimento || ''}" required></div>
                                <div class="form-group"><label>Data Pagamento</label><input type="date" id="data_pagamento" value="${conta?.data_pagamento || ''}"></div>
                            </div>
                        </div>
                        <div class="tab-content" id="tab-parcelas">
                            <div class="parcelas-section">
                                <div id="parcelasFormList" class="parcelas-list">${parcelasHTML}</div>
                                <div class="nova-parcela">
                                    <button type="button" class="btn-add-parcela" onclick="adicionarParcelaForm()">+ Adicionar Parcela</button>
                                </div>
                            </div>
                        </div>
                        <div class="tab-content" id="tab-observacoes">
                            <div class="observacoes-section">
                                <div class="observacoes-list" id="observacoesList">${obsHTML || '<p style="text-align:center; padding:1rem;">Nenhuma observação</p>'}</div>
                                <div class="nova-observacao">
                                    <textarea id="novaObservacao" placeholder="Digite uma observação..." rows="2"></textarea>
                                    <button type="button" class="btn-add-obs" onclick="adicionarObservacao()">+ Adicionar</button>
                                </div>
                            </div>
                        </div>
                        <div class="modal-actions">
                            <button type="button" id="btnPrevious" onclick="previousTab()" class="secondary" style="display:none;">Anterior</button>
                            <button type="button" id="btnNext" onclick="nextTab()" class="secondary">Próximo</button>
                            <button type="button" onclick="closeFormModal()" class="btn-cancel">Cancelar</button>
                            <button type="submit" id="btnSave" style="display:none;">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    // Aplica uppercase nos campos
    ['numero_nf','orgao'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', e => {
            const start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
        });
    });
    
    updateNavigationButtons();
    atualizarValorPagoForm();
    setTimeout(() => document.getElementById('numero_nf')?.focus(), 100);
}

function renderParcelasFormTemp() {
    if (editingParcelasTemp.length === 0) {
        return '<p style="text-align:center; padding:1rem;">Nenhuma parcela adicionada.</p>';
    }
    return editingParcelasTemp.map((p, i) => `
        <div class="parcela-item" data-index="${i}">
            <div class="parcela-header">
                <span class="parcela-data">${p.numero || (i+1)+'ª Parcela'}</span>
                <button type="button" class="btn-remove-parcela" onclick="removerParcelaForm(${i})">✕</button>
            </div>
            <div class="form-grid" style="margin-top:0.5rem;">
                <div class="form-group"><label>Valor (R$)</label><input type="number" step="0.01" min="0" value="${p.valor || 0}" onchange="editingParcelasTemp[${i}].valor = parseFloat(this.value)||0; atualizarValorPagoForm();"></div>
                <div class="form-group"><label>Data Pagamento</label><input type="date" value="${p.data || ''}" onchange="editingParcelasTemp[${i}].data = this.value; atualizarValorPagoForm();"></div>
            </div>
        </div>
    `).join('');
}

window.adicionarParcelaForm = function() {
    const numero = editingParcelasTemp.length + 1;
    editingParcelasTemp.push({ numero: numero + 'ª Parcela', valor: 0, data: '' });
    const container = document.getElementById('parcelasFormList');
    if (container) container.innerHTML = renderParcelasFormTemp();
    atualizarValorPagoForm();
};

window.removerParcelaForm = function(index) {
    editingParcelasTemp.splice(index, 1);
    editingParcelasTemp.forEach((p, idx) => p.numero = (idx+1) + 'ª Parcela');
    const container = document.getElementById('parcelasFormList');
    if (container) container.innerHTML = renderParcelasFormTemp();
    atualizarValorPagoForm();
};

function atualizarValorPagoForm() {
    const totalParcelas = editingParcelasTemp.reduce((s, p) => s + (parseFloat(p.valor) || 0), 0);
    const elValorPago = document.getElementById('valor_pago');
    if (elValorPago) elValorPago.value = totalParcelas > 0 ? totalParcelas.toFixed(2) : '0';
    
    // Atualiza data de pagamento com a última data das parcelas
    const datas = editingParcelasTemp.map(p => p.data).filter(Boolean).sort();
    const elDataPag = document.getElementById('data_pagamento');
    if (elDataPag && datas.length > 0) {
        elDataPag.value = datas[datas.length - 1];
    }
}

window.switchFormTab = function(idx) {
    currentTabIndex = idx;
    const btns = document.querySelectorAll('#formModal .tab-btn');
    const contents = document.querySelectorAll('#formModal .tab-content');
    btns.forEach((btn,i) => btn.classList.toggle('active', i===idx));
    contents.forEach((c,i) => c.classList.toggle('active', i===idx));
    updateNavigationButtons();
};
function nextTab() { if(currentTabIndex < tabs.length-1) switchFormTab(++currentTabIndex); }
function previousTab() { if(currentTabIndex > 0) switchFormTab(--currentTabIndex); }
function updateNavigationButtons() {
    const btnPrev = document.getElementById('btnPrevious');
    const btnNext = document.getElementById('btnNext');
    const btnSave = document.getElementById('btnSave');
    if(btnPrev) btnPrev.style.display = currentTabIndex===0 ? 'none' : 'inline-block';
    if(btnNext) btnNext.style.display = currentTabIndex===tabs.length-1 ? 'none' : 'inline-block';
    if(btnSave) btnSave.style.display = currentTabIndex===tabs.length-1 ? 'inline-block' : 'none';
}
window.closeFormModal = function() {
    const modal = document.getElementById('formModal');
    if(modal) modal.remove();
    editingParcelasTemp = [];
};

window.adicionarObservacao = function() {
    const textarea = document.getElementById('novaObservacao');
    const texto = textarea.value.trim().toUpperCase();
    if(!texto) return;
    const notas = JSON.parse(document.getElementById('observacoesNotas').value);
    notas.push({ texto, data: new Date().toISOString() });
    document.getElementById('observacoesNotas').value = JSON.stringify(notas);
    textarea.value = '';
    renderizarObservacoes();
};
window.removerObservacao = function(idx) {
    const notas = JSON.parse(document.getElementById('observacoesNotas').value);
    notas.splice(idx,1);
    document.getElementById('observacoesNotas').value = JSON.stringify(notas);
    renderizarObservacoes();
};
function renderizarObservacoes() {
    const notas = JSON.parse(document.getElementById('observacoesNotas').value);
    const container = document.getElementById('observacoesList');
    if(!container) return;
    if(notas.length===0) {
        container.innerHTML = '<p style="text-align:center; padding:1rem;">Nenhuma observação</p>';
        return;
    }
    container.innerHTML = notas.map((obs,idx)=>`
        <div class="observacao-item">
            <div class="observacao-header">
                <span class="observacao-data">${formatDateTime(obs.data)}</span>
                <button type="button" class="btn-remove-obs" onclick="removerObservacao(${idx})">✕</button>
            </div>
            <p class="observacao-texto">${obs.texto}</p>
        </div>
    `).join('');
}

// ============================================
// SUBMIT (salvar)
// ============================================
window.handleSubmit = async function(event) {
    if(event) event.preventDefault();
    const notas = JSON.parse(document.getElementById('observacoesNotas').value);
    const parcelas = editingParcelasTemp.filter(p => p.valor > 0 || p.data);
    // Validar parcelas
    for (const p of parcelas) {
        if (p.valor > 0 && !p.data) {
            showMessage(`Preencha a data de pagamento da ${p.numero}`, 'error');
            return;
        }
    }
    const totalParcelas = parcelas.reduce((s,p) => s + (parseFloat(p.valor)||0), 0);
    const valorPago = parcelas.length > 0 ? totalParcelas : (parseFloat(document.getElementById('valor_pago').value) || 0);
    let data_pagamento = document.getElementById('data_pagamento').value || null;
    if (parcelas.length > 0 && !data_pagamento) {
        const datas = parcelas.map(p => p.data).filter(Boolean).sort();
        if (datas.length > 0) data_pagamento = datas[datas.length - 1];
    }
    let status = 'A RECEBER';
    const valorTotal = parseFloat(document.getElementById('valor').value) || 0;
    if (parcelas.length > 0) {
        if (totalParcelas >= valorTotal && valorTotal > 0) status = 'PAGO';
        else if (totalParcelas > 0) status = parcelas.length + 'ª PARCELA';
    } else if (valorPago > 0 && valorPago >= valorTotal) {
        status = 'PAGO';
    }
    
    const formData = {
        numero_nf: document.getElementById('numero_nf').value.trim().toUpperCase(),
        orgao: document.getElementById('orgao').value.trim().toUpperCase(),
        vendedor: document.getElementById('vendedor').value,
        banco: document.getElementById('banco').value,
        valor: valorTotal,
        valor_pago: valorPago,
        data_emissao: document.getElementById('data_emissao').value,
        data_vencimento: document.getElementById('data_vencimento').value,
        data_pagamento: data_pagamento,
        tipo_nf: document.getElementById('tipo_nf').value,
        observacoes: { notas: notas, parcelas: parcelas },
        status: status
    };
    
    const editId = document.getElementById('editId').value;
    if(!isOnline) { closeFormModal(); return; }
    try {
        const url = editId ? `${API_URL}/contas/${editId}` : `${API_URL}/contas`;
        const method = editId ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type':'application/json', 'X-Session-Token':sessionToken },
            body: JSON.stringify(formData)
        });
        if(response.status===401) { sessionStorage.removeItem('contasReceberSession'); mostrarTelaAcessoNegado(); return; }
        if(!response.ok) throw new Error('Erro ao salvar');
        const saved = await response.json();
        const mapped = mapearConta(saved);
        if(editId) {
            const idx = contas.findIndex(c=>c.id===editId);
            if(idx!==-1) contas[idx]=mapped;
            showMessage(`NF ${formData.numero_nf} atualizada`,'success');
        } else {
            contas.push(mapped);
            showMessage(`NF ${formData.numero_nf} registrada`,'success');
        }
        lastDataHash = JSON.stringify(contas.map(c=>c.id));
        updateAllFilters();
        updateDashboard();
        filterContas();
        closeFormModal();
    } catch(err) {
        console.error(err);
        showMessage('Erro ao salvar','error');
    }
};

// ============================================
// EDIÇÃO, EXCLUSÃO, VISUALIZAÇÃO
// ============================================
window.editConta = function(id) { 
    showFormModal(id); 
};
window.deleteConta = async function(id) {
    const conta = contas.find(c=>c.id===id);
    if(!conta) return;
    // Confirmar exclusão com botões: Sim (verde), Cancelar (vermelho)
    const confirmado = await showConfirmDialog(`Excluir NF ${conta.numero_nf}?`, 'Sim', 'Cancelar');
    if(!confirmado) return;
    const removed = contas.filter(c=>c.id!==id);
    contas = removed;
    updateAllFilters();
    updateDashboard();
    filterContas();
    showMessage(`NF ${conta.numero_nf} excluída`,'error');
    if(isOnline) {
        try {
            await fetch(`${API_URL}/contas/${id}`, { method:'DELETE', headers:{'X-Session-Token':sessionToken} });
        } catch(e) { console.error(e); }
    }
};

// Modal VER completo com abas
window.viewConta = function(id) {
    const conta = contas.find(c=>c.id===id);
    if(!conta) return;
    
    const tipoLabels = { 'ENVIO':'Envio','CANCELADA':'Cancelada','REMESSA_AMOSTRA':'Remessa Amostra','SIMPLES_REMESSA':'Simples Remessa','DEVOLUCAO':'Devolução','DEVOLVIDA':'Devolvida' };
    const notas = conta.observacoes?.notas || [];
    const parcelas = conta.observacoes?.parcelas || [];
    const hoje = new Date().toISOString().split('T')[0];
    
    // Badge de status
    let statusBadge = '';
    if (conta.tipo_nf && conta.tipo_nf !== 'ENVIO') {
        statusBadge = `<span class="badge status-especial">${tipoLabels[conta.tipo_nf]}</span>`;
    } else if (conta.status === 'PAGO') {
        statusBadge = `<span class="badge status-pago">PAGO</span>`;
    } else if (conta.data_vencimento && conta.data_vencimento < hoje) {
        statusBadge = `<span class="badge status-vencido">VENCIDO</span>`;
    } else if (conta.status && conta.status.includes('PARCELA')) {
        statusBadge = `<span class="badge status-parcela">${conta.status}</span>`;
    } else {
        statusBadge = `<span class="badge status-a-receber">A RECEBER</span>`;
    }
    
    const valorPagoTotal = parcelas.reduce((s,p) => s + (parseFloat(p.valor)||0), 0) || conta.valor_pago || 0;
    
    // Aba Geral
    const tabGeral = `
        <div class="info-section">
            <div class="info-row"><span class="info-label">Número NF:</span><span class="info-value">${conta.numero_nf}</span></div>
            <div class="info-row"><span class="info-label">Órgão:</span><span class="info-value">${conta.orgao}</span></div>
            <div class="info-row"><span class="info-label">Vendedor:</span><span class="info-value">${conta.vendedor}</span></div>
            <div class="info-row"><span class="info-label">Banco:</span><span class="info-value">${conta.banco || '-'}</span></div>
            <div class="info-row"><span class="info-label">Tipo NF:</span><span class="info-value">${tipoLabels[conta.tipo_nf] || conta.tipo_nf}</span></div>
            <div class="info-row"><span class="info-label">Status:</span><span class="info-value">${statusBadge}</span></div>
        </div>
    `;
    
    // Aba Valores e Datas
    const tabValores = `
        <div class="info-section">
            <div class="info-row"><span class="info-label">Valor NF:</span><span class="info-value">${formatCurrency(conta.valor)}</span></div>
            <div class="info-row"><span class="info-label">Valor Pago Total:</span><span class="info-value">${formatCurrency(valorPagoTotal)}</span></div>
            <div class="info-row"><span class="info-label">Data Emissão:</span><span class="info-value">${formatDate(conta.data_emissao)}</span></div>
            <div class="info-row"><span class="info-label">Vencimento:</span><span class="info-value">${formatDate(conta.data_vencimento)}</span></div>
            <div class="info-row"><span class="info-label">Data Pagamento:</span><span class="info-value">${conta.data_pagamento ? formatDate(conta.data_pagamento) : '-'}</span></div>
        </div>
    `;
    
    // Aba Parcelas
    let tabParcelas = `<div class="info-section"><h4>Pagamento Parcelado</h4>`;
    if (parcelas.length === 0) {
        tabParcelas += `<p style="color:var(--text-secondary);">Nenhuma parcela registrada.</p>`;
    } else {
        tabParcelas += `<table style="width:100%; margin-top:0.5rem; border-collapse:collapse;">
            <thead><tr><th style="text-align:left;">Parcela</th><th style="text-align:left;">Valor</th><th style="text-align:left;">Data Pagamento</th></tr></thead>
            <tbody>`;
        parcelas.forEach(p => {
            tabParcelas += `<tr><td>${p.numero || '-'}</td><td>${formatCurrency(p.valor || 0)}</td><td>${p.data ? formatDate(p.data) : '-'}</td></tr>`;
        });
        tabParcelas += `</tbody></table>`;
    }
    tabParcelas += `</div>`;
    
    // Aba Observações
    let tabObs = `<div class="info-section"><h4>Observações</h4>`;
    if (notas.length === 0) {
        tabObs += `<p style="color:var(--text-secondary);">Nenhuma observação registrada.</p>`;
    } else {
        tabObs += `<div class="observacoes-list-view">`;
        notas.forEach(n => {
            tabObs += `<div class="observacao-item-view">
                <div class="observacao-header"><span class="observacao-data">${formatDateTime(n.data)}</span></div>
                <p class="observacao-texto">${n.texto}</p>
            </div>`;
        });
        tabObs += `</div>`;
    }
    tabObs += `</div>`;
    
    const modalHTML = `
        <div class="modal-overlay" id="viewModal" style="display:flex;">
            <div class="modal-content" style="max-width: 800px;">
                <div class="modal-header">
                    <h3 class="modal-title">NF ${conta.numero_nf}</h3>
                    <button class="close-modal" onclick="closeViewModal()">✕</button>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchViewTab(0)">Geral</button>
                        <button class="tab-btn" onclick="switchViewTab(1)">Valores e Datas</button>
                        <button class="tab-btn" onclick="switchViewTab(2)">Pagamento Parcelado</button>
                        <button class="tab-btn" onclick="switchViewTab(3)">Observações</button>
                    </div>
                    <div class="tab-content active" id="view-tab-geral">${tabGeral}</div>
                    <div class="tab-content" id="view-tab-valores">${tabValores}</div>
                    <div class="tab-content" id="view-tab-parcelas">${tabParcelas}</div>
                    <div class="tab-content" id="view-tab-observacoes">${tabObs}</div>
                </div>
                <div class="modal-actions">
                    <button class="btn-close" onclick="closeViewModal()">Fechar</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
};

window.closeViewModal = function() {
    const modal = document.getElementById('viewModal');
    if(modal) modal.remove();
};

window.switchViewTab = function(idx) {
    const btns = document.querySelectorAll('#viewModal .tab-btn');
    const contents = document.querySelectorAll('#viewModal .tab-content');
    btns.forEach((b,i)=>b.classList.toggle('active',i===idx));
    contents.forEach((c,i)=>c.classList.toggle('active',i===idx));
};

// ============================================
// FILTROS E RENDERIZAÇÃO
// ============================================
function updateAllFilters() {
    const vendedores = [...new Set(contas.map(c=>c.vendedor).filter(Boolean))];
    const bancos = [...new Set(contas.map(c=>c.banco).filter(Boolean))];
    const selVend = document.getElementById('filterVendedor');
    if(selVend) {
        const cur = selVend.value;
        selVend.innerHTML = '<option value="">Todos Vendedores</option>';
        vendedores.sort().forEach(v => { const opt = document.createElement('option'); opt.value=v; opt.text=v; selVend.appendChild(opt); });
        selVend.value = cur;
    }
    const selBanco = document.getElementById('filterBanco');
    if(selBanco) {
        const cur = selBanco.value;
        selBanco.innerHTML = '<option value="">Todos Bancos</option>';
        bancos.sort().forEach(b => { const opt = document.createElement('option'); opt.value=b; opt.text=b; selBanco.appendChild(opt); });
        selBanco.value = cur;
    }
}

function filterContas() {
    const search = document.getElementById('search')?.value.toLowerCase() || '';
    const filterVendedor = document.getElementById('filterVendedor')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    const filterBanco = document.getElementById('filterBanco')?.value || '';
    let filtered = [...contas];
    if(showAllMonths) {
        filtered = filtered.filter(c => new Date(c.data_emissao+'T00:00:00').getFullYear() === currentYear);
    } else {
        filtered = filtered.filter(c => {
            const d = new Date(c.data_emissao+'T00:00:00');
            return d.getMonth()===currentMonth && d.getFullYear()===currentYear;
        });
    }
    if(filterVendedor) filtered = filtered.filter(c=>c.vendedor===filterVendedor);
    if(filterBanco) filtered = filtered.filter(c=>c.banco===filterBanco);
    if(filterStatus) filtered = filtered.filter(c=>c.status===filterStatus);
    if(search) filtered = filtered.filter(c=>c.numero_nf.toLowerCase().includes(search)||c.orgao.toLowerCase().includes(search)||c.vendedor.toLowerCase().includes(search));
    filtered.sort((a,b)=> (parseInt(a.numero_nf)||0) - (parseInt(b.numero_nf)||0));
    renderContas(filtered);
}

function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if(!container) return;
    if(!lista.length) { container.innerHTML = '<div style="text-align:center; padding:2rem;">Nenhuma conta encontrada</div>'; return; }
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const tipoLabels = { 'CANCELADA':'Cancelada','REMESSA_AMOSTRA':'Remessa Amostra','SIMPLES_REMESSA':'Simples Remessa','DEVOLUCAO':'Devolução','DEVOLVIDA':'Devolvida' };
    let html = `
        <div style="overflow-x:auto;">
            <table style="width:100%">
                <thead>
                    <tr>
                        <th style="width:50px; text-align:center;">Pago</th>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Valor NF</th>
                        <th>Valor Pago</th>
                        <th>Vencimento</th>
                        <th>Status</th>
                        <th style="text-align:center;">Ações</th>
                    </tr>
                </thead>
                <tbody>
    `;
    for(const c of lista) {
        const isEnvio = !c.tipo_nf || c.tipo_nf === 'ENVIO';
        const isPago = c.status === 'PAGO';
        const rowClass = isPago ? 'row-pago' : '';
        let statusBadge = '';
        if(!isEnvio) {
            statusBadge = `<span class="badge status-especial">${tipoLabels[c.tipo_nf] || c.tipo_nf}</span>`;
        } else if(isPago) {
            statusBadge = `<span class="badge status-pago">PAGO</span>`;
        } else if (c.status && c.status.includes('PARCELA')) {
            statusBadge = `<span class="badge status-parcela">${c.status}</span>`;
        } else {
            const vencimento = new Date(c.data_vencimento+'T00:00:00');
            if(vencimento < hoje) {
                statusBadge = `<span class="badge status-vencido">VENCIDO</span>`;
            } else {
                statusBadge = `<span class="badge status-a-receber">A RECEBER</span>`;
            }
        }
        // Calcular valor pago (parcelas ou campo)
        let valorPagoDisplay = c.valor_pago || 0;
        if (c.observacoes?.parcelas?.length) {
            valorPagoDisplay = c.observacoes.parcelas.reduce((s,p)=>s+(parseFloat(p.valor)||0),0);
        }
        html += `
            <tr class="${rowClass}" data-id="${c.id}" style="cursor:pointer;">
                <td style="text-align:center;">
                    ${isEnvio ? `<input type="checkbox" class="pago-checkbox" ${isPago ? 'checked' : ''} onchange="togglePagamento('${c.id}', this.checked)">` : '-'}
                 </td>
                <td><strong>${c.numero_nf}</strong></td>
                <td>${c.orgao}</td>
                <td><strong>${formatCurrency(c.valor)}</strong></td>
                <td>${formatCurrency(valorPagoDisplay)}</td>
                <td>${c.data_vencimento ? formatDate(c.data_vencimento) : '-'}</td>
                <td>${statusBadge}</td>
                <td class="actions-cell" style="text-align:center;">
                    <button onclick="editConta('${c.id}')" class="action-btn edit">Editar</button>
                    <button onclick="deleteConta('${c.id}')" class="action-btn delete">Excluir</button>
                </td>
            </tr>
        `;
    }
    html += `
                </tbody>
            </table>
        </div>
    `;
    container.innerHTML = html;
    document.querySelectorAll('#contasContainer tbody tr').forEach(tr => {
        tr.addEventListener('click', function(e) {
            if(e.target.tagName==='BUTTON' || e.target.closest('button') || e.target.type==='checkbox') return;
            const id = this.dataset.id;
            if(id) viewConta(id);
        });
    });
}

// ============================================
// TOGGLE PAGAMENTO (checkbox)
// ============================================
window.togglePagamento = async function(id, isChecked) {
    const conta = contas.find(c => c.id === id);
    if(!conta) return;
    const wasPago = conta.status === 'PAGO';
    if(isChecked && !wasPago) {
        const confirmado = await showConfirmDialog(`Confirmar pagamento da NF ${conta.numero_nf}?`, 'Sim', 'Não');
        if(!confirmado) {
            const chk = document.querySelector(`.pago-checkbox[onchange*="togglePagamento('${id}']`);
            if(chk) chk.checked = false;
            return;
        }
        const updated = {
            ...conta,
            status: 'PAGO',
            valor_pago: conta.valor,
            data_pagamento: new Date().toISOString().split('T')[0],
            observacoes: { ...conta.observacoes, parcelas: [] } // limpa parcelas se marcar pago direto
        };
        const success = await atualizarConta(id, updated);
        if(success) {
            Object.assign(conta, updated);
            showMessage(`NF ${conta.numero_nf} marcada como PAGA`, 'success');
        } else {
            const chk = document.querySelector(`.pago-checkbox[onchange*="togglePagamento('${id}']`);
            if(chk) chk.checked = false;
        }
    } else if(!isChecked && wasPago) {
        const confirmado = await showConfirmDialog(`Reverter pagamento da NF ${conta.numero_nf}?`, 'Sim', 'Cancelar');
        if(!confirmado) {
            const chk = document.querySelector(`.pago-checkbox[onchange*="togglePagamento('${id}']`);
            if(chk) chk.checked = true;
            return;
        }
        const updated = {
            ...conta,
            status: 'A RECEBER',
            valor_pago: 0,
            data_pagamento: null
        };
        const success = await atualizarConta(id, updated);
        if(success) {
            Object.assign(conta, updated);
            showMessage(`Pagamento da NF ${conta.numero_nf} revertido`, 'info');
        } else {
            const chk = document.querySelector(`.pago-checkbox[onchange*="togglePagamento('${id}']`);
            if(chk) chk.checked = true;
        }
    }
    updateDashboard();
    filterContas();
};

async function atualizarConta(id, dadosAtualizados) {
    if(!isOnline) { showMessage('Sistema offline','error'); return false; }
    try {
        const response = await fetch(`${API_URL}/contas/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type':'application/json', 'X-Session-Token':sessionToken },
            body: JSON.stringify(dadosAtualizados)
        });
        if(response.status===401) { sessionStorage.removeItem('contasReceberSession'); mostrarTelaAcessoNegado(); return false; }
        if(!response.ok) throw new Error('Erro ao atualizar');
        const saved = await response.json();
        const idx = contas.findIndex(c=>c.id===id);
        if(idx!==-1) contas[idx] = mapearConta(saved);
        return true;
    } catch(err) {
        console.error(err);
        showMessage('Erro ao atualizar status','error');
        return false;
    }
}

// ============================================
// DIÁLOGO DE CONFIRMAÇÃO PERSONALIZADO (Sim verde, Cancelar vermelho)
// ============================================
function showConfirmDialog(message, confirmText = 'Sim', cancelText = 'Cancelar') {
    return new Promise((resolve) => {
        const modalHTML = `
            <div class="modal-overlay" id="confirmDialog" style="display:flex; z-index:10001;">
                <div class="modal-content confirm-modal-content">
                    <div class="confirm-modal-body">
                        <h3 class="confirm-modal-title">${message}</h3>
                    </div>
                    <div class="confirm-modal-actions">
                        <button class="success" id="dialogConfirmBtn">${confirmText}</button>
                        <button class="danger" id="dialogCancelBtn">${cancelText}</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('confirmDialog');
        const confirmBtn = document.getElementById('dialogConfirmBtn');
        const cancelBtn = document.getElementById('dialogCancelBtn');
        const closeModal = (result) => {
            if(modal) modal.remove();
            resolve(result);
        };
        confirmBtn.addEventListener('click', () => closeModal(true));
        cancelBtn.addEventListener('click', () => closeModal(false));
        modal.addEventListener('click', (e) => { if(e.target === modal) closeModal(false); });
    });
}

function showMessage(msg, type) {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOutBottom 0.3s forwards';
        setTimeout(()=>div.remove(),300);
    },3000);
}

console.log('✅ Script carregado com modal VER completo, parcelas e botões corrigidos');
