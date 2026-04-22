// ============================================
// CONFIGURAÇÃO
// ============================================
const API_URL = '/api/receber';
const NOTIFICATION_KEY = 'receberNotificationShown';

let contas = [];
let isOnline = false;
let lastDataHash = '';
let sessionToken = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let showAllMonths = false;
let currentTabIndex = 0;
const tabs = ['tab-basico', 'tab-valores', 'tab-parcelas', 'tab-observacoes'];

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

console.log('🚀 Receber iniciada');

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
            display.textContent = `Todos de ${currentYear}`;
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
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    else if (currentMonth > 11) { currentMonth = 0; currentYear++; }
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
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:var(--bg-primary);color:var(--text-primary);text-align:center;padding:2rem;">
            <h1 style="font-size:2.2rem;margin-bottom:1rem;">${mensagem}</h1>
            <p style="color:var(--text-secondary);margin-bottom:2rem;">Somente usuários autenticados podem acessar esta área.</p>
        </div>
    `;
}

async function inicializarApp() {
    updateMonthDisplay();
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    await loadContas();
    startPolling();
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const formModal = document.getElementById('formModal');
            if (formModal && formModal.style.display === 'flex') {
                const active = document.activeElement;
                if (active && active.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    handleSubmit(e);
                }
            }
        }
    });
}

// ============================================
// CONEXÃO
// ============================================
async function checkServerStatus() {
    try {
        const response = await fetch(API_URL, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' }
        });
        if (response.status === 401) {
            sessionStorage.removeItem('receberSession');
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
        const response = await fetch(API_URL, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' }
        });
        if (response.status === 401) {
            sessionStorage.removeItem('receberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        if (!response.ok) return;
        const data = await response.json();
        contas = data.map(mapearConta);
        const newHash = JSON.stringify(contas.map(c => c.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
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
    // observacoes: array de textos OU objeto com { parcelas: [...], textos: [...] }
    let observacoes = { parcelas: [], textos: [] };
    if (conta.observacoes) {
        if (typeof conta.observacoes === 'string') {
            try { observacoes = JSON.parse(conta.observacoes); } catch { observacoes = { parcelas: [], textos: [] }; }
        } else if (typeof conta.observacoes === 'object') {
            if (Array.isArray(conta.observacoes)) {
                // legado: array de {texto, data}
                observacoes = { parcelas: [], textos: conta.observacoes };
            } else {
                observacoes = {
                    parcelas: conta.observacoes.parcelas || [],
                    textos: conta.observacoes.textos || conta.observacoes.observacoes || []
                };
            }
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
        observacoes,
        created_at: conta.created_at || new Date().toISOString()
    };
}

window.sincronizarDados = async function() {
    const btns = document.querySelectorAll('button[onclick="sincronizarDados()"]');
    btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = 'spin 1s linear infinite'; });
    await loadContas();
    showMessage('Dados sincronizados', 'success');
    setTimeout(() => { btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = ''; }); }, 1000);
};

function startPolling() {
    setInterval(() => { if (isOnline) loadContas(); }, 30000);
}

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const contasPeriodo = contas.filter(c => {
        if (showAllMonths) return new Date(c.data_emissao + 'T00:00:00').getFullYear() === currentYear;
        const d = new Date(c.data_emissao + 'T00:00:00');
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const totalFaturado = contasPeriodo.filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO').reduce((s, c) => s + c.valor, 0);
    const totalPago = contasPeriodo.filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO').reduce((s, c) => s + (c.valor_pago || 0), 0);
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
    if (quantidadeVencidas > 0) { badge.style.display = 'flex'; card.classList.add('has-alert'); }
    else { badge.style.display = 'none'; card.classList.remove('has-alert'); }
}

function verificarContasVencidas() {
    if (sessionStorage.getItem(NOTIFICATION_KEY)) return;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const vencidas = contas.filter(c => {
        if (c.tipo_nf && c.tipo_nf !== 'ENVIO') return false;
        if (c.status === 'PAGO') return false;
        return new Date(c.data_vencimento + 'T00:00:00') < hoje;
    });
    if (vencidas.length > 0) {
        mostrarNotificacaoVencidos(vencidas);
        sessionStorage.setItem(NOTIFICATION_KEY, 'true');
    }
}

function mostrarNotificacaoVencidos(contasVencidas) {
    const total = contasVencidas.reduce((s, c) => s + c.valor, 0);
    const modal = document.createElement('div');
    modal.id = 'notificationModal';
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content" style="max-width:500px;border:3px solid #EF4444;">
            <div class="modal-header" style="background:#EF4444;color:white;">
                <h3 style="margin:0;">⚠️ Contas Vencidas</h3>
                <button class="close-modal" onclick="fecharNotificacaoVencidos()">✕</button>
            </div>
            <div style="padding:1.5rem;">
                <p>Você possui <strong>${contasVencidas.length} ${contasVencidas.length === 1 ? 'conta vencida' : 'contas vencidas'}</strong></p>
                <div style="background:#FEE;border-left:4px solid #EF4444;padding:1rem;margin:1rem 0;">
                    <strong>Total vencido:</strong> ${formatCurrency(total)}
                </div>
                <button onclick="fecharNotificacaoVencidos()" style="width:100%;background:#EF4444;">Entendi</button>
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
// MODAL DE VENCIDOS
// ============================================
let vencidosPage = 1;
const VENCIDOS_PER_PAGE = 5;
let vencidosData = [];

function renderVencidosTable() {
    const start = (vencidosPage - 1) * VENCIDOS_PER_PAGE;
    const page = vencidosData.slice(start, start + VENCIDOS_PER_PAGE);
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
        <div style="display:flex;justify-content:center;gap:1rem;margin-top:1rem;">
            <button onclick="changeVencidosPage(-1)" ${vencidosPage === 1 ? 'disabled' : ''}>Anterior</button>
            <span>Página ${vencidosPage} de ${totalPages}</span>
            <button onclick="changeVencidosPage(1)" ${vencidosPage === totalPages ? 'disabled' : ''}>Próximo</button>
        </div>
    `;
}
window.changeVencidosPage = function(delta) {
    const total = Math.ceil(vencidosData.length / VENCIDOS_PER_PAGE);
    const newPage = vencidosPage + delta;
    if (newPage >= 1 && newPage <= total) { vencidosPage = newPage; renderVencidosTable(); }
};
window.showVencidosModal = function() {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    vencidosData = contas.filter(c => {
        if (c.tipo_nf && c.tipo_nf !== 'ENVIO') return false;
        if (c.status === 'PAGO') return false;
        return new Date(c.data_vencimento + 'T00:00:00') < hoje;
    });
    if (vencidosData.length === 0) { showMessage('Nenhuma conta vencida', 'error'); return; }
    vencidosPage = 1;
    renderVencidosTable();
    document.getElementById('vencidosModal').style.display = 'flex';
};
window.closeVencidosModal = function() {
    document.getElementById('vencidosModal').style.display = 'none';
};

// ============================================
// HELPERS DE PARCELAS
// ============================================
function calcularNumeroParcela(parcelas) {
    const n = parcelas.length;
    if (n === 0) return null;
    const sufixo = ['1ª PARCELA', '2ª PARCELA', '3ª PARCELA', '4ª PARCELA', '5ª PARCELA',
                    '6ª PARCELA', '7ª PARCELA', '8ª PARCELA', '9ª PARCELA', '10ª PARCELA'];
    return sufixo[n - 1] || `${n}ª PARCELA`;
}

function somarParcelas(parcelas) {
    return parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
}

function ultimaDataParcela(parcelas) {
    if (!parcelas.length) return null;
    return parcelas.reduce((last, p) => (!last || p.data > last ? p.data : last), null);
}

// ============================================
// FORMULÁRIO
// ============================================
window.toggleForm = () => showFormModal(null);

function showFormModal(editingId = null) {
    const isEditing = !!editingId;
    let conta = null;
    if (isEditing) conta = contas.find(c => c.id === editingId);
    currentTabIndex = 0;

    const parcelas = conta?.observacoes?.parcelas || [];
    const textos = conta?.observacoes?.textos || [];
    const obsHTML = textos.map((obs, idx) => `
        <div class="observacao-item">
            <div class="observacao-header">
                <span class="observacao-data">${formatDateTime(obs.data)}</span>
                <button type="button" class="btn-remove-obs" onclick="removerObservacao(${idx})">✕</button>
            </div>
            <p class="observacao-texto">${obs.texto}</p>
        </div>
    `).join('');

    const parcelasHTML = parcelas.map((p, idx) => buildParcelaRow(p, idx)).join('');

    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display:flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Conta' : 'Nova Conta'}</h3>
                    <button class="close-modal" onclick="closeFormModal(false)">✕</button>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchFormTab(0)">Básico</button>
                        <button class="tab-btn" onclick="switchFormTab(1)">Valores e Datas</button>
                        <button class="tab-btn" onclick="switchFormTab(2)">Pagamento Parcelado</button>
                        <button class="tab-btn" onclick="switchFormTab(3)">Observações</button>
                    </div>
                    <form id="contaForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="${editingId || ''}">
                        <input type="hidden" id="observacoesData" value='${JSON.stringify(textos)}'>
                        <input type="hidden" id="parcelasData" value='${JSON.stringify(parcelas)}'>

                        <!-- ABA BÁSICO -->
                        <div class="tab-content active" id="tab-basico">
                            <div class="form-grid">
                                <div class="form-group"><label>Número NF *</label><input type="text" id="numero_nf" value="${conta?.numero_nf || ''}" required></div>
                                <div class="form-group"><label>Órgão *</label><input type="text" id="orgao" value="${conta?.orgao || ''}" required></div>
                                <div class="form-group"><label>Vendedor *</label>
                                    <select id="vendedor" required>
                                        <option value="">Selecione</option>
                                        <option value="ROBERTO" ${conta?.vendedor === 'ROBERTO' ? 'selected' : ''}>ROBERTO</option>
                                        <option value="ISAQUE" ${conta?.vendedor === 'ISAQUE' ? 'selected' : ''}>ISAQUE</option>
                                        <option value="MIGUEL" ${conta?.vendedor === 'MIGUEL' ? 'selected' : ''}>MIGUEL</option>
                                    </select>
                                </div>
                                <div class="form-group"><label>Banco *</label>
                                    <select id="banco" required>
                                        <option value="">Selecione</option>
                                        <option value="BANCO DO BRASIL" ${conta?.banco === 'BANCO DO BRASIL' ? 'selected' : ''}>BANCO DO BRASIL</option>
                                        <option value="BRADESCO" ${conta?.banco === 'BRADESCO' ? 'selected' : ''}>BRADESCO</option>
                                        <option value="SICOOB" ${conta?.banco === 'SICOOB' ? 'selected' : ''}>SICOOB</option>
                                    </select>
                                </div>
                                <div class="form-group"><label>Tipo NF *</label>
                                    <select id="tipo_nf">
                                        <option value="ENVIO" ${!conta?.tipo_nf || conta.tipo_nf === 'ENVIO' ? 'selected' : ''}>Envio</option>
                                        <option value="CANCELADA" ${conta?.tipo_nf === 'CANCELADA' ? 'selected' : ''}>Cancelada</option>
                                        <option value="REMESSA DE AMOSTRA" ${conta?.tipo_nf === 'REMESSA DE AMOSTRA' ? 'selected' : ''}>Remessa Amostra</option>
                                        <option value="SIMPLES REMESSA" ${conta?.tipo_nf === 'SIMPLES REMESSA' ? 'selected' : ''}>Simples Remessa</option>
                                        <option value="DEVOLUÇÃO" ${conta?.tipo_nf === 'DEVOLUÇÃO' ? 'selected' : ''}>Devolução</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <!-- ABA VALORES E DATAS -->
                        <div class="tab-content" id="tab-valores">
                            <div class="form-grid">
                                <div class="form-group"><label>Valor NF (R$) *</label><input type="number" id="valor" step="0.01" value="${conta?.valor || ''}" required oninput="onValorNFChange()"></div>
                                <div class="form-group"><label>Valor Pago (R$)</label><input type="number" id="valor_pago" step="0.01" value="${conta?.valor_pago || '0'}" oninput="onValorPagoManual()"></div>
                                <div class="form-group"><label>Data Emissão *</label><input type="date" id="data_emissao" value="${conta?.data_emissao || new Date().toISOString().split('T')[0]}" required></div>
                                <div class="form-group"><label>Data Vencimento *</label><input type="date" id="data_vencimento" value="${conta?.data_vencimento || ''}" required></div>
                                <div class="form-group"><label>Data Pagamento</label><input type="date" id="data_pagamento" value="${conta?.data_pagamento || ''}" oninput="onDataPagamentoManual()"></div>
                            </div>
                        </div>

                        <!-- ABA PARCELAS -->
                        <div class="tab-content" id="tab-parcelas">
                            <div id="parcelasList" class="parcelas-list">
                                ${parcelasHTML || '<p class="no-parcelas">Nenhuma parcela registrada</p>'}
                            </div>
                            <div class="nova-parcela-form">
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label>Valor da Parcela (R$)</label>
                                        <input type="number" id="novaParcela_valor" step="0.01" placeholder="0,00">
                                    </div>
                                    <div class="form-group">
                                        <label>Data da Parcela</label>
                                        <input type="date" id="novaParcela_data">
                                    </div>
                                </div>
                                <button type="button" class="btn-add-parcela" onclick="adicionarParcela()">+ Adicionar Parcela</button>
                            </div>
                        </div>

                        <!-- ABA OBSERVAÇÕES -->
                        <div class="tab-content" id="tab-observacoes">
                            <div class="observacoes-section">
                                <div class="observacoes-list" id="observacoesList">
                                    ${obsHTML || '<p style="text-align:center;padding:2rem;">Nenhuma observação</p>'}
                                </div>
                                <div class="nova-observacao">
                                    <textarea id="novaObservacao" placeholder="Digite uma observação..." rows="3"></textarea>
                                    <button type="button" class="btn-add-obs" onclick="adicionarObservacao()">+ Adicionar</button>
                                </div>
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button type="button" id="btnPrevious" onclick="previousTab()" class="btn-secondary" style="display:none;">Anterior</button>
                            <button type="button" id="btnNext" onclick="nextTab()" class="btn-secondary">Próximo</button>
                            <button type="button" onclick="closeFormModal(false)" class="btn-cancel">Cancelar</button>
                            <button type="submit" id="btnSave" style="display:none;">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    ['numero_nf', 'orgao'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', e => {
            const start = e.target.selectionStart;
            e.target.value = e.target.value.toUpperCase();
            e.target.setSelectionRange(start, start);
        });
    });
    updateNavigationButtons();
    setTimeout(() => document.getElementById('numero_nf')?.focus(), 100);
}

function buildParcelaRow(p, idx) {
    return `
        <div class="parcela-item" data-idx="${idx}">
            <div class="parcela-fields">
                <div class="form-group">
                    <label>Valor (R$)</label>
                    <input type="number" step="0.01" value="${p.valor}" onchange="editarParcela(${idx}, 'valor', this.value)">
                </div>
                <div class="form-group">
                    <label>Data</label>
                    <input type="date" value="${p.data}" onchange="editarParcela(${idx}, 'data', this.value)">
                </div>
            </div>
            <button type="button" class="btn-remove-parcela" onclick="removerParcela(${idx})" title="Remover">✕</button>
        </div>
    `;
}

// Valor NF mudou — recalcular se valor_pago não foi editado manualmente
let valorPagoManual = false;
let dataPagamentoManual = false;

window.onValorNFChange = function() { /* sem efeito direto */ };
window.onValorPagoManual = function() { valorPagoManual = true; };
window.onDataPagamentoManual = function() { dataPagamentoManual = true; };

window.adicionarParcela = function() {
    const valorEl = document.getElementById('novaParcela_valor');
    const dataEl = document.getElementById('novaParcela_data');
    const valor = parseFloat(valorEl.value);
    const data = dataEl.value;
    if (!valor || valor <= 0 || !data) {
        showMessage('Informe o valor e a data da parcela', 'error');
        return;
    }
    const parcelas = JSON.parse(document.getElementById('parcelasData').value);
    parcelas.push({ valor, data });
    document.getElementById('parcelasData').value = JSON.stringify(parcelas);
    valorEl.value = '';
    dataEl.value = '';
    renderizarParcelas();
    sincronizarCamposComParcelas(parcelas);
};

window.removerParcela = function(idx) {
    const parcelas = JSON.parse(document.getElementById('parcelasData').value);
    parcelas.splice(idx, 1);
    document.getElementById('parcelasData').value = JSON.stringify(parcelas);
    renderizarParcelas();
    sincronizarCamposComParcelas(parcelas);
};

window.editarParcela = function(idx, campo, valor) {
    const parcelas = JSON.parse(document.getElementById('parcelasData').value);
    if (campo === 'valor') parcelas[idx].valor = parseFloat(valor) || 0;
    if (campo === 'data') parcelas[idx].data = valor;
    document.getElementById('parcelasData').value = JSON.stringify(parcelas);
    sincronizarCamposComParcelas(parcelas);
};

function sincronizarCamposComParcelas(parcelas) {
    if (!parcelas.length) return;
    const total = somarParcelas(parcelas);
    const ultima = ultimaDataParcela(parcelas);
    // Atualiza valor_pago se não foi editado manualmente
    if (!valorPagoManual) {
        const elVP = document.getElementById('valor_pago');
        if (elVP) elVP.value = total.toFixed(2);
    }
    // Atualiza data_pagamento se não foi editado manualmente
    if (!dataPagamentoManual && ultima) {
        const elDP = document.getElementById('data_pagamento');
        if (elDP) elDP.value = ultima;
    }
}

function renderizarParcelas() {
    const parcelas = JSON.parse(document.getElementById('parcelasData').value);
    const container = document.getElementById('parcelasList');
    if (!container) return;
    if (!parcelas.length) {
        container.innerHTML = '<p class="no-parcelas">Nenhuma parcela registrada</p>';
        return;
    }
    container.innerHTML = parcelas.map((p, idx) => buildParcelaRow(p, idx)).join('');
}

window.switchFormTab = function(idx) {
    currentTabIndex = idx;
    const btns = document.querySelectorAll('#formModal .tab-btn');
    const contents = document.querySelectorAll('#formModal .tab-content');
    btns.forEach((btn, i) => btn.classList.toggle('active', i === idx));
    contents.forEach((c, i) => c.classList.toggle('active', i === idx));
    updateNavigationButtons();
};
function nextTab() { if (currentTabIndex < tabs.length - 1) switchFormTab(++currentTabIndex); }
function previousTab() { if (currentTabIndex > 0) switchFormTab(--currentTabIndex); }
function updateNavigationButtons() {
    const btnPrev = document.getElementById('btnPrevious');
    const btnNext = document.getElementById('btnNext');
    const btnSave = document.getElementById('btnSave');
    if (btnPrev) btnPrev.style.display = currentTabIndex === 0 ? 'none' : 'inline-flex';
    if (btnNext) btnNext.style.display = currentTabIndex === tabs.length - 1 ? 'none' : 'inline-flex';
    if (btnSave) btnSave.style.display = currentTabIndex === tabs.length - 1 ? 'inline-flex' : 'none';
}
function closeFormModal(saved = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        if (!saved) showMessage(modal.querySelector('#editId')?.value ? 'Atualização cancelada' : 'Registro cancelado', 'error');
        modal.style.animation = 'fadeOut 0.2s forwards';
        setTimeout(() => modal.remove(), 200);
    }
    // Reset flags
    valorPagoManual = false;
    dataPagamentoManual = false;
}
window.adicionarObservacao = function() {
    const textarea = document.getElementById('novaObservacao');
    const texto = textarea.value.trim().toUpperCase();
    if (!texto) return;
    const data = JSON.parse(document.getElementById('observacoesData').value);
    data.push({ texto, data: new Date().toISOString() });
    document.getElementById('observacoesData').value = JSON.stringify(data);
    textarea.value = '';
    renderizarObservacoes();
};
window.removerObservacao = function(idx) {
    const data = JSON.parse(document.getElementById('observacoesData').value);
    data.splice(idx, 1);
    document.getElementById('observacoesData').value = JSON.stringify(data);
    renderizarObservacoes();
};
function renderizarObservacoes() {
    const data = JSON.parse(document.getElementById('observacoesData').value);
    const container = document.getElementById('observacoesList');
    if (!container) return;
    if (!data.length) { container.innerHTML = '<p style="text-align:center;padding:2rem;">Nenhuma observação</p>'; return; }
    container.innerHTML = data.map((obs, idx) => `
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
// SUBMIT
// ============================================
window.handleSubmit = async function(event) {
    if (event) event.preventDefault();
    const textos = JSON.parse(document.getElementById('observacoesData').value);
    const parcelas = JSON.parse(document.getElementById('parcelasData').value);
    const valorNF = parseFloat(document.getElementById('valor').value) || 0;
    const valorPago = parseFloat(document.getElementById('valor_pago').value) || 0;
    const dataPagamento = document.getElementById('data_pagamento').value || null;

    // Determinar status com base nas parcelas e valor
    let status;
    if (parcelas.length > 0) {
        const totalParcelas = somarParcelas(parcelas);
        if (Math.abs(totalParcelas - valorNF) < 0.01) {
            status = 'PAGO';
        } else {
            status = calcularNumeroParcela(parcelas) || 'A RECEBER';
        }
    } else if (dataPagamento || valorPago >= valorNF) {
        status = 'PAGO';
    } else {
        status = 'A RECEBER';
    }

    const formData = {
        numero_nf: document.getElementById('numero_nf').value.trim().toUpperCase(),
        orgao: document.getElementById('orgao').value.trim().toUpperCase(),
        vendedor: document.getElementById('vendedor').value,
        banco: document.getElementById('banco').value,
        valor: valorNF,
        valor_pago: valorPago,
        data_emissao: document.getElementById('data_emissao').value,
        data_vencimento: document.getElementById('data_vencimento').value,
        data_pagamento: dataPagamento,
        tipo_nf: document.getElementById('tipo_nf').value,
        observacoes: { parcelas, textos },
        status
    };
    const editId = document.getElementById('editId').value;
    if (!isOnline) { closeFormModal(false); return; }
    try {
        const url = editId ? `${API_URL}/${editId}` : API_URL;
        const method = editId ? 'PUT' : 'POST';
        const response = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify(formData)
        });
        if (response.status === 401) { sessionStorage.removeItem('receberSession'); mostrarTelaAcessoNegado(); return; }
        if (!response.ok) throw new Error('Erro ao salvar');
        const saved = await response.json();
        const mapped = mapearConta(saved);
        if (editId) {
            const idx = contas.findIndex(c => c.id === editId);
            if (idx !== -1) contas[idx] = mapped;
            showMessage(`NF ${formData.numero_nf} atualizada`, 'success');
        } else {
            contas.push(mapped);
            showMessage(`NF ${formData.numero_nf} registrada`, 'success');
        }
        lastDataHash = JSON.stringify(contas.map(c => c.id));
        updateAllFilters();
        updateDashboard();
        filterContas();
        closeFormModal(true);
    } catch (err) {
        console.error(err);
        showMessage('Erro ao salvar', 'error');
    }
};

// ============================================
// EDIÇÃO E EXCLUSÃO
// ============================================
window.editConta = function(id) { showFormModal(id); };
window.deleteConta = async function(id) {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;
    showConfirmModal(
        `Excluir NF ${conta.numero_nf}?`,
        'Esta ação não pode ser desfeita.',
        async () => {
            contas = contas.filter(c => c.id !== id);
            updateAllFilters(); updateDashboard(); filterContas();
            showMessage(`NF ${conta.numero_nf} excluída`, 'error');
            if (isOnline) {
                try { await fetch(`${API_URL}/${id}`, { method: 'DELETE', headers: { 'X-Session-Token': sessionToken } }); }
                catch (e) { console.error(e); }
            }
        }
    );
};

// ============================================
// MODAL CONFIRMAR (genérico - substitui confirm())
// ============================================
function showConfirmModal(titulo, descricao, onConfirm, confirmLabel = 'Confirmar', confirmClass = 'btn-danger') {
    const id = 'confirmModal_' + Date.now();
    const html = `
        <div class="modal-overlay confirm-modal-overlay" id="${id}" style="display:flex;">
            <div class="modal-content confirm-modal">
                <div class="confirm-modal-body">
                    <p class="confirm-title">${titulo}</p>
                    ${descricao ? `<p class="confirm-desc">${descricao}</p>` : ''}
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-cancel" onclick="document.getElementById('${id}').remove()">Cancelar</button>
                    <button type="button" class="${confirmClass}" id="${id}_confirm">${confirmLabel}</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById(`${id}_confirm`).addEventListener('click', () => {
        document.getElementById(id).remove();
        onConfirm();
    });
}

// ============================================
// VIEW MODAL — abre ao clicar na linha
// ============================================
window.viewConta = function(id) {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;
    const tipoLabels = { 'ENVIO': 'Envio', 'CANCELADA': 'Cancelada', 'REMESSA DE AMOSTRA': 'Remessa Amostra', 'SIMPLES REMESSA': 'Simples Remessa', 'DEVOLUÇÃO': 'Devolução' };
    const parcelas = conta.observacoes?.parcelas || [];
    const textos = conta.observacoes?.textos || [];

    const obsHTML = textos.map(obs => `
        <div class="observacao-item-view">
            <div class="observacao-header"><span class="observacao-data">${formatDateTime(obs.data)}</span></div>
            <p class="observacao-texto">${obs.texto}</p>
        </div>
    `).join('');

    const parcelasHTML = parcelas.length ? `
        <table style="width:100%;margin-top:0.5rem;">
            <thead><tr><th>#</th><th>Valor</th><th>Data</th></tr></thead>
            <tbody>
                ${parcelas.map((p, i) => `
                    <tr>
                        <td>${i + 1}ª</td>
                        <td>${formatCurrency(parseFloat(p.valor) || 0)}</td>
                        <td>${formatDate(p.data)}</td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    ` : '<p style="text-align:center;padding:1rem;">Nenhuma parcela</p>';

    let statusDisplay = conta.status;
    const modalHTML = `
        <div class="modal-overlay" id="viewModal" style="display:flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3>Detalhes da Conta</h3>
                    <button class="close-modal" onclick="closeViewModal()">✕</button>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchViewTab(0)">Básico</button>
                        <button class="tab-btn" onclick="switchViewTab(1)">Valores e Datas</button>
                        <button class="tab-btn" onclick="switchViewTab(2)">Parcelas</button>
                        <button class="tab-btn" onclick="switchViewTab(3)">Observações</button>
                    </div>
                    <div class="tab-content active" id="view-tab-basico">
                        <div class="info-section">
                            <p><strong>NF:</strong> ${conta.numero_nf}</p>
                            <p><strong>Órgão:</strong> ${conta.orgao}</p>
                            <p><strong>Vendedor:</strong> ${conta.vendedor}</p>
                            <p><strong>Banco:</strong> ${conta.banco}</p>
                            <p><strong>Tipo NF:</strong> ${tipoLabels[conta.tipo_nf] || conta.tipo_nf}</p>
                            <p><strong>Status:</strong> <span class="badge ${getBadgeClass(conta)}">${statusDisplay}</span></p>
                        </div>
                    </div>
                    <div class="tab-content" id="view-tab-valores">
                        <div class="info-section">
                            <p><strong>Valor NF:</strong> ${formatCurrency(conta.valor)}</p>
                            <p><strong>Valor Pago:</strong> ${formatCurrency(conta.valor_pago || 0)}</p>
                            <p><strong>Emissão:</strong> ${formatDate(conta.data_emissao)}</p>
                            <p><strong>Vencimento:</strong> ${formatDate(conta.data_vencimento)}</p>
                            <p><strong>Pagamento:</strong> ${conta.data_pagamento ? formatDate(conta.data_pagamento) : 'Não pago'}</p>
                        </div>
                    </div>
                    <div class="tab-content" id="view-tab-parcelas">
                        ${parcelasHTML}
                    </div>
                    <div class="tab-content" id="view-tab-observacoes">
                        <div class="observacoes-list-view">${obsHTML || '<p style="text-align:center;">Nenhuma observação</p>'}</div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn-secondary" onclick="closeViewModal(); editConta('${conta.id}')">Editar</button>
                    <button class="btn-close" onclick="closeViewModal()">Fechar</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
};
window.closeViewModal = function() {
    const modal = document.getElementById('viewModal');
    if (modal) modal.remove();
};
window.switchViewTab = function(idx) {
    const btns = document.querySelectorAll('#viewModal .tab-btn');
    const contents = document.querySelectorAll('#viewModal .tab-content');
    btns.forEach((b, i) => b.classList.toggle('active', i === idx));
    contents.forEach((c, i) => c.classList.toggle('active', i === idx));
};

function getBadgeClass(conta) {
    if (conta.status === 'PAGO') return 'status-pago';
    if (conta.tipo_nf && conta.tipo_nf !== 'ENVIO') return 'status-especial';
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    if (conta.data_vencimento && new Date(conta.data_vencimento + 'T00:00:00') < hoje) return 'status-vencido';
    if (conta.status && conta.status.includes('PARCELA')) return 'status-parcela';
    return 'status-a-receber';
}

// ============================================
// FILTROS E RENDERIZAÇÃO
// ============================================
function updateAllFilters() {
    const vendedores = [...new Set(contas.map(c => c.vendedor).filter(Boolean))];
    const bancos = [...new Set(contas.map(c => c.banco).filter(Boolean))];
    const selVend = document.getElementById('filterVendedor');
    if (selVend) {
        const cur = selVend.value;
        selVend.innerHTML = '<option value="">Todos Vendedores</option>';
        vendedores.sort().forEach(v => { const opt = document.createElement('option'); opt.value = v; opt.text = v; selVend.appendChild(opt); });
        selVend.value = cur;
    }
    const selBanco = document.getElementById('filterBanco');
    if (selBanco) {
        const cur = selBanco.value;
        selBanco.innerHTML = '<option value="">Todos Bancos</option>';
        bancos.sort().forEach(b => { const opt = document.createElement('option'); opt.value = b; opt.text = b; selBanco.appendChild(opt); });
        selBanco.value = cur;
    }
}

function filterContas() {
    const search = document.getElementById('search')?.value.toLowerCase() || '';
    const filterVendedor = document.getElementById('filterVendedor')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    const filterBanco = document.getElementById('filterBanco')?.value || '';
    let filtered = [...contas];
    if (showAllMonths) {
        filtered = filtered.filter(c => new Date(c.data_emissao + 'T00:00:00').getFullYear() === currentYear);
    } else {
        filtered = filtered.filter(c => {
            const d = new Date(c.data_emissao + 'T00:00:00');
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        });
    }
    if (filterVendedor) filtered = filtered.filter(c => c.vendedor === filterVendedor);
    if (filterBanco) filtered = filtered.filter(c => c.banco === filterBanco);
    if (filterStatus) filtered = filtered.filter(c => c.status === filterStatus);
    if (search) filtered = filtered.filter(c =>
        c.numero_nf.toLowerCase().includes(search) ||
        c.orgao.toLowerCase().includes(search) ||
        c.vendedor.toLowerCase().includes(search)
    );
    filtered.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderContas(filtered);
}

function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if (!container) return;
    if (!lista.length) { container.innerHTML = '<div style="text-align:center;padding:2rem;">Nenhuma conta encontrada</div>'; return; }
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const tipoLabels = { 'CANCELADA': 'Cancelada', 'REMESSA DE AMOSTRA': 'Remessa Amostra', 'SIMPLES REMESSA': 'Simples Remessa', 'DEVOLUÇÃO': 'Devolução' };
    let html = `
        <div style="overflow-x:auto;">
            <table style="width:100%">
                <thead>
                    <tr>
                        <th style="width:56px;text-align:center;">Pago</th>
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
    for (const c of lista) {
        const isEnvio = !c.tipo_nf || c.tipo_nf === 'ENVIO';
        const isPago = c.status === 'PAGO';
        const isParcial = c.status && c.status.includes('PARCELA');
        const rowClass = isPago ? 'row-pago' : (isParcial ? 'row-parcial' : '');

        let statusBadge = '';
        if (!isEnvio) {
            statusBadge = `<span class="badge status-especial">${tipoLabels[c.tipo_nf] || c.tipo_nf}</span>`;
        } else if (isPago) {
            statusBadge = `<span class="badge status-pago">PAGO</span>`;
        } else if (isParcial) {
            statusBadge = `<span class="badge status-parcela">${c.status}</span>`;
        } else {
            const vencimento = c.data_vencimento ? new Date(c.data_vencimento + 'T00:00:00') : null;
            if (vencimento && vencimento < hoje) {
                statusBadge = `<span class="badge status-vencido">VENCIDO</span>`;
            } else {
                statusBadge = `<span class="badge status-a-receber">A RECEBER</span>`;
            }
        }

        html += `
            <tr class="${rowClass}" data-id="${c.id}" style="cursor:pointer;">
                <td style="text-align:center;">
                    ${isEnvio ? `<input type="checkbox" class="pago-checkbox" ${isPago ? 'checked' : ''} onchange="togglePagamento('${c.id}', this.checked)" onclick="event.stopPropagation()">` : '-'}
                </td>
                <td><strong>${c.numero_nf}</strong></td>
                <td>${c.orgao}</td>
                <td><strong>${formatCurrency(c.valor)}</strong></td>
                <td>${formatCurrency(c.valor_pago || 0)}</td>
                <td>${c.data_vencimento ? formatDate(c.data_vencimento) : '-'}</td>
                <td>${statusBadge}</td>
                <td class="actions-cell" style="text-align:center;">
                    <button onclick="event.stopPropagation(); editConta('${c.id}')" class="action-btn edit">Editar</button>
                    <button onclick="event.stopPropagation(); deleteConta('${c.id}')" class="action-btn delete">Excluir</button>
                </td>
            </tr>
        `;
    }
    html += `</tbody></table></div>`;
    container.innerHTML = html;
    document.querySelectorAll('#contasContainer tbody tr').forEach(tr => {
        tr.addEventListener('click', function(e) {
            if (e.target.tagName === 'BUTTON' || e.target.closest('button') || e.target.type === 'checkbox') return;
            const id = this.dataset.id;
            if (id) viewConta(id);
        });
    });
}

// ============================================
// TOGGLE PAGAMENTO (checkbox)
// ============================================
window.togglePagamento = async function(id, isChecked) {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;
    const wasPago = conta.status === 'PAGO';
    const isParcial = conta.status && conta.status.includes('PARCELA');

    if (isChecked && !wasPago) {
        // Verificar se tem parcelas abertas (valor pago < valor NF)
        const totalParcelas = somarParcelas(conta.observacoes?.parcelas || []);
        const valorNF = conta.valor;
        const temParcelasAbertas = totalParcelas > 0 && Math.abs(totalParcelas - valorNF) >= 0.01;

        if (isParcial || temParcelasAbertas) {
            // Já tem parcelas — pergunta se quer confirmar pagamento total (quitação)
            showConfirmModal(
                `Quitar NF ${conta.numero_nf}?`,
                'O valor pago será igual ao valor da NF e o status mudará para PAGO.',
                async () => await confirmarPagamentoTotal(id, conta),
                'Confirmar Quitação',
                'btn-save'
            );
        } else {
            // Sem parcelas — pergunta se será parcelado
            showParcelamentoModal(id, conta);
        }
    } else if (!isChecked && wasPago) {
        showConfirmModal(
            `Reverter pagamento da NF ${conta.numero_nf}?`,
            'O status voltará para A RECEBER.',
            async () => {
                const updated = { ...conta, observacoes: { parcelas: [], textos: conta.observacoes?.textos || [] }, status: 'A RECEBER', valor_pago: 0, data_pagamento: null };
                const success = await atualizarConta(id, updated);
                if (success) { Object.assign(conta, updated); showMessage(`Pagamento da NF ${conta.numero_nf} revertido`, 'info'); updateDashboard(); filterContas(); }
                else { const chk = document.querySelector(`.pago-checkbox[onchange*="'${id}'"]`); if (chk) chk.checked = true; }
            },
            'Reverter',
            'btn-danger'
        );
    }
};

function showParcelamentoModal(id, conta) {
    const modalId = 'parcelamentoModal';
    const html = `
        <div class="modal-overlay confirm-modal-overlay" id="${modalId}" style="display:flex;">
            <div class="modal-content confirm-modal">
                <div class="confirm-modal-body">
                    <p class="confirm-title">O pagamento para a NF ${conta.numero_nf} será parcelado?</p>
                </div>
                <div class="modal-actions">
                    <button type="button" class="btn-cancel" onclick="
                        document.getElementById('${modalId}').remove();
                        const chk = document.querySelector('.pago-checkbox[onchange*=\\'${id}\\']');
                        if (chk) chk.checked = false;
                    ">Cancelar</button>
                    <button type="button" class="btn-secondary" id="${modalId}_sim">Sim, parcelado</button>
                    <button type="button" class="btn-save" id="${modalId}_nao">Não, pago integral</button>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', html);
    document.getElementById(`${modalId}_sim`).addEventListener('click', () => {
        document.getElementById(modalId).remove();
        // Abre o formulário direto na aba de parcelas
        showFormModal(id);
        setTimeout(() => switchFormTab(2), 100);
    });
    document.getElementById(`${modalId}_nao`).addEventListener('click', () => {
        document.getElementById(modalId).remove();
        confirmarPagamentoTotal(id, conta);
    });
}

async function confirmarPagamentoTotal(id, conta) {
    const updated = {
        ...conta,
        status: 'PAGO',
        valor_pago: conta.valor,
        data_pagamento: new Date().toISOString().split('T')[0],
        observacoes: { parcelas: conta.observacoes?.parcelas || [], textos: conta.observacoes?.textos || [] }
    };
    const success = await atualizarConta(id, updated);
    if (success) {
        Object.assign(conta, updated);
        showMessage(`NF ${conta.numero_nf} marcada como PAGA`, 'success');
        updateDashboard(); filterContas();
    } else {
        const chk = document.querySelector(`.pago-checkbox[onchange*="'${id}'"]`);
        if (chk) chk.checked = false;
    }
}

async function atualizarConta(id, dadosAtualizados) {
    if (!isOnline) { showMessage('Sistema offline', 'error'); return false; }
    try {
        const response = await fetch(`${API_URL}/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify(dadosAtualizados)
        });
        if (response.status === 401) { sessionStorage.removeItem('receberSession'); mostrarTelaAcessoNegado(); return false; }
        if (!response.ok) throw new Error('Erro ao atualizar');
        const saved = await response.json();
        const idx = contas.findIndex(c => c.id === id);
        if (idx !== -1) contas[idx] = mapearConta(saved);
        return true;
    } catch (err) {
        console.error(err);
        showMessage('Erro ao atualizar status', 'error');
        return false;
    }
}

// ============================================
// MENSAGENS
// ============================================
function showMessage(msg, type) {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOutBottom 0.3s forwards';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

console.log('✅ Receber script carregado');
