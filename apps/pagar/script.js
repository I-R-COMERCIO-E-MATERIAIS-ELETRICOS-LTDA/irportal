// ============================================
// CONFIGURAÇÃO
// ============================================
const PORTAL_URL = 'https://ir-comercio-portal-zcan.onrender.com';
const API_URL = 'https://contas-a-pagar-ytr6.onrender.com/api';

let contas = [];
let isOnline = false;
let lastDataHash = '';
let sessionToken = null;
let currentMonth = new Date();

let formType = 'simple';
let numParcelas = 0;
let currentGrupoId = null;
let parcelasDoGrupo = [];
let observacoesArray = [];
let tentativasReconexao = 0;
const MAX_TENTATIVAS = 3;

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// ============================================
// QUEUE DE PROCESSAMENTO EM BACKGROUND
// ============================================
const processingQueue = {
    items: [],
    isProcessing: false,
    retryAttempts: 3
};

function addToQueue(item) {
    processingQueue.items.push({
        ...item,
        id: generateUUID(),
        attempts: 0,
        status: 'pending'
    });
}

async function processQueue() {
    if (processingQueue.isProcessing || processingQueue.items.length === 0) return;
    
    processingQueue.isProcessing = true;
    const BATCH_SIZE = 5;
    
    while (processingQueue.items.length > 0) {
        const batch = processingQueue.items.slice(0, BATCH_SIZE);
        await Promise.allSettled(batch.map(item => processSingleItem(item)));
        processingQueue.items = processingQueue.items.filter(item => item.status !== 'success');
    }
    
    processingQueue.isProcessing = false;
}

async function processSingleItem(item) {
    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            body: JSON.stringify(item.data),
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) {
            item.status = 'auth_error';
            return;
        }

        if (response.ok) {
            const savedData = await response.json();
            const index = contas.findIndex(c => c.tempId === item.tempId);
            if (index !== -1) contas[index] = savedData;
            item.status = 'success';
            console.log(`✅ Parcela ${item.tempId} salva com sucesso`);
        } else {
            throw new Error(`Erro ${response.status}`);
        }
    } catch (error) {
        console.error(`❌ Erro ao processar item ${item.tempId}:`, error);
        item.attempts++;
        
        if (item.attempts >= processingQueue.retryAttempts) {
            item.status = 'failed';
            showMessage(`Falha ao salvar parcela. Tente novamente.`, 'error');
            contas = contas.filter(c => c.tempId !== item.tempId);
            updateDashboard();
            filterContas();
        } else {
            item.status = 'retry';
            await new Promise(resolve => setTimeout(resolve, 1000 * item.attempts));
        }
    }
}

console.log('🚀 Contas a Pagar iniciada');

document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM carregado');
    
    // ============================================
    // EVENT DELEGATION PARA BOTÕES DA TABELA
    // ============================================
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        
        console.log(`🎯 Event delegation - Ação: ${action}, ID: ${id}`);
        
        // Validação de ID apenas para ações que precisam
        if (!id && action !== 'new-conta') {
            console.error('❌ ID não encontrado no botão');
            return;
        }
        
        switch(action) {
            case 'view':
                window.viewConta(id);
                break;
            case 'edit':
                window.editConta(id);
                break;
            case 'delete':
                window.deleteConta(id);
                break;
            case 'toggle':
                window.togglePago(id);
                break;
            case 'new-conta':
                window.showFormModal(null);
                break;
            default:
                console.warn('Ação desconhecida:', action);
        }
    });
    
    verificarAutenticacao();
});

// ============================================
// NAVEGAÇÃO POR MESES
// ============================================
function updateDisplay() {
    const display = document.getElementById('currentMonth');
    if (display) {
        display.textContent = `${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    }
    updateDashboard();
    filterContas();
}

window.changeMonth = function(direction) {
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    updateDisplay();
};

window.previousMonth = function() {
    window.changeMonth(-1);
};

window.nextMonth = function() {
    window.changeMonth(1);
};

// ============================================
// AUTENTICAÇÃO
// ============================================
function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('contasPagarSession', tokenFromUrl);
        sessionStorage.setItem('contasPagarSessionTime', Date.now().toString());
        window.history.replaceState({}, document.title, window.location.pathname);
        console.log('✅ Token recebido da URL');
    } else {
        sessionToken = sessionStorage.getItem('contasPagarSession');
        
        const sessionTime = sessionStorage.getItem('contasPagarSessionTime');
        if (sessionTime && sessionToken) {
            const timeDiff = Date.now() - parseInt(sessionTime);
            const hoursElapsed = timeDiff / (1000 * 60 * 60);
            
            if (hoursElapsed > 24) {
                console.log('⏰ Sessão expirada por tempo (>24h)');
                console.warn('⚠️ Sessão expirada - Funcionando em modo offline');
                sessionToken = null;
            } else {
                console.log(`✅ Sessão válida (${hoursElapsed.toFixed(1)}h desde o login)`);
            }
        }
    }

    if (!sessionToken) {
        console.log('⚠️ Sem token - Funcionando em modo offline');
    }

    inicializarApp();
}

function tratarErroAutenticacao(response) {
    if (response && response.status === 401) {
        console.log('❌ Token inválido ou sessão expirada (401)');
        tentativasReconexao++;
        
        if (tentativasReconexao < MAX_TENTATIVAS) {
            console.log(`🔄 Tentativa ${tentativasReconexao} de ${MAX_TENTATIVAS} - aguardando 2s...`);
            setTimeout(() => {
                checkServerStatus().catch(err => console.warn('Erro na tentativa de reconexão:', err));
            }, 2000);
            return true;
        } else {
            console.log('❌ Máximo de tentativas atingido - Continuando em modo offline');
            isOnline = false;
            sessionToken = null;
            showMessage('Sessão expirada - Modo offline ativado', 'warning');
            return true;
        }
    }
    return false;
}

function inicializarApp() {
    console.log('🚀 Iniciando aplicação...');
    tentativasReconexao = 0;
    updateDisplay();
    
    checkServerStatus().catch(err => {
        console.warn('⚠️ Erro ao verificar servidor:', err);
        isOnline = false;
        updateConnectionStatus();
    });
    
    if (sessionToken) {
        setInterval(() => {
            checkServerStatus().catch(err => console.warn('Erro no polling:', err));
        }, 15000);
        startPolling();
    } else {
        console.log('ℹ️ Modo offline - Polling desabilitado');
    }
}

// ============================================
// CONEXÃO E STATUS
// ============================================
async function checkServerStatus() {
    if (!sessionToken) {
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
    
    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            mode: 'cors',
            signal: AbortSignal.timeout(5000)
        });

        if (tratarErroAutenticacao(response)) return false;

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE - Sincronizando pendências...');
            tentativasReconexao = 0;
            await loadContas();
            
            if (processingQueue.items.length > 0) {
                showMessage('Sincronizando contas pendentes...', 'info');
                processQueue();
            }
        }
        
        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        console.warn('⚠️ Erro ao verificar servidor:', error.message);
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
}

function updateConnectionStatus() {
    const statusElement = document.getElementById('connectionStatus');
    if (statusElement) {
        statusElement.className = isOnline ? 'connection-status online' : 'connection-status offline';
    }
}

// ============================================
// CARREGAMENTO DE DADOS
// ============================================
async function loadContas() {
    if (!isOnline) return;

    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) return;
        if (!response.ok) return;

        const data = await response.json();
        contas = data;
        
        const newHash = JSON.stringify(contas.map(c => c.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            updateAllFilters();
            updateDashboard();
            filterContas();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar:', error);
    }
}

async function loadParcelasDoGrupo(grupoId) {
    if (!isOnline || !grupoId) return [];

    try {
        const response = await fetch(`${API_URL}/contas/grupo/${grupoId}`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) return [];
        if (!response.ok) return [];

        const data = await response.json();
        return data || [];
    } catch (error) {
        console.error('❌ Erro ao carregar parcelas do grupo:', error);
        return [];
    }
}

function startPolling() {
    loadContas();
    setInterval(() => {
        if (isOnline) loadContas();
    }, 10000);
}

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const contasDoMes = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    
    const valorPago = contasDoMes
        .filter(c => c.status === 'PAGO')
        .reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    
    const contasVencidas = contasDoMes.filter(c => {
        if (c.status === 'PAGO') return false;
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        dataVenc.setHours(0, 0, 0, 0);
        return dataVenc <= hoje;
    });
    const qtdVencido = contasVencidas.length;
    
    const valorTotal = contasDoMes.reduce((sum, c) => sum + parseFloat(c.valor || 0), 0);
    const valorPendente = valorTotal - valorPago;
    
    document.getElementById('statPagos').textContent = `R$ ${valorPago.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('statVencido').textContent = qtdVencido;
    document.getElementById('statPendente').textContent = `R$ ${valorPendente.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    document.getElementById('statValorTotal').textContent = `R$ ${valorTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2})}`;
    
    const cardVencido = document.getElementById('cardVencido');
    const pulseBadge = document.getElementById('pulseBadge');
    
    if (qtdVencido > 0) {
        cardVencido.classList.add('has-alert');
        if (pulseBadge) {
            pulseBadge.style.display = 'flex';
            pulseBadge.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="12" y1="8" x2="12" y2="12"></line>
                    <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
            `;
        }
    } else {
        cardVencido.classList.remove('has-alert');
        if (pulseBadge) {
            pulseBadge.style.display = 'none';
        }
    }
}

// ============================================
// MODAL DE VENCIDOS
// ============================================
window.showVencidoModal = function() {
    console.log('🔔 showVencidoModal chamado');
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const contasDoMes = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    
    const contasVencidas = contasDoMes.filter(c => {
        if (c.status === 'PAGO') return false;
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        dataVenc.setHours(0, 0, 0, 0);
        return dataVenc <= hoje;
    });
    
    contasVencidas.sort((a, b) => {
        const dataA = new Date(a.data_vencimento);
        const dataB = new Date(b.data_vencimento);
        return dataA - dataB;
    });
    
    const modal = document.getElementById('vencidoModal');
    const body = document.getElementById('vencidoModalBody');
    
    if (contasVencidas.length === 0) {
        body.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.3; margin-bottom: 1rem;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 8l0 4"></path>
                    <path d="M12 16l.01 0"></path>
                </svg>
                <p style="font-size: 1.1rem; font-weight: 600; margin: 0;">Nenhuma conta vencida</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Todas as contas estão dentro do prazo ou foram pagas</p>
            </div>
        `;
    } else {
        body.innerHTML = `
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Descrição</th>
                            <th>Vencimento</th>
                            <th style="text-align: right;">Valor</th>
                            <th style="text-align: center;">Dias Atraso</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${contasVencidas.map(c => {
                            const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
                            const diasAtraso = Math.floor((hoje - dataVenc) / (1000 * 60 * 60 * 24));
                            return `
                                <tr>
                                    <td>${c.descricao}</td>
                                    <td style="white-space: nowrap;">${formatDate(c.data_vencimento)}</td>
                                    <td style="text-align: right; font-weight: 700; color: #EF4444;">
                                        R$ ${parseFloat(c.valor).toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                                    </td>
                                    <td style="text-align: center;">
                                        <span class="badge vencido">${diasAtraso} dia${diasAtraso !== 1 ? 's' : ''}</span>
                                    </td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    modal.style.display = 'flex';
};

window.closeVencidoModal = function() {
    console.log('❌ closeVencidoModal chamado');
    const modal = document.getElementById('vencidoModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => {
            modal.style.display = 'none';
            modal.style.animation = '';
        }, 200);
    }
};

// ============================================
// SINCRONIZAÇÃO
// ============================================
window.sincronizarDados = async function() {
    console.log('🔄 sincronizarDados chamado');
    showMessage('Sincronizando...', 'info');
    await loadContas();
    showMessage('Dados sincronizados', 'success');
};

// ============================================
// FORMULÁRIO
// ============================================
window.toggleForm = function() {
    console.log('🔘 toggleForm chamado');
    window.showFormModal(null);
};

window.showFormModal = async function(editingId = null) {
    console.log('📝 showFormModal chamado com editingId:', editingId, 'tipo:', typeof editingId);
    
    const isEditing = editingId !== null && editingId !== undefined && editingId !== 'null' && editingId !== '';
    let conta = null;
    
    if (isEditing) {
        console.log('🔍 Procurando conta com ID:', editingId);
        conta = contas.find(c => String(c.id) === String(editingId) || String(c.tempId) === String(editingId));
        console.log('🔍 Conta encontrada:', conta ? 'SIM' : 'NÃO');
        
        if (!conta) {
            showMessage('Conta não encontrada!', 'error');
            return;
        }
        
        if (conta.grupo_id) {
            currentGrupoId = conta.grupo_id;
            parcelasDoGrupo = await loadParcelasDoGrupo(conta.grupo_id);
        } else {
            currentGrupoId = null;
            parcelasDoGrupo = [conta];
        }
        
        if (conta.observacoes) {
            try {
                observacoesArray = typeof conta.observacoes === 'string' 
                    ? JSON.parse(conta.observacoes) 
                    : conta.observacoes;
            } catch (e) {
                observacoesArray = [];
            }
        } else {
            observacoesArray = [];
        }
    } else {
        currentGrupoId = null;
        parcelasDoGrupo = [];
        observacoesArray = [];
    }

    formType = isEditing ? 'edit' : 'simple';
    numParcelas = 0;

    const temParcelas = isEditing && conta?.grupo_id && parcelasDoGrupo.length > 1;
    
    const modalHTML = `
        <div class="modal-overlay" id="formModal">
            <div class="modal-content modal-large">
                <button class="modal-close-x" onclick="window.closeFormModal()" title="Fechar">✕</button>
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Conta' : 'Nova Conta'}</h3>
                </div>
                
                ${!isEditing ? `
                <div class="form-type-selector">
                    <button type="button" class="form-type-btn active" onclick="window.selectFormType('simple')">Cadastro Simples</button>
                    <button type="button" class="form-type-btn" onclick="window.selectFormType('parcelado')">Cadastro Parcelado</button>
                </div>
                ` : ''}
                
                <form id="contaForm" onsubmit="window.handleFormSubmit(event, ${isEditing})">
                    <input type="hidden" id="observacoesData" value='${JSON.stringify(observacoesArray)}'>
                    ${isEditing ? `
                        <input type="hidden" id="editId" value="${editingId}">
                        <input type="hidden" id="grupoId" value="${currentGrupoId || ''}">
                    ` : ''}
                    
                    <div class="tabs-container">
                        <div class="tabs-nav">
                            ${isEditing && temParcelas ? `
                                <button type="button" class="tab-btn active" onclick="window.switchFormTab(0)">Dados Gerais</button>
                                ${parcelasDoGrupo.map((p, idx) => 
                                    `<button type="button" class="tab-btn" onclick="window.switchFormTab(${idx + 1})">${p.parcela_numero}ª Parcela</button>`
                                ).join('')}
                                <button type="button" class="tab-btn" onclick="window.switchFormTab(${parcelasDoGrupo.length + 1})">Observações</button>
                            ` : `
                                <button type="button" class="tab-btn active" onclick="window.switchFormTab(0)">Dados</button>
                                <button type="button" class="tab-btn" onclick="window.switchFormTab(1)">Pagamento</button>
                                <button type="button" class="tab-btn" onclick="window.switchFormTab(2)">Observações</button>
                            `}
                        </div>

                        ${isEditing && temParcelas ? renderEditFormComParcelas(conta) : renderEditFormSimples(conta, isEditing)}
                    </div>

                    <div class="modal-actions">
                        <button type="submit" class="save">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        <button type="button" class="secondary" onclick="window.closeFormModal()">Cancelar</button>
                    </div>
                </form>
            </div>
        </div>
    `;

document.body.insertAdjacentHTML('beforeend', modalHTML);

const modal = document.getElementById('formModal');

// FORÇA O CSS CORRETO
requestAnimationFrame(() => {
    modal.classList.add('show');
});

setTimeout(() => {
    applyUppercaseFields();
}, 100);

function renderEditFormSimples(conta, isEditing) {
    const observacoesHTML = observacoesArray.length > 0 
        ? observacoesArray.map((obs, idx) => `
            <div class="observacao-item" data-index="${idx}">
                <div class="observacao-header">
                    <span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span>
                    <button type="button" class="btn-remove-obs" onclick="window.removerObservacao(${idx})" title="Remover">✕</button>
                </div>
                <p class="observacao-texto">${obs.texto}</p>
            </div>
        `).join('')
        : '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';
        
    return `
        <div class="tab-content active" id="tab-dados">
            <div class="form-grid-compact">
                <div class="form-row">
                    <div class="form-group">
                        <label for="documento">Documento</label>
                        <input type="text" id="documento" value="${conta?.documento || ''}" placeholder="CPF/CNPJ">
                    </div>
                    
                    <div class="form-group form-group-full">
                        <label for="descricao">Descrição *</label>
                        <input type="text" id="descricao" value="${conta?.descricao || ''}" required>
                    </div>
                </div>
                
                <div id="formSimple" ${formType === 'parcelado' ? 'style="display:none"' : ''}>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="valor">Valor (R$) *</label>
                            <input type="number" id="valor" step="0.01" min="0" value="${conta?.valor || ''}" ${formType === 'simple' ? 'required' : ''}>
                        </div>
                        
                        <div class="form-group">
                            <label for="data_vencimento">Data de Vencimento *</label>
                            <input type="date" id="data_vencimento" value="${conta?.data_vencimento || ''}" ${formType === 'simple' ? 'required' : ''}>
                        </div>
                    </div>
                </div>
                
                <div id="formParcelado" ${formType !== 'parcelado' ? 'style="display:none"' : ''}>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="numParcelas">Número de Parcelas *</label>
                            <input type="number" id="numParcelas" min="2" max="360" onchange="window.generateParcelas()">
                        </div>
                        
                        <div class="form-group">
                            <label for="valorTotal">Valor Total (R$) *</label>
                            <input type="number" id="valorTotal" step="0.01" min="0" onchange="window.generateParcelas()">
                        </div>
                        
                        <div class="form-group">
                            <label for="dataInicio">Data Início *</label>
                            <input type="date" id="dataInicio" onchange="window.generateParcelas()">
                        </div>
                    </div>
                    
                    <div id="parcelasContainer"></div>
                </div>
            </div>
        </div>

        <div class="tab-content" id="tab-pagamento">
            <div class="form-grid-compact">
                <div class="form-row">
                    <div class="form-group">
                        <label for="forma_pagamento">Forma de Pagamento *</label>
                        <select id="forma_pagamento" ${formType === 'simple' ? 'required' : ''}>
                            <option value="">Selecione...</option>
                            <option value="PIX" ${conta?.forma_pagamento === 'PIX' ? 'selected' : ''}>Pix</option>
                            <option value="BOLETO" ${conta?.forma_pagamento === 'BOLETO' ? 'selected' : ''}>Boleto</option>
                            <option value="CARTAO" ${conta?.forma_pagamento === 'CARTAO' ? 'selected' : ''}>Cartão</option>
                            <option value="DINHEIRO" ${conta?.forma_pagamento === 'DINHEIRO' ? 'selected' : ''}>Dinheiro</option>
                            <option value="TRANSFERENCIA" ${conta?.forma_pagamento === 'TRANSFERENCIA' ? 'selected' : ''}>Transferência</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="banco">Banco *</label>
                        <select id="banco" ${formType === 'simple' ? 'required' : ''}>
                            <option value="">Selecione...</option>
                            <option value="BANCO DO BRASIL" ${conta?.banco === 'BANCO DO BRASIL' ? 'selected' : ''}>Banco do Brasil</option>
                            <option value="BRADESCO" ${conta?.banco === 'BRADESCO' ? 'selected' : ''}>Bradesco</option>
                            <option value="SICOOB" ${conta?.banco === 'SICOOB' ? 'selected' : ''}>Sicoob</option>
                        </select>
                    </div>
                    
                    <div class="form-group">
                        <label for="data_pagamento">Data do Pagamento</label>
                        <input type="date" id="data_pagamento" value="${conta?.data_pagamento || ''}">
                    </div>
                </div>
            </div>
        </div>

        <div class="tab-content" id="tab-observacoes">
            <div class="observacoes-container">
                <div class="observacoes-list" id="observacoesList">
                    ${observacoesHTML}
                </div>
                
                <div class="nova-observacao">
                    <label for="novaObservacao">Nova Observação</label>
                    <textarea id="novaObservacao" placeholder="Digite sua observação aqui..." rows="3"></textarea>
                    <button type="button" class="btn-add-obs" onclick="window.adicionarObservacao()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Adicionar Observação
                    </button>
                </div>
            </div>
        </div>
    `;
}

function renderEditFormComParcelas(conta) {
    const observacoesHTML = observacoesArray.length > 0 
        ? observacoesArray.map((obs, idx) => `
            <div class="observacao-item" data-index="${idx}">
                <div class="observacao-header">
                    <span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span>
                    <button type="button" class="btn-remove-obs" onclick="window.removerObservacao(${idx})" title="Remover">✕</button>
                </div>
                <p class="observacao-texto">${obs.texto}</p>
            </div>
        `).join('')
        : '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';
        
    return `
        <div class="tab-content active" id="tab-dados-gerais">
            <div class="form-grid-compact">
                <div class="form-row">
                    <div class="form-group">
                        <label for="documento">NF / Documento</label>
                        <input type="text" id="documento" value="${conta?.documento || ''}" placeholder="NF, CTE...">
                    </div>
                    
                    <div class="form-group">
                        <label for="descricao">Descrição *</label>
                        <input type="text" id="descricao" value="${conta?.descricao || ''}" required>
                    </div>
                </div>
            </div>
        </div>

        ${parcelasDoGrupo.map((parcela, idx) => `
            <div class="tab-content" id="tab-parcela-${idx}">
                <div class="form-grid-compact">
                    <div class="form-row">
                        <div class="form-group">
                            <label>Forma de Pagamento *</label>
                            <select id="parcela_forma_pagamento_${parcela.id}" class="parcela-field" data-parcela-id="${parcela.id}" required>
                                <option value="">Selecione...</option>
                                <option value="PIX" ${parcela.forma_pagamento === 'PIX' ? 'selected' : ''}>Pix</option>
                                <option value="BOLETO" ${parcela.forma_pagamento === 'BOLETO' ? 'selected' : ''}>Boleto</option>
                                <option value="CARTAO" ${parcela.forma_pagamento === 'CARTAO' ? 'selected' : ''}>Cartão</option>
                                <option value="DINHEIRO" ${parcela.forma_pagamento === 'DINHEIRO' ? 'selected' : ''}>Dinheiro</option>
                                <option value="TRANSFERENCIA" ${parcela.forma_pagamento === 'TRANSFERENCIA' ? 'selected' : ''}>Transferência</option>
                            </select>
                        </div>
                        
                        <div class="form-group">
                            <label>Banco *</label>
                            <select id="parcela_banco_${parcela.id}" class="parcela-field" data-parcela-id="${parcela.id}" required>
                                <option value="">Selecione...</option>
                                <option value="BANCO DO BRASIL" ${parcela.banco === 'BANCO DO BRASIL' ? 'selected' : ''}>Banco do Brasil</option>
                                <option value="BRADESCO" ${parcela.banco === 'BRADESCO' ? 'selected' : ''}>Bradesco</option>
                                <option value="SICOOB" ${parcela.banco === 'SICOOB' ? 'selected' : ''}>Sicoob</option>
                            </select>
                        </div>
                    </div>
                    
                    <div class="form-row">
                        <div class="form-group">
                            <label>Data de Vencimento *</label>
                            <input type="date" id="parcela_vencimento_${parcela.id}" class="parcela-field" value="${parcela.data_vencimento}" data-parcela-id="${parcela.id}" required>
                        </div>
                        
                        <div class="form-group">
                            <label>Valor (R$) *</label>
                            <input type="number" id="parcela_valor_${parcela.id}" class="parcela-field" step="0.01" min="0" value="${parcela.valor}" data-parcela-id="${parcela.id}" required>
                        </div>
                        
                        <div class="form-group">
                            <label>Data do Pagamento</label>
                            <input type="date" id="parcela_pagamento_${parcela.id}" class="parcela-field" value="${parcela.data_pagamento || ''}" data-parcela-id="${parcela.id}">
                        </div>
                    </div>
                </div>
            </div>
        `).join('')}

        <div class="tab-content" id="tab-observacoes-final">
            <div class="observacoes-container">
                <div class="observacoes-list" id="observacoesList">
                    ${observacoesHTML}
                </div>
                
                <div class="nova-observacao">
                    <label for="novaObservacao">Nova Observação</label>
                    <textarea id="novaObservacao" placeholder="Digite sua observação aqui..." rows="3"></textarea>
                    <button type="button" class="btn-add-obs" onclick="window.adicionarObservacao()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                        </svg>
                        Adicionar Observação
                    </button>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// FUNÇÕES DE OBSERVAÇÕES
// ============================================
window.switchFormTab = function(index) {
    document.querySelectorAll('#formModal .tab-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
    
    document.querySelectorAll('#formModal .tab-content').forEach((content, i) => {
        content.classList.toggle('active', i === index);
    });
};

window.adicionarObservacao = function() {
    const textarea = document.getElementById('novaObservacao');
    const texto = textarea.value.trim();
    
    if (!texto) {
        showMessage('Digite uma observação primeiro', 'error');
        return;
    }
    
    const observacoesDataField = document.getElementById('observacoesData');
    let observacoes = JSON.parse(observacoesDataField.value || '[]');
    
    observacoes.push({
        texto: texto,
        timestamp: new Date().toISOString()
    });
    
    observacoesDataField.value = JSON.stringify(observacoes);
    textarea.value = '';
    
    atualizarListaObservacoes();
    showMessage('Observação adicionada!', 'success');
};

window.removerObservacao = function(index) {
    const observacoesDataField = document.getElementById('observacoesData');
    let observacoes = JSON.parse(observacoesDataField.value || '[]');
    
    observacoes.splice(index, 1);
    observacoesDataField.value = JSON.stringify(observacoes);
    
    atualizarListaObservacoes();
    showMessage('Observação removida!', 'success');
};

function atualizarListaObservacoes() {
    const observacoesDataField = document.getElementById('observacoesData');
    const observacoes = JSON.parse(observacoesDataField.value || '[]');
    const container = document.getElementById('observacoesList');
    
    if (observacoes.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';
    } else {
        container.innerHTML = observacoes.map((obs, idx) => `
            <div class="observacao-item" data-index="${idx}">
                <div class="observacao-header">
                    <span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span>
                    <button type="button" class="btn-remove-obs" onclick="window.removerObservacao(${idx})" title="Remover">✕</button>
                </div>
                <p class="observacao-texto">${obs.texto}</p>
            </div>
        `).join('');
    }
}

// ============================================
// FUNÇÕES DO FORMULÁRIO
// ============================================
window.selectFormType = function(type) {
    formType = type;
    
    const buttons = document.querySelectorAll('.form-type-btn');
    buttons.forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    const formSimple = document.getElementById('formSimple');
    const formParcelado = document.getElementById('formParcelado');
    
    if (type === 'simple') {
        formSimple.style.display = 'block';
        formParcelado.style.display = 'none';
        
        document.getElementById('valor').required = true;
        document.getElementById('data_vencimento').required = true;
        document.getElementById('forma_pagamento').required = true;
        document.getElementById('banco').required = true;
    } else {
        formSimple.style.display = 'none';
        formParcelado.style.display = 'block';
        
        document.getElementById('valor').required = false;
        document.getElementById('data_vencimento').required = false;
        document.getElementById('forma_pagamento').required = false;
        document.getElementById('banco').required = false;
    }
};

window.generateParcelas = function() {
    const numParcelasInput = document.getElementById('numParcelas');
    const valorTotalInput = document.getElementById('valorTotal');
    const dataInicioInput = document.getElementById('dataInicio');
    const container = document.getElementById('parcelasContainer');

    const numParcelas = parseInt(numParcelasInput?.value);
    const valorTotal = parseFloat(valorTotalInput?.value);
    const dataInicio = dataInicioInput?.value;

    if (!numParcelas || !valorTotal || !dataInicio || numParcelas < 2) {
        container.innerHTML = '';
        return;
    }

    const valorParcela = (valorTotal / numParcelas).toFixed(2);
    const dataBase = new Date(dataInicio + 'T00:00:00');

    let html = '<div class="parcelas-preview"><h4>Parcelas Geradas:</h4>';

    for (let i = 0; i < numParcelas; i++) {
        const dataVenc = new Date(dataBase);
        dataVenc.setMonth(dataVenc.getMonth() + i);
        const dataFormatada = dataVenc.toISOString().split('T')[0];

        html += `
            <div class="parcela-item">
                <span class="parcela-numero">${i + 1}ª Parcela</span>
                <span class="parcela-data">${formatDate(dataFormatada)}</span>
                <span class="parcela-valor">R$ ${parseFloat(valorParcela).toLocaleString('pt-BR', {minimumFractionDigits: 2})}</span>
            </div>
        `;
    }

    html += '</div>';
    container.innerHTML = html;
};

// ============================================
// HANDLER DE SUBMIT DO FORMULÁRIO
// ============================================
window.handleFormSubmit = function(event, isEditing) {
    event.preventDefault();
    
    if (isEditing) {
        handleEditSubmit(event);
    } else {
        handleCreateSubmit(event);
    }
    
    return false;
};

async function handleCreateSubmit(event) {
    event.preventDefault();
    
    if (formType === 'parcelado') {
        await salvarContaParcelada();
    } else {
        await salvarContaOtimista();
    }
}

async function handleEditSubmit(event) {
    event.preventDefault();
    
    const temParcelas = parcelasDoGrupo.length > 1;
    
    if (temParcelas) {
        await handleEditSubmitParcelas();
    } else {
        const editId = document.getElementById('editId').value;
        await editarContaOtimista(editId);
    }
}

async function salvarContaOtimista() {
    const descricao = document.getElementById('descricao')?.value?.trim();
    const valor = document.getElementById('valor')?.value;
    const dataVencimento = document.getElementById('data_vencimento')?.value;
    const formaPagamento = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;

    if (!descricao || !valor || !dataVencimento || !formaPagamento || !banco) {
        showMessage('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const formData = {
        documento: document.getElementById('documento')?.value?.trim() || null,
        descricao: descricao,
        valor: parseFloat(valor),
        data_vencimento: dataVencimento,
        forma_pagamento: formaPagamento,
        banco: banco,
        data_pagamento: document.getElementById('data_pagamento')?.value || null,
        observacoes: document.getElementById('observacoesData')?.value || '[]',
        status: document.getElementById('data_pagamento')?.value ? 'PAGO' : 'PENDENTE'
    };

    if (isNaN(formData.valor) || formData.valor <= 0) {
        showMessage('Valor inválido. Digite um número maior que zero.', 'error');
        return;
    }

    const tempId = `temp_${Date.now()}`;
    const contaTemporaria = {
        ...formData,
        id: null,
        tempId: tempId,
        synced: false
    };
    
    contas.push(contaTemporaria);
    
    lastDataHash = JSON.stringify(contas.map(c => c.id || c.tempId));
    updateAllFilters();
    updateDashboard();
    filterContas();
    window.closeFormModal();
    
    showMessage('Nova conta registrada', 'success');
    
    if (!isOnline) {
        showMessage('Sistema offline. A conta será sincronizada quando voltar online.', 'warning');
        return;
    }
    
    addToQueue({
        tempId: tempId,
        data: formData
    });
    
    processQueue();
}

async function salvarContaParcelada() {
    const descricao = document.getElementById('descricao')?.value?.trim();
    const documento = document.getElementById('documento')?.value?.trim() || null;
    const numParcelas = parseInt(document.getElementById('numParcelas')?.value);
    const valorTotal = parseFloat(document.getElementById('valorTotal')?.value);
    const dataInicio = document.getElementById('dataInicio')?.value;
    const formaPagamento = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    const observacoesData = document.getElementById('observacoesData')?.value || '[]';

    if (!descricao || !numParcelas || !valorTotal || !dataInicio || !formaPagamento || !banco) {
        showMessage('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    if (isNaN(valorTotal) || valorTotal <= 0) {
        showMessage('Valor total inválido.', 'error');
        return;
    }

    if (numParcelas < 2 || numParcelas > 360) {
        showMessage('Número de parcelas deve ser entre 2 e 360.', 'error');
        return;
    }

    const valorParcela = (valorTotal / numParcelas).toFixed(2);
    const dataBase = new Date(dataInicio + 'T00:00:00');
    const grupoId = generateUUID();

    const parcelas = [];
    for (let i = 0; i < numParcelas; i++) {
        const dataVenc = new Date(dataBase);
        dataVenc.setMonth(dataVenc.getMonth() + i);

        parcelas.push({
            documento,
            descricao,
            observacoes: observacoesData,
            valor: parseFloat(valorParcela),
            data_vencimento: dataVenc.toISOString().split('T')[0],
            data_pagamento: null,
            forma_pagamento: formaPagamento,
            banco,
            status: 'PENDENTE',
            parcela_numero: i + 1,
            parcela_total: numParcelas,
            grupo_id: grupoId
        });
    }

    const tempIds = [];
    for (const parcela of parcelas) {
        const tempId = `temp_${Date.now()}_${Math.random()}`;
        tempIds.push(tempId);
        contas.push({
            ...parcela,
            id: null,
            tempId,
            synced: false
        });
    }

    lastDataHash = JSON.stringify(contas.map(c => c.id || c.tempId));
    updateAllFilters();
    updateDashboard();
    filterContas();
    window.closeFormModal();

    showMessage('Nova conta registrada', 'success');

    if (!isOnline) {
        showMessage('Sistema offline. As parcelas serão sincronizadas quando voltar online.', 'warning');
        return;
    }

    for (let i = 0; i < parcelas.length; i++) {
        addToQueue({
            tempId: tempIds[i],
            data: parcelas[i]
        });
    }

    processQueue();
}

async function editarContaOtimista(editId) {
    const descricao = document.getElementById('descricao')?.value?.trim();
    const valor = document.getElementById('valor')?.value;
    const dataVencimento = document.getElementById('data_vencimento')?.value;
    const formaPagamento = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;

    if (!descricao || !valor || !dataVencimento || !formaPagamento || !banco) {
        showMessage('Por favor, preencha todos os campos obrigatórios.', 'error');
        return;
    }

    const formData = {
        documento: document.getElementById('documento')?.value?.trim() || null,
        descricao: descricao,
        valor: parseFloat(valor),
        data_vencimento: dataVencimento,
        forma_pagamento: formaPagamento,
        banco: banco,
        data_pagamento: document.getElementById('data_pagamento')?.value || null,
        observacoes: document.getElementById('observacoesData')?.value || '[]',
    };

    if (isNaN(formData.valor) || formData.valor <= 0) {
        showMessage('Valor inválido. Digite um número maior que zero.', 'error');
        return;
    }

    const contaOriginal = contas.find(c => String(c.id) === String(editId));
    if (!contaOriginal) {
        showMessage('Conta não encontrada!', 'error');
        return;
    }

    formData.parcela_numero = contaOriginal.parcela_numero;
    formData.parcela_total = contaOriginal.parcela_total;

    if (!formData.data_pagamento) {
        formData.status = contaOriginal.status;
    } else {
        formData.status = 'PAGO';
    }

    if (!isOnline) {
        showMessage('Sistema offline. Dados não foram salvos.', 'error');
        window.closeFormModal();
        return;
    }

    const backup = {...contaOriginal};
    const index = contas.findIndex(c => String(c.id) === String(editId));
    
    contas[index] = {
        ...contaOriginal,
        ...formData,
        synced: false
    };
    
    lastDataHash = JSON.stringify(contas.map(c => c.id));
    updateAllFilters();
    updateDashboard();
    filterContas();
    window.closeFormModal();
    
    showMessage('Registro atualizado', 'success');
    
    try {
        const response = await fetch(`${API_URL}/contas/${editId}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            body: JSON.stringify(formData),
            mode: 'cors'
        });

        if (tratarErroAutenticacao(response)) {
            contas[index] = backup;
            updateDashboard();
            filterContas();
            return;
        }

        if (!response.ok) {
            let errorMessage = 'Erro ao salvar';
            try {
                const errorData = await response.json();
                errorMessage = errorData.error || errorData.message || errorMessage;
            } catch (e) {
                errorMessage = `Erro ${response.status}: ${response.statusText}`;
            }
            throw new Error(errorMessage);
        }

        const savedData = await response.json();
        contas[index] = savedData;
        
        lastDataHash = JSON.stringify(contas.map(c => c.id));
        updateAllFilters();
        updateDashboard();
        filterContas();
    } catch (error) {
        console.error('Erro ao sincronizar:', error);
        contas[index] = backup;
        updateDashboard();
        filterContas();
        showMessage(`Erro ao sincronizar: ${error.message}`, 'error');
    }
}

async function handleEditSubmitParcelas() {
    const descricao = document.getElementById('descricao')?.value?.trim();
    const documento = document.getElementById('documento')?.value?.trim() || null;
    const observacoes = document.getElementById('observacoesData')?.value || '[]';

    if (!descricao) {
        showMessage('Por favor, preencha a descrição.', 'error');
        return;
    }

    const dadosComuns = { descricao, documento, observacoes };
    
    if (!isOnline) {
        showMessage('Sistema offline. Dados não foram salvos.', 'error');
        window.closeFormModal();
        return;
    }
    
    const atualizacoes = [];
    const backupOriginal = [];
    
    for (const parcela of parcelasDoGrupo) {
        if (parcela.isNew) continue;
        
        const vencInput = document.getElementById(`parcela_vencimento_${parcela.id}`);
        const valorInput = document.getElementById(`parcela_valor_${parcela.id}`);
        const pagInput = document.getElementById(`parcela_pagamento_${parcela.id}`);
        const formaPagInput = document.getElementById(`parcela_forma_pagamento_${parcela.id}`);
        const bancoInput = document.getElementById(`parcela_banco_${parcela.id}`);
        
        if (!vencInput || !valorInput || !formaPagInput || !bancoInput) continue;
        
        const index = contas.findIndex(c => String(c.id) === String(parcela.id));
        if (index !== -1) {
            backupOriginal.push({ index, data: {...contas[index]} });
            
            contas[index] = {
                ...contas[index],
                ...dadosComuns,
                valor: parseFloat(valorInput.value),
                data_vencimento: vencInput.value,
                data_pagamento: pagInput?.value || null,
                forma_pagamento: formaPagInput.value,
                banco: bancoInput.value,
                status: pagInput?.value ? 'PAGO' : 'PENDENTE',
                parcela_numero: parcela.parcela_numero,
                parcela_total: parcelasDoGrupo.filter(p => !p.isNew).length,
                synced: false
            };
            
            atualizacoes.push({
                id: parcela.id,
                data: {
                    ...dadosComuns,
                    valor: parseFloat(valorInput.value),
                    data_vencimento: vencInput.value,
                    data_pagamento: pagInput?.value || null,
                    forma_pagamento: formaPagInput.value,
                    banco: bancoInput.value,
                    status: pagInput?.value ? 'PAGO' : 'PENDENTE',
                    parcela_numero: parcela.parcela_numero,
                    parcela_total: parcelasDoGrupo.filter(p => !p.isNew).length
                }
            });
        }
    }
    
    lastDataHash = JSON.stringify(contas.map(c => c.id || c.tempId));
    updateAllFilters();
    updateDashboard();
    filterContas();
    window.closeFormModal();
    
    showMessage('Registro atualizado', 'success');
    
    await processEditQueue(atualizacoes, backupOriginal, parcelasDoGrupo.length);
}

async function processEditQueue(atualizacoes, backupOriginal, totalParcelas) {
    const BATCH_SIZE = 5;
    let sucessos = 0;
    let erros = [];
    
    for (let i = 0; i < atualizacoes.length; i += BATCH_SIZE) {
        const batch = atualizacoes.slice(i, i + BATCH_SIZE);
        
        const results = await Promise.allSettled(
            batch.map(async (item) => {
                const response = await fetch(`${API_URL}/contas/${item.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Session-Token': sessionToken,
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(item.data),
                    mode: 'cors'
                });
                
                if (!response.ok) throw new Error(`Erro ${response.status}`);
                
                const savedData = await response.json();
                const index = contas.findIndex(c => String(c.id) === String(item.id));
                if (index !== -1) {
                    contas[index] = savedData;
                }
                
                return { success: true, id: item.id };
            })
        );
        
        results.forEach((result, idx) => {
            if (result.status === 'fulfilled') {
                sucessos++;
            } else {
                const item = batch[idx];
                erros.push(`Parcela ${item.data.parcela_numero}: ${result.reason.message}`);
                
                const backup = backupOriginal.find(b => contas[b.index]?.id === item.id);
                if (backup) {
                    contas[backup.index] = backup.data;
                }
            }
        });
    }
    
    lastDataHash = JSON.stringify(contas.map(c => c.id));
    updateAllFilters();
    updateDashboard();
    filterContas();
    
    if (erros.length > 0) {
        showMessage(`${sucessos} de ${atualizacoes.length} parcelas atualizadas. Erros: ${erros.join('; ')}`, 'warning');
    }
}

window.closeFormModal = function() {
    const modal = document.getElementById('formModal');
    if (!modal) return;

    modal.classList.remove('show');

    setTimeout(() => {
        modal.remove();
    }, 200);
};
}


function applyUppercaseFields() {
    const camposMaiusculas = ['documento', 'descricao'];

    camposMaiusculas.forEach(campoId => {
        const campo = document.getElementById(campoId);
        if (campo) {
            campo.addEventListener('input', (e) => {
                const start = e.target.selectionStart;
                e.target.value = e.target.value.toUpperCase();
                e.target.setSelectionRange(start, start);
            });
        }
    });
}

// ============================================
// TOGGLE PAGO
// ============================================
window.togglePago = async function(id) {
    console.log('✓ togglePago chamado com id:', id);
    const idStr = String(id);
    const conta = contas.find(c => String(c.id || c.tempId) === idStr);
    if (!conta) return;

    const novoStatus = conta.status === 'PAGO' ? 'PENDENTE' : 'PAGO';
    const novaData = novoStatus === 'PAGO' ? new Date().toISOString().split('T')[0] : null;

    const old = { status: conta.status, data: conta.data_pagamento };
    conta.status = novoStatus;
    conta.data_pagamento = novaData;
    updateDashboard();
    filterContas();
    
    showMessage(`Conta marcada como ${novoStatus === 'PAGO' ? 'paga' : 'pendente'}!`, 'success');

    if (isOnline) {
        try {
            const response = await fetch(`${API_URL}/contas/${idStr}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': sessionToken,
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ status: novoStatus, data_pagamento: novaData }),
                mode: 'cors'
            });

            if (tratarErroAutenticacao(response)) return;
            if (!response.ok) throw new Error('Erro ao atualizar');

            const data = await response.json();
            const index = contas.findIndex(c => String(c.id) === idStr);
            if (index !== -1) contas[index] = data;
        } catch (error) {
            conta.status = old.status;
            conta.data_pagamento = old.data;
            updateDashboard();
            filterContas();
            showMessage('Erro ao atualizar status', 'error');
        }
    }
};

// ============================================
// EDIÇÃO E EXCLUSÃO
// ============================================
window.editConta = function(id) {
    console.log('✏️ editConta chamado com id:', id, 'tipo:', typeof id);
    window.showFormModal(id);
};

window.deleteConta = async function(id) {
    console.log('🗑️ deleteConta chamado com id:', id);
    if (!confirm('Tem certeza que deseja excluir esta conta?')) return;

    const idStr = String(id);
    const deleted = contas.find(c => String(c.id || c.tempId) === idStr);
    contas = contas.filter(c => String(c.id || c.tempId) !== idStr);
    updateAllFilters();
    updateDashboard();
    filterContas();
    showMessage('Registro excluído', 'error');

    if (isOnline) {
        try {
            const response = await fetch(`${API_URL}/contas/${idStr}`, {
                method: 'DELETE',
                headers: {
                    'X-Session-Token': sessionToken,
                    'Accept': 'application/json'
                },
                mode: 'cors'
            });

            if (tratarErroAutenticacao(response)) return;
            if (!response.ok) throw new Error('Erro ao deletar');
        } catch (error) {
            if (deleted) {
                contas.push(deleted);
                updateAllFilters();
                updateDashboard();
                filterContas();
                showMessage('Erro ao excluir conta', 'error');
            }
        }
    }
};

// ============================================
// VISUALIZAÇÃO
// ============================================
window.viewConta = function(id) {
    console.log('👁️ viewConta chamado com id:', id);
    
    const idStr = String(id);
    const conta = contas.find(c => String(c.id || c.tempId) === idStr);
    
    if (!conta) {
        showMessage('Conta não encontrada!', 'error');
        return;
    }

    const parcelaInfo = conta.parcela_numero && conta.parcela_total 
        ? `
        <div class="info-item">
            <span class="info-label">Parcela:</span>
            <span class="info-value">${conta.parcela_numero}ª de ${conta.parcela_total}</span>
        </div>
        ` 
        : '';

    const documentoInfo = conta.documento 
        ? `
        <div class="info-item">
            <span class="info-label">Documento:</span>
            <span class="info-value">${conta.documento}</span>
        </div>
        ` 
        : '';

    const observacoesInfo = conta.observacoes 
        ? `
        <div class="info-item info-item-full">
            <span class="info-label">Observações:</span>
            <span class="info-value">${conta.observacoes}</span>
        </div>
        ` 
        : '';

    const modal = `
        <div class="modal-overlay" id="viewModal">
            <div class="modal-content modal-view">
                <button class="modal-close-x" onclick="window.closeViewModal()" title="Fechar">✕</button>
                <div class="modal-header">
                    <h3 class="modal-title">Detalhes da Conta</h3>
                </div>
                <div class="info-grid">
                    ${documentoInfo}
                    <div class="info-item info-item-full">
                        <span class="info-label">Descrição:</span>
                        <span class="info-value">${conta.descricao}</span>
                    </div>
                    ${parcelaInfo}
                    <div class="info-item">
                        <span class="info-label">Valor:</span>
                        <span class="info-value info-highlight">R$ ${parseFloat(conta.valor).toFixed(2)}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Vencimento:</span>
                        <span class="info-value">${formatDate(conta.data_vencimento)}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Forma de Pagamento:</span>
                        <span class="info-value">${conta.forma_pagamento}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">Banco:</span>
                        <span class="info-value">${conta.banco}</span>
                    </div>
                    <div class="info-item">
                        <span class="info-label">${conta.data_pagamento ? 'Data do Pagamento:' : 'Status:'}</span>
                        <span class="info-value">${conta.data_pagamento ? formatDate(conta.data_pagamento) : 'Não pago'}</span>
                    </div>
                    ${observacoesInfo}
                </div>
                <div class="modal-actions">
                    <button class="secondary" onclick="window.closeViewModal()">Fechar</button>
                </div>
            </div>
        </div>
    `;
document.body.insertAdjacentHTML('beforeend', modal);
document.getElementById('viewModal').style.display = 'flex';

};

window.closeViewModal = function() {
    const modal = document.getElementById('viewModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
};

// ============================================
// FILTROS
// ============================================
function updateAllFilters() {
    const bancos = new Set();
    contas.forEach(c => {
        if (c.banco?.trim()) bancos.add(c.banco.trim());
    });
    
    const select = document.getElementById('filterBanco');
    if (select) {
        const val = select.value;
        select.innerHTML = '<option value="">Todos</option>';
        Array.from(bancos).sort().forEach(b => {
            const opt = document.createElement('option');
            opt.value = b;
            opt.textContent = b;
            select.appendChild(opt);
        });
        select.value = val;
    }
    
    const selectPag = document.getElementById('filterPagamento');
    if (selectPag) {
        const val = selectPag.value;
        const formas = new Set();
        contas.forEach(c => {
            if (c.forma_pagamento?.trim()) formas.add(c.forma_pagamento.trim());
        });
        selectPag.innerHTML = '<option value="">Todas Formas</option>';
        Array.from(formas).sort().forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            selectPag.appendChild(opt);
        });
        selectPag.value = val;
    }
    
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const contasDoMes = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    
    let temVencido = false, temPago = false, temPendente = false;
    
    contasDoMes.forEach(c => {
        if (c.status === 'PAGO') {
            temPago = true;
        } else {
            const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
            dataVenc.setHours(0, 0, 0, 0);
            
            if (dataVenc <= hoje) {
                temVencido = true;
            } else {
                temPendente = true;
            }
        }
    });

    const statusSelect = document.getElementById('filterStatus');
    if (statusSelect) {
        const val = statusSelect.value;
        statusSelect.innerHTML = '<option value="">Todos</option>';
        if (temPago) statusSelect.innerHTML += '<option value="PAGO">Pago</option>';
        if (temVencido) statusSelect.innerHTML += '<option value="VENCIDO">Vencido</option>';
        if (temPendente) statusSelect.innerHTML += '<option value="PENDENTE">Pendente</option>';
        statusSelect.value = val;
    }
}

function filterContas() {
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const banco = document.getElementById('filterBanco')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const pagamento = document.getElementById('filterPagamento')?.value || '';
    
    let filtered = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        const mesMatch = dataVenc.getMonth() === currentMonth.getMonth();
        const anoMatch = dataVenc.getFullYear() === currentMonth.getFullYear();
        return mesMatch && anoMatch;
    });

    if (banco) {
        filtered = filtered.filter(c => c.banco === banco);
    }
    
    if (pagamento) {
        filtered = filtered.filter(c => c.forma_pagamento === pagamento);
    }
    
    if (status) {
        const hoje = new Date();
        hoje.setHours(0, 0, 0, 0);
        
        filtered = filtered.filter(c => {
            if (status === 'PAGO') return c.status === 'PAGO';
            
            if (status === 'VENCIDO') {
                if (c.status === 'PAGO') return false;
                const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
                dataVenc.setHours(0, 0, 0, 0);
                return dataVenc <= hoje;
            }
            
            if (status === 'PENDENTE') {
                if (c.status === 'PAGO') return false;
                const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
                dataVenc.setHours(0, 0, 0, 0);
                return dataVenc > hoje;
            }
            
            return true;
        });
    }

    if (search) {
        filtered = filtered.filter(c => 
            (c.descricao || '').toLowerCase().includes(search) ||
            (c.banco || '').toLowerCase().includes(search) ||
            (c.forma_pagamento || '').toLowerCase().includes(search) ||
            (c.observacoes || '').toLowerCase().includes(search)
        );
    }

    filtered.sort((a, b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
    
    renderContas(filtered);
}

// ============================================
// RENDERIZAÇÃO - COM EVENT DELEGATION (CORREÇÃO CRÍTICA)
// ============================================
function renderContas(lista) {
    console.log('🎨 renderContas chamado com', lista?.length || 0, 'contas');
    
    const container = document.getElementById('contasContainer');
    
    if (!container) return;
    
    if (!lista || lista.length === 0) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary)">Nenhuma conta encontrada para este período</div>';
        return;
    }

    const table = `
        <table>
            <thead>
                <tr>
                    <th style="text-align: center; width: 60px;">
                        <span style="font-size: 1.1rem;">✓</span>
                    </th>
                    <th>Descrição</th>
                    <th>Valor</th>
                    <th>Vencimento</th>
                    <th style="text-align: center;">Nº Parcelas</th>
                    <th>Banco</th>
                    <th>Data Pagamento</th>
                    <th>Status</th>
                    <th style="text-align: center;">Ações</th>
                </tr>
            </thead>
            <tbody>
                ${lista.map(c => {
                    const numParcelas = c.parcela_numero && c.parcela_total 
                        ? `${c.parcela_numero}/${c.parcela_total}` 
                        : '-';
                    
                    const syncIndicator = !c.synced && c.tempId 
                        ? '<span style="color: orange; font-size: 0.8em;" title="Sincronizando...">⟳</span> '
                        : '';
                    
                    const isPago = c.status === 'PAGO';
                    const contaId = c.id || c.tempId;
                    
                    return `
                    <tr class="${isPago ? 'row-pago' : ''}">
                        <td style="text-align: center; padding: 8px;">
                           <button class="check-btn ${isPago ? 'checked' : ''}" 
                                   data-action="toggle" 
                                   data-id="${contaId}"
                                   title="${isPago ? 'Marcar como pendente' : 'Marcar como pago'}">
                           </button>
                        </td>
                        <td>${syncIndicator}${c.descricao}</td>
                        <td><strong>R$ ${parseFloat(c.valor).toFixed(2)}</strong></td>
                        <td style="white-space: nowrap;">${formatDate(c.data_vencimento)}</td>
                        <td style="text-align: center;">${numParcelas}</td>
                        <td>${c.banco || '-'}</td>
                        <td style="white-space: nowrap;">${c.data_pagamento ? formatDate(c.data_pagamento) : '-'}</td>
                        <td>${getStatusBadge(getStatusDinamico(c))}</td>
                        <td class="actions-cell" style="text-align: center;">
                            <button class="action-btn view" data-action="view" data-id="${contaId}">Ver</button>
                            <button class="action-btn edit" data-action="edit" data-id="${contaId}">Editar</button>
                            <button class="action-btn delete" data-action="delete" data-id="${contaId}">Excluir</button>
                        </td>
                    </tr>
                `}).join('')}
            </tbody>
        </table>
    `;
    
    container.innerHTML = table;
}

// ============================================
// UTILITÁRIOS
// ============================================
function formatDate(dateString) {
    if (!dateString) return '-';
    return new Date(dateString + 'T00:00:00').toLocaleDateString('pt-BR');
}

function getStatusDinamico(conta) {
    if (conta.status === 'PAGO') return 'PAGO';
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const dataVenc = new Date(conta.data_vencimento + 'T00:00:00');
    dataVenc.setHours(0, 0, 0, 0);
    if (dataVenc <= hoje) return 'VENCIDO';
    return 'PENDENTE';
}

function getStatusBadge(status) {
    const map = {
        'PAGO': { class: 'pago', text: 'Pago' },
        'VENCIDO': { class: 'vencido', text: 'Vencido' },
        'PENDENTE': { class: 'pendente', text: 'Pendente' }
    };
    const s = map[status] || { class: 'pendente', text: status };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

function showMessage(message, type) {
    const old = document.querySelectorAll('.floating-message');
    old.forEach(m => m.remove());
    
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}
