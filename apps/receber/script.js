// ============================================
// CONFIGURAÇÃO
// ============================================
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';
const NOTIFICATION_KEY = 'contasReceberNotificationShown';

let contas = [];
let isOnline = false;
let lastDataHash = '';
let sessionToken = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let showAllMonths = false; // Controle para exibir todos os meses do ano corrente
let currentTabIndex = 0; // Para navegação entre abas
const tabs = ['tab-basico', 'tab-valores', 'tab-observacoes']; // IDs das abas no formulário

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
// FORMATAÇÃO DE MOEDA
// ============================================
function formatCurrency(valor) {
    return 'R$ ' + valor.toLocaleString('pt-BR', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
    });
}

// ============================================
// NAVEGAÇÃO POR MESES (com opção "Todos os Meses")
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
    // Ao navegar pelos meses, desativa o modo "Todos os Meses"
    showAllMonths = false;
    currentMonth = currentMonth + direction;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    } else if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    updateMonthDisplay();
};

// Alterna o modo "Todos os Meses" (chamado pelo calendário)
window.toggleAllMonths = function() {
    // Esta função é chamada pelo calendar.js para ativar/desativar o modo
    // Mas como o calendar.js já gerencia, podemos apenas alternar
    showAllMonths = !showAllMonths;
    updateMonthDisplay();
};

// ============================================
// MODAL DE CONFIRMAÇÃO
// ============================================
function showConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const existingModal = document.getElementById('confirmModal');
        if (existingModal) existingModal.remove();

        const { title = 'Confirmação', confirmText = 'Confirmar', cancelText = 'Cancelar', type = 'warning' } = options;

        const overlay = document.createElement('div');
        overlay.id = 'confirmModal';
        overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;z-index:999999;';

        const box = document.createElement('div');
        box.style.cssText = 'background:#FFFFFF;border-radius:16px;padding:2rem;max-width:450px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);';

        box.innerHTML = `
            <h3 style="color:#1A1A1A;margin:0 0 1rem 0;font-size:1.25rem;">${title}</h3>
            <p style="color:#6B7280;margin:0 0 2rem 0;">${message}</p>
            <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
                <button id="btnCancel" style="background:#EF4444;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:600;min-width:100px;">${cancelText}</button>
                <button id="btnConfirm" style="background:#22C55E;color:#fff;border:none;padding:12px 24px;border-radius:8px;cursor:pointer;font-size:0.95rem;font-weight:600;min-width:100px;">${confirmText}</button>
            </div>
        `;

        overlay.appendChild(box);
        document.body.appendChild(overlay);

        const btnCancel = document.getElementById('btnCancel');
        const btnConfirm = document.getElementById('btnConfirm');

        btnCancel.onclick = () => { overlay.remove(); resolve(false); };
        btnConfirm.onclick = () => { overlay.remove(); resolve(true); };
        overlay.onclick = (e) => { if (e.target === overlay) { overlay.remove(); resolve(false); } };
    });
}

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

    // Listener para salvar com Enter
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') {
            const formModal = document.getElementById('formModal');
            if (formModal && formModal.style.display === 'flex') {
                const activeElement = document.activeElement;
                if (activeElement && activeElement.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    handleSubmit(e);
                }
            }
        }
    });
}

// ============================================
// CONEXÃO E STATUS
// ============================================
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            mode: 'cors'
        });

        if (response.status === 401) {
            sessionStorage.removeItem('contasReceberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;

        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE');
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
    let observacoesArray = [];
    
    // Converter observacoes para array se necessário
    if (conta.observacoes) {
        if (Array.isArray(conta.observacoes)) {
            observacoesArray = conta.observacoes;
        } else if (typeof conta.observacoes === 'string') {
            try {
                observacoesArray = JSON.parse(conta.observacoes);
            } catch {
                observacoesArray = [{ texto: conta.observacoes, data: new Date().toISOString() }];
            }
        } else if (typeof conta.observacoes === 'object') {
            observacoesArray = [conta.observacoes];
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
        observacoes: observacoesArray,
        created_at: conta.created_at || new Date().toISOString()
    };
}

// ============================================
// SINCRONIZAÇÃO DE DADOS
// ============================================
window.sincronizarDados = async function() {
    console.log('🔄 Sincronizando dados...');
    
    const syncButtons = document.querySelectorAll('button[onclick="sincronizarDados()"]');
    syncButtons.forEach(btn => {
        const svg = btn.querySelector('svg');
        if (svg) {
            svg.style.animation = 'spin 1s linear infinite';
        }
    });
    
    try {
        await loadContas();
        showMessage('Dados sincronizados', 'success');
    } catch (error) {
        showMessage('Erro ao sincronizar', 'error');
    }
    
    setTimeout(() => {
        syncButtons.forEach(btn => {
            const svg = btn.querySelector('svg');
            if (svg) {
                svg.style.animation = '';
            }
        });
    }, 1000);
};

function startPolling() {
    setInterval(() => {
        if (isOnline) loadContas();
    }, 30000);
}

// ============================================
// CÁLCULO AUTOMÁTICO DE STATUS (sem VENCIDO)
// ============================================
function calcularStatus(conta) {
    if (conta.tipo_nf && conta.tipo_nf !== 'ENVIO') {
        return 'ESPECIAL'; // Mantém para tipos especiais
    }

    if (conta.data_pagamento) {
        return 'PAGO';
    }

    // Não retorna mais VENCIDO; todas as não pagas são A RECEBER
    return 'A RECEBER';
}

// ============================================
// DASHBOARD (com valor_pago e quantidade vencida)
// ============================================
function updateDashboard() {
    // Para o dashboard, consideramos as contas do período selecionado (mês ou ano)
    const contasPeriodo = contas.filter(c => {
        if (showAllMonths) {
            // Se modo "Todos", filtra por ano
            const data = new Date(c.data_emissao + 'T00:00:00');
            return data.getFullYear() === currentYear;
        } else {
            // Senão, filtra por mês e ano
            const data = new Date(c.data_emissao + 'T00:00:00');
            return data.getMonth() === currentMonth && data.getFullYear() === currentYear;
        }
    });

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    // Total faturado (soma dos valores das NFs de envio)
    const totalFaturado = contasPeriodo
        .filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO')
        .reduce((sum, c) => sum + c.valor, 0);

    // Total pago (soma dos valores pagos, independente do status)
    const totalPago = contasPeriodo
        .filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO')
        .reduce((sum, c) => sum + (c.valor_pago || 0), 0);

    // QUANTIDADE de contas vencidas (considera todas as contas, independente do filtro)
    const todasContasEnvio = contas.filter(c => !c.tipo_nf || c.tipo_nf === 'ENVIO');

    const quantidadeVencidas = todasContasEnvio
        .filter(c => {
            if (c.status === 'PAGO') return false;
            const dataVencimento = new Date(c.data_vencimento + 'T00:00:00');
            return dataVencimento < hoje;
        }).length;

    const totalReceber = totalFaturado - totalPago;

    const statFaturado = document.getElementById('statFaturado');
    const statPago = document.getElementById('statPago');
    const statVencido = document.getElementById('statVencido');
    const statReceber = document.getElementById('statReceber');

    if (statFaturado) statFaturado.textContent = formatCurrency(totalFaturado);
    if (statPago) statPago.textContent = formatCurrency(totalPago);
    if (statVencido) statVencido.textContent = quantidadeVencidas;
    if (statReceber) statReceber.textContent = formatCurrency(totalReceber);

    const badgeVencido = document.getElementById('pulseBadgeVencido');
    const cardVencido = document.getElementById('cardVencido');

    if (badgeVencido && cardVencido) {
        if (quantidadeVencidas > 0) {
            badgeVencido.style.display = 'flex';
            cardVencido.classList.add('has-alert');
        } else {
            badgeVencido.style.display = 'none';
            cardVencido.classList.remove('has-alert');
        }
    }
}

function verificarContasVencidas() {
    const jaExibiu = sessionStorage.getItem(NOTIFICATION_KEY);
    if (jaExibiu) return;

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    const contasVencidas = contas.filter(c => {
        if (c.tipo_nf && c.tipo_nf !== 'ENVIO') return false;
        if (c.status === 'PAGO') return false;
        const vencimento = new Date(c.data_vencimento + 'T00:00:00');
        return vencimento < hoje;
    });

    if (contasVencidas.length > 0) {
        mostrarNotificacaoVencidos(contasVencidas);
        sessionStorage.setItem(NOTIFICATION_KEY, 'true');
    }
}

function mostrarNotificacaoVencidos(contas) {
    const totalVencido = contas.reduce((sum, c) => sum + c.valor, 0);

    const modalHTML = `
        <div class="modal-overlay" id="notificationModal" style="z-index: 999999;">
            <div class="modal-content" style="max-width: 500px; border: 3px solid #e70000;">
                <div class="modal-header" style="background: linear-gradient(135deg, #e70000 0%, #c00000 100%); color: white; padding: 1.5rem;">
                    <h3 class="modal-title" style="margin: 0; font-size: 1.5rem; display: flex; align-items: center; gap: 0.75rem;">
                        <span style="font-size: 2rem;">⚠️</span>
                        Atenção: Contas Vencidas
                    </h3>
                </div>
                
                <div style="padding: 2rem;">
                    <p style="color: #1A1A1A; font-size: 1.1rem; margin-bottom: 1rem;">
                        Você possui <strong style="color: #e70000;">${contas.length} ${contas.length === 1 ? 'conta vencida' : 'contas vencidas'}</strong>
                    </p>
                    
                    <div style="background: #FEE; border-left: 4px solid #e70000; padding: 1rem; margin-bottom: 1.5rem; border-radius: 4px;">
                        <p style="margin: 0; color: #6B7280;">
                            <strong>Total vencido:</strong>
                        </p>
                        <p style="margin: 0.5rem 0 0 0; font-size: 1.5rem; font-weight: bold; color: #e70000;">
                            ${formatCurrency(totalVencido)}
                        </p>
                    </div>
                    
                    <p style="color: #6B7280; font-size: 0.95rem; margin-bottom: 1.5rem;">
                        Esta notificação é exibida apenas no primeiro acesso.
                    </p>
                    
                    <button onclick="fecharNotificacaoVencidos()" 
                            style="width: 100%; background: #e70000; color: white; border: none; padding: 14px; border-radius: 8px; cursor: pointer; font-size: 1rem; font-weight: 600;">
                        Entendi
                    </button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

window.fecharNotificacaoVencidos = function() {
    const modal = document.getElementById('notificationModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
};

// ============================================
// MODAL DE CONTAS VENCIDAS COM PAGINAÇÃO
// ============================================
let vencidosPage = 1;
const VENCIDOS_PER_PAGE = 5;
let vencidosData = [];

function renderVencidosTable() {
    const start = (vencidosPage - 1) * VENCIDOS_PER_PAGE;
    const end = start + VENCIDOS_PER_PAGE;
    const pageContas = vencidosData.slice(start, end);
    const totalPages = Math.ceil(vencidosData.length / VENCIDOS_PER_PAGE);

    const tabelaHTML = `
        <div style="overflow-x: auto; margin-top: 1rem;">
            <table>
                <thead>
                    <tr>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Valor</th>
                        <th>Vencimento</th>
                    </tr>
                </thead>
                <tbody>
                    ${pageContas.map(c => `
                        <tr>
                            <td><strong>${c.numero_nf}</strong></td>
                            <td>${c.orgao}</td>
                            <td><strong>${formatCurrency(c.valor)}</strong></td>
                            <td>${formatDate(c.data_vencimento)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
        <div style="display: flex; justify-content: center; align-items: center; gap: 1rem; margin-top: 1.5rem;">
            <button onclick="changeVencidosPage(-1)" ${vencidosPage === 1 ? 'disabled' : ''} style="padding: 0.5rem 1rem;">Anterior</button>
            <span>Página ${vencidosPage} de ${totalPages}</span>
            <button onclick="changeVencidosPage(1)" ${vencidosPage === totalPages ? 'disabled' : ''} style="padding: 0.5rem 1rem;">Próximo</button>
        </div>
    `;

    const modalBody = document.getElementById('vencidosModalBody');
    if (modalBody) {
        modalBody.innerHTML = `
            <h3 style="color: #EF4444; margin: 0 0 1.5rem 0;">
                Contas Vencidas (${vencidosData.length})
            </h3>
            ${tabelaHTML}
        `;
    }
}

window.changeVencidosPage = function(delta) {
    const totalPages = Math.ceil(vencidosData.length / VENCIDOS_PER_PAGE);
    const newPage = vencidosPage + delta;
    if (newPage >= 1 && newPage <= totalPages) {
        vencidosPage = newPage;
        renderVencidosTable();
    }
};

window.showVencidosModal = function() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);

    vencidosData = contas.filter(c => {
        if (c.tipo_nf && c.tipo_nf !== 'ENVIO') return false;
        if (c.status === 'PAGO') return false;
        const vencimento = new Date(c.data_vencimento + 'T00:00:00');
        return vencimento < hoje;
    });

    if (vencidosData.length === 0) {
        showMessage('Não há contas vencidas no momento!', 'error');
        return;
    }

    vencidosPage = 1;
    renderVencidosTable();

    const modal = document.getElementById('vencidosModal');
    if (modal) {
        modal.style.display = 'flex';
    }
};

window.closeVencidosModal = function() {
    const modal = document.getElementById('vencidosModal');
    if (modal) {
        modal.style.display = 'none';
    }
};

// ============================================
// FORMULÁRIO (com observações)
// ============================================
window.toggleForm = function() {
    showFormModal(null);
};

function showFormModal(editingId = null) {
    const isEditing = editingId !== null;
    let conta = null;

    if (isEditing) {
        conta = contas.find(c => c.id === editingId);
        if (!conta) return;
    }

    // Reset do índice da aba
    currentTabIndex = 0;

    const observacoesHTML = (conta?.observacoes || []).map((obs, index) => `
        <div class="observacao-item">
            <div class="observacao-header">
                <span class="observacao-data">${formatDateTime(obs.data)}</span>
                <button type="button" class="btn-remove-obs" onclick="removerObservacao(${index})" title="Remover">✕</button>
            </div>
            <p class="observacao-texto">${obs.texto}</p>
        </div>
    `).join('');

    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Conta' : 'Nova Conta a Receber'}</h3>
                    <button class="close-modal" onclick="closeFormModal(false)">✕</button>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchFormTab(0)">Informações Básicas</button>
                        <button class="tab-btn" onclick="switchFormTab(1)">Valores e Datas</button>
                        <button class="tab-btn" onclick="switchFormTab(2)">Observações</button>
                    </div>

                    <form id="contaForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="${editingId || ''}">
                        <input type="hidden" id="observacoesData" value='${JSON.stringify(conta?.observacoes || [])}'>
                        
                        <div class="tab-content active" id="tab-basico">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="numero_nf">Número da NF *</label>
                                    <input type="text" id="numero_nf" value="${conta?.numero_nf || ''}" required>
                                </div>
                                <div class="form-group">
                                    <label for="orgao">Órgão *</label>
                                    <input type="text" id="orgao" value="${conta?.orgao || ''}" required>
                                </div>
                                <div class="form-group">
                                    <label for="vendedor">Vendedor *</label>
                                    <select id="vendedor" required>
                                        <option value="">Selecione...</option>
                                        <option value="ROBERTO" ${conta?.vendedor === 'ROBERTO' ? 'selected' : ''}>ROBERTO</option>
                                        <option value="ISAQUE" ${conta?.vendedor === 'ISAQUE' ? 'selected' : ''}>ISAQUE</option>
                                        <option value="MIGUEL" ${conta?.vendedor === 'MIGUEL' ? 'selected' : ''}>MIGUEL</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="banco">Banco *</label>
                                    <select id="banco" required>
                                        <option value="">Selecione...</option>
                                        <option value="BANCO DO BRASIL" ${conta?.banco === 'BANCO DO BRASIL' ? 'selected' : ''}>BANCO DO BRASIL</option>
                                        <option value="BRADESCO" ${conta?.banco === 'BRADESCO' ? 'selected' : ''}>BRADESCO</option>
                                        <option value="SICOOB" ${conta?.banco === 'SICOOB' ? 'selected' : ''}>SICOOB</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="tipo_nf">Tipo de NF *</label>
                                    <select id="tipo_nf" required>
                                        <option value="ENVIO" ${!conta?.tipo_nf || conta?.tipo_nf === 'ENVIO' ? 'selected' : ''}>Envio</option>
                                        <option value="CANCELADA" ${conta?.tipo_nf === 'CANCELADA' ? 'selected' : ''}>Cancelada</option>
                                        <option value="REMESSA_AMOSTRA" ${conta?.tipo_nf === 'REMESSA_AMOSTRA' ? 'selected' : ''}>Remessa de Amostra</option>
                                        <option value="SIMPLES_REMESSA" ${conta?.tipo_nf === 'SIMPLES_REMESSA' ? 'selected' : ''}>Simples Remessa</option>
                                        <option value="DEVOLUCAO" ${conta?.tipo_nf === 'DEVOLUCAO' ? 'selected' : ''}>Devolução</option>
                                        <option value="DEVOLVIDA" ${conta?.tipo_nf === 'DEVOLVIDA' ? 'selected' : ''}>Devolvida</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-valores">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="valor">Valor da NF (R$) *</label>
                                    <input type="number" id="valor" step="0.01" min="0" value="${conta?.valor || ''}" required>
                                </div>
                                <div class="form-group">
                                    <label for="valor_pago">Valor Pago (R$)</label>
                                    <input type="number" id="valor_pago" step="0.01" min="0" value="${conta?.valor_pago || '0'}">
                                </div>
                                <div class="form-group">
                                    <label for="data_emissao">Data de Emissão *</label>
                                    <input type="date" id="data_emissao" value="${conta?.data_emissao || new Date().toISOString().split('T')[0]}" required>
                                </div>
                                <div class="form-group">
                                    <label for="data_vencimento">Data de Vencimento *</label>
                                    <input type="date" id="data_vencimento" value="${conta?.data_vencimento || ''}" required>
                                </div>
                                <div class="form-group">
                                    <label for="data_pagamento">Data de Pagamento</label>
                                    <input type="date" id="data_pagamento" value="${conta?.data_pagamento || ''}">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-observacoes">
                            <div class="observacoes-section">
                                <div class="observacoes-list" id="observacoesList">
                                    ${observacoesHTML || '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Nenhuma observação adicionada</p>'}
                                </div>
                                <div class="nova-observacao">
                                    <textarea id="novaObservacao" placeholder="Digite uma observação..." rows="3"></textarea>
                                    <button type="button" class="btn-add-obs" onclick="adicionarObservacao()">
                                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <line x1="12" y1="5" x2="12" y2="19"></line>
                                            <line x1="5" y1="12" x2="19" y2="12"></line>
                                        </svg>
                                        Adicionar Observação
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button type="button" id="btnPrevious" onclick="previousTab()" class="secondary" style="display: none;">Anterior</button>
                            <button type="button" id="btnNext" onclick="nextTab()" class="secondary">Próximo</button>
                            <button type="button" onclick="closeFormModal(false)" class="btn-cancel">Cancelar</button>
                            <button type="submit" id="btnSave" style="display: none;">${isEditing ? 'Atualizar' : 'Salvar'}</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Forçar uppercase em campos específicos
    const camposMaiusculas = ['numero_nf', 'orgao'];
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

    // Atualizar visibilidade dos botões
    updateNavigationButtons();

    setTimeout(() => document.getElementById('numero_nf')?.focus(), 100);
}

// ============================================
// NAVEGAÇÃO ENTRE ABAS (Anterior/Próximo)
// ============================================
window.switchFormTab = function(index) {
    currentTabIndex = index;
    const tabButtons = document.querySelectorAll('#formModal .tab-btn');
    const tabContents = document.querySelectorAll('#formModal .tab-content');

    tabButtons.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });

    tabContents.forEach((content, i) => {
        content.classList.toggle('active', i === index);
    });

    updateNavigationButtons();
};

function nextTab() {
    if (currentTabIndex < tabs.length - 1) {
        currentTabIndex++;
        switchFormTab(currentTabIndex);
    }
}

function previousTab() {
    if (currentTabIndex > 0) {
        currentTabIndex--;
        switchFormTab(currentTabIndex);
    }
}

function updateNavigationButtons() {
    const btnPrevious = document.getElementById('btnPrevious');
    const btnNext = document.getElementById('btnNext');
    const btnSave = document.getElementById('btnSave');

    if (btnPrevious) btnPrevious.style.display = currentTabIndex === 0 ? 'none' : 'inline-block';
    if (btnNext) btnNext.style.display = currentTabIndex === tabs.length - 1 ? 'none' : 'inline-block';
    if (btnSave) btnSave.style.display = currentTabIndex === tabs.length - 1 ? 'inline-block' : 'none';
}

// ============================================
// FECHAR MODAL
// ============================================
function closeFormModal(saved = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        const editId = document.getElementById('editId')?.value;
        
        if (!saved) {
            if (editId) {
                showMessage('Atualização cancelada', 'error');
            } else {
                showMessage('Registro cancelado', 'error');
            }
        }
        
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

// ============================================
// OBSERVAÇÕES
// ============================================
window.adicionarObservacao = function() {
    const textarea = document.getElementById('novaObservacao');
    const texto = textarea.value.trim().toUpperCase();
    
    if (!texto) return;
    
    const observacoesData = JSON.parse(document.getElementById('observacoesData').value);
    observacoesData.push({
        texto: texto,
        data: new Date().toISOString()
    });
    
    document.getElementById('observacoesData').value = JSON.stringify(observacoesData);
    textarea.value = '';
    
    renderizarObservacoes();
};

window.removerObservacao = function(index) {
    const observacoesData = JSON.parse(document.getElementById('observacoesData').value);
    observacoesData.splice(index, 1);
    document.getElementById('observacoesData').value = JSON.stringify(observacoesData);
    renderizarObservacoes();
};

function renderizarObservacoes() {
    const observacoesData = JSON.parse(document.getElementById('observacoesData').value);
    const container = document.getElementById('observacoesList');
    
    if (observacoesData.length === 0) {
        container.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Nenhuma observação adicionada</p>';
        return;
    }
    
    container.innerHTML = observacoesData.map((obs, index) => `
        <div class="observacao-item">
            <div class="observacao-header">
                <span class="observacao-data">${formatDateTime(obs.data)}</span>
                <button type="button" class="btn-remove-obs" onclick="removerObservacao(${index})" title="Remover">✕</button>
            </div>
            <p class="observacao-texto">${obs.texto}</p>
        </div>
    `).join('');
}

// ============================================
// SUBMIT (salvar)
// ============================================
window.handleSubmit = async function(event) {
    if (event) event.preventDefault();

    const observacoesData = JSON.parse(document.getElementById('observacoesData').value);

    const formData = {
        numero_nf: document.getElementById('numero_nf').value.trim().toUpperCase(),
        orgao: document.getElementById('orgao').value.trim().toUpperCase(),
        vendedor: document.getElementById('vendedor').value.trim(),
        banco: document.getElementById('banco').value.trim(),
        valor: parseFloat(document.getElementById('valor').value),
        valor_pago: parseFloat(document.getElementById('valor_pago').value) || 0,
        data_emissao: document.getElementById('data_emissao').value,
        data_vencimento: document.getElementById('data_vencimento').value,
        data_pagamento: document.getElementById('data_pagamento').value || null,
        tipo_nf: document.getElementById('tipo_nf').value,
        observacoes: observacoesData
    };

    formData.status = calcularStatus(formData);

    const editId = document.getElementById('editId').value;

    if (!isOnline) {
        closeFormModal(false);
        return;
    }

    try {
        const url = editId ? `${API_URL}/contas/${editId}` : `${API_URL}/contas`;
        const method = editId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method,
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            },
            body: JSON.stringify(formData),
            mode: 'cors'
        });

        if (response.status === 401) {
            sessionStorage.removeItem('contasReceberSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            throw new Error('Erro ao salvar');
        }

        const savedData = await response.json();
        const mappedData = mapearConta(savedData);

        if (editId) {
            const index = contas.findIndex(c => c.id === editId);
            if (index !== -1) contas[index] = mappedData;
            showMessage(`Conta NF ${formData.numero_nf} atualizada`, 'success');
        } else {
            contas.push(mappedData);
            showMessage(`NF ${formData.numero_nf} registrada`, 'success');
        }

        lastDataHash = JSON.stringify(contas.map(c => c.id));
        updateAllFilters();
        updateDashboard();
        filterContas();
        closeFormModal(true);

    } catch (error) {
        console.error('Erro:', error);
        showMessage('Erro ao salvar conta', 'error');
    }
};

// ============================================
// EDIÇÃO
// ============================================
window.editConta = function(id) {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;
    showFormModal(id);
};

// ============================================
// EXCLUSÃO
// ============================================
window.deleteConta = async function(id) {
    const conta = contas.find(c => c.id === id);
    const numeroNf = conta?.numero_nf || '';
    
    const confirmed = await showConfirm(
        'Tem certeza que deseja excluir esta conta?',
        {
            title: 'Excluir Conta',
            confirmText: 'Excluir',
            cancelText: 'Cancelar',
            type: 'warning'
        }
    );

    if (!confirmed) return;

    const deletedConta = contas.find(c => c.id === id);
    contas = contas.filter(c => c.id !== id);
    updateAllFilters();
    updateDashboard();
    filterContas();
    showMessage(`NF ${numeroNf} excluída`, 'error');

    if (isOnline) {
        try {
            const response = await fetch(`${API_URL}/contas/${id}`, {
                method: 'DELETE',
                headers: {
                    'X-Session-Token': sessionToken,
                    'Accept': 'application/json'
                },
                mode: 'cors'
            });

            if (!response.ok) throw new Error('Erro ao deletar');
        } catch (error) {
            if (deletedConta) {
                contas.push(deletedConta);
                updateAllFilters();
                updateDashboard();
                filterContas();
            }
        }
    }
};

// ============================================
// VISUALIZAÇÃO (sem botão Ver, por clique na linha)
// ============================================
window.viewConta = function(id) {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;

    const tipoNfLabel = {
        'ENVIO': 'Envio',
        'CANCELADA': 'Cancelada',
        'REMESSA_AMOSTRA': 'Remessa de Amostra',
        'SIMPLES_REMESSA': 'Simples Remessa',
        'DEVOLUCAO': 'Devolução',
        'DEVOLVIDA': 'Devolvida'
    };

    const observacoesHTML = (conta.observacoes || []).map(obs => `
        <div class="observacao-item-view">
            <div class="observacao-header">
                <span class="observacao-data">${formatDateTime(obs.data)}</span>
            </div>
            <p class="observacao-texto">${obs.texto}</p>
        </div>
    `).join('');

    // Status formatado: se for especial, mostra o tipo; senão, mostra apenas A RECEBER ou PAGO
    let statusDisplay = conta.status;
    if (conta.tipo_nf && conta.tipo_nf !== 'ENVIO') {
        statusDisplay = conta.tipo_nf.replace(/_/g, ' ');
    }

    const modalHTML = `
        <div class="modal-overlay" id="viewModal" style="display: flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">Detalhes da Conta</h3>
                    <button class="close-modal" onclick="closeViewModal()">✕</button>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchViewTab(0)">Informações Básicas</button>
                        <button class="tab-btn" onclick="switchViewTab(1)">Valores e Datas</button>
                        <button class="tab-btn" onclick="switchViewTab(2)">Observações</button>
                    </div>

                    <div class="tab-content active" id="view-tab-basico">
                        <div class="info-section">
                            <h4>Dados da Conta</h4>
                            <p><strong>Número NF:</strong> ${conta.numero_nf}</p>
                            <p><strong>Órgão:</strong> ${conta.orgao}</p>
                            <p><strong>Vendedor:</strong> ${conta.vendedor}</p>
                            <p><strong>Banco:</strong> ${conta.banco}</p>
                            <p><strong>Tipo de NF:</strong> ${tipoNfLabel[conta.tipo_nf] || conta.tipo_nf}</p>
                            <p><strong>Status:</strong> <span class="badge status-${conta.status.toLowerCase().replace(' ', '-')}">${statusDisplay}</span></p>
                        </div>
                    </div>

                    <div class="tab-content" id="view-tab-valores">
                        <div class="info-section">
                            <h4>Valores e Datas</h4>
                            <p><strong>Valor da NF:</strong> ${formatCurrency(conta.valor)}</p>
                            <p><strong>Valor Pago:</strong> ${formatCurrency(conta.valor_pago || 0)}</p>
                            <p><strong>Data de Emissão:</strong> ${formatDate(conta.data_emissao)}</p>
                            <p><strong>Data de Vencimento:</strong> ${formatDate(conta.data_vencimento)}</p>
                            ${conta.data_pagamento ? `<p><strong>Data de Pagamento:</strong> ${formatDate(conta.data_pagamento)}</p>` : '<p><strong>Data de Pagamento:</strong> Não pago</p>'}
                        </div>
                    </div>

                    <div class="tab-content" id="view-tab-observacoes">
                        <div class="info-section">
                            <h4>Observações</h4>
                            <div class="observacoes-list-view">
                                ${observacoesHTML || '<p style="color: var(--text-secondary); text-align: center; padding: 2rem;">Nenhuma observação</p>'}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="modal-actions">
                    <button class="btn-close" onclick="closeViewModal()">Fechar</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
};

function closeViewModal() {
    const modal = document.getElementById('viewModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

window.switchViewTab = function(index) {
    document.querySelectorAll('#viewModal .tab-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });

    document.querySelectorAll('#viewModal .tab-content').forEach((content, i) => {
        content.classList.toggle('active', i === index);
    }); 
};

// ============================================
// FILTROS - ATUALIZAÇÃO DINÂMICA
// ============================================
function updateAllFilters() {
    updateVendedoresFilter();
    updateBancosFilter();
}

function updateVendedoresFilter() {
    const vendedores = new Set();
    contas.forEach(c => {
        if (c.vendedor?.trim()) {
            vendedores.add(c.vendedor.trim());
        }
    });

    const select = document.getElementById('filterVendedor');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Todos Vendedores</option>';
        Array.from(vendedores).sort().forEach(v => {
            const option = document.createElement('option');
            option.value = v;
            option.textContent = v;
            select.appendChild(option);
        });
        select.value = currentValue;
    }
}

function updateBancosFilter() {
    const bancos = new Set();
    contas.forEach(c => {
        if (c.banco?.trim()) {
            bancos.add(c.banco.trim());
        }
    });

    const select = document.getElementById('filterBanco');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Todos Bancos</option>';
        Array.from(bancos).sort().forEach(b => {
            const option = document.createElement('option');
            option.value = b;
            option.textContent = b;
            select.appendChild(option);
        });
        select.value = currentValue;
    }
}

// ============================================
// FILTROS E RENDERIZAÇÃO
// ============================================
function filterContas() {
    const searchTerm = document.getElementById('search')?.value.toLowerCase() || '';
    const filterVendedor = document.getElementById('filterVendedor')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    const filterBanco = document.getElementById('filterBanco')?.value || '';

    let filtered = [...contas];

    // Filtro por período (mês/ano ou ano inteiro)
    if (showAllMonths) {
        // Modo "Todos": filtrar por ano
        filtered = filtered.filter(c => {
            const data = new Date(c.data_emissao + 'T00:00:00');
            return data.getFullYear() === currentYear;
        });
    } else {
        // Modo normal: filtrar por mês e ano
        filtered = filtered.filter(c => {
            const data = new Date(c.data_emissao + 'T00:00:00');
            return data.getMonth() === currentMonth && data.getFullYear() === currentYear;
        });
    }

    if (filterVendedor) {
        filtered = filtered.filter(c => c.vendedor === filterVendedor);
    }

    if (filterStatus) {
        filtered = filtered.filter(c => c.status === filterStatus);
    }

    if (filterBanco) {
        filtered = filtered.filter(c => c.banco === filterBanco);
    }

    if (searchTerm) {
        filtered = filtered.filter(c => 
            c.numero_nf?.toLowerCase().includes(searchTerm) ||
            c.orgao?.toLowerCase().includes(searchTerm) ||
            c.vendedor?.toLowerCase().includes(searchTerm) ||
            c.banco?.toLowerCase().includes(searchTerm)
        );
    }

    // Ordenação
    if (showAllMonths) {
        // Todos os meses do ano: ordenar por data de emissão crescente
        filtered.sort((a, b) => {
            const dateA = new Date(a.data_emissao + 'T00:00:00');
            const dateB = new Date(b.data_emissao + 'T00:00:00');
            return dateA - dateB;
        });
    } else {
        // Mês específico: ordenar por número NF decrescente
        filtered.sort((a, b) => {
            const numA = parseInt(a.numero_nf.replace(/\D/g, '')) || 0;
            const numB = parseInt(b.numero_nf.replace(/\D/g, '')) || 0;
            return numB - numA;
        });
    }
    
    renderContas(filtered);
}

// ============================================
// RENDERIZAÇÃO DA TABELA (com coluna Valor NF e sem Vendedor)
// ============================================
function renderContas(contasToRender) {
    const container = document.getElementById('contasContainer');

    if (!container) return;

    if (!contasToRender || contasToRender.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhuma conta encontrada para este período</div>';
        return;
    }

    const table = `
        <div style="overflow-x: auto;">
            <table>
                <thead>
                    <tr>
                        <th style="text-align: center; width: 60px;"> </th>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Banco</th>
                        <th>Pagamento</th>
                        <th>Valor NF</th>
                        <th>Valor Pago</th>
                        <th>Status</th>
                        <th style="text-align: center; min-width: 260px;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${contasToRender.map(c => {
                        const statusClass = c.status.toLowerCase().replace(' ', '-');
                        const isEspecial = c.tipo_nf && c.tipo_nf !== 'ENVIO';
                        const isEnvio = !c.tipo_nf || c.tipo_nf === 'ENVIO';
                        const isPago = c.status === 'PAGO';
                        const rowClass = isPago ? 'row-pago' : '';
                        const tipoLabels = {
                            'CANCELADA': 'Cancelada',
                            'REMESSA_AMOSTRA': 'Remessa de Amostra',
                            'SIMPLES_REMESSA': 'Simples Remessa',
                            'DEVOLUCAO': 'Devolução',
                            'DEVOLVIDA': 'Devolvida'
                        };
                        const statusDisplay = isEspecial ? (tipoLabels[c.tipo_nf] || c.tipo_nf.replace(/_/g, ' ')) : c.status;
                        return `
                        <tr class="${rowClass}" data-id="${c.id}" style="cursor:pointer;">
                            <td style="text-align: center;">
                                ${isEnvio ? `
                                    <button class="check-btn ${isPago ? 'checked' : ''}" 
                                            onclick="togglePago('${c.id}')" 
                                            title="${isPago ? 'Marcar como não pago' : 'Marcar como pago'}">
                                            ✓
                                    </button>
                                ` : '-'}
                            </td>
                            <td><strong>${c.numero_nf}</strong></td>
                            <td>${c.orgao}</td>
                            <td>${c.banco}</td>
                            <td>${c.data_pagamento ? formatDate(c.data_pagamento) : '-'}</td>
                            <td><strong>${formatCurrency(c.valor)}</strong></td>
                            <td><strong>${formatCurrency(c.valor_pago || 0)}</strong></td>
                            <td>
                                <span class="badge status-${isEspecial ? 'especial' : statusClass}">
                                    ${statusDisplay}
                                </span>
                            </td>
                            <td class="actions-cell" style="text-align: center;">
                                <button onclick="editConta('${c.id}')" class="action-btn edit">Editar</button>
                                <button onclick="deleteConta('${c.id}')" class="action-btn delete">Excluir</button>
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>
    `;

    container.innerHTML = table;

    // Adiciona evento de clique nas linhas para abrir o modal de visualização
    document.querySelectorAll('#contasContainer tbody tr').forEach(tr => {
        tr.addEventListener('click', function(e) {
            // Se o clique foi em um botão, não abre o modal
            if (e.target.tagName === 'BUTTON' || e.target.closest('button')) {
                return;
            }
            const id = this.dataset.id;
            if (id) viewConta(id);
        });
    });
}

// ============================================
// TOGGLE STATUS PAGO (agora também atualiza valor_pago)
// ============================================
window.togglePago = async function(id) {
    const conta = contas.find(c => c.id === id);
    if (!conta) return;

    const novoStatus = conta.status === 'PAGO' ? 'A RECEBER' : 'PAGO';
    const dataPagamento = novoStatus === 'PAGO' ? new Date().toISOString().split('T')[0] : null;
    
    // Se for marcar como pago, sugere preencher o valor_pago com o valor total (se estiver vazio)
    let novoValorPago = conta.valor_pago;
    if (novoStatus === 'PAGO' && (conta.valor_pago === 0 || conta.valor_pago === null)) {
        novoValorPago = conta.valor;
    }

    const statusAnterior = conta.status;
    const dataPagamentoAnterior = conta.data_pagamento;
    const valorPagoAnterior = conta.valor_pago;

    conta.status = novoStatus;
    conta.data_pagamento = dataPagamento;
    conta.valor_pago = novoValorPago;

    updateDashboard();
    filterContas();

    if (novoStatus === 'PAGO') {
        showMessage('Pagamento confirmado. Ajuste o valor pago se necessário.', 'success');
    } else {
        showMessage('Confirmação de pagamento revogada', 'error');
    }

    if (isOnline) {
        try {
            const response = await fetch(`${API_URL}/contas/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': sessionToken,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(conta),
                mode: 'cors'
            });

            if (!response.ok) throw new Error('Erro ao atualizar');

            const savedData = await response.json();
            const index = contas.findIndex(c => c.id === id);
            if (index !== -1) contas[index] = mapearConta(savedData);
            
            updateDashboard();
            filterContas();
        } catch (error) {
            conta.status = statusAnterior;
            conta.data_pagamento = dataPagamentoAnterior;
            conta.valor_pago = valorPagoAnterior;
            updateDashboard();
            filterContas();
            showMessage('Erro ao atualizar status', 'error');
        }
    }
};

// ============================================
// UTILIDADES
// ============================================
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
}

function formatDateTime(isoString) {
    if (!isoString) return '-';
    const date = new Date(isoString);
    return date.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function showMessage(message, type) {
    const oldMessages = document.querySelectorAll('.floating-message');
    oldMessages.forEach(msg => msg.remove());

    const messageDiv = document.createElement('div');
    messageDiv.className = `floating-message ${type}`;
    messageDiv.textContent = message;

    document.body.appendChild(messageDiv);

    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}
