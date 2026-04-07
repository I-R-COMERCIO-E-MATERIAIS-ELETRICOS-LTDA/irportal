// ============================================
// CONFIGURAÇÃO
// ============================================
const API_URL = window.location.origin + '/api';

let fretes = [];
let isOnline = false;
let lastDataHash = '';
let sessionToken = null;
let currentMonth = new Date();
let graficoYear = new Date().getFullYear();
let graficoChart = null;

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

const mesesAbrev = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

console.log('✅ Controle de Frete iniciado');
console.log('📍 API URL:', API_URL);

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
    
    setTimeout(setupEventDelegation, 100);
});

// ============================================
// EVENT DELEGATION PARA BOTÕES
// ============================================
function setupEventDelegation() {
    console.log('🔧 Configurando Event Delegation...');
    
    // Listener para checkboxes via event delegation
    document.body.addEventListener('change', function(e) {
        if (e.target.type === 'checkbox' && e.target.classList.contains('styled-checkbox')) {
            const row = e.target.closest('tr[data-id]');
            if (row) {
                const id = row.getAttribute('data-id');
                console.log('☑️ Checkbox alterado via delegation - ID:', id);
                window.handleCheckboxChange(id);
            }
        }
    });
    
    console.log('✅ Event Delegation configurado');
}

// ============================================
// HANDLERS DE EVENTOS (EXPOSTOS GLOBALMENTE)
// ============================================
window.handleViewClick = function(id) {
    console.log('👁️ Visualizar frete:', id);
    
    const frete = fretes.find(f => String(f.id) === String(id));
    if (!frete) {
        showToast('Frete não encontrado!', 'error');
        return;
    }
    
    mostrarModalVisualizacao(frete);
};

window.handleEditClick = function(id) {
    console.log('✏️ Editar frete:', id);
    
    const frete = fretes.find(f => String(f.id) === String(id));
    if (!frete) {
        showToast('Frete não encontrado!', 'error');
        return;
    }
    
    showFormModal(String(id));
};

window.handleDeleteClick = async function(id) {
    try {
        console.log('🗑️ Tentando excluir frete:', id);
        
        const idStr = String(id);
        const freteToDelete = fretes.find(f => String(f.id) === idStr);
        
        if (!freteToDelete) {
            console.error('❌ Frete não encontrado:', id);
            showToast('Frete não encontrado!', 'error');
            return;
        }
        
        const numeroNF = freteToDelete.numero_nf || 'sem número';
        console.log('📋 Frete encontrado - NF:', numeroNF);
        
        // Verificar se showConfirm existe
        if (typeof window.showConfirm !== 'function') {
            console.error('❌ showConfirm não está definido!');
            const confirmar = confirm(`Tem certeza que deseja excluir esta NF?`);
            if (!confirmar) return;
        } else {
            console.log('✅ Abrindo modal de confirmação...');
            
            // Usar modal de confirmação personalizado
            const confirmar = await window.showConfirm(
                `Tem certeza que deseja excluir esta NF?`,
                {
                    title: 'Confirmar Exclusão',
                    confirmText: 'Sim',
                    cancelText: 'Cancelar',
                    type: 'danger'
                }
            );
            
            if (!confirmar) {
                console.log('❌ Exclusão cancelada pelo usuário');
                return;
            }
        }
        
        console.log('✅ Usuário confirmou exclusão');
        console.log('🗑️ Deletando NF:', numeroNF);
        
        // Remover da lista local primeiro
        fretes = fretes.filter(f => String(f.id) !== idStr);
        updateAllFilters();
        updateDashboard();
        filterFretes();
        showToast(`NF ${numeroNF} Excluído`, 'success');
        
        // Deletar no servidor
        if (isOnline) {
            fetch(`${API_URL}/fretes/${idStr}`, {
                method: 'DELETE',
                headers: {
                    'X-Session-Token': sessionToken,
                    'Accept': 'application/json'
                },
                mode: 'cors'
            })
            .then(response => {
                if (!response.ok) throw new Error('Erro ao deletar no servidor');
                console.log('✅ Deletado no servidor com sucesso');
            })
            .catch(error => {
                console.error('❌ Erro ao deletar no servidor:', error);
                // Restaurar o frete se falhar no servidor
                if (freteToDelete) {
                    fretes.push(freteToDelete);
                    updateAllFilters();
                    updateDashboard();
                    filterFretes();
                    showToast('Erro ao excluir no servidor', 'error');
                }
            });
        }
    } catch (error) {
        console.error('💥 Erro em handleDeleteClick:', error);
        showToast('Erro ao processar exclusão', 'error');
    }
};

window.handleCheckboxChange = async function(id) {
    console.log('☑️ Checkbox alterado:', id);
    
    const idStr = String(id);
    const frete = fretes.find(f => String(f.id) === idStr);
    
    if (!frete) return;
    
    const tiposPermitidos = ['ENVIO', 'SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
    const tipoNf = frete.tipo_nf || 'ENVIO';
    
    if (!tiposPermitidos.includes(tipoNf)) return;
    
    const novoStatus = frete.status === 'ENTREGUE' ? 'EM_TRANSITO' : 'ENTREGUE';
    
    // Preparar dados para atualização
    const updateData = { status: novoStatus };
    
    // Se está marcando como ENTREGUE e não tem data_entrega, define a data atual
    if (novoStatus === 'ENTREGUE' && !frete.data_entrega) {
        const hoje = new Date();
        updateData.data_entrega = hoje.toISOString().split('T')[0];
        console.log(`📅 Definindo data_entrega: ${updateData.data_entrega}`);
    }
    
    // Se está desmarcando (voltando para EM_TRANSITO), REMOVE a data_entrega
    if (novoStatus === 'EM_TRANSITO') {
        updateData.data_entrega = null;
        console.log('🗑️ Removendo data_entrega (desmarcado)');
    }
    
    if (isOnline) {
        try {
            const response = await fetch(`${API_URL}/fretes/${idStr}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Session-Token': sessionToken,
                    'Accept': 'application/json'
                },
                body: JSON.stringify(updateData),
                mode: 'cors'
            });
            
            if (!response.ok) throw new Error('Erro ao atualizar');
            
            const savedData = await response.json();
            const index = fretes.findIndex(f => String(f.id) === idStr);
            if (index !== -1) {
                fretes[index] = savedData;
                
                if (novoStatus === 'ENTREGUE') {
                    showToast(`NF ${savedData.numero_nf} Entregue`, 'success');
                } else {
                    showToast(`NF ${savedData.numero_nf} desmarcado - voltou ao monitoramento`, 'info');
                }
                
                updateDashboard();
                filterFretes();
            }
        } catch (error) {
            console.error('❌ Erro ao atualizar status:', error);
            showToast('Erro ao atualizar status', 'error');
        }
    }
};

// ============================================
// MODAL DE VISUALIZAÇÃO
// ============================================
function mostrarModalVisualizacao(frete) {
    let observacoesArray = [];
    if (frete.observacoes) {
        try {
            observacoesArray = typeof frete.observacoes === 'string' 
                ? JSON.parse(frete.observacoes) 
                : frete.observacoes;
        } catch (e) {
            console.error('Erro ao parsear observações:', e);
        }
    }

    const observacoesHTML = observacoesArray.length > 0 
        ? observacoesArray.map(obs => `
            <div class="observacao-item-view">
                <div class="observacao-header">
                    <div class="observacao-info">
                        <span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span>
                        ${obs.username ? `<span class="observacao-username">• ${obs.username}</span>` : ''}
                    </div>
                </div>
                <p class="observacao-texto">${obs.texto}</p>
            </div>
        `).join('')
        : '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 1rem;">Nenhuma observação registrada</p>';

    const displayValue = (val) => {
        if (!val || val === 'NÃO INFORMADO') return '-';
        return val;
    };

    const modalHTML = `
        <div class="modal-overlay" id="viewModal" style="display: flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">Detalhes do Frete</h3>
                    <button class="close-modal" onclick="closeViewModal()">✕</button>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchViewTab(0)">Dados da Nota</button>
                        <button class="tab-btn" onclick="switchViewTab(1)">Órgão</button>
                        <button class="tab-btn" onclick="switchViewTab(2)">Transporte</button>
                        <button class="tab-btn" onclick="switchViewTab(3)">Observações</button>
                    </div>

                    <div class="tab-content active" id="view-tab-nota">
                        <div class="info-section">
                            <h4>Dados da Nota Fiscal</h4>
                            <p><strong>Número NF:</strong> ${frete.numero_nf || '-'}</p>
                            <p><strong>Data Emissão:</strong> ${frete.data_emissao ? formatDate(frete.data_emissao) : '-'}</p>
                            <p><strong>Documento:</strong> ${displayValue(frete.documento)}</p>
                            <p><strong>Valor NF:</strong> R$ ${frete.valor_nf ? parseFloat(frete.valor_nf).toFixed(2) : '0,00'}</p>
                            <p><strong>Tipo NF:</strong> ${getTipoNfLabel(frete.tipo_nf)}</p>
                        </div>
                    </div>

                    <div class="tab-content" id="view-tab-orgao">
                        <div class="info-section">
                            <h4>Dados do Órgão</h4>
                            <p><strong>Nome do Órgão:</strong> ${frete.nome_orgao || '-'}</p>
                            <p><strong>Contato:</strong> ${displayValue(frete.contato_orgao)}</p>
                            <p><strong>Vendedor Responsável:</strong> ${displayValue(frete.vendedor)}</p>
                        </div>
                    </div>

                    <div class="tab-content" id="view-tab-transporte">
                        <div class="info-section">
                            <h4>Dados do Transporte</h4>
                            <p><strong>Transportadora:</strong> ${displayValue(frete.transportadora)}</p>
                            <p><strong>Valor do Frete:</strong> R$ ${frete.valor_frete ? parseFloat(frete.valor_frete).toFixed(2) : '0,00'}</p>
                            <p><strong>Data Coleta:</strong> ${frete.data_coleta ? formatDate(frete.data_coleta) : '-'}</p>
                            <p><strong>Destino:</strong> ${displayValue(frete.cidade_destino)}</p>
                            <p><strong>Previsão Entrega:</strong> ${frete.previsao_entrega ? formatDate(frete.previsao_entrega) : '-'}</p>
                            <p><strong>Data Entrega:</strong> ${frete.data_entrega ? formatDate(frete.data_entrega) : '-'}</p>
                            <p><strong>Status:</strong> ${getStatusBadgeForRender(frete)}</p>
                        </div>
                    </div>

                    <div class="tab-content" id="view-tab-observacoes">
                        <div class="info-section">
                            <h4>Observações</h4>
                            <div class="observacoes-list-view">
                                ${observacoesHTML}
                            </div>
                        </div>
                    </div>
                </div>

                <div class="modal-actions">
                    <button class="secondary" onclick="closeViewModal()">Fechar</button>
                </div>
            </div>
        </div>
    `;

    const existingModal = document.getElementById('viewModal');
    if (existingModal) existingModal.remove();
    
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

window.closeViewModal = function() {
    const modal = document.getElementById('viewModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
};

window.switchViewTab = function(index) {
    document.querySelectorAll('#viewModal .tab-btn').forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
    
    document.querySelectorAll('#viewModal .tab-content').forEach((content, i) => {
        content.classList.toggle('active', i === index);
    });
};

// ============================================
// AUTENTICAÇÃO
// ============================================
function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('controleFreteSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('controleFreteSession');
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
            
        </div>
    `;
}

function inicializarApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            inicializarApp();
        });
        return;
    }
    
    updateDisplay();
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

// ============================================
// CONEXÃO E STATUS
// ============================================
async function checkServerStatus() {
    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(`${API_URL}/fretes`, {
            method: 'GET',
            headers: headers,
            mode: 'cors'
        });

        if (response.status === 401) {
            sessionStorage.removeItem('controleFreteSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ Servidor ONLINE');
            await loadFretes();
        }
        
        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        console.error('❌ Erro ao verificar servidor:', error);
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
async function loadFretes(showMessage = false) {
    if (!isOnline) {
        if (showMessage) {
            showToast('Sistema offline. Não foi possível sincronizar.', 'error');
        }
        return;
    }

    try {
        const timestamp = new Date().getTime();
        const response = await fetch(`${API_URL}/fretes?_t=${timestamp}`, {
            method: 'GET',
            headers: { 
                'X-Session-Token': sessionToken,
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            },
            mode: 'cors'
        });

        if (response.status === 401) {
            sessionStorage.removeItem('controleFreteSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            if (showMessage) {
                showToast('Erro ao sincronizar dados', 'error');
            }
            return;
        }

        const data = await response.json();
        fretes = data;
        lastDataHash = JSON.stringify(fretes.map(f => f.id));
        
        console.log(`✅ ${fretes.length} fretes carregados`);
        
        updateAllFilters();
        updateDashboard();
        filterFretes();
        
        if (!sessionStorage.getItem('alertaAtrasosExibido')) {
            setTimeout(() => verificarNotasAtrasadas(), 1000);
            sessionStorage.setItem('alertaAtrasosExibido', 'true');
        }
    } catch (error) {
        console.error('❌ Erro ao carregar:', error);
        if (showMessage) {
            showToast('Erro ao sincronizar dados', 'error');
        }
    }
}

window.sincronizarDados = async function() {
    console.log('🔄 Sincronizando dados...');
    
    const syncButtons = document.querySelectorAll('button[onclick="sincronizarDados()"]');
    syncButtons.forEach(btn => {
        const svg = btn.querySelector('svg');
        if (svg) {
            svg.style.animation = 'spin 1s linear infinite';
        }
    });
    
    showToast('Dados sincronizados', 'success');
    await loadFretes(true);
    
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
    loadFretes();
    setInterval(() => {
        if (isOnline) loadFretes();
    }, 10000);
}

// ============================================
// NAVEGAÇÃO POR MESES
// ============================================
function updateDisplay() {
    const display = document.getElementById('currentMonth');
    if (display) {
        display.textContent = `${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    }
    updateDashboard();
    filterFretes();
}

window.changeMonth = function(direction) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);
    updateDisplay();
};

// ============================================
// DASHBOARD ATUALIZADO
// ============================================
function updateDashboard() {
    const statEntregues = document.getElementById('statEntregues');
    const statForaPrazo = document.getElementById('statForaPrazo');
    const statTransito = document.getElementById('statTransito');
    const statValorTotal = document.getElementById('statValorTotal');
    const statFrete = document.getElementById('statFrete');
    
    if (!statEntregues || !statForaPrazo || !statTransito || !statValorTotal || !statFrete) {
        console.warn('⚠️ Elementos do dashboard não encontrados');
        return;
    }
    
    const fretesMesAtual = fretes.filter(f => {
        const data = new Date(f.data_emissao + 'T00:00:00');
        return data.getMonth() === currentMonth.getMonth() && data.getFullYear() === currentMonth.getFullYear();
    });

    const tiposComStatus = ['ENVIO', 'SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
    const fretesComStatusMesAtual = fretesMesAtual.filter(f => {
        const tipo = f.tipo_nf || 'ENVIO';
        return tiposComStatus.includes(tipo);
    });
    
    const fretesComStatusTodos = fretes.filter(f => {
        const tipo = f.tipo_nf || 'ENVIO';
        return tiposComStatus.includes(tipo);
    });
    
    const fretesEnvio = fretesMesAtual.filter(f => !f.tipo_nf || f.tipo_nf === 'ENVIO');

    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const entregues = fretesComStatusMesAtual.filter(f => f.status === 'ENTREGUE').length;
    const transito = fretesComStatusMesAtual.filter(f => f.status === 'EM_TRANSITO').length;
    
    const foraPrazo = fretesComStatusTodos.filter(f => {
        if (f.status === 'ENTREGUE') return false;
        if (!f.previsao_entrega) return false;
        const previsao = new Date(f.previsao_entrega + 'T00:00:00');
        previsao.setHours(0, 0, 0, 0);
        return previsao < hoje;
    }).length;
    
    const valorTotal = fretesEnvio.reduce((sum, f) => sum + parseFloat(f.valor_nf || 0), 0);
    const freteTotal = fretesEnvio.reduce((sum, f) => sum + parseFloat(f.valor_frete || 0), 0);
    
    statEntregues.textContent = entregues;
    statForaPrazo.textContent = foraPrazo;
    statTransito.textContent = transito;
    statValorTotal.textContent = `R$ ${valorTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    statFrete.textContent = `R$ ${freteTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    
    const cardForaPrazo = document.getElementById('cardForaPrazo');
    if (!cardForaPrazo) return;
    
    let pulseBadge = cardForaPrazo.querySelector('.pulse-badge');
    if (pulseBadge) {
        pulseBadge.remove();
    }
    
    if (foraPrazo > 0) {
        cardForaPrazo.classList.add('has-alert');
        
        pulseBadge = document.createElement('div');
        pulseBadge.className = 'pulse-badge';
        pulseBadge.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
        `;
        cardForaPrazo.appendChild(pulseBadge);
    } else {
        cardForaPrazo.classList.remove('has-alert');
    }
}

// ============================================
// MODAL DASHBOARDS MENSAIS
// ============================================
let graficoPagina = 1;

window.showGraficoModal = function() {
    graficoYear = currentMonth.getFullYear();
    graficoPagina = 1;
    
    const graficoModal = document.getElementById('graficoModal');
    if (graficoModal) {
        graficoModal.style.display = 'flex';
        renderizarGrafico();
    }
};

window.closeGraficoModal = function() {
    const graficoModal = document.getElementById('graficoModal');
    if (graficoModal) {
        graficoModal.style.display = 'none';
    }
    
    if (graficoChart) {
        graficoChart.destroy();
        graficoChart = null;
    }
};

window.changeGraficoYear = function(direction) {
    graficoYear += direction;
    graficoPagina = 1;
    renderizarGrafico();
};

window.changeGraficoPagina = function(direction) {
    graficoPagina += direction;
    renderizarGrafico();
};

function renderizarGrafico() {
    document.getElementById('graficoYear').textContent = graficoYear;
    
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    
    // Calcular dados por mês
    const dadosPorMes = months.map((nome, index) => {
        const fretesDoMes = fretes.filter(f => {
            const dataEmissao = new Date(f.data_emissao + 'T00:00:00');
            const isTipoEnvio = !f.tipo_nf || f.tipo_nf === 'ENVIO';
            return dataEmissao.getMonth() === index && 
                   dataEmissao.getFullYear() === graficoYear &&
                   isTipoEnvio;
        });
        
        const valorFrete = fretesDoMes.reduce((sum, f) => sum + parseFloat(f.valor_frete || 0), 0);
        const valorTotal = fretesDoMes.reduce((sum, f) => sum + parseFloat(f.valor_nf || 0), 0);
        
        return { nome, valorFrete, valorTotal };
    });
    
    // Paginação - 3 meses por página
    const mesesPorPagina = 3;
    const totalPaginas = Math.ceil(dadosPorMes.length / mesesPorPagina);
    const inicio = (graficoPagina - 1) * mesesPorPagina;
    const fim = inicio + mesesPorPagina;
    const mesesPagina = dadosPorMes.slice(inicio, fim);
    
    // Calcular totais gerais do ano inteiro
    const totalFrete = dadosPorMes.reduce((sum, m) => sum + m.valorFrete, 0);
    const totalValor = dadosPorMes.reduce((sum, m) => sum + m.valorTotal, 0);
    
    const container = document.getElementById('dashboardsContainer');
    if (!container) return;
    
    container.innerHTML = `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
            ${mesesPagina.map((mes, indexPagina) => {
                const mesIndex = inicio + indexPagina;
                const mesAnterior = mesIndex > 0 ? dadosPorMes[mesIndex - 1] : null;
                
                // Calcular tendências
                let freteTendencia = '';
                let totalTendencia = '';
                
                if (mesAnterior) {
                    // Tendência Frete
                    if (mes.valorFrete > mesAnterior.valorFrete) {
                        freteTendencia = '<span style="color: #22C55E; font-size: 1.2rem; margin-left: 0.25rem;">▲</span>';
                    } else if (mes.valorFrete < mesAnterior.valorFrete) {
                        freteTendencia = '<span style="color: #EF4444; font-size: 1.2rem; margin-left: 0.25rem;">▼</span>';
                    }
                    
                    // Tendência Valor Total
                    if (mes.valorTotal > mesAnterior.valorTotal) {
                        totalTendencia = '<span style="color: #22C55E; font-size: 1.2rem; margin-left: 0.25rem;">▲</span>';
                    } else if (mes.valorTotal < mesAnterior.valorTotal) {
                        totalTendencia = '<span style="color: #EF4444; font-size: 1.2rem; margin-left: 0.25rem;">▼</span>';
                    }
                }
                
                return `
                <div style="padding: 0.75rem; background: var(--bg-card); border: 1px solid rgba(107, 114, 128, 0.2); border-radius: 8px;">
                    <h4 style="margin: 0 0 0.5rem 0; font-size: 0.9rem; color: var(--text-primary);">${mes.nome}</h4>
                    <div style="margin-bottom: 0.4rem;">
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">Valor Total</div>
                        <div style="font-size: 0.95rem; font-weight: 700; color: #22C55E; display: flex; align-items: center;">
                            R$ ${mes.valorTotal.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}${totalTendencia}
                        </div>
                    </div>
                    <div>
                        <div style="font-size: 0.8rem; color: var(--text-secondary);">Frete</div>
                        <div style="font-size: 0.95rem; font-weight: 700; color: #3B82F6; display: flex; align-items: center;">
                            R$ ${mes.valorFrete.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}${freteTendencia}
                        </div>
                    </div>
                </div>
            `;
            }).join('')}
        </div>
        
        <div style="display: flex; justify-content: center; align-items: center; gap: 1rem; margin-bottom: 1rem; padding: 0.5rem;">
            <button onclick="changeGraficoPagina(-1)" ${graficoPagina === 1 ? 'disabled' : ''} 
                    style="padding: 6px 14px; border: 1px solid rgba(107, 114, 128, 0.2); background: var(--bg-card); cursor: pointer; border-radius: 4px; font-weight: 600; color: var(--text-primary);">‹</button>
            <span style="font-weight: 600;">${graficoPagina}</span>
            <button onclick="changeGraficoPagina(1)" ${graficoPagina === totalPaginas ? 'disabled' : ''}
                    style="padding: 6px 14px; border: 1px solid rgba(107, 114, 128, 0.2); background: var(--bg-card); cursor: pointer; border-radius: 4px; font-weight: 600; color: var(--text-primary);">›</button>
        </div>
        
        <div style="display: flex; gap: 1rem; justify-content: center; max-width: 800px; margin: 0 auto;">
            <div style="flex: 0 1 auto; min-width: 250px; text-align: center; padding: 0.75rem; background: rgba(34, 197, 94, 0.1); border: 1px solid rgba(34, 197, 94, 0.3); border-radius: 8px;">
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.4rem;">Total Valor</div>
                <div style="font-size: 1.4rem; font-weight: 700; color: #22C55E;">R$ ${totalValor.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </div>
            <div style="flex: 0 1 auto; min-width: 250px; text-align: center; padding: 0.75rem; background: rgba(59, 130, 246, 0.1); border-radius: 8px; border: 1px solid rgba(59, 130, 246, 0.3);">
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.4rem;">Total Frete</div>
                <div style="font-size: 1.4rem; font-weight: 700; color: #3B82F6;">R$ ${totalFrete.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</div>
            </div>
        </div>
    `;
}

function renderizarDashboards(dadosMensais) {
    // Função removida - agora integrada em renderizarGrafico
}

// ============================================
// MODAL DE CONFIRMAÇÃO
// ============================================
function showConfirm(message, options = {}) {
    return new Promise((resolve) => {
        const { title = 'Confirmação', confirmText = 'Confirmar', cancelText = 'Cancelar', type = 'warning' } = options;

        const modalHTML = `
            <div class="modal-overlay" id="confirmModal" style="display: flex !important; z-index: 10001 !important;">
                <div class="modal-content confirm-modal-content" style="max-width: 450px !important;">
                    <button class="close-modal" id="confirmModalClose">✕</button>
                    <div class="confirm-modal-body">
                        <h3 class="confirm-modal-title">${message}</h3>
                    </div>
                    <div class="modal-actions confirm-modal-actions">
                        <button class="${type === 'danger' ? 'danger' : 'success'}" id="modalConfirmBtn">${confirmText}</button>
                        <button class="secondary" id="modalCancelBtn">${cancelText}</button>
                    </div>
                </div>
            </div>
        `;

        document.body.insertAdjacentHTML('beforeend', modalHTML);
        const modal = document.getElementById('confirmModal');
        const confirmBtn = document.getElementById('modalConfirmBtn');
        const cancelBtn = document.getElementById('modalCancelBtn');
        const closeBtn = document.getElementById('confirmModalClose');

        // Forçar display do modal
        if (modal) {
            modal.style.display = 'flex';
            modal.style.opacity = '1';
        }

        const closeModal = (result) => {
            if (modal) {
                modal.style.animation = 'fadeOut 0.2s ease forwards';
                setTimeout(() => { 
                    modal.remove(); 
                    resolve(result); 
                }, 200);
            } else {
                resolve(result);
            }
        };

        if (confirmBtn) confirmBtn.addEventListener('click', () => closeModal(true));
        if (cancelBtn) cancelBtn.addEventListener('click', () => closeModal(false));
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal(false));
        
        // Fechar ao clicar fora do modal
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal(false);
                }
            });
        }

        if (!document.querySelector('#modalAnimations')) {
            const style = document.createElement('style');
            style.id = 'modalAnimations';
            style.textContent = `@keyframes fadeOut { to { opacity: 0; } }`;
            document.head.appendChild(style);
        }
    });
}

// Exportar para window
window.showConfirm = showConfirm;

// ============================================
// FORMULÁRIO COM OBSERVAÇÕES
// ============================================
window.toggleForm = function() {
    console.log('🆕 Abrindo formulário para novo frete');
    showFormModal(null);
};

window.showFormModal = function(editingId = null) {
    console.log('📝 showFormModal chamada com ID:', editingId);
    
    const isEditing = editingId !== null;
    let frete = null;
    
    if (isEditing) {
        const idStr = String(editingId);
        frete = fretes.find(f => String(f.id) === idStr);
        
        if (!frete) {
            showToast('Frete não encontrado!', 'error');
            return;
        }
        console.log('✏️ Editando frete:', frete);
    } else {
        console.log('🆕 Criando novo frete');
    }

    let observacoesArray = [];
    if (frete && frete.observacoes) {
        try {
            observacoesArray = typeof frete.observacoes === 'string' 
                ? JSON.parse(frete.observacoes) 
                : frete.observacoes;
        } catch (e) {
            console.error('Erro ao parsear observações:', e);
        }
    }

    const observacoesHTML = observacoesArray.length > 0 
        ? observacoesArray.map((obs, idx) => `
            <div class="observacao-item" data-index="${idx}">
                <div class="observacao-header">
                    <div class="observacao-info">
                        <span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span>
                        ${obs.username ? `<span class="observacao-username">• ${obs.username}</span>` : ''}
                    </div>
                    <button type="button" class="btn-remove-obs" onclick="removerObservacao(${idx})" title="Remover">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <p class="observacao-texto">${obs.texto}</p>
            </div>
        `).join('')
        : '<p style="color: var(--text-secondary); font-style: italic; text-align: center; padding: 2rem;">Nenhuma observação registrada</p>';

    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content">
                <div class="modal-header">
                    <h3 class="modal-title">${isEditing ? 'Editar Frete' : 'Novo Frete'}</h3>
                    <button class="close-modal" onclick="closeFormModal(true)">✕</button>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchFormTab(0)">Dados da Nota</button>
                        <button class="tab-btn" onclick="switchFormTab(1)">Órgão</button>
                        <button class="tab-btn" onclick="switchFormTab(2)">Transporte</button>
                        <button class="tab-btn" onclick="switchFormTab(3)">Observações</button>
                    </div>

                    <form id="freteForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="${editingId || ''}">
                        <input type="hidden" id="observacoesData" value='${JSON.stringify(observacoesArray)}'>
                        
                        <div class="tab-content active" id="tab-nota">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="numero_nf">Número da NF *</label>
                                    <input type="text" id="numero_nf" value="${frete?.numero_nf || ''}" required>
                                </div>
                                <div class="form-group">
                                    <label for="data_emissao">Data de Emissão</label>
                                    <input type="date" id="data_emissao" value="${frete?.data_emissao || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="documento">Documento</label>
                                    <input type="text" id="documento" value="${frete?.documento || ''}" placeholder="2025NE0000">
                                </div>
                                <div class="form-group">
                                    <label for="valor_nf">Valor da Nota (R$)</label>
                                    <input type="number" id="valor_nf" step="0.01" min="0" value="${frete?.valor_nf || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="tipo_nf">Tipo de NF</label>
                                    <select id="tipo_nf" onchange="handleTipoNfChange()">
                                        <option value="ENVIO" ${!frete?.tipo_nf || frete?.tipo_nf === 'ENVIO' ? 'selected' : ''}>Envio</option>
                                        <option value="CANCELADA" ${frete?.tipo_nf === 'CANCELADA' ? 'selected' : ''}>Cancelada</option>
                                        <option value="REMESSA_AMOSTRA" ${frete?.tipo_nf === 'REMESSA_AMOSTRA' ? 'selected' : ''}>Remessa de Amostra</option>
                                        <option value="SIMPLES_REMESSA" ${frete?.tipo_nf === 'SIMPLES_REMESSA' ? 'selected' : ''}>Simples Remessa</option>
                                        <option value="DEVOLUCAO" ${frete?.tipo_nf === 'DEVOLUCAO' ? 'selected' : ''}>Devolução</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-orgao">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="nome_orgao">Nome do Órgão *</label>
                                    <input type="text" id="nome_orgao" value="${frete?.nome_orgao || ''}" required>
                                </div>
                                <div class="form-group">
                                    <label for="contato_orgao">Contato do Órgão</label>
                                    <input type="text" id="contato_orgao" value="${frete?.contato_orgao || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="vendedor">Vendedor Responsável</label>
                                    <select id="vendedor">
                                        <option value="">Selecione...</option>
                                        <option value="ROBERTO" ${frete?.vendedor === 'ROBERTO' ? 'selected' : ''}>ROBERTO</option>
                                        <option value="ISAQUE" ${frete?.vendedor === 'ISAQUE' ? 'selected' : ''}>ISAQUE</option>
                                        <option value="MIGUEL" ${frete?.vendedor === 'MIGUEL' ? 'selected' : ''}>MIGUEL</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-transporte">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="transportadora">Transportadora</label>
                                    <select id="transportadora">
                                        <option value="">Selecione...</option>
                                        <option value="TNT MERCÚRIO" ${frete?.transportadora === 'TNT MERCÚRIO' ? 'selected' : ''}>TNT MERCÚRIO</option>
                                        <option value="BRASPRESS" ${frete?.transportadora === 'BRASPRESS' ? 'selected' : ''}>BRASPRESS</option>
                                        <option value="CORREIOS" ${frete?.transportadora === 'CORREIOS' ? 'selected' : ''}>CORREIOS</option>
                                        <option value="JAMEF" ${frete?.transportadora === 'JAMEF' ? 'selected' : ''}>JAMEF</option>
                                        <option value="GENEROSO" ${frete?.transportadora === 'GENEROSO' ? 'selected' : ''}>GENEROSO</option>
                                        <option value="MOVVI" ${frete?.transportadora === 'MOVVI' ? 'selected' : ''}>MOVVI</option>
                                        <option value="TG TRANSPORTES" ${frete?.transportadora === 'TG TRANSPORTES' ? 'selected' : ''}>TG TRANSPORTES</option>
                                        <option value="BROSLOG" ${frete?.transportadora === 'BROSLOG' ? 'selected' : ''}>BROSLOG</option>
                                        <option value="FAVORITA TRANSPORTES" ${frete?.transportadora === 'FAVORITA TRANSPORTES' ? 'selected' : ''}>FAVORITA TRANSPORTES</option>
                                        <option value="SNT LOG LTDA" ${frete?.transportadora === 'SNT LOG LTDA' ? 'selected' : ''}>SNT LOG LTDA</option>
                                        <option value="TRANSLOVATO" ${frete?.transportadora === 'TRANSLOVATO' ? 'selected' : ''}>TRANSLOVATO</option>
                                        <option value="TODO BRASIL" ${frete?.transportadora === 'TODO BRASIL' ? 'selected' : ''}>TODO BRASIL</option>
                                        <option value="AZURE" ${frete?.transportadora === 'AZURE' ? 'selected' : ''}>AZURE</option>
                                        <option value="RODONAVES" ${frete?.transportadora === 'RODONAVES' ? 'selected' : ''}>RODONAVES</option>
                                        <option value="TOTAL EXPRESS" ${frete?.transportadora === 'TOTAL EXPRESS' ? 'selected' : ''}>TOTAL EXPRESS</option>
                                        <option value="ENTREGA PRÓPRIA" ${frete?.transportadora === 'ENTREGA PRÓPRIA' ? 'selected' : ''}>ENTREGA PRÓPRIA</option>
                                        <option value="DIRETO PELO FORNECEDOR" ${frete?.transportadora === 'DIRETO PELO FORNECEDOR' ? 'selected' : ''}>DIRETO PELO FORNECEDOR</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label for="valor_frete">Valor do Frete (R$)</label>
                                    <input type="number" id="valor_frete" step="0.01" min="0" value="${frete?.valor_frete || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="data_coleta">Data da Coleta *</label>
                                    <input type="date" id="data_coleta" value="${frete?.data_coleta || ''}" required>
                                </div>
                                <div class="form-group">
                                    <label for="cidade_destino">Cidade-UF (Destino)</label>
                                    <input type="text" id="cidade_destino" value="${frete?.cidade_destino || ''}" placeholder="Ex: São Paulo-SP">
                                </div>
                                <div class="form-group">
                                    <label for="previsao_entrega">Previsão de Entrega</label>
                                    <input type="date" id="previsao_entrega" value="${frete?.previsao_entrega || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="data_entrega">Data de Entrega</label>
                                    <input type="date" id="data_entrega" value="${frete?.data_entrega || ''}">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-observacoes">
                            <div class="observacoes-section">
                                <div class="observacoes-list" id="observacoesList">
                                    ${observacoesHTML}
                                </div>
                                
                                <div class="nova-observacao">
                                    <label for="novaObservacao">Nova Observação</label>
                                    <textarea id="novaObservacao" placeholder="Digite sua observação aqui..." rows="3"></textarea>
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
                            <button type="submit" class="save">${editingId ? 'Atualizar' : 'Salvar'}</button>
                            <button type="button" class="secondary" onclick="closeFormModal(true)">Cancelar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    const existingModal = document.getElementById('formModal');
    if (existingModal) {
        existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    const camposMaiusculas = ['numero_nf', 'documento', 'nome_orgao', 'contato_orgao', 'cidade_destino'];

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
    
    setTimeout(() => document.getElementById('numero_nf')?.focus(), 100);
    
    console.log('✅ Modal de formulário criado e exibido');
};

// ============================================
// FUNÇÕES DE OBSERVAÇÕES
// ============================================
window.adicionarObservacao = function() {
    const textarea = document.getElementById('novaObservacao');
    const texto = textarea.value.trim();
    
    if (!texto) {
        showToast('Digite uma observação primeiro', 'error');
        return;
    }
    
    const observacoesDataField = document.getElementById('observacoesData');
    let observacoes = JSON.parse(observacoesDataField.value || '[]');
    
    // Adicionar username à observação
    const username = sessionStorage.getItem('username') || 'Usuário';
    
    observacoes.push({
        texto: texto,
        timestamp: new Date().toISOString(),
        username: username
    });
    
    observacoesDataField.value = JSON.stringify(observacoes);
    textarea.value = '';
    
    atualizarListaObservacoes();
};

window.removerObservacao = function(index) {
    const observacoesDataField = document.getElementById('observacoesData');
    let observacoes = JSON.parse(observacoesDataField.value || '[]');
    
    observacoes.splice(index, 1);
    observacoesDataField.value = JSON.stringify(observacoes);
    
    atualizarListaObservacoes();
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
                    <div class="observacao-info">
                        <span class="observacao-data">${new Date(obs.timestamp).toLocaleString('pt-BR')}</span>
                        ${obs.username ? `<span class="observacao-username">• ${obs.username}</span>` : ''}
                    </div>
                    <button type="button" class="btn-remove-obs" onclick="removerObservacao(${idx})" title="Remover">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                <p class="observacao-texto">${obs.texto}</p>
            </div>
        `).join('');
    }
}

window.handleTipoNfChange = function() {
    // Placeholder para futura expansão
};

window.closeFormModal = function(showCancelMessage = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        const editId = document.getElementById('editId')?.value;
        const isEditing = editId && editId !== '';
        
        if (showCancelMessage) {
            showToast(isEditing ? 'Atualização Cancelada' : 'Registro Cancelado', 'error');
        }
        
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
};

// ============================================
// SISTEMA DE ABAS
// ============================================
window.switchFormTab = function(index) {
    const tabButtons = document.querySelectorAll('#formModal .tab-btn');
    const tabContents = document.querySelectorAll('#formModal .tab-content');
    
    tabButtons.forEach((btn, i) => {
        btn.classList.toggle('active', i === index);
    });
    
    tabContents.forEach((content, i) => {
        content.classList.toggle('active', i === index);
    });
};

// ============================================
// SUBMIT
// ============================================
window.handleSubmit = async function(event) {
    if (event) event.preventDefault();

    const observacoesField = document.getElementById('observacoesData');
    const observacoesValue = observacoesField ? observacoesField.value : '[]';

    const formData = {
        numero_nf: document.getElementById('numero_nf').value.trim(),
        data_emissao: document.getElementById('data_emissao').value || new Date().toISOString().split('T')[0],
        documento: document.getElementById('documento').value.trim() || 'NÃO INFORMADO',
        valor_nf: document.getElementById('valor_nf').value ? parseFloat(document.getElementById('valor_nf').value) : 0,
        tipo_nf: document.getElementById('tipo_nf').value || 'ENVIO',
        nome_orgao: document.getElementById('nome_orgao').value.trim(),
        contato_orgao: document.getElementById('contato_orgao').value.trim() || 'NÃO INFORMADO',
        vendedor: document.getElementById('vendedor').value.trim() || 'NÃO INFORMADO',
        transportadora: document.getElementById('transportadora').value.trim() || 'NÃO INFORMADO',
        valor_frete: document.getElementById('valor_frete').value ? parseFloat(document.getElementById('valor_frete').value) : 0,
        data_coleta: document.getElementById('data_coleta').value,
        cidade_destino: document.getElementById('cidade_destino').value.trim() || 'NÃO INFORMADO',
        previsao_entrega: document.getElementById('previsao_entrega').value || null,
        data_entrega: document.getElementById('data_entrega').value || null,
        observacoes: observacoesValue
    };

    // O backend vai calcular o status automaticamente baseado em:
    // 1. tipo_nf (se for tipo especial, status = null)
    // 2. data_entrega (se existir, status = ENTREGUE)
    // 3. padrão (se não tiver data_entrega, status = EM_TRANSITO)
    // Não enviamos status no formData para deixar o backend decidir

    const editId = document.getElementById('editId').value;

    if (editId) {
        const freteExistente = fretes.find(f => String(f.id) === String(editId));
        if (freteExistente) {
            formData.timestamp = freteExistente.timestamp;
        }
    }

    if (!isOnline) {
        showToast('Sistema offline. Dados não foram salvos.', 'error');
        closeFormModal();
        return;
    }

    try {
        const url = editId ? `${API_URL}/fretes/${editId}` : `${API_URL}/fretes`;
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
            sessionStorage.removeItem('controleFreteSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.details || 'Erro ao salvar');
        }

        const savedData = await response.json();

        if (editId) {
            await loadFretes(false);
            showToast(`NF ${formData.numero_nf || savedData.numero_nf} Atualizado`, 'success');
        } else {
            fretes.push(savedData);
            showToast(`NF ${formData.numero_nf || savedData.numero_nf} Registrado`, 'success');
            
            lastDataHash = JSON.stringify(fretes.map(f => f.id));
            updateAllFilters();
            updateDashboard();
            filterFretes();
        }
        
        closeFormModal();

    } catch (error) {
        console.error('❌ Erro:', error);
        showToast(`Erro: ${error.message}`, 'error');
        closeFormModal();
    }
};

// ============================================
// FILTROS - ATUALIZAÇÃO DINÂMICA
// ============================================
function updateAllFilters() {
    updateStatusFilter();
    updateTransportadoraFilter();
    updateVendedorFilter();
}

function updateTransportadoraFilter() {
    const transportadoras = new Set();
    fretes.forEach(f => {
        if (f.transportadora?.trim()) {
            transportadoras.add(f.transportadora.trim());
        }
    });

    const select = document.getElementById('filterTransportadora');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Todas Transportadoras</option>';
        Array.from(transportadoras).sort().forEach(t => {
            const option = document.createElement('option');
            option.value = t;
            option.textContent = t;
            select.appendChild(option);
        });
        select.value = currentValue;
    }
}

function updateVendedorFilter() {
    const vendedores = new Set();
    fretes.forEach(f => {
        if (f.vendedor?.trim()) {
            vendedores.add(f.vendedor.trim());
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

function updateStatusFilter() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const statusSet = new Set();
    let temForaDoPrazo = false;
    
    fretes.forEach(f => {
        if (f.status?.trim()) {
            statusSet.add(f.status.trim());
        }
        
        const isTipoEnvio = !f.tipo_nf || f.tipo_nf === 'ENVIO';
        if (isTipoEnvio && f.status !== 'ENTREGUE' && f.previsao_entrega) {
            const previsao = new Date(f.previsao_entrega + 'T00:00:00');
            previsao.setHours(0, 0, 0, 0);
            if (previsao < hoje) {
                temForaDoPrazo = true;
            }
        }
    });

    const select = document.getElementById('filterStatus');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Todos os Status</option>';
        
        if (temForaDoPrazo) {
            const optionForaPrazo = document.createElement('option');
            optionForaPrazo.value = 'FORA_DO_PRAZO';
            optionForaPrazo.textContent = 'Fora do Prazo';
            select.appendChild(optionForaPrazo);
        }
        
        const statusMap = {
            'EM_TRANSITO': 'Em Trânsito',
            'ENTREGUE': 'Entregue'
        };
        
        Array.from(statusSet).sort().forEach(s => {
            const option = document.createElement('option');
            option.value = s;
            option.textContent = statusMap[s] || s;
            select.appendChild(option);
        });
        select.value = currentValue;
    }
}

// ============================================
// FILTROS E RENDERIZAÇÃO
// ============================================
function filterFretes() {
    const searchTerm = document.getElementById('search')?.value.toLowerCase() || '';
    const filterTransportadora = document.getElementById('filterTransportadora')?.value || '';
    const filterStatus = document.getElementById('filterStatus')?.value || '';
    const filterVendedor = document.getElementById('filterVendedor')?.value || '';
    
    let filtered = [...fretes];

    filtered = filtered.filter(f => {
        const dataEmissao = new Date(f.data_emissao + 'T00:00:00');
        return dataEmissao.getMonth() === currentMonth.getMonth() && dataEmissao.getFullYear() === currentMonth.getFullYear();
    });

    if (filterTransportadora) {
        filtered = filtered.filter(f => f.transportadora === filterTransportadora);
    }

    if (filterVendedor) {
        filtered = filtered.filter(f => f.vendedor === filterVendedor);
    }

    if (filterStatus) {
        if (filterStatus === 'FORA_DO_PRAZO') {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            filtered = filtered.filter(f => {
                const isTipoEnvio = !f.tipo_nf || f.tipo_nf === 'ENVIO';
                if (!isTipoEnvio) return false;
                
                if (f.status === 'ENTREGUE') return false;
                if (!f.previsao_entrega) return false;
                const previsao = new Date(f.previsao_entrega + 'T00:00:00');
                previsao.setHours(0, 0, 0, 0);
                return previsao < hoje;
            });
        } else {
            filtered = filtered.filter(f => f.status === filterStatus);
        }
    }

    if (searchTerm) {
        filtered = filtered.filter(f => {
            const searchFields = [
                f.numero_nf,
                f.transportadora,
                f.nome_orgao,
                f.cidade_destino,
                f.vendedor,
                f.documento,
                f.contato_orgao
            ];
            
            return searchFields.some(field => 
                field && field.toString().toLowerCase().includes(searchTerm)
            );
        });
    }

    filtered.sort((a, b) => {
        const numA = parseInt(a.numero_nf) || 0;
        const numB = parseInt(b.numero_nf) || 0;
        return numA - numB;
    });
    
    renderFretes(filtered);
}

// ============================================
// RENDERIZAÇÃO COM ONCLICK INLINE
// ============================================
function renderFretes(fretesToRender) {
    const container = document.getElementById('fretesContainer');
    
    if (!container) return;
    
    if (!fretesToRender || fretesToRender.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhum frete encontrado</div>';
        return;
    }

    const table = `
        <div style="overflow-x: auto;">
            <table>
                <thead>
                    <tr>
                        <th style="width: 40px; text-align: center;">
                            <span style="font-size: 1.1rem;">✓</span>
                        </th>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Vendedor</th>
                        <th>Transportadora</th>
                        <th>Data Entrega</th>
                        <th>Valor NF</th>
                        <th>Status</th>
                        <th style="text-align: center;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${fretesToRender.map(f => {
                        const isEntregue = f.status === 'ENTREGUE';
                        
                        const tiposComCheckbox = ['ENVIO', 'SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
                        const tipoNf = f.tipo_nf || 'ENVIO';
                        const showCheckbox = tiposComCheckbox.includes(tipoNf);
                        
                        const displayValue = (val) => {
                            if (!val || val === 'NÃO INFORMADO') return '-';
                            return val;
                        };
                        
                        return `
                        <tr class="${isEntregue ? 'row-entregue' : ''}" data-id="${f.id}">
                            <td style="text-align: center; padding: 8px;">
                                ${showCheckbox ? `
                                <div class="checkbox-wrapper">
                                    <input 
                                        type="checkbox" 
                                        id="check-${f.id}"
                                        ${isEntregue ? 'checked' : ''}
                                        class="styled-checkbox"
                                    >
                                    <label for="check-${f.id}" class="checkbox-label-styled"></label>
                                </div>
                                ` : ''}
                            </td>
                            <td><strong>${f.numero_nf || '-'}</strong></td>
                            <td style="max-width: 200px; word-wrap: break-word; white-space: normal;">${f.nome_orgao || '-'}</td>
                            <td>${displayValue(f.vendedor)}</td>
                            <td>${displayValue(f.transportadora)}</td>
                            <td style="white-space: nowrap;">${f.data_entrega ? formatDate(f.data_entrega) : '-'}</td>
                            <td><strong>R$ ${f.valor_nf ? parseFloat(f.valor_nf).toFixed(2) : '0,00'}</strong></td>
                            <td>${getStatusBadgeForRender(f)}</td>
                            <td class="actions-cell" style="text-align: center; white-space: nowrap;">
                                <button class="action-btn view" onclick="handleViewClick('${f.id}')" title="Ver detalhes">Ver</button>
                                <button class="action-btn edit" onclick="handleEditClick('${f.id}')" title="Editar">Editar</button>
                                <button class="action-btn delete" onclick="handleDeleteClick('${f.id}')" title="Excluir">Excluir</button>
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>
    `;
    
    container.innerHTML = table;
}

// ============================================
// BADGES E LABELS
// ============================================
function getTipoNfLabel(tipo) {
    const labels = {
        'ENVIO': 'Envio',
        'CANCELADA': 'Cancelada',
        'REMESSA_AMOSTRA': 'Remessa de Amostra',
        'SIMPLES_REMESSA': 'Simples Remessa',
        'DEVOLUCAO': 'Devolução'
    };
    return labels[tipo] || tipo || 'Envio';
}

function getStatusBadgeForRender(frete) {
    const tiposSempreCinza = ['SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
    if (tiposSempreCinza.includes(frete.tipo_nf)) {
        const tipoLabel = getTipoNfLabel(frete.tipo_nf);
        return `<span class="badge badge-especial">${tipoLabel.toUpperCase()}</span>`;
    }
    
    const tiposEspeciais = ['CANCELADA', 'DEVOLUCAO'];
    if (tiposEspeciais.includes(frete.tipo_nf)) {
        const tipoLabel = getTipoNfLabel(frete.tipo_nf);
        return `<span class="badge badge-especial">${tipoLabel.toUpperCase()}</span>`;
    }
    
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    if (frete.status !== 'ENTREGUE' && frete.previsao_entrega) {
        const previsao = new Date(frete.previsao_entrega + 'T00:00:00');
        previsao.setHours(0, 0, 0, 0);
        
        if (previsao < hoje) {
            return '<span class="badge devolvido">FORA DO PRAZO</span>';
        }
    }
    
    return getStatusBadge(frete.status);
}

function getStatusBadge(status) {
    const statusMap = {
        'EM_TRANSITO': { class: 'transito', text: 'Em Trânsito' },
        'ENTREGUE': { class: 'entregue', text: 'Entregue' },
        'DEVOLUCAO': { class: 'devolvido', text: 'Devolução' },
        'SIMPLES_REMESSA': { class: 'cancelado', text: 'Simples Remessa' },
        'REMESSA_AMOSTRA': { class: 'cancelado', text: 'Remessa de Amostra' },
        'CANCELADO': { class: 'cancelado', text: 'Cancelada' }
    };
    
    const s = statusMap[status] || { class: 'transito', text: status };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

// ============================================
// UTILIDADES
// ============================================
function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
}

function showToast(message, type) {
    const oldMessages = document.querySelectorAll('.floating-message');
    oldMessages.forEach(msg => msg.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `floating-message ${type}`;
    messageDiv.textContent = message;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOutBottom 0.3s ease forwards';
        setTimeout(() => messageDiv.remove(), 300);
    }, 3000);
}

// ============================================
// ALERTA DE NOTAS EM ATRASO
// ============================================
function verificarNotasAtrasadas() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const tiposComStatus = ['ENVIO', 'SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
    const notasAtrasadas = fretes.filter(f => {
        const tipo = f.tipo_nf || 'ENVIO';
        if (!tiposComStatus.includes(tipo)) return false;
        
        if (f.status === 'ENTREGUE') return false;
        
        if (!f.previsao_entrega) return false;
        
        const previsao = new Date(f.previsao_entrega + 'T00:00:00');
        previsao.setHours(0, 0, 0, 0);
        
        return previsao < hoje;
    });
    
    if (notasAtrasadas.length === 0) return;
    
    notasAtrasadas.sort((a, b) => {
        const dataA = new Date(a.previsao_entrega);
        const dataB = new Date(b.previsao_entrega);
        return dataA - dataB;
    });
}

// ============================================
// MODAL DE ALERTA FORA DO PRAZO
// ============================================
window.showAlertModal = function() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    const tiposComStatus = ['ENVIO', 'SIMPLES_REMESSA', 'REMESSA_AMOSTRA'];
    const foraDoPrazo = fretes.filter(f => {
        const tipo = f.tipo_nf || 'ENVIO';
        if (!tiposComStatus.includes(tipo)) return false;
        if (f.status === 'ENTREGUE') return false;
        if (!f.previsao_entrega) return false;
        
        const previsao = new Date(f.previsao_entrega + 'T00:00:00');
        previsao.setHours(0, 0, 0, 0);
        return previsao < hoje;
    });
    
    foraDoPrazo.sort((a, b) => {
        const dataA = new Date(a.previsao_entrega);
        const dataB = new Date(b.previsao_entrega);
        return dataA - dataB;
    });
    
    const modalBody = document.getElementById('alertModalBody');
    if (!modalBody) return;
    
    if (foraDoPrazo.length === 0) {
        modalBody.innerHTML = `
            <div style="text-align: center; padding: 3rem; color: var(--text-secondary);">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity: 0.3; margin-bottom: 1rem;">
                    <circle cx="12" cy="12" r="10"></circle>
                    <path d="M12 8l0 4"></path>
                    <path d="M12 16l.01 0"></path>
                </svg>
                <p style="font-size: 1.1rem; font-weight: 600; margin: 0;">Nenhuma entrega fora do prazo</p>
                <p style="font-size: 0.9rem; margin-top: 0.5rem;">Todas as entregas estão dentro do prazo previsto</p>
            </div>
        `;
    } else {
        modalBody.innerHTML = `
            <div style="overflow-x: auto;">
                <table>
                    <thead>
                        <tr>
                            <th>Nº NF</th>
                            <th>Data Emissão</th>
                            <th>Órgão</th>
                            <th>Previsão</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${foraDoPrazo.map(f => `
                            <tr>
                                <td><strong>${f.numero_nf || '-'}</strong></td>
                                <td style="white-space: nowrap;">${formatDate(f.data_emissao)}</td>
                                <td>${f.nome_orgao || '-'}</td>
                                <td style="white-space: nowrap; color: #EF4444; font-weight: 600;">${formatDate(f.previsao_entrega)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    const alertModal = document.getElementById('alertModal');
    if (alertModal) {
        alertModal.style.display = 'flex';
    }
};

window.closeAlertModal = function() {
    const alertModal = document.getElementById('alertModal');
    if (alertModal) {
        alertModal.style.display = 'none';
    }
};

window.addEventListener('beforeunload', () => {
    sessionStorage.removeItem('alertShown');
});

// ============================================
// LOG FINAL
// ============================================
console.log('✅ Script completo carregado com sucesso!');
console.log('🔧 Funções exportadas para window:', {
    toggleForm: typeof window.toggleForm,
    showFormModal: typeof window.showFormModal,
    handleEditClick: typeof window.handleEditClick,
    handleSubmit: typeof window.handleSubmit
});
