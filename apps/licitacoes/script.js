// CONFIGURAÇÃO
const PORTAL_URL = window.location.origin;
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:10000/api'
    : `${window.location.origin}/api`;

let licitacoes = [];
let editingId = null;
let currentTab = 0;
let currentInfoTab = 0;
let isOnline = false;
let sessionToken = null;
let consecutive401Count = 0;
const MAX_401_BEFORE_LOGOUT = 3;
let lastDataHash = '';
let deleteId = null;
let detalhes = [];

// NOVAS VARIÁVEIS PARA NAVEGAÇÃO DE MÊS
let currentMonth = new Date();
let currentFetchController = null;
let isAllMonths = false;

// CONFIGURAÇÕES DA PROPOSTA (editáveis)
let configProposta = {
    impostoFederal: 9.7,
    freteVenda: 5,
    freteCompra: 0,
    validade: '',
    prazoEntrega: '',
    prazoPagamento: '',
    dadosBancarios: '',
    assinatura: true
};

const tabs = ['tab-geral', 'tab-orgao', 'tab-contato', 'tab-prazos', 'tab-detalhes'];
const infoTabs = ['info-tab-geral', 'info-tab-orgao', 'info-tab-contato', 'info-tab-prazos', 'info-tab-detalhes'];

console.log('🚀 Licitações iniciada');
console.log('📍 API URL:', API_URL);

function toUpperCase(value) {
    return value ? String(value).toUpperCase() : '';
}

// Converter input para maiúsculo automaticamente
function setupUpperCaseInputs() {
    const textInputs = document.querySelectorAll('input[type="text"]:not([readonly]), textarea');
    textInputs.forEach(input => {
        input.addEventListener('input', function(e) {
            const start = this.selectionStart;
            const end = this.selectionEnd;
            this.value = toUpperCase(this.value);
            this.setSelectionRange(start, end);
        });
    });
}

document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
    populateMonthFilter();
});

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('licitacoesSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('licitacoesSession');
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
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_URL}/licitacoes`, {
            method: 'HEAD',
            headers: headers,
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            consecutive401Count++;
            if (consecutive401Count >= MAX_401_BEFORE_LOGOUT) {
                sessionStorage.removeItem('licitacoesSession');
                mostrarTelaAcessoNegado('Sua sessão expirou');
            }
            return false;
        }
        consecutive401Count = 0;

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE');
            await loadLicitacoes();
        }
        
        updateConnectionStatus();
        return isOnline;
    } catch (error) {
        console.error('❌ Erro ao verificar servidor:', error.message);
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

function startPolling() {
    loadLicitacoes();
    setInterval(() => {
        if (isOnline) loadLicitacoes();
    }, 10000);
}

// ============================================
// NOVAS FUNÇÕES DE NAVEGAÇÃO DE MÊS
// ============================================
function updateMonthDisplay() {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthName = months[currentMonth.getMonth()];
    const year = currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = isAllMonths ? 'Todos os meses' : `${monthName} ${year}`;
}

function changeMonth(direction) {
    if (isAllMonths) {
        isAllMonths = false;
        currentMonth = new Date();
    } else {
        currentMonth.setMonth(currentMonth.getMonth() + direction);
    }
    updateMonthDisplay();
    loadLicitacoes();
}

function resetToAllMonths() {
    isAllMonths = true;
    updateMonthDisplay();
    loadLicitacoes();
}

// ============================================
// LOAD LICITACOES COM ABORTCONTROLLER E FILTRO DE MÊS
// ============================================
async function loadLicitacoes() {
    if (!isOnline) return;

    // Cancela requisição anterior
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;

    const mesFetch = isAllMonths ? null : currentMonth.getMonth() + 1;
    const anoFetch = isAllMonths ? null : currentMonth.getFullYear();

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        let url = `${API_URL}/licitacoes`;
        if (!isAllMonths && mesFetch && anoFetch) {
            url += `?mes=${mesFetch}&ano=${anoFetch}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            mode: 'cors',
            signal: signal
        });

        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            console.error('❌ Erro ao carregar pregões:', response.status);
            return;
        }

        const data = await response.json();

        // Se o usuário mudou de mês enquanto carregava, ignora
        if ((isAllMonths && mesFetch !== null) || (!isAllMonths && (mesFetch !== currentMonth.getMonth()+1 || anoFetch !== currentMonth.getFullYear()))) {
            return;
        }

        licitacoes = data;
        
        // Atualizar status para OCORRIDO se a data já passou
        atualizarStatusOcorridos();
        
        const newHash = JSON.stringify(licitacoes.map(p => p.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            updateDisplay();
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            console.log('⏹️ Requisição cancelada (mês trocado)');
        } else {
            console.error('❌ Erro ao carregar:', error);
        }
    } finally {
        if (currentFetchController && currentFetchController.signal.aborted === false) {
            currentFetchController = null;
        }
    }
}

// Atualizar status para OCORRIDO
function atualizarStatusOcorridos() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    
    licitacoes.forEach(licitacao => {
        if (licitacao.status !== 'GANHO' && licitacao.data) {
            const dataLicitacao = new Date(licitacao.data + 'T00:00:00');
            if (dataLicitacao < hoje && licitacao.status !== 'OCORRIDO') {
                licitacao.status = 'OCORRIDO';
            }
        }
    });
}

async function syncData() {
    console.log('🔄 Iniciando sincronização...');
    
    if (!isOnline) {
        showToast('Erro ao sincronizar', 'error');
        console.log('❌ Sincronização cancelada: servidor offline');
        return;
    }

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        let url = `${API_URL}/licitacoes`;
        if (!isAllMonths) {
            url += `?mes=${currentMonth.getMonth()+1}&ano=${currentMonth.getFullYear()}`;
        }

        const response = await fetch(url, {
            method: 'GET',
            headers: headers,
            mode: 'cors',
            cache: 'no-cache',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            throw new Error(`Erro ao sincronizar: ${response.status}`);
        }

        const data = await response.json();
        licitacoes = data;
        
        atualizarStatusOcorridos();
        
        lastDataHash = JSON.stringify(licitacoes.map(p => p.id));
        updateDisplay();
        
        console.log(`✅ Sincronização concluída: ${licitacoes.length} licitações carregadas`);
        showToast('Dados sincronizados', 'success');
    } catch (error) {
        if (error.name === 'AbortError') {
            console.error('❌ Timeout na sincronização');
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            console.error('❌ Erro na sincronização:', error.message);
            showToast('Erro ao sincronizar', 'error');
        }
    }
}

function showToast(message, type = 'success') {
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

function updateDisplay() {
    updateStats();
    filterLicitacoes();
}

function updateStats() {
    const total = licitacoes.length;
    const abertos = licitacoes.filter(p => p.status === 'ABERTO').length;
    const ganhos = licitacoes.filter(p => p.status === 'GANHO').length;
    const ocorridos = licitacoes.filter(p => p.status === 'OCORRIDO').length;
    
    document.getElementById('totalPregoes').textContent = total;
    document.getElementById('totalAbertos').textContent = abertos;
    document.getElementById('totalGanhos').textContent = ganhos;
    document.getElementById('totalOcorridos').textContent = ocorridos;
}

// Popular filtro de meses
function populateMonthFilter() {
    const select = document.getElementById('filterMes');
    const months = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 
                    'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    
    months.forEach((month, index) => {
        const option = document.createElement('option');
        option.value = index + 1;
        option.textContent = month;
        select.appendChild(option);
    });
}

function filterLicitacoes() {
    const search = toUpperCase(document.getElementById('search').value);
    const filterResp = document.getElementById('filterResponsavel').value;
    const filterStatus = document.getElementById('filterStatus').value;
    const filterMes = document.getElementById('filterMes').value;
    
    const filtered = licitacoes.filter(licitacao => {
        const matchSearch = !search || 
            toUpperCase(licitacao.responsavel).includes(search) ||
            toUpperCase(licitacao.numero_pregao).includes(search) ||
            toUpperCase(licitacao.uasg || '').includes(search) ||
            toUpperCase(licitacao.nome_orgao || '').includes(search);
            
        const matchResp = !filterResp || licitacao.responsavel === filterResp;
        const matchStatus = !filterStatus || licitacao.status === filterStatus;
        
        let matchMes = true;
        if (filterMes && licitacao.data) {
            const dataLicitacao = new Date(licitacao.data + 'T00:00:00');
            matchMes = (dataLicitacao.getMonth() + 1) == filterMes;
        }
        
        return matchSearch && matchResp && matchStatus && matchMes;
    });
    
    displayLicitacoes(filtered);
}

// ============================================
// REMOÇÃO DO BOTÃO "VER" E CLICK NA LINHA
// ============================================
function displayLicitacoes(licitacoesToDisplay) {
    const container = document.getElementById('pregoesContainer');
    
    if (licitacoesToDisplay.length === 0) {
        container.innerHTML = '<tr><td colspan="8" style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhuma licitação encontrada</td></tr>';
        return;
    }
    
    container.innerHTML = licitacoesToDisplay.map(licitacao => {
        const statusClass = licitacao.status === 'GANHO' ? 'success' : 
                           licitacao.status === 'ABERTO' ? 'warning' :
                           licitacao.status === 'OCORRIDO' ? 'danger' : 'default';
        
        const rowClass = licitacao.ganho ? 'row-won' : '';
        const checked = licitacao.ganho ? 'checked' : '';
        
        const dataFormatada = licitacao.data ? new Date(licitacao.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
        const hora = licitacao.hora || '-';
        
        return `
            <tr class="${rowClass}" data-id="${licitacao.id}" onclick="viewLicitacao('${licitacao.id}')">
                <td style="text-align: center; padding: 8px;" onclick="event.stopPropagation()">
                    <div class="checkbox-wrapper">
                        <input 
                            type="checkbox" 
                            id="check-${licitacao.id}"
                            ${checked}
                            onchange="toggleGanho('${licitacao.id}', this.checked)"
                            class="styled-checkbox"
                        >
                        <label for="check-${licitacao.id}" class="checkbox-label-styled"></label>
                    </div>
                </td>
                <td><strong>${licitacao.responsavel || '-'}</strong></td>
                <td>${dataFormatada}</td>
                <td>${hora}</td>
                <td><strong>${licitacao.numero_pregao}</strong></td>
                <td>${licitacao.uasg || '-'}</td>
                <td><span class="status-badge status-badge-${statusClass}">${licitacao.status}</span></td>
                <td class="actions-cell" onclick="event.stopPropagation()">
                    <button class="action-btn edit" onclick="editLicitacao('${licitacao.id}')" title="Editar">Editar</button>
                    <button class="action-btn btn-items" onclick="openItems('${licitacao.id}')" title="${licitacao.disputa_por === 'GRUPO' ? 'Grupos' : 'Itens'}">${licitacao.disputa_por === 'GRUPO' ? 'Grupos' : 'Itens'}</button>
                    <button class="action-btn delete" onclick="openDeleteModal('${licitacao.id}')" title="Excluir">Excluir</button>
                </td>
            </tr>
        `;
    }).join('');
}

// Toggle ganho
async function toggleGanho(id, ganho) {
    if (!isOnline) {
        showToast('Sistema offline. Não foi possível atualizar.', 'error');
        loadLicitacoes();
        return;
    }

    try {
        const licitacao = licitacoes.find(l => l.id === id);
        if (!licitacao) return;
        
        licitacao.ganho = ganho;
        if (ganho) {
            licitacao.status = 'GANHO';
        } else {
            const hoje = new Date();
            hoje.setHours(0, 0, 0, 0);
            const dataLicitacao = new Date(licitacao.data + 'T00:00:00');
            licitacao.status = dataLicitacao < hoje ? 'OCORRIDO' : 'ABERTO';
        }
        
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        const response = await fetch(`${API_URL}/licitacoes/${id}`, {
            method: 'PUT',
            headers: headers,
            body: JSON.stringify({
                ...licitacao,
                ganho: licitacao.ganho,
                status: licitacao.status
            }),
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        
        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao atualizar');
        
        updateDisplay();
        const mensagem = ganho 
            ? `Licitação ${licitacao.numero_pregao} ganho` 
            : 'Marcação removida';
        showToast(mensagem, ganho ? 'success' : 'error');
    } catch (error) {
        console.error('Erro:', error);
        if (error.name === 'AbortError') {
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            showToast('Erro ao atualizar status', 'error');
        }
        loadLicitacoes();
    }
}

// MODAL DE FORMULÁRIO
function openFormModal() {
    editingId = null;
    document.getElementById('formTitle').textContent = 'Nova Licitação';
    document.getElementById('formModal').classList.add('show');
    resetForm();
    currentTab = 0;
    switchTab(tabs[0]);
    setupUpperCaseInputs();
}

function closeFormModal(showCancelMessage = true) {
    document.getElementById('formModal').classList.remove('show');
    resetForm();
    if (showCancelMessage) {
        showToast('Registro cancelado', 'error');
    }
}

function resetForm() {
    document.getElementById('responsavel').value = '';
    document.getElementById('dataLicitacao').value = '';
    document.getElementById('horaPregao').value = '';
    document.getElementById('numeroPregao').value = '';
    document.getElementById('uasg').value = '';
    document.getElementById('nomeOrgao').value = '';
    document.getElementById('municipio').value = '';
    document.getElementById('uf').value = '';
    document.getElementById('validadeProposta').value = '';
    document.getElementById('prazoEntrega').value = '';
    document.getElementById('prazoPagamento').value = '';
    document.getElementById('banco').value = '';
    document.getElementById('disputaPor').value = 'ITEM';
    
    document.getElementById('telefonesContainer').innerHTML = `
        <div class="input-with-button">
            <input type="text" class="telefone-input" placeholder="TELEFONE">
            <button type="button" onclick="addTelefone()" class="btn-add">+</button>
        </div>
    `;
    
    document.getElementById('emailsContainer').innerHTML = `
        <div class="input-with-button">
            <input type="email" class="email-input" placeholder="E-MAIL">
            <button type="button" onclick="addEmail()" class="btn-add">+</button>
        </div>
    `;
    
    detalhes = [];
    document.querySelectorAll('.detalhe-item').forEach(item => {
        item.classList.remove('selected');
    });
}

function addTelefone() {
    const container = document.getElementById('telefonesContainer');
    const div = document.createElement('div');
    div.className = 'input-with-button';
    div.innerHTML = `
        <input type="text" class="telefone-input" placeholder="TELEFONE">
        <button type="button" onclick="removeTelefone(this)" class="btn-remove">−</button>
    `;
    container.appendChild(div);
    setupUpperCaseInputs();
}

function removeTelefone(btn) {
    btn.parentElement.remove();
}

function getTelefones() {
    const inputs = document.querySelectorAll('.telefone-input');
    return Array.from(inputs)
        .map(input => input.value.trim())
        .filter(value => value !== '');
}

function addEmail() {
    const container = document.getElementById('emailsContainer');
    const div = document.createElement('div');
    div.className = 'input-with-button';
    div.innerHTML = `
        <input type="email" class="email-input" placeholder="E-MAIL">
        <button type="button" onclick="removeEmail(this)" class="btn-remove">−</button>
    `;
    container.appendChild(div);
}

function removeEmail(btn) {
    btn.parentElement.remove();
}

function getEmails() {
    const inputs = document.querySelectorAll('.email-input');
    return Array.from(inputs)
        .map(input => input.value.trim().toUpperCase())
        .filter(value => value !== '');
}

function toggleDetalhe(element, nome) {
    element.classList.toggle('selected');
    const index = detalhes.indexOf(nome);
    if (index > -1) {
        detalhes.splice(index, 1);
    } else {
        detalhes.push(nome);
    }
}

function switchTab(tabId) {
    tabs.forEach((tab, index) => {
        document.getElementById(tab).classList.remove('active');
        document.querySelectorAll('.tabs-nav .tab-btn')[index].classList.remove('active');
    });
    
    document.getElementById(tabId).classList.add('active');
    const tabIndex = tabs.indexOf(tabId);
    document.querySelectorAll('.tabs-nav .tab-btn')[tabIndex].classList.add('active');
    currentTab = tabIndex;
    
    updateNavigationButtons();
}

function updateNavigationButtons() {
    const btnPrevious = document.getElementById('btnPrevious');
    const btnNext = document.getElementById('btnNext');
    const btnCancel = document.getElementById('btnCancel');
    const btnSave = document.getElementById('btnSave');
    
    btnPrevious.style.display = currentTab === 0 ? 'none' : 'inline-block';
    btnCancel.style.display = 'inline-block';
    
    if (currentTab === tabs.length - 1) {
        btnNext.style.display = 'none';
        btnSave.style.display = 'inline-block';
    } else {
        btnNext.style.display = 'inline-block';
        btnSave.style.display = 'none';
    }
}

function nextTab() {
    if (currentTab < tabs.length - 1) {
        currentTab++;
        switchTab(tabs[currentTab]);
    }
}

function previousTab() {
    if (currentTab > 0) {
        currentTab--;
        switchTab(tabs[currentTab]);
    }
}

async function salvarLicitacao() {
    const dataLicitacao = document.getElementById('dataLicitacao').value;
    const numeroPregao = toUpperCase(document.getElementById('numeroPregao').value);
    
    if (!dataLicitacao || !numeroPregao) {
        showToast('Preencha os campos obrigatórios (Data e Nº Pregão)', 'error');
        return;
    }
    
    const responsavel = document.getElementById('responsavel').value;
    
    const licitacao = {
        responsavel: responsavel || null,
        data: dataLicitacao,
        hora: document.getElementById('horaPregao').value || null,
        numero_pregao: numeroPregao,
        uasg: toUpperCase(document.getElementById('uasg').value) || null,
        nome_orgao: toUpperCase(document.getElementById('nomeOrgao').value) || null,
        municipio: toUpperCase(document.getElementById('municipio').value) || null,
        uf: document.getElementById('uf').value || null,
        telefones: getTelefones(),
        emails: getEmails(),
        validade_proposta: toUpperCase(document.getElementById('validadeProposta').value) || null,
        prazo_entrega: toUpperCase(document.getElementById('prazoEntrega').value) || null,
        prazo_pagamento: toUpperCase(document.getElementById('prazoPagamento').value) || null,
        detalhes: detalhes,
        banco: document.getElementById('banco').value || null,
        disputa_por: document.getElementById('disputaPor').value || 'ITEM',
        status: 'ABERTO',
        ganho: false
    };
    
    if (!isOnline) {
        showToast('Sistema offline', 'error');
        closeFormModal(false);
        return;
    }
    
    try {
        const url = editingId ? `${API_URL}/licitacoes/${editingId}` : `${API_URL}/licitacoes`;
        const method = editingId ? 'PUT' : 'POST';

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        const response = await fetch(url, {
            method: method,
            headers: headers,
            body: JSON.stringify(licitacao),
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
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

        const savedLicitacao = await response.json();
        const mensagem = editingId 
            ? `Licitação ${savedLicitacao.numero_pregao} atualizado` 
            : `Licitação ${savedLicitacao.numero_pregao} registrado`;
        showToast(mensagem, 'success');
        closeFormModal(false);
        await loadLicitacoes();
    } catch (error) {
        console.error('Erro completo:', error);
        if (error.name === 'AbortError') {
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            showToast(`Erro: ${error.message}`, 'error');
        }
    }
}

async function editLicitacao(id) {
    editingId = id;
    const licitacao = licitacoes.find(l => l.id === id);
    if (!licitacao) return;
    
    document.getElementById('formTitle').textContent = `Editar Licitação Nº ${licitacao.numero_pregao}`;
    
    document.getElementById('responsavel').value = licitacao.responsavel;
    document.getElementById('dataLicitacao').value = licitacao.data;
    document.getElementById('horaPregao').value = licitacao.hora || '';
    document.getElementById('numeroPregao').value = licitacao.numero_pregao;
    document.getElementById('uasg').value = licitacao.uasg || '';
    document.getElementById('nomeOrgao').value = licitacao.nome_orgao || '';
    document.getElementById('municipio').value = licitacao.municipio || '';
    document.getElementById('uf').value = licitacao.uf || '';
    document.getElementById('validadeProposta').value = licitacao.validade_proposta || '';
    document.getElementById('prazoEntrega').value = licitacao.prazo_entrega || '';
    document.getElementById('prazoPagamento').value = licitacao.prazo_pagamento || '';
    document.getElementById('banco').value = licitacao.banco || '';
    document.getElementById('disputaPor').value = licitacao.disputa_por || 'ITEM';
    
    const telefonesContainer = document.getElementById('telefonesContainer');
    telefonesContainer.innerHTML = '';
    if (licitacao.telefones && licitacao.telefones.length > 0) {
        licitacao.telefones.forEach((tel, index) => {
            const div = document.createElement('div');
            div.className = 'input-with-button';
            div.innerHTML = `
                <input type="text" class="telefone-input" placeholder="TELEFONE" value="${tel}">
                <button type="button" onclick="${index === 0 ? 'addTelefone()' : 'removeTelefone(this)'}" class="btn-${index === 0 ? 'add">+' : 'remove">−'}</button>
            `;
            telefonesContainer.appendChild(div);
        });
    } else {
        telefonesContainer.innerHTML = `
            <div class="input-with-button">
                <input type="text" class="telefone-input" placeholder="TELEFONE">
                <button type="button" onclick="addTelefone()" class="btn-add">+</button>
            </div>
        `;
    }
    
    const emailsContainer = document.getElementById('emailsContainer');
    emailsContainer.innerHTML = '';
    if (licitacao.emails && licitacao.emails.length > 0) {
        licitacao.emails.forEach((email, index) => {
            const div = document.createElement('div');
            div.className = 'input-with-button';
            div.innerHTML = `
                <input type="email" class="email-input" placeholder="E-MAIL" value="${email}">
                <button type="button" onclick="${index === 0 ? 'addEmail()' : 'removeEmail(this)'}" class="btn-${index === 0 ? 'add">+' : 'remove">−'}</button>
            `;
            emailsContainer.appendChild(div);
        });
    } else {
        emailsContainer.innerHTML = `
            <div class="input-with-button">
                <input type="email" class="email-input" placeholder="E-MAIL">
                <button type="button" onclick="addEmail()" class="btn-add">+</button>
            </div>
        `;
    }
    
    detalhes = licitacao.detalhes || [];
    document.querySelectorAll('.detalhe-item').forEach(item => {
        item.classList.remove('selected');
        const nome = item.textContent;
        if (detalhes.includes(nome)) {
            item.classList.add('selected');
        }
    });
    
    document.getElementById('formModal').classList.add('show');
    currentTab = 0;
    switchTab(tabs[0]);
    setupUpperCaseInputs();
}

function viewLicitacao(id) {
    const licitacao = licitacoes.find(l => l.id === id);
    if (!licitacao) return;
    
    document.getElementById('modalNumero').textContent = licitacao.numero_pregao;
    
    document.getElementById('info-tab-geral').innerHTML = `
        <div class="info-section">
            <p><strong>Responsável:</strong> ${licitacao.responsavel}</p>
            <p><strong>Data:</strong> ${licitacao.data ? new Date(licitacao.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</p>
            <p><strong>Hora:</strong> ${licitacao.hora || '-'}</p>
            <p><strong>Disputa por:</strong> ${licitacao.disputa_por || 'ITEM'}</p>
            <p><strong>Status:</strong> <span class="status-badge ${licitacao.status === 'GANHO' ? 'success' : licitacao.status === 'ABERTO' ? 'warning' : licitacao.status === 'OCORRIDO' ? 'danger' : 'default'}">${licitacao.status}</span></p>
        </div>
    `;
    
    document.getElementById('info-tab-orgao').innerHTML = `
        <div class="info-section">
            <p><strong>Nº Pregão:</strong> ${licitacao.numero_pregao}</p>
            <p><strong>UASG:</strong> ${licitacao.uasg || '-'}</p>
            <p><strong>Nome do Órgão:</strong> ${licitacao.nome_orgao || '-'}</p>
            <p><strong>Município:</strong> ${licitacao.municipio || '-'}</p>
            <p><strong>UF:</strong> ${licitacao.uf || '-'}</p>
        </div>
    `;
    
    const telefonesHtml = licitacao.telefones && licitacao.telefones.length > 0 
        ? licitacao.telefones.map(t => `<p>• ${t}</p>`).join('') 
        : '<p>-</p>';
    const emailsHtml = licitacao.emails && licitacao.emails.length > 0 
        ? licitacao.emails.map(e => `<p>• ${e}</p>`).join('') 
        : '<p>-</p>';
    
    document.getElementById('info-tab-contato').innerHTML = `
        <div class="info-section">
            <h4 style="color: #111; font-weight: 700;">Telefones</h4>
            ${telefonesHtml}
        </div>
        <div class="info-section">
            <h4 style="color: #111; font-weight: 700;">E-mails</h4>
            ${emailsHtml}
        </div>
    `;
    
    document.getElementById('info-tab-prazos').innerHTML = `
        <div class="info-section">
            <p><strong>Validade da Proposta:</strong> ${licitacao.validade_proposta || '-'}</p>
            <p><strong>Prazo de Entrega:</strong> ${licitacao.prazo_entrega || '-'}</p>
            <p><strong>Prazo de Pagamento:</strong> ${licitacao.prazo_pagamento || '-'}</p>
        </div>
    `;
    
    const detalhesHtml = licitacao.detalhes && licitacao.detalhes.length > 0 
        ? licitacao.detalhes.map(d => `<p>✓ ${d}</p>`).join('') 
        : '<p>Nenhum detalhe selecionado</p>';
    
    document.getElementById('info-tab-detalhes').innerHTML = `
        <div class="info-section">
            <h4 style="color: #111; font-weight: 700;">Detalhes Selecionados</h4>
            ${detalhesHtml}
        </div>
        <div class="info-section">
            <p><strong>Banco:</strong> ${licitacao.banco || '-'}</p>
            <p style="color: var(--text-secondary); font-size: 0.85rem; font-style: italic;">* Dados bancários completos serão incluídos no PDF da proposta</p>
        </div>
    `;
    
    document.getElementById('infoModal').classList.add('show');
    currentInfoTab = 0;
    switchInfoTab(infoTabs[0]);
}

function closeInfoModal() {
    document.getElementById('infoModal').classList.remove('show');
}

function switchInfoTab(tabId) {
    infoTabs.forEach((tab, index) => {
        document.getElementById(tab).classList.remove('active');
        document.querySelectorAll('#infoModal .tabs-nav .tab-btn')[index].classList.remove('active');
    });
    
    document.getElementById(tabId).classList.add('active');
    const tabIndex = infoTabs.indexOf(tabId);
    document.querySelectorAll('#infoModal .tabs-nav .tab-btn')[tabIndex].classList.add('active');
    currentInfoTab = tabIndex;
    
    updateInfoNavigationButtons();
}

function updateInfoNavigationButtons() {
    const btnPrevious = document.getElementById('btnInfoPrevious');
    const btnNext = document.getElementById('btnInfoNext');
    const btnClose = document.getElementById('btnInfoClose');
    
    btnPrevious.style.display = currentInfoTab === 0 ? 'none' : 'inline-block';
    btnNext.style.display = currentInfoTab === infoTabs.length - 1 ? 'none' : 'inline-block';
    btnClose.style.display = 'inline-block';
}

function nextInfoTab() {
    if (currentInfoTab < infoTabs.length - 1) {
        currentInfoTab++;
        switchInfoTab(infoTabs[currentInfoTab]);
    }
}

function previousInfoTab() {
    if (currentInfoTab > 0) {
        currentInfoTab--;
        switchInfoTab(infoTabs[currentInfoTab]);
    }
}

function openDeleteModal(id) {
    deleteId = id;
    document.getElementById('deleteModal').classList.add('show');
}

function closeDeleteModal() {
    deleteId = null;
    document.getElementById('deleteModal').classList.remove('show');
}

async function confirmarExclusao() {
    closeDeleteModal();

    if (!isOnline) {
        showToast('Sistema offline. Não foi possível excluir.', 'error');
        return;
    }

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_URL}/licitacoes/${deleteId}`, {
            method: 'DELETE',
            headers: headers,
            mode: 'cors',
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao deletar');

        const licitacaoExcluida = licitacoes.find(l => l.id === deleteId);
        licitacoes = licitacoes.filter(l => l.id !== deleteId);
        lastDataHash = JSON.stringify(licitacoes.map(p => p.id));
        updateDisplay();
        showToast(`Licitação ${licitacaoExcluida?.numero_pregao} excluído`, 'error');
    } catch (error) {
        console.error('Erro ao deletar:', error);
        if (error.name === 'AbortError') {
            showToast('Timeout: Operação demorou muito', 'error');
        } else {
            showToast('Erro ao excluir pregão', 'error');
        }
    }
}

async function openItems(id) {
    currentPregaoId = id;
    const licitacao = licitacoes.find(l => l.id === id);
    const disputa = licitacao?.disputa_por || 'ITEM';
    
    if (disputa === 'GRUPO') {
        mostrarTelaGrupos();
        await carregarGrupos();
    } else {
        mostrarTelaItens();
        await carregarItens(id);
    }
}

// ============================================
// COMPROVANTE DE EXEQUIBILIDADE
// ============================================

let exequibilidadeData = {
    intervalo: '',
    impostoFederal: 9.7,
    freteVenda: 5,
    freteCompra: 0
};

function abrirModalExequibilidade(licitacaoId) {
    currentPregaoId = licitacaoId;
    
    let modal = document.getElementById('modalExequibilidade');
    if (!modal) {
        modal = criarModalExequibilidade();
        document.body.appendChild(modal);
    }
    
    // Resetar valores padrão
    document.getElementById('exeIntervalo').value = '';
    document.getElementById('exeImpostoFederal').value = '9.7';
    document.getElementById('exeFreteVenda').value = '5';
    document.getElementById('exeFreteCompra').value = '0';
    
    modal.classList.add('show');
}

function fecharModalExequibilidade() {
    const modal = document.getElementById('modalExequibilidade');
    if (modal) modal.classList.remove('show');
}

function criarModalExequibilidade() {
    const modal = document.createElement('div');
    modal.id = 'modalExequibilidade';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <div class="modal-header">
                <h3 class="modal-title">Comprovante de Exequibilidade</h3>
                <button class="close-modal" onclick="fecharModalExequibilidade()">✕</button>
            </div>
            
            <div class="tabs-container">
                <div class="tabs-nav">
                    <button class="tab-btn active" onclick="switchExeTab('exe-tab-geral')">Geral</button>
                    <button class="tab-btn" onclick="switchExeTab('exe-tab-valores')">Valores</button>
                </div>
                
                <div class="tab-content active" id="exe-tab-geral">
                    <div class="form-grid">
                        <div class="form-group" style="grid-column: 1/-1;">
                            <label>Intervalo de Itens <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10, 15-20 ou deixe vazio para todos)</span></label>
                            <input type="text" id="exeIntervalo" placeholder="Ex: 1-5, 10, 15-20">
                        </div>
                    </div>
                </div>
                
                <div class="tab-content" id="exe-tab-valores">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Imposto Federal (%)</label>
                            <input type="number" id="exeImpostoFederal" step="0.1" min="0" max="100" value="9.7">
                        </div>
                        <div class="form-group">
                            <label>Frete Venda (%)</label>
                            <input type="number" id="exeFreteVenda" step="0.1" min="0" max="100" value="5">
                        </div>
                        <div class="form-group">
                            <label>Frete Compra (R$)</label>
                            <input type="number" id="exeFreteCompra" step="0.01" min="0" value="0">
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal-actions">
                <button type="button" id="btnExePrev" class="secondary" style="display: none;" onclick="prevExeTab()">Anterior</button>
                <button type="button" id="btnExeNext" class="secondary" onclick="nextExeTab()">Próximo</button>
                <button type="button" id="btnExeGerar" class="success" style="display: none;" onclick="gerarComprovanteExequibilidade()">Gerar Comprovante</button>
                <button type="button" class="danger" onclick="fecharModalExequibilidade()">Cancelar</button>
            </div>
        </div>
    `;
    return modal;
}

const exeTabs = ['exe-tab-geral', 'exe-tab-valores'];
let currentExeTab = 0;

function switchExeTab(tabId) {
    const allTabs = document.querySelectorAll('#modalExequibilidade .tab-content');
    const allBtns = document.querySelectorAll('#modalExequibilidade .tab-btn');
    allTabs.forEach(t => t.classList.remove('active'));
    allBtns.forEach(b => b.classList.remove('active'));
    const active = document.getElementById(tabId);
    if (active) active.classList.add('active');
    currentExeTab = exeTabs.indexOf(tabId);
    const idx = currentExeTab;
    if (allBtns[idx]) allBtns[idx].classList.add('active');
    const isLast = idx === exeTabs.length - 1;
    const prev = document.getElementById('btnExePrev');
    const next = document.getElementById('btnExeNext');
    const gerar = document.getElementById('btnExeGerar');
    if (prev) prev.style.display = idx === 0 ? 'none' : 'inline-block';
    if (next) next.style.display = isLast ? 'none' : 'inline-block';
    if (gerar) gerar.style.display = isLast ? 'inline-block' : 'none';
}

function nextExeTab() {
    if (currentExeTab < exeTabs.length - 1) {
        currentExeTab++;
        switchExeTab(exeTabs[currentExeTab]);
    }
}

function prevExeTab() {
    if (currentExeTab > 0) {
        currentExeTab--;
        switchExeTab(exeTabs[currentExeTab]);
    }
}

// ============================================
// PDF DE EXEQUIBILIDADE COM CABEÇALHO PADRÃO
// ============================================
async function gerarComprovanteExequibilidade() {
    const intervalo = document.getElementById('exeIntervalo').value.trim();
    const impostoFederal = parseFloat(document.getElementById('exeImpostoFederal').value) || 9.7;
    const freteVenda = parseFloat(document.getElementById('exeFreteVenda').value) || 5;
    const freteCompra = parseFloat(document.getElementById('exeFreteCompra').value) || 0;
    
    fecharModalExequibilidade();
    
    const licitacao = licitacoes.find(l => l.id === currentPregaoId);
    if (!licitacao) {
        showToast('Erro: Licitação não encontrada', 'error');
        return;
    }
    
    // Filtrar itens pelo intervalo
    let itensFiltrados = [...itens];
    if (intervalo) {
        const numeros = parsearIntervalo(intervalo);
        if (numeros) {
            itensFiltrados = itens.filter(item => numeros.includes(item.numero));
        }
    }
    
    if (itensFiltrados.length === 0) {
        showToast('Nenhum item encontrado no intervalo informado', 'error');
        return;
    }
    
    // Buscar dados bancários
    let dadosBancarios = null;
    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        const response = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/dados-bancarios`, {
            method: 'GET',
            headers: headers
        });
        if (response.ok) {
            const data = await response.json();
            dadosBancarios = data.dados_bancarios;
        }
    } catch (error) {
        console.error('Erro ao buscar dados bancários:', error);
    }
    
    if (typeof window.jspdf === 'undefined') {
        showToast('Erro: Biblioteca PDF não carregou. Recarregue a página (F5).', 'error');
        return;
    }
    
    gerarPDFExequibilidade(licitacao, itensFiltrados, dadosBancarios, impostoFederal, freteVenda, freteCompra);
}

function gerarPDFExequibilidade(licitacao, itensExe, dadosBancarios, impostoFederal, freteVenda, freteCompra) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    let y = 3;
    const margin = 15;
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const lineHeight = 5;
    const maxWidth = pageWidth - (2 * margin);
    const footerMargin = 30;
    
    // --- CABEÇALHO IDÊNTICO AO DA PROPOSTA ---
    function adicionarCabecalho() {
        const logoHeaderImg = new Image();
        logoHeaderImg.crossOrigin = 'anonymous';
        logoHeaderImg.src = 'I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
        
        try {
            const logoWidth = 40;
            const logoHeight = 15;
            const logoX = 5;
            const headerY = 3;
            
            doc.setGState(new doc.GState({ opacity: 0.3 }));
            doc.addImage(logoHeaderImg, 'PNG', logoX, headerY, logoWidth, logoHeight);
            doc.setGState(new doc.GState({ opacity: 1.0 }));
            
            doc.setFontSize(8);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(150, 150, 150);
            const textX = logoX + logoWidth + 1.2;
            doc.text('I.R COMÉRCIO E', textX, headerY + 5);
            doc.text('MATERIAIS ELÉTRICOS LTDA', textX, headerY + 10);
            doc.setTextColor(0, 0, 0);
            
            return headerY + logoHeight + 8;
        } catch (e) {
            return 20;
        }
    }
    
    function addPageWithHeader() {
        doc.addPage();
        return adicionarCabecalho();
    }
    
    function paginaCheia(yAtual, espaco = 40) {
        return yAtual > pageHeight - footerMargin - espaco;
    }
    
    // Rodapé
    const footerLines = [
        'I.R. COMÉRCIO E MATERIAIS ELÉTRICOS LTDA  |  CNPJ: 33.149.502/0001-38  |  IE: 083.780.74-2',
        'RUA TADORNA Nº 472, SALA 2, NOVO HORIZONTE – SERRA/ES  |  CEP: 29.163-318',
        'TELEFAX: (27) 3209-4291  |  E-MAIL: COMERCIAL.IRCOMERCIO@GMAIL.COM'
    ];
    const footerLineH = 5;
    const footerH = footerLines.length * footerLineH + 4;
    
    function addFooter(docRef) {
        const totalPags = docRef.internal.getNumberOfPages();
        for (let pg = 1; pg <= totalPags; pg++) {
            docRef.setPage(pg);
            docRef.setFontSize(8);
            docRef.setFont(undefined, 'normal');
            docRef.setTextColor(150, 150, 150);
            const fyBase = pageHeight - footerH + 2;
            footerLines.forEach((line, i) => {
                docRef.text(line, pageWidth / 2, fyBase + (i * footerLineH), { align: 'center' });
            });
            docRef.setTextColor(0, 0, 0);
        }
    }
    
    // Título
    y = adicionarCabecalho();
    y += 5;
    
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text('TABELA DE CUSTOS E FORMAÇÃO DE PREÇOS', pageWidth / 2, y, { align: 'center' });
    
    y += 8;
    doc.setFontSize(12);
    doc.text(`${licitacao.numero_pregao}${licitacao.uasg ? ' - ' + licitacao.uasg : ''}`, pageWidth / 2, y, { align: 'center' });
    
    y += 12;
    
    // DADOS 1 - Informações do Processo
    doc.setFontSize(10);
    doc.setFont(undefined, 'bold');
    doc.text('INFORMAÇÕES DO PROCESSO', margin, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    doc.text(`PREGÃO: ${licitacao.numero_pregao}`, margin, y);
    y += 5;
    doc.text(`ÓRGÃO: ${licitacao.nome_orgao || 'NÃO INFORMADO'} - ${licitacao.uasg || ''}`, margin, y);
    y += 5;
    doc.text(`${licitacao.municipio || ''} - ${licitacao.uf || ''}`, margin, y);
    y += 10;
    
    // DADOS 2 - Informações da Empresa
    doc.setFont(undefined, 'bold');
    doc.text('INFORMAÇÕES DA EMPRESA', margin, y);
    y += 6;
    doc.setFont(undefined, 'normal');
    doc.text('FORNECEDOR: I.R. COMÉRCIO E MATERIAIS ELÉTRICOS LTDA', margin, y);
    doc.text('TEL: (27) 3209-4291', pageWidth - margin - 50, y, { align: 'right' });
    y += 5;
    doc.text('CNPJ/CPF: 33.149.502/0001-38', margin, y);
    y += 5;
    doc.text('ENDEREÇO: RUA TADORNA, Nº 472, SALA 2', margin, y);
    y += 5;
    doc.text('BAIRRO: NOVO HORIZONTE', margin, y);
    y += 5;
    doc.text(`CIDADE: SERRA      UF: ES`, margin, y);
    doc.text(`CEP: 29.163-318`, pageWidth - margin - 30, y, { align: 'right' });
    y += 5;
    if (dadosBancarios) {
        doc.text(`DADOS BANCÁRIOS: ${dadosBancarios}`, margin, y);
        y += 5;
    }
    y += 5;
    
    if (paginaCheia(y, 80)) y = addPageWithHeader() + 20;
    
    // DADOS 3 - Tabela de Itens
    doc.setFont(undefined, 'bold');
    doc.text('COMPOSIÇÃO DE CUSTOS', margin, y);
    y += 8;
    
    // Cabeçalho da tabela (sem cores alternadas)
    const colWidths = {
        item: 15,
        descricao: 50,
        qtd: 12,
        un: 10,
        marca: 20,
        modelo: 20,
        custoUnt: 20,
        freteCompra: 20,
        impFed: 20,
        freteVenda: 20,
        vendaUnt: 20,
        lucroReal: 20,
        percLucro: 15
    };
    
    const tableWidth = Object.values(colWidths).reduce((a, b) => a + b, 0);
    const startX = (pageWidth - tableWidth) / 2;
    
    doc.setFillColor(108, 117, 125);
    doc.setDrawColor(180, 180, 180);
    doc.rect(startX, y, tableWidth, 10, 'FD');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(6);
    doc.setFont(undefined, 'bold');
    
    let xp = startX;
    const headers = [
        ['ITEM', colWidths.item, 'center'],
        ['DESCRIÇÃO', colWidths.descricao, 'left'],
        ['QTD', colWidths.qtd, 'center'],
        ['UN', colWidths.un, 'center'],
        ['MARCA', colWidths.marca, 'center'],
        ['MODELO', colWidths.modelo, 'center'],
        ['CUSTO\nUNT', colWidths.custoUnt, 'right'],
        ['FRETE\nCOMPRA', colWidths.freteCompra, 'right'],
        ['IMP\nFED', colWidths.impFed, 'right'],
        ['FRETE\nVENDA', colWidths.freteVenda, 'right'],
        ['VENDA\nUNT', colWidths.vendaUnt, 'right'],
        ['LUCRO\nREAL', colWidths.lucroReal, 'right'],
        ['% LUCRO', colWidths.percLucro, 'right']
    ];
    
    headers.forEach(([lbl, w, align]) => {
        doc.line(xp, y, xp, y + 10);
        const lines = lbl.split('\n');
        lines.forEach((line, i) => {
            doc.text(line, xp + w / 2, y + 4 + (i * 3), { align: 'center' });
        });
        xp += w;
    });
    doc.line(xp, y, xp, y + 10);
    
    y += 10;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(6);
    doc.setFont(undefined, 'normal');
    
    // Linhas de itens (sem cores alternadas)
    let totalGeralVenda = 0;
    itensExe.forEach((item, idx) => {
        if (paginaCheia(y, 50)) {
            y = addPageWithHeader() + 20;
            doc.setFillColor(108, 117, 125);
            doc.setDrawColor(180, 180, 180);
            doc.rect(startX, y, tableWidth, 10, 'FD');
            doc.setTextColor(255, 255, 255);
            doc.setFont(undefined, 'bold');
            xp = startX;
            headers.forEach(([lbl, w]) => {
                doc.line(xp, y, xp, y + 10);
                const lines = lbl.split('\n');
                lines.forEach((line, i) => {
                    doc.text(line, xp + w / 2, y + 4 + (i * 3), { align: 'center' });
                });
                xp += w;
            });
            doc.line(xp, y, xp, y + 10);
            y += 10;
            doc.setTextColor(0, 0, 0);
            doc.setFont(undefined, 'normal');
        }
        
        const vendaUnt = item.venda_unt || 0;
        const custoUnt = item.custo_unt || 0;
        const impostoFederalValor = vendaUnt * (impostoFederal / 100);
        const freteVendaValor = vendaUnt * (freteVenda / 100);
        const lucroReal = vendaUnt - freteVendaValor - impostoFederalValor - freteCompra - custoUnt;
        const percLucro = vendaUnt > 0 ? (lucroReal / vendaUnt) * 100 : 0;
        
        totalGeralVenda += vendaUnt * (item.qtd || 1);
        
        // Sem cor de fundo alternada
        doc.setFillColor(255, 255, 255);
        doc.setDrawColor(180, 180, 180);
        doc.rect(startX, y, tableWidth, 8, 'FD');
        
        xp = startX;
        const values = [
            [String(item.numero || ''), 'center'],
            [item.descricao || '', 'left'],
            [String(item.qtd || 1), 'center'],
            [item.unidade || 'UN', 'center'],
            [item.marca || '-', 'center'],
            [item.modelo || '-', 'center'],
            ['R$ ' + custoUnt.toFixed(2), 'right'],
            ['R$ ' + freteCompra.toFixed(2), 'right'],
            ['R$ ' + impostoFederalValor.toFixed(2), 'right'],
            ['R$ ' + freteVendaValor.toFixed(2), 'right'],
            ['R$ ' + vendaUnt.toFixed(2), 'right'],
            ['R$ ' + lucroReal.toFixed(2), 'right'],
            [percLucro.toFixed(1) + '%', 'right']
        ];
        
        values.forEach(([val, align], i) => {
            doc.line(xp, y, xp, y + 8);
            const w = Object.values(colWidths)[i];
            const textX = align === 'left' ? xp + 2 : (align === 'right' ? xp + w - 2 : xp + w / 2);
            // Quebra de linha para descrição longa
            if (i === 1) { // descrição
                const lines = doc.splitTextToSize(val, w - 4);
                lines.forEach((line, j) => {
                    doc.text(line, textX, y + 4 + (j * 3));
                });
            } else {
                doc.text(val, textX, y + 5, { align: align });
            }
            xp += w;
        });
        doc.line(xp, y, xp, y + 8);
        y += 8;
    });
    
    y += 5;
    
    // DADOS 4 - Data e Assinatura (centralizada verticalmente)
    if (paginaCheia(y, 40)) y = addPageWithHeader() + 20;
    
    const dataAtual = new Date();
    const dia = dataAtual.getDate();
    const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 
                   'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    const mes = meses[dataAtual.getMonth()];
    const ano = dataAtual.getFullYear();
    
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`SERRA/ES, ${dia} DE ${mes} DE ${ano}`, pageWidth / 2, y, { align: 'center' });
    y += 15;
    
    // Assinatura centralizada verticalmente
    const assinatura = new Image();
    assinatura.crossOrigin = 'anonymous';
    assinatura.src = 'assinatura.png';
    
    try {
        const imgWidth = 50;
        const imgHeight = 15;
        doc.addImage(assinatura, 'PNG', (pageWidth / 2) - (imgWidth / 2), y - 5, imgWidth, imgHeight);
    } catch (e) {
        doc.line(pageWidth / 2 - 40, y, pageWidth / 2 + 40, y);
    }
    
    y += 10;
    doc.setFont(undefined, 'bold');
    doc.text('ROSEMEIRE BICALHO DE LIMA GRAVINO', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.setFont(undefined, 'normal');
    doc.text('MG-10.078.568 / CPF: 045.160.616-78', pageWidth / 2, y, { align: 'center' });
    y += 5;
    doc.text('DIRETORA', pageWidth / 2, y, { align: 'center' });
    
    addFooter(doc);
    
    const nomeArquivo = `COMPROVANTE-EXEQUIBILIDADE-${licitacao.numero_pregao}${licitacao.uasg ? '-' + licitacao.uasg : ''}.pdf`;
    doc.save(nomeArquivo);
    showToast('Comprovante gerado com sucesso!', 'success');
}

// ============================================
// GESTÃO DE ITENS DO PREGÃO
// ============================================

let currentPregaoId = null;
let itens = [];
let editingItemIndex = null;
let selectedItens = new Set();
let currentItemsView = 'proposta';
let marcasItens = new Set();

function mostrarTelaItens() {
    document.querySelector('.container').style.display = 'none';
    let telaItens = document.getElementById('telaItens');
    if (!telaItens) {
        telaItens = criarTelaItens();
        document.body.querySelector('.app-content').appendChild(telaItens);
    }
    telaItens.style.display = 'block';
    const licitacao = licitacoes.find(l => l.id === currentPregaoId);
    if (licitacao) {
        const tituloEl = document.getElementById('tituloItens');
        if (tituloEl) {
            const uasgPart = licitacao.uasg ? ` — UASG ${licitacao.uasg}` : '';
            tituloEl.textContent = `Licitação ${licitacao.numero_pregao}${uasgPart}`;
        }
    }
}

function voltarLicitacoes() {
    document.getElementById('telaItens').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    currentPregaoId = null;
    itens = [];
}

// ============================================================
// ESTADO DOS GRUPOS
// ============================================================
let grupos = [];
let editandoGrupoIdx = null;
let editandoGrupoItemIdx = null;
let modoNavegacaoGrupo = false;

// ============================================================
// TELA DE GRUPOS (com ícone de configuração)
// ============================================================
function mostrarTelaGrupos() {
    document.querySelector('.container').style.display = 'none';
    let telaGrupos = document.getElementById('telaGrupos');
    if (!telaGrupos) {
        telaGrupos = criarTelaGrupos();
        document.body.querySelector('.app-content').appendChild(telaGrupos);
    }
    telaGrupos.style.display = 'block';
    const licitacao = licitacoes.find(l => l.id === currentPregaoId);
    if (licitacao) {
        const el = document.getElementById('tituloGrupos');
        if (el) el.textContent = `Licitação ${licitacao.numero_pregao}${licitacao.uasg ? ' — UASG ' + licitacao.uasg : ''}`;
    }
    carregarGrupos();
}

function voltarLicitacoesDeGrupos() {
    const tela = document.getElementById('telaGrupos');
    if (tela) tela.style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    currentPregaoId = null;
    itens = [];
    grupos = [];
}

function criarTelaGrupos() {
    const div = document.createElement('div');
    div.id = 'telaGrupos';
    div.className = 'container';
    div.innerHTML = `
        <div class="header">
            <div class="header-left">
                <div>
                    <h1>Grupos do Pregão</h1>
                    <p id="tituloGrupos" style="color:var(--text-secondary);font-size:0.8rem;font-weight:400;margin-top:2px;"></p>
                </div>
            </div>
            <div style="display:flex;gap:0.75rem;align-items:center;">
                <button onclick="abrirModalNovoGrupo()" style="background:#22C55E;color:white;border:none;padding:0.65rem 1.25rem;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">+ Grupo</button>
                <button onclick="abrirModalIntervaloGrupos()" style="background:#6B7280;color:white;border:none;padding:0.65rem 1.25rem;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">+ Intervalo</button>
                <button onclick="abrirModalExcluirGrupo()" style="background:#EF4444;color:white;border:none;padding:0.65rem 1.25rem;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">Excluir</button>
                <!-- Ícone de configuração -->
                <button onclick="abrirModalConfigProposta()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Configurar Proposta">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H5.78a1.65 1.65 0 0 0-1.51 1 1.65 1.65 0 0 0 .33 1.82l.04.04A10 10 0 0 0 12 18a10 10 0 0 0 6.36-2.28l.04-.04z"></path>
                        <line x1="12" y1="2" x2="12" y2="6"></line>
                        <line x1="12" y1="22" x2="12" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>

        <div class="search-bar-wrapper">
            <div class="search-bar">
                <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path>
                </svg>
                <input type="text" id="searchGrupos" placeholder="Pesquisar grupos" oninput="renderGrupos()">
                <div class="search-bar-filters">
                    <div class="filter-dropdown-inline">
                        <select id="filterGrupoGrupos" onchange="onChangeFilterGrupo()">
                            <option value="">Grupo</option>
                        </select>
                        <svg class="dropdown-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                    <div class="filter-dropdown-inline">
                        <select id="filterMarcaGrupos" onchange="renderGrupos()">
                            <option value="">Marca</option>
                        </select>
                        <svg class="dropdown-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </div>
                </div>
                <button onclick="abrirModalCotacao()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Cotação">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="20" height="16" x="2" y="4" rx="2"/>
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                </button>
                <button onclick="perguntarAssinaturaPDFGrupos()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Gerar Proposta PDF">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                </button>
                <button onclick="abrirModalExequibilidade(currentPregaoId)" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Comprovante de Exequibilidade">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="3" width="20" height="18" rx="2" ry="2"></rect>
                        <line x1="8" y1="9" x2="16" y2="9"></line>
                        <line x1="8" y1="13" x2="16" y2="13"></line>
                        <line x1="8" y1="17" x2="12" y2="17"></line>
                    </svg>
                </button>
                <button onclick="syncGrupos()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Sincronizar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                        <path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                        <path d="M8 16H3v5"/>
                    </svg>
                </button>
                <button onclick="voltarLicitacoesDeGrupos()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Voltar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                </button>
            </div>
        </div>

        <div id="gruposWrapper" style="margin-top:0.5rem;">
            <div style="text-align:center;padding:3rem;color:var(--text-secondary);">Nenhum grupo cadastrado</div>
        </div>

        <!-- MODAL NOVO GRUPO (mantido) -->
        <div class="modal-overlay" id="modalNovoGrupo">
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header">
                    <h3 class="modal-title">Novo Grupo / Lote</h3>
                    <button class="close-modal" onclick="fecharModalNovoGrupo()">✕</button>
                </div>
                <div class="form-grid">
                    <div class="form-group">
                        <label>Tipo</label>
                        <select id="novoGrupoTipo">
                            <option value="GRUPO">Grupo</option>
                            <option value="LOTE">Lote</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Número</label>
                        <input type="number" id="novoGrupoNumero" min="1" placeholder="Nº do grupo">
                    </div>
                    <div class="form-group" style="grid-column:1/-1;">
                        <label>Itens do grupo <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10, 15-20)</span></label>
                        <input type="text" id="novoGrupoItens" placeholder="Ex: 1-5, 10, 15-20">
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="secondary" onclick="fecharModalNovoGrupo();showToast('Registro cancelado','error')">Cancelar</button>
                    <button class="success" onclick="confirmarNovoGrupo()">Criar Grupo</button>
                </div>
            </div>
        </div>

        <!-- MODAL EXCLUIR GRUPO (mantido) -->
        <div class="modal-overlay" id="modalExcluirGrupo">
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header">
                    <h3 class="modal-title">Excluir Grupo / Lote</h3>
                    <button class="close-modal" onclick="fecharModalExcluirGrupo()">✕</button>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active">Selecionar</button>
                    </div>
                    <div class="tab-content active">
                        <div class="form-grid">
                            <div class="form-group" style="grid-column:1/-1;">
                                <label>Selecione o grupo a excluir</label>
                                <select id="excluirGrupoSelect">
                                    <option value="">Selecione...</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="danger" onclick="confirmarExcluirGrupo()">Excluir</button>
                    <button class="secondary" onclick="fecharModalExcluirGrupo()">Cancelar</button>
                </div>
            </div>
        </div>

        <!-- MODAL ASSINATURA GRUPOS (mantido) -->
        <div class="modal-overlay" id="modalAssinaturaGrupos">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="document.getElementById('modalAssinaturaGrupos').classList.remove('show')">✕</button>
                <div class="modal-message-delete">
                    Deseja incluir a assinatura padrão na proposta?
                </div>
                <div class="modal-actions modal-actions-no-border">
                    <button class="success" onclick="gerarPDFGruposComAssinatura(true)">Sim</button>
                    <button class="danger" onclick="gerarPDFGruposComAssinatura(false)">Não</button>
                </div>
            </div>
        </div>

        <!-- MODAL INTERVALO GRUPOS (mantido) -->
        <div class="modal-overlay" id="modalIntervaloGrupos">
            <div class="modal-content" style="max-width:600px;">
                <div class="modal-header">
                    <h3 class="modal-title">Adicionar Grupos em Intervalo</h3>
                    <button class="close-modal" onclick="fecharModalIntervaloGrupos()">✕</button>
                </div>
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchIntervaloTab('intervalo-tab-config')">Configuração</button>
                        <button class="tab-btn" onclick="switchIntervaloTab('intervalo-tab-itens')">Itens</button>
                    </div>
                    <div class="tab-content active" id="intervalo-tab-config">
                        <div class="form-grid">
                            <div class="form-group">
                                <label>Tipo</label>
                                <select id="intervGrupoTipo" onchange="atualizarLinhasIntervalo()">
                                    <option value="GRUPO">Grupo</option>
                                    <option value="LOTE">Lote</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Quantidade de grupos</label>
                                <input type="number" id="intervGrupoQtd" min="1" max="50" value="1" placeholder="Ex: 3" oninput="atualizarLinhasIntervalo()">
                            </div>
                        </div>
                    </div>
                    <div class="tab-content" id="intervalo-tab-itens">
                        <div id="intervGrupoLinhas" style="display:flex;flex-direction:column;gap:0.75rem;max-height:300px;overflow-y:auto;">
                        </div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button type="button" id="btnIntervaloPrev" class="secondary" style="display:none;" onclick="prevIntervaloTab()">Anterior</button>
                    <button type="button" id="btnIntervaloNext" class="secondary" onclick="nextIntervaloTab()">Próximo</button>
                    <button type="button" id="btnIntervaloCriar" class="success" style="display:none;" onclick="confirmarIntervaloGrupos()">Criar Grupos</button>
                    <button type="button" class="danger" onclick="fecharModalIntervaloGrupos()">Cancelar</button>
                </div>
            </div>
        </div>
    `;
    return div;
}

async function carregarGrupos() {
    await carregarItens(currentPregaoId);
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
}

function reconstruirERenderGrupos() {
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
}

function reconstruirGruposDeItens() {
    const mapa = new Map();
    itens.forEach(item => {
        if (!item.grupo_tipo || item.grupo_numero == null) return;
        const key = item.grupo_tipo + '-' + item.grupo_numero;
        if (!mapa.has(key)) mapa.set(key, { tipo: item.grupo_tipo, numero: parseInt(item.grupo_numero), itens: [] });
        mapa.get(key).itens.push(item);
    });
    grupos = Array.from(mapa.values()).sort((a, b) => a.numero - b.numero);
    grupos.forEach(g => g.itens.sort((a, b) => (a.numero || 0) - (b.numero || 0)));
}

function atualizarSelectsGrupos() {
    const gSel = document.getElementById('filterGrupoGrupos');
    if (!gSel) return;
    const cur = gSel.value;
    gSel.innerHTML = '<option value="">Grupo</option>' +
        grupos.map(g => `<option value="${g.tipo}-${g.numero}">${g.tipo} ${g.numero}</option>`).join('');
    gSel.value = cur;
    onChangeFilterGrupo();
}

function onChangeFilterGrupo() {
    const gKey = document.getElementById('filterGrupoGrupos')?.value || '';
    const mSel = document.getElementById('filterMarcaGrupos');
    if (!mSel) return;
    const marcas = new Set();
    if (gKey) {
        const g = grupoByKey(gKey);
        (g?.itens || []).forEach(i => { if (i.marca) marcas.add(i.marca); });
    }
    mSel.innerHTML = '<option value="">Marca</option>' +
        Array.from(marcas).sort().map(m => `<option value="${m}">${m}</option>`).join('');
    renderGrupos();
}

function grupoByKey(key) {
    const [tipo, num] = key.split('-');
    return grupos.find(g => g.tipo === tipo && String(g.numero) === num);
}

function renderGrupos() {
    const wrapper = document.getElementById('gruposWrapper');
    if (!wrapper) return;
    const search = (document.getElementById('searchGrupos')?.value || '').toLowerCase();
    const gKey = document.getElementById('filterGrupoGrupos')?.value || '';
    const marcaFiltro = gKey ? (document.getElementById('filterMarcaGrupos')?.value || '') : '';
    const fmtUnt = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:6});
    const fmtTot = v => 'R$ ' + (v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
    let gruposRender = gKey ? [grupoByKey(gKey)].filter(Boolean) : grupos;

    if (gruposRender.length === 0) {
        wrapper.innerHTML = '<div style="text-align:center;padding:3rem;color:var(--text-secondary);">Nenhum grupo cadastrado</div>';
        return;
    }

    const cards = [];
    for (const grupo of gruposRender) {
        let its = grupo.itens;
        if (marcaFiltro) its = its.filter(i => i.marca === marcaFiltro);
        if (search) its = its.filter(i =>
            (i.descricao || '').toLowerCase().includes(search) ||
            (i.marca || '').toLowerCase().includes(search) ||
            String(i.numero).includes(search)
        );
        const lbl = grupo.tipo + ' ' + grupo.numero;
        let totC = 0, totCu = 0, totV = 0;
        const rowParts = new Array(its.length);
        const grupoAllGanho = grupo.itens.every(i => i.ganho);
        for (let idx = 0; idx < its.length; idx++) {
            const item = its[idx];
            const vm = (item.venda_unt || 0) > (item.estimado_unt || 0) && (item.estimado_unt || 0) > 0;
            totC  += item.estimado_total || 0;
            totCu += item.custo_total || 0;
            totV  += item.venda_total || 0;
            const iid = item.id;
            const rowClass = grupoAllGanho ? 'item-ganho row-won' : (vm ? 'row-venda-alta' : '');
            rowParts[idx] =
                '<tr class="' + rowClass + '" ondblclick="editarItemGrupoById(\'' + iid + '\')" oncontextmenu="showItemContextMenu(event,\'' + iid + '\')">' +
                '<td style="width: 60px; text-align:center;"><strong>' + item.numero + '</strong></td>' +
                '<td class="descricao-cell" style="min-width: 350px; text-align:left;">' + (item.descricao || '-') + '</td>' +
                '<td style="width: 80px; text-align:center;">' + (item.qtd || 1) + '</td>' +
                '<td style="width: 80px; text-align:center;">' + (item.unidade || 'UN') + '</td>' +
                '<td style="width: 120px; text-align:center; vertical-align: middle;">' + (item.marca || '-') + '</td>' +
                '<td style="width: 120px; text-align:center; vertical-align: middle;">' + (item.modelo || '-') + '</td>' +
                '<td style="width: 120px; text-align:right;">' + fmtTot(item.estimado_total || 0) + '</td>' +
                '<td style="width: 120px; text-align:right;">' + fmtTot(item.custo_total || 0) + '</td>' +
                '<td style="width: 120px; text-align:right;">' + fmtUnt(item.venda_unt || 0) + '</td>' +
                '<td style="width: 120px; text-align:right;">' + fmtTot(item.venda_total || 0) + '</td>' +
                '</tr>';
        }
        const grupoGanho = grupo.itens.length > 0 && grupo.itens.every(i => i.ganho);
        const grupoGanhoId = 'grp-ganho-' + grupo.tipo + '-' + grupo.numero;
        const grupoGanhoChk = grupoGanho ? ' checked' : '';

        cards.push(
            '<div class="card table-card" style="margin-bottom:0.5rem;">' +
            '<div style="background:#1e3a5f;display:flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:8px 8px 0 0;gap:0.75rem;position:relative;">' +
            '<div class="checkbox-wrapper" style="position:absolute; left: 14px;">' +
            '<input type="checkbox" id="' + grupoGanhoId + '"' + grupoGanhoChk +
            ' onchange="toggleGrupoGanho(\'' + grupo.tipo + '\',' + grupo.numero + ',this.checked)"' +
            ' class="styled-checkbox">' +
            '<label for="' + grupoGanhoId + '" class="checkbox-label-styled"></label>' +
            '</div>' +
            '<label for="' + grupoGanhoId + '" style="font-weight:700;font-size:1rem;color:#fff;cursor:pointer;margin:0; text-align:center;">' + lbl + '</label>' +
            '</div>' +
            '<div style="overflow-x:auto;"><table style="min-width: 1260px; border-collapse: collapse; width:100%;">' +
            '<thead><tr>' +
            '<th style="width: 60px; text-align: center;">ITEM</th>' +
            '<th style="min-width: 350px; text-align: left;">DESCRIÇÃO</th>' +
            '<th style="width: 80px; text-align: center;">QTD</th>' +
            '<th style="width: 80px; text-align: center;">UN</th>' +
            '<th style="width: 120px; text-align: center;">MARCA</th>' +
            '<th style="width: 120px; text-align: center;">MODELO</th>' +
            '<th style="width: 120px; text-align: right;">COMPRA TOTAL</th>' +
            '<th style="width: 120px; text-align: right;">CUSTO TOTAL</th>' +
            '<th style="width: 120px; text-align: right;">VENDA UNT</th>' +
            '<th style="width: 120px; text-align: right;">VENDA TOTAL</th>' +
            '</tr></thead>' +
            '<tbody>' + rowParts.join('') + '</tbody>' +
            '</table></div>' +
            '</div>'
        );
        
        // Barra de totais
        cards.push(
            '<div style="display:flex;gap:3rem;padding:1rem 1rem 0.25rem 1rem;font-size:10pt;color:var(--text-primary);margin-top:0.5rem;margin-bottom:1.5rem;">' +
            '<span><strong>COMPRA TOTAL:</strong> ' + fmtTot(totC) + '</span>' +
            '<span><strong>CUSTO TOTAL:</strong> ' + fmtTot(totCu) + '</span>' +
            '<span><strong>VENDA TOTAL:</strong> ' + fmtTot(totV) + '</span>' +
            '</div>'
        );
    }
    wrapper.innerHTML = cards.join('');
}

function abrirModalNovoGrupo() {
    const maxN = grupos.reduce((m, g) => Math.max(m, g.numero), 0);
    document.getElementById('novoGrupoNumero').value = maxN + 1;
    document.getElementById('novoGrupoItens').value = '';
    document.getElementById('novoGrupoTipo').value = 'GRUPO';
    document.getElementById('modalNovoGrupo').classList.add('show');
}

function fecharModalNovoGrupo() {
    document.getElementById('modalNovoGrupo').classList.remove('show');
}

async function confirmarNovoGrupo() {
    const tipo = document.getElementById('novoGrupoTipo').value;
    const numero = parseInt(document.getElementById('novoGrupoNumero').value);
    const itensStr = document.getElementById('novoGrupoItens').value.trim();
    if (!numero || !itensStr) { showToast('Preencha número e itens do grupo', 'error'); return; }
    const numeros = parsearIntervalo(itensStr);
    if (!numeros || numeros.length === 0) return;
    fecharModalNovoGrupo();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    for (const numItem of numeros) {
        const jaExiste = itens.find(i => i.grupo_tipo === tipo && i.grupo_numero === numero && i.numero === numItem);
        if (jaExiste) continue;
        const novo = payloadItemSeguro({
            pregao_id: currentPregaoId,
            numero: numItem, descricao: '', qtd: 1, unidade: 'UN',
            marca: '', modelo: '',
            estimado_unt: 0, estimado_total: 0, custo_unt: 0, custo_total: 0,
            porcentagem: 149, venda_unt: 0, venda_total: 0, ganho: false,
            grupo_tipo: tipo, grupo_numero: numero
        });
        try {
            const r = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novo) });
            if (r.ok) itens.push(await r.json());
        } catch(e) { console.error(e); }
    }
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
    const grupoNovo = grupos.find(g => g.tipo === tipo && g.numero === numero);
    if (grupoNovo && grupoNovo.itens.length > 0) {
        showToast('Grupo criado', 'success');
        abrirEdicaoGrupoItem(grupoNovo, 0);
    }
}

function abrirEdicaoGrupoItem(grupo, idxItem) {
    editandoGrupoIdx = grupos.indexOf(grupo);
    editandoGrupoItemIdx = idxItem;
    const item = grupo.itens[idxItem];
    editingItemIndex = itens.indexOf(item);
    mostrarModalItemGrupo(item, grupo, idxItem);
}

function editarItemGrupoById(itemId) {
    const item = itens.find(i => i.id === itemId);
    if (!item) return;
    const grupo = grupos.find(g => g.itens.includes(item));
    if (!grupo) { editingItemIndex = itens.indexOf(item); mostrarModalItem(item); return; }
    const idxItem = grupo.itens.indexOf(item);
    abrirEdicaoGrupoItem(grupo, idxItem);
}

function mostrarModalItemGrupo(item, grupo, idxItem) {
    let modal = document.getElementById('modalItem');
    if (!modal) { modal = criarModalItem(); document.body.appendChild(modal); }
    document.getElementById('itemNumero').value = item.numero || '';
    document.getElementById('itemDescricao').value = item.descricao || '';
    document.getElementById('itemQtd').value = item.qtd || 1;
    document.getElementById('itemUnidade').value = item.unidade || 'UN';
    document.getElementById('itemMarca').value = item.marca || '';
    document.getElementById('itemModelo').value = item.modelo || '';
    document.getElementById('itemEstimadoUnt').value = item.estimado_unt || '';
    document.getElementById('itemEstimadoTotal').value = item.estimado_total || '';
    document.getElementById('itemCustoUnt').value = item.custo_unt || '';
    document.getElementById('itemCustoTotal').value = item.custo_total || '';
    document.getElementById('itemPorcentagem').value = item.porcentagem ?? 149;
    document.getElementById('itemVendaUnt').value = item.venda_unt || '';
    document.getElementById('itemVendaTotal').value = item.venda_total || '';
    
    // Resetar flag de edição manual
    const vendaUntInput = document.getElementById('itemVendaUnt');
    if (vendaUntInput) {
        vendaUntInput.dataset.manual = 'false';
    }
    
    const tituloEl = document.getElementById('modalItemTitle');
    if (tituloEl) tituloEl.textContent = `Item ${item.numero}`;
    const btnPrev = document.getElementById('btnPrevPagItem');
    const btnNext = document.getElementById('btnNextPagItem');
    const temAnterior = idxItem > 0 || editandoGrupoIdx > 0;
    const temProximo = idxItem < grupo.itens.length - 1 || editandoGrupoIdx < grupos.length - 1;
    if (btnPrev) btnPrev.style.visibility = temAnterior ? 'visible' : 'hidden';
    if (btnNext) btnNext.style.visibility = temProximo ? 'visible' : 'hidden';
    modoNavegacaoGrupo = true;
    currentItemTab = 0;
    switchItemTab(itemTabs[0]);
    modal.classList.add('show');
    configurarCalculosAutomaticos();
    setTimeout(calcularValoresItem, 50);
    setTimeout(setupUpperCaseInputs, 50);
}

async function navegarGrupoAnterior() {
    await salvarItemAtual(false);
    let gi = editandoGrupoIdx;
    let ii = editandoGrupoItemIdx - 1;
    if (ii < 0) { gi--; if (gi < 0) return; ii = grupos[gi].itens.length - 1; }
    editandoGrupoIdx = gi; editandoGrupoItemIdx = ii;
    const grupo = grupos[gi];
    editingItemIndex = itens.indexOf(grupo.itens[ii]);
    mostrarModalItemGrupo(grupo.itens[ii], grupo, ii);
}

async function navegarGrupoProximo() {
    await salvarItemAtual(false);
    let gi = editandoGrupoIdx;
    let ii = editandoGrupoItemIdx + 1;
    if (ii >= grupos[gi].itens.length) { gi++; if (gi >= grupos.length) return; ii = 0; }
    editandoGrupoIdx = gi; editandoGrupoItemIdx = ii;
    const grupo = grupos[gi];
    editingItemIndex = itens.indexOf(grupo.itens[ii]);
    mostrarModalItemGrupo(grupo.itens[ii], grupo, ii);
}

function abrirModalExcluirGrupo() {
    const sel = document.getElementById('excluirGrupoSelect');
    if (!sel) return;
    sel.innerHTML = '<option value="">Selecione...</option>' +
        grupos.map(g => `<option value="${g.tipo}-${g.numero}">${g.tipo} ${g.numero} (${g.itens.length} item(s))</option>`).join('');
    document.getElementById('modalExcluirGrupo').classList.add('show');
}

function fecharModalExcluirGrupo() {
    document.getElementById('modalExcluirGrupo').classList.remove('show');
}

async function confirmarExcluirGrupo() {
    const val = document.getElementById('excluirGrupoSelect').value;
    if (!val) { showToast('Selecione um grupo', 'error'); return; }
    const grupo = grupoByKey(val);
    if (!grupo) return;
    fecharModalExcluirGrupo();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    const ids = grupo.itens.map(i => i.id).filter(id => !String(id).startsWith('temp-'));
    for (const id of ids) {
        try {
            await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens/${id}`, { method:'DELETE', headers });
        } catch(e) {}
    }
    itens = itens.filter(i => !(i.grupo_tipo === grupo.tipo && i.grupo_numero === grupo.numero));
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
    showToast('Item excluída', 'error');
}

const intervaloTabs = ['intervalo-tab-config', 'intervalo-tab-itens'];
let currentIntervaloTab = 0;

function switchIntervaloTab(tabId) {
    const allTabs = document.querySelectorAll('#modalIntervaloGrupos .tab-content');
    const allBtns = document.querySelectorAll('#modalIntervaloGrupos .tab-btn');
    allTabs.forEach(t => t.classList.remove('active'));
    allBtns.forEach(b => b.classList.remove('active'));
    const active = document.getElementById(tabId);
    if (active) active.classList.add('active');
    currentIntervaloTab = intervaloTabs.indexOf(tabId);
    if (allBtns[currentIntervaloTab]) allBtns[currentIntervaloTab].classList.add('active');
    const isLast = currentIntervaloTab === intervaloTabs.length - 1;
    const prev = document.getElementById('btnIntervaloPrev');
    const next = document.getElementById('btnIntervaloNext');
    const criar = document.getElementById('btnIntervaloCriar');
    if (prev) prev.style.display = currentIntervaloTab === 0 ? 'none' : 'inline-block';
    if (next) next.style.display = isLast ? 'none' : 'inline-block';
    if (criar) criar.style.display = isLast ? 'inline-block' : 'none';
}

function nextIntervaloTab() {
    if (currentIntervaloTab < intervaloTabs.length - 1) {
        currentIntervaloTab++;
        switchIntervaloTab(intervaloTabs[currentIntervaloTab]);
    }
}

function prevIntervaloTab() {
    if (currentIntervaloTab > 0) {
        currentIntervaloTab--;
        switchIntervaloTab(intervaloTabs[currentIntervaloTab]);
    }
}

function abrirModalIntervaloGrupos() {
    document.getElementById('intervGrupoTipo').value = 'GRUPO';
    document.getElementById('intervGrupoQtd').value = 1;
    atualizarLinhasIntervalo();
    switchIntervaloTab('intervalo-tab-config');
    document.getElementById('modalIntervaloGrupos').classList.add('show');
}

function fecharModalIntervaloGrupos() {
    document.getElementById('modalIntervaloGrupos').classList.remove('show');
}

function atualizarLinhasIntervalo() {
    const tipo = document.getElementById('intervGrupoTipo').value;
    const qtd = parseInt(document.getElementById('intervGrupoQtd').value) || 1;
    const container = document.getElementById('intervGrupoLinhas');
    const maxN = grupos.reduce((m, g) => Math.max(m, g.numero), 0);
    let html = '';
    for (let i = 0; i < qtd; i++) {
        const n = maxN + i + 1;
        html += `<div style="display:grid;grid-template-columns:auto 1fr 2fr;gap:0.75rem;align-items:end;padding:0.75rem;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border-color);">
            <div style="font-weight:700;font-size:0.9rem;color:var(--primary);white-space:nowrap;">${tipo} ${n}</div>
            <div class="form-group" style="margin:0;">
                <label style="font-size:0.8rem;">Número</label>
                <input type="number" class="ig-numero" value="${n}" min="1" style="width:100%;padding:0.5rem 0.65rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-primary);font-size:0.9rem;">
            </div>
            <div class="form-group" style="margin:0;">
                <label style="font-size:0.8rem;">Itens (ex: 1-5, 10)</label>
                <input type="text" class="ig-itens" placeholder="Ex: 1-5, 10" style="width:100%;padding:0.5rem 0.65rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-primary);font-size:0.9rem;">
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

async function confirmarIntervaloGrupos() {
    const tipo = document.getElementById('intervGrupoTipo').value;
    const linhas = document.getElementById('intervGrupoLinhas').querySelectorAll('div[style*="grid"]');
    if (linhas.length === 0) { showToast('Adicione ao menos um grupo', 'error'); return; }
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    let totalCriados = 0;
    fecharModalIntervaloGrupos();
    for (const linha of linhas) {
        const numGrupo = parseInt(linha.querySelector('.ig-numero').value);
        const itensStr = linha.querySelector('.ig-itens').value.trim();
        if (!numGrupo || !itensStr) continue;
        const numerosItens = parsearIntervalo(itensStr);
        if (!numerosItens) continue;
        for (const numItem of numerosItens) {
            const jaExiste = itens.find(i => i.grupo_tipo === tipo && i.grupo_numero === numGrupo && String(i.numero) === String(numItem));
            if (jaExiste) continue;
            const novo = payloadItemSeguro({ pregao_id: currentPregaoId, numero: numItem, grupo_tipo: tipo, grupo_numero: numGrupo });
            try {
                const r = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novo) });
                if (r.ok) { itens.push(await r.json()); totalCriados++; }
            } catch(e) { console.error(e); }
        }
    }
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
    showToast('Grupos criados', 'success');
}

async function toggleGrupoGanho(tipo, numero, ganho) {
    const grupoItens = itens.filter(i => i.grupo_tipo === tipo && parseInt(i.grupo_numero) === parseInt(numero));
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    for (const item of grupoItens) {
        item.ganho = ganho;
        if (!String(item.id).startsWith('temp-')) {
            fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens/${item.id}`, {
                method: 'PUT', headers, body: JSON.stringify(item)
            }).catch(e => console.error(e));
        }
    }
    renderGrupos();
}

function syncGrupos() {
    carregarGrupos();
    showToast('Dados sincronizados', 'success');
}

function perguntarAssinaturaPDFGrupos() {
    const temGanho = itens.some(i => i.ganho && i.grupo_tipo);
    if (!temGanho) { showToast('Marque ao menos um item (ganho) para gerar a proposta', 'error'); return; }
    document.getElementById('modalAssinaturaGrupos').classList.add('show');
}

async function gerarPDFGruposComAssinatura(comAssinatura) {
    document.getElementById('modalAssinaturaGrupos').classList.remove('show');
    const licitacao = licitacoes.find(l => l.id === currentPregaoId);
    if (!licitacao) return;
    let dadosBancarios = null;
    try {
        const h = { 'Accept': 'application/json' };
        if (sessionToken) h['X-Session-Token'] = sessionToken;
        const r = await fetch(`${API_URL}/licitacoes/${licitacao.id}/dados-bancarios`, { headers: h });
        if (r.ok) { const d = await r.json(); dadosBancarios = d.dados_bancarios || null; }
    } catch(e) {}
    const estrutura = grupos.map(g => ({ grupo: g, itens: g.itens.filter(i => i.ganho) })).filter(e => e.itens.length > 0);
    if (estrutura.length === 0) { showToast('Nenhum item ganho encontrado', 'error'); return; }
    if (typeof window.jspdf === 'undefined') { showToast('Biblioteca PDF não carregou. Recarregue (F5).', 'error'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const margin = 20, pageWidth = doc.internal.pageSize.width, pageHeight = doc.internal.pageSize.height;
    const lineHeight = 5, maxWidth = pageWidth - 2 * margin;
    let addTextWithWrap;
    const logo = new Image();
    logo.crossOrigin = 'anonymous';
    logo.src = 'I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
    logo.onload = () => iniciarPDFGrupos(true);
    logo.onerror = () => iniciarPDFGrupos(false);
    function iniciarPDFGrupos(logoOk) {
        let y = 3;
        try {
            if (logoOk) {
                const lw = 40, lh = (logo.height / logo.width) * lw;
                doc.setGState(new doc.GState({ opacity: 0.3 }));
                doc.addImage(logo, 'PNG', 5, 3, lw, lh);
                doc.setGState(new doc.GState({ opacity: 1.0 }));
                const fs = lh * 0.5;
                doc.setFontSize(fs); doc.setFont(undefined, 'bold'); doc.setTextColor(150,150,150);
                doc.text('I.R COMÉRCIO E', 5 + lw + 1.2, 3 + fs * 0.85);
                doc.text('MATERIAIS ELÉTRICOS LTDA', 5 + lw + 1.2, 3 + fs * 0.85 + fs * 0.5);
                doc.setTextColor(0, 0, 0);
                y = 3 + lh + 8;
            } else { y = 25; }
        } catch(e) { y = 25; }
        continuarGeracaoPDFProposta(doc, licitacao, dadosBancarios, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap, comAssinatura, estrutura);
    }
}

function criarTelaItens() {
    const div = document.createElement('div');
    div.id = 'telaItens';
    div.className = 'container';
    div.innerHTML = `
        <div class="header">
            <div class="header-left">
                <div>
                    <h1>Itens do Pregão</h1>
                    <p id="tituloItens" style="color: var(--text-secondary); font-size: 0.8rem; font-weight: 400; margin-top: 2px; letter-spacing: 0.01em;"></p>
                </div>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items:center;">
                <button onclick="adicionarItem()" style="background: #22C55E; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">+ Item</button>
                <button onclick="abrirModalIntervalo()" style="background: #6B7280; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">+ Intervalo</button>
                <button onclick="abrirModalExcluirItens()" style="background: #EF4444; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">Excluir</button>
                <!-- Ícone de configuração -->
                <button onclick="abrirModalConfigProposta()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Configurar Proposta">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"></circle>
                        <path d="M19.4 15a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H5.78a1.65 1.65 0 0 0-1.51 1 1.65 1.65 0 0 0 .33 1.82l.04.04A10 10 0 0 0 12 18a10 10 0 0 0 6.36-2.28l.04-.04z"></path>
                        <line x1="12" y1="2" x2="12" y2="6"></line>
                        <line x1="12" y1="22" x2="12" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>

        <div class="search-bar-wrapper">
            <div class="search-bar">
                <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <input type="text" id="searchItens" placeholder="Pesquisar itens" oninput="filterItens()">
                
                <div class="search-bar-filters">
                    <div class="filter-dropdown-inline">
                        <select id="filterMarcaItens" onchange="filterItens()">
                            <option value="">Marca</option>
                        </select>
                        <svg class="dropdown-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="6 9 12 15 18 9"></polyline>
                        </svg>
                    </div>
                </div>

                <button onclick="abrirModalCotacao()" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.5rem; display: flex; align-items: center;" title="Cotação">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <rect width="20" height="16" x="2" y="4" rx="2"/>
                        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                    </svg>
                </button>
                
                <button onclick="perguntarAssinaturaPDF()" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.5rem; display: flex; align-items: center;" title="Gerar Proposta PDF">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                </button>
                
                <button onclick="abrirModalExequibilidade(currentPregaoId)" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.5rem; display: flex; align-items: center;" title="Comprovante de Exequibilidade">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="2" y="3" width="20" height="18" rx="2" ry="2"></rect>
                        <line x1="8" y1="9" x2="16" y2="9"></line>
                        <line x1="8" y1="13" x2="16" y2="13"></line>
                        <line x1="8" y1="17" x2="12" y2="17"></line>
                    </svg>
                </button>
                
                <button onclick="syncItens()" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.5rem; display: flex; align-items: center;" title="Sincronizar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="23 4 23 10 17 10"></polyline>
                        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
                    </svg>
                </button>
                
                <button onclick="voltarLicitacoes()" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.5rem; display: flex; align-items: center;" title="Voltar">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                        <polyline points="16 17 21 12 16 7"></polyline>
                        <line x1="21" y1="12" x2="9" y2="12"></line>
                    </svg>
                </button>
            </div>
        </div>

        <div class="card table-card">
            <div style="overflow-x: auto;">
                <table style="min-width: 1260px; border-collapse: collapse; width:100%;">
                    <thead>
                        <tr>
                            <th style="width: 40px; text-align: center;">
                                <span style="font-size: 1.1rem;">✓</span>
                            </th>
                            <th style="width: 60px; text-align: center;">ITEM</th>
                            <th style="min-width: 350px; text-align: left;">DESCRIÇÃO</th>
                            <th style="width: 80px; text-align: center;">QTD</th>
                            <th style="width: 80px; text-align: center;">UNIDADE</th>
                            <th style="width: 120px; text-align: center;">MARCA</th>
                            <th style="width: 120px; text-align: center;">MODELO</th>
                            <th style="width: 120px; text-align: right;">ESTIMADO UNT</th>
                            <th style="width: 120px; text-align: right;">ESTIMADO TOTAL</th>
                            <th style="width: 120px; text-align: right;">CUSTO UNT</th>
                            <th style="width: 120px; text-align: right;">CUSTO TOTAL</th>
                            <th style="width: 120px; text-align: right;">VENDA UNT</th>
                            <th style="width: 120px; text-align: right;">VENDA TOTAL</th>
                        </tr>
                    </thead>
                    <tbody id="itensContainer"></tbody>
                </table>
            </div>
        </div>
        <div id="itensTotaisBar" style="display:flex;gap:3rem;padding:1rem 1rem 0.25rem 1rem;font-size:10pt;color:var(--text-primary);margin-top:0.5rem;"></div>

        <!-- MODAL INTERVALO (mantido) -->
        <div class="modal-overlay" id="modalIntervalo">
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header">
                    <h3 class="modal-title">Adicionar Intervalo</h3>
                    <button class="close-modal" onclick="fecharModalIntervalo()">✕</button>
                </div>
                <div class="form-grid">
                    <div class="form-group" style="grid-column:1/-1;">
                        <label>Intervalo de itens <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10, 15-20)</span></label>
                        <input type="text" id="inputIntervalo" placeholder="Ex: 1-5, 10, 15-20">
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="secondary" onclick="fecharModalIntervalo();showToast('Registro cancelado','error')">Cancelar</button>
                    <button class="success" onclick="confirmarAdicionarIntervalo()">Adicionar</button>
                </div>
            </div>
        </div>

        <!-- MODAL EXCLUIR ITENS (mantido) -->
        <div class="modal-overlay" id="modalExcluirItens">
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header">
                    <h3 class="modal-title">Excluir Itens</h3>
                    <button class="close-modal" onclick="fecharModalExcluirItens()">✕</button>
                </div>
                <div class="form-grid">
                    <div class="form-group" style="grid-column:1/-1;">
                        <label>Intervalo a excluir <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10)</span></label>
                        <input type="text" id="inputExcluirIntervalo" placeholder="Ex: 1-5, 10">
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="secondary" onclick="fecharModalExcluirItens();showToast('Registro cancelado','error')">Cancelar</button>
                    <button class="danger" onclick="confirmarExcluirItens()">Excluir</button>
                </div>
            </div>
        </div>

        <!-- MODAL ASSINATURA (mantido) -->
        <div class="modal-overlay" id="modalAssinatura">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="fecharModalAssinatura()">✕</button>
                <div class="modal-message-delete">
                    Deseja incluir a assinatura padrão na proposta?
                </div>
                <div class="modal-actions modal-actions-no-border">
                    <button class="success" onclick="gerarPDFsProposta(true)">Sim</button>
                    <button class="danger" onclick="gerarPDFsProposta(false)">Não</button>
                </div>
            </div>
        </div>

    `;
    return div;
}

function obterSaudacao() {
    const hora = new Date().getHours();
    if (hora >= 5 && hora < 12) return 'Bom dia';
    if (hora >= 12 && hora < 18) return 'Boa tarde';
    return 'Boa noite';
}

async function carregarItens(pregaoId) {
    if (!isOnline) return;
    
    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;

        const response = await fetch(`${API_URL}/licitacoes/${pregaoId}/itens`, {
            method: 'GET',
            headers: headers
        });

        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (response.ok) {
            itens = await response.json();
            atualizarMarcasItens();
            renderItens();
        }
    } catch (error) {
        console.error('Erro ao carregar itens:', error);
    }
}

function atualizarMarcasItens() {
    const novas = new Set();
    for (const item of itens) { if (item.marca) novas.add(item.marca); }
    const antes = Array.from(marcasItens).sort().join('|');
    const depois = Array.from(novas).sort().join('|');
    marcasItens = novas;
    if (antes === depois) return;
    const select = document.getElementById('filterMarcaItens');
    if (select) {
        const cur = select.value;
        select.innerHTML = '<option value="">Marca</option>' +
            Array.from(novas).sort().map(m => '<option value="' + m + '"' + (m === cur ? ' selected' : '') + '>' + m + '</option>').join('');
    }
}

function filterItens() {
    const search = document.getElementById('searchItens')?.value.toLowerCase() || '';
    const marca = document.getElementById('filterMarcaItens')?.value || '';
    
    const filtered = itens.filter(item => {
        const matchSearch = !search || 
            (item.descricao || '').toLowerCase().includes(search) ||
            (item.marca && item.marca.toLowerCase().includes(search)) ||
            item.numero.toString().includes(search);
        const matchMarca = !marca || item.marca === marca;
        return matchSearch && matchMarca;
    });
    
    renderItens(filtered);
}

function renderItens(itensToRender = itens) {
    const container = document.getElementById('itensContainer');
    if (!container) return;

    if (itensToRender.length === 0) {
        container.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:2rem;">Nenhum item cadastrado</td></tr>';
        return;
    }

    let totCompra = 0, totCusto = 0, totVenda = 0;
    const parts = new Array(itensToRender.length);

    for (let idx = 0; idx < itensToRender.length; idx++) {
        const item = itensToRender[idx];
        const vendaUnt  = item.venda_unt  || 0;
        const compraUnt = item.estimado_unt || 0;
        const estTotal  = item.estimado_total || 0;
        const custoTotal= item.custo_total || 0;
        const vendaTotal= item.venda_total || 0;
        totCompra += estTotal; totCusto += custoTotal; totVenda += vendaTotal;

        const vm = compraUnt > 0 && vendaUnt > compraUnt;
        const rc = (item.ganho ? 'item-ganho row-won' : '') + (vm ? ' row-venda-alta' : '');
        const cbId = 'ig-' + item.id;
        const ck = item.ganho ? ' checked' : '';

        const iid = item.id;
        parts[idx] = '<tr class="' + rc + '" ondblclick="editarItem(\'' + iid + '\')" oncontextmenu="showItemContextMenu(event,\'' + iid + '\')">' +
            '<td style="text-align:center;padding:8px;"><div class="checkbox-wrapper">' +
            '<input type="checkbox" id="' + cbId + '"' + ck +
            (vm ? ' onclick="event.preventDefault();event.stopPropagation()"' : ' onchange="toggleItemGanho(\'' + iid + '\',this.checked)" onclick="event.stopPropagation()"') +
            ' class="styled-checkbox' + (vm ? ' cb-venda-alta' : '') + '">' +
            '<label for="' + cbId + '" class="checkbox-label-styled' + (vm ? ' cb-label-venda-alta' : '') + '">' + (vm ? '✕' : '') + '</label>' +
            '</div></td>' +
            '<td style="text-align:center;"><strong>' + item.numero + '</strong></td>' +
            '<td class="descricao-cell" style="text-align:left;">' + (item.descricao || '-') + '</td>' +
            '<td style="text-align:center;">' + (item.qtd || 1) + '</td>' +
            '<td style="text-align:center;">' + (item.unidade || 'UN') + '</td>' +
            '<td style="text-align:center; vertical-align: middle;">' + (item.marca || '-') + '</td>' +
            '<td style="text-align:center; vertical-align: middle;">' + (item.modelo || '-') + '</td>' +
            '<td style="text-align:right;">' + fmtUnt(compraUnt) + '</td>' +
            '<td style="text-align:right;">' + fmtTotal(estTotal) + '</td>' +
            '<td style="text-align:right;">' + fmtUnt(item.custo_unt || 0) + '</td>' +
            '<td style="text-align:right;">' + fmtTotal(custoTotal) + '</td>' +
            '<td style="text-align:right;">' + fmtUnt(vendaUnt) + '</td>' +
            '<td style="text-align:right;">' + fmtTotal(vendaTotal) + '</td>' +
            '</tr>';
    }

    container.innerHTML = parts.join('');

    const totaisContainer = document.getElementById('itensTotaisBar');
    if (totaisContainer) {
        totaisContainer.innerHTML =
            '<span><strong>COMPRA TOTAL:</strong> ' + fmtTotal(totCompra) + '</span>' +
            '<span><strong>CUSTO TOTAL:</strong> ' + fmtTotal(totCusto) + '</span>' +
            '<span><strong>VENDA TOTAL:</strong> ' + fmtTotal(totVenda) + '</span>';
    }
}

function showItemContextMenu(event, itemId) {
    event.preventDefault();
    
    const existingMenu = document.getElementById('contextMenu');
    if (existingMenu) existingMenu.remove();
    
    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.style.cssText = `
        position: fixed;
        left: ${event.clientX}px;
        top: ${event.clientY}px;
        background: white;
        border: 1px solid #E5E7EB;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        min-width: 150px;
        padding: 0.5rem 0;
    `;
    
    menu.innerHTML = `
        <div onclick="excluirItemContexto('${itemId}')" style="
            padding: 0.75rem 1rem;
            cursor: pointer;
            color: #EF4444;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 0.5rem;
        " onmouseover="this.style.background='#FEE2E2'" onmouseout="this.style.background='white'">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
            Excluir
        </div>
    `;
    
    document.body.appendChild(menu);
    
    const closeMenu = () => {
        menu.remove();
        document.removeEventListener('click', closeMenu);
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 100);
}

async function excluirItemContexto(itemId) {
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        
        if (!itemId.startsWith('temp-')) {
            const response = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens/${itemId}`, {
                method: 'DELETE',
                headers: headers
            });
            
            if (!response.ok) throw new Error('Erro ao excluir');
        }
        
        itens = itens.filter(item => item.id !== itemId);
        selectedItens.delete(itemId);
        renderItens();
        showToast('Item excluído', 'success');
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao excluir item', 'error');
    }
}

async function toggleItemGanho(id, ganho) {
    const item = itens.find(i => i.id === id);
    if (!item) return;
    item.ganho = ganho;

    const cb = document.getElementById('ig-' + id) || document.getElementById('grp-' + id);
    if (cb) {
        cb.checked = ganho;
        const row = cb.closest('tr');
        if (row) {
            if (ganho) row.classList.add('item-ganho', 'row-won');
            else row.classList.remove('item-ganho', 'row-won');
        }
    }

    try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        if (!String(id).startsWith('temp-')) {
            fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens/${id}`, {
                method: 'PUT', headers, body: JSON.stringify(item)
            }).catch(e => console.error('Erro ao salvar ganho:', e));
        }
    } catch (error) {
        console.error('Erro ao atualizar ganho:', error);
    }
}

function toggleItemSelection(id) {
    if (selectedItens.has(id)) {
        selectedItens.delete(id);
    } else {
        selectedItens.add(id);
    }
}

function toggleSelectAllItens() {
    const checkbox = document.getElementById('selectAllItens');
    if (checkbox.checked) {
        itens.forEach(item => selectedItens.add(item.id));
    } else {
        selectedItens.clear();
    }
    renderItens();
}

const _fmtBRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _fmtBRL6 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 6 });
function fmtTotal(v) { return 'R$ ' + _fmtBRL.format(v || 0); }
function fmtUnt(v) {
    const n = v || 0;
    if (n === 0) return 'R$ 0,00';
    const s = _fmtBRL6.format(n);
    return 'R$ ' + s.replace(/,?0+$/, m => m === ',00' ? ',00' : m.replace(/0+$/, '') || ',00');
}

function payloadItemSeguro(fields) {
    return {
        pregao_id: fields.pregao_id,
        numero: fields.numero || 1,
        descricao: fields.descricao || ' ',
        qtd: fields.qtd || 1,
        unidade: fields.unidade || 'UN',
        marca: fields.marca || null,
        modelo: fields.modelo || null,
        estimado_unt: fields.estimado_unt || 0,
        estimado_total: fields.estimado_total || 0,
        custo_unt: fields.custo_unt || 0,
        custo_total: fields.custo_total || 0,
        porcentagem: fields.porcentagem || 149,
        venda_unt: fields.venda_unt || 0,
        venda_total: fields.venda_total || 0,
        ganho: fields.ganho || false,
        ...(fields.grupo_tipo !== undefined ? { grupo_tipo: fields.grupo_tipo } : {}),
        ...(fields.grupo_numero !== undefined ? { grupo_numero: fields.grupo_numero } : {})
    };
}

async function adicionarItem() {
    const numero = itens.length > 0 ? Math.max(...itens.map(i => i.numero)) + 1 : 1;
    const novoItem = payloadItemSeguro({
        pregao_id: currentPregaoId,
        numero
    });
    try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        const r = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novoItem) });
        if (r.ok) {
            const saved = await r.json();
            itens.push(saved);
            renderItens();
            showToast('Item salvo', 'success');
        } else { throw new Error('Erro ' + r.status); }
    } catch(e) {
        console.error(e);
        showToast('Erro ao criar item', 'error');
    }
}

function abrirModalIntervalo() {
    const modal = document.getElementById('modalIntervalo');
    if (modal) {
        document.getElementById('inputIntervalo').value = '';
        modal.classList.add('show');
    }
}

function fecharModalIntervalo() {
    const modal = document.getElementById('modalIntervalo');
    if (modal) modal.classList.remove('show');
    showToast('Registro cancelado', 'error');
}

function confirmarAdicionarIntervalo() {
    const intervalo = document.getElementById('inputIntervalo').value.trim();
    fecharModalIntervalo();
    if (!intervalo) return;
    adicionarIntervalo(intervalo);
}

async function adicionarIntervalo(intervalo) {
    let numeros = [];
    const partes = intervalo.split(',').map(p => p.trim());
    
    for (const parte of partes) {
        if (parte.includes('-')) {
            const [inicio, fim] = parte.split('-').map(n => parseInt(n.trim()));
            if (isNaN(inicio) || isNaN(fim) || inicio > fim) {
                showToast('Intervalo inválido', 'error');
                return;
            }
            for (let i = inicio; i <= fim; i++) {
                numeros.push(i);
            }
        } else {
            const num = parseInt(parte);
            if (isNaN(num)) {
                showToast('Número inválido', 'error');
                return;
            }
            numeros.push(num);
        }
    }
    
    const numerosExistentes = new Set(itens.map(i => i.numero));
    const duplicatas = numeros.filter(n => numerosExistentes.has(n));
    if (duplicatas.length > 0) {
        showToast(`Itens ${duplicatas.join(', ')} já existem — ignorados`, 'error');
        numeros = numeros.filter(n => !numerosExistentes.has(n));
        if (numeros.length === 0) return;
    }
    
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    let criados = 0;
    for (const numero of numeros) {
        const novoItem = payloadItemSeguro({ pregao_id: currentPregaoId, numero });
        try {
            const r = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novoItem) });
            if (r.ok) { itens.push(await r.json()); criados++; }
        } catch(e) { console.error(e); }
    }
    itens.sort((a, b) => a.numero - b.numero);
    renderItens();
    showToast('Item salvo', 'success');
}

function abrirModalExcluirItens() {
    const modal = document.getElementById('modalExcluirItens');
    if (modal) {
        document.getElementById('inputExcluirIntervalo').value = '';
        modal.classList.add('show');
    }
}

function fecharModalExcluirItens() {
    const modal = document.getElementById('modalExcluirItens');
    if (modal) modal.classList.remove('show');
}

async function confirmarExcluirItens() {
    const intervalo = document.getElementById('inputExcluirIntervalo').value.trim();
    fecharModalExcluirItens();
    
    if (!intervalo) {
        showToast('Digite um intervalo para excluir', 'error');
        return;
    }
    
    const numeros = parsearIntervalo(intervalo);
    if (!numeros) return;
    
    const idsParaExcluir = itens
        .filter(item => numeros.includes(item.numero))
        .map(item => item.id);
    
    if (idsParaExcluir.length === 0) {
        showToast('Nenhum item encontrado no intervalo informado', 'error');
        return;
    }
    
    await excluirItensPorIds(idsParaExcluir);
}

function parsearIntervalo(intervalo) {
    const numeros = [];
    const partes = intervalo.split(',').map(p => p.trim());
    
    for (const parte of partes) {
        if (parte.includes('-')) {
            const [inicio, fim] = parte.split('-').map(n => parseInt(n.trim()));
            if (isNaN(inicio) || isNaN(fim) || inicio > fim) {
                showToast('Intervalo inválido', 'error');
                return null;
            }
            for (let i = inicio; i <= fim; i++) numeros.push(i);
        } else {
            const num = parseInt(parte);
            if (isNaN(num)) {
                showToast('Número inválido', 'error');
                return null;
            }
            numeros.push(num);
        }
    }
    return numeros;
}

async function excluirItensPorIds(ids) {
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        
        const idsServidor = ids.filter(id => !id.startsWith('temp-'));
        
        if (idsServidor.length > 0) {
            const response = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens/delete-multiple`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ ids: idsServidor })
            });
            if (!response.ok) throw new Error('Erro ao excluir');
        }
        
        const idsSet = new Set(ids);
        itens = itens.filter(item => !idsSet.has(item.id));
        ids.forEach(id => selectedItens.delete(id));
        renderItens();
        showToast('Itens excluídos', 'success');
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao excluir itens', 'error');
    }
}

async function excluirItensSelecionados() {
    if (selectedItens.size === 0) {
        showToast('Selecione itens para excluir', 'error');
        return;
    }
    
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        
        const idsParaExcluir = Array.from(selectedItens).filter(id => !id.startsWith('temp-'));
        
        if (idsParaExcluir.length > 0) {
            const response = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/itens/delete-multiple`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify({ ids: idsParaExcluir })
            });
            
            if (!response.ok) throw new Error('Erro ao excluir');
        }
        
        itens = itens.filter(item => !selectedItens.has(item.id));
        selectedItens.clear();
        renderItens();
        showToast('Itens excluídos', 'success');
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao excluir itens', 'error');
    }
}

function editarItem(id) {
    const item = itens.find(i => i.id === id);
    if (!item) return;
    
    editingItemIndex = itens.indexOf(item);
    mostrarModalItem(item);
}

let currentItemTab = 0;
const itemTabs = ['item-tab-item', 'item-tab-fornecedor', 'item-tab-valores'];

function mostrarModalItem(item) {
    let modal = document.getElementById('modalItem');
    if (!modal) {
        modal = criarModalItem();
        document.body.appendChild(modal);
    }
    
    document.getElementById('itemNumero').value = item.numero;
    document.getElementById('itemDescricao').value = item.descricao;
    document.getElementById('itemQtd').value = item.qtd;
    document.getElementById('itemUnidade').value = item.unidade || 'UN';
    document.getElementById('itemMarca').value = item.marca || '';
    document.getElementById('itemModelo').value = item.modelo || '';
    document.getElementById('itemEstimadoUnt').value = item.estimado_unt || 0;
    document.getElementById('itemEstimadoTotal').value = item.estimado_total || 0;
    document.getElementById('itemCustoUnt').value = item.custo_unt || 0;
    document.getElementById('itemCustoTotal').value = item.custo_total || 0;
    document.getElementById('itemPorcentagem').value = item.porcentagem !== undefined ? item.porcentagem : 149;
    document.getElementById('itemVendaUnt').value = item.venda_unt || 0;
    document.getElementById('itemVendaTotal').value = item.venda_total || 0;
    
    // Resetar flag de edição manual
    const vendaUntInput = document.getElementById('itemVendaUnt');
    if (vendaUntInput) {
        vendaUntInput.dataset.manual = 'false';
    }
    
    modoNavegacaoGrupo = false;
    atualizarTituloModalItem(item);
    
    currentItemTab = 0;
    switchItemTab(itemTabs[0]);
    
    modal.classList.add('show');
    configurarCalculosAutomaticos();
    setTimeout(calcularValoresItem, 50);
    setTimeout(setupUpperCaseInputs, 50);
}

function atualizarTituloModalItem(item) {
    const totalItens = itens.length;
    const posicao = editingItemIndex + 1;
    
    const titleEl = document.getElementById('modalItemTitle');
    const prevPag = document.getElementById('btnPrevPagItem');
    const nextPag = document.getElementById('btnNextPagItem');
    
    if (titleEl) titleEl.textContent = `Item ${item.numero}`;
    if (prevPag) prevPag.style.visibility = editingItemIndex > 0 ? 'visible' : 'hidden';
    if (nextPag) nextPag.style.visibility = editingItemIndex < itens.length - 1 ? 'visible' : 'hidden';
}

function switchItemTab(tabId) {
    itemTabs.forEach((tab, idx) => {
        const el = document.getElementById(tab);
        const btn = document.querySelectorAll('#modalItem .tab-btn')[idx];
        if (el) el.classList.remove('active');
        if (btn) btn.classList.remove('active');
    });
    
    const activeEl = document.getElementById(tabId);
    const activeIdx = itemTabs.indexOf(tabId);
    const activeBtn = document.querySelectorAll('#modalItem .tab-btn')[activeIdx];
    
    if (activeEl) activeEl.classList.add('active');
    if (activeBtn) activeBtn.classList.add('active');
    
    currentItemTab = activeIdx;
    atualizarNavegacaoAbasItem();
}

function atualizarNavegacaoAbasItem() {
    const btnPrev   = document.getElementById('btnItemTabPrev');
    const btnNext   = document.getElementById('btnItemTabNext');
    const btnSalvar = document.getElementById('btnSalvarItem');
    const isLast = currentItemTab === itemTabs.length - 1;
    if (btnPrev)   btnPrev.style.display   = currentItemTab === 0 ? 'none' : 'inline-block';
    if (btnNext)   btnNext.style.display   = isLast ? 'none' : 'inline-block';
    if (btnSalvar) btnSalvar.style.display = isLast ? 'inline-block' : 'none';
}

function nextItemTab() {
    if (currentItemTab < itemTabs.length - 1) {
        currentItemTab++;
        switchItemTab(itemTabs[currentItemTab]);
    }
}

function prevItemTab() {
    if (currentItemTab > 0) {
        currentItemTab--;
        switchItemTab(itemTabs[currentItemTab]);
    }
}

function criarModalItem() {
    const modal = document.createElement('div');
    modal.id = 'modalItem';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content large" style="max-width: 680px; width: 90vw;">
            <div class="modal-header" style="align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <button id="btnPrevPagItem" onclick="navegarItemAnterior()" 
                            style="background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 1.1rem; padding: 0 0.25rem; visibility: hidden;">‹</button>
                    <h3 class="modal-title" id="modalItemTitle">Item</h3>
                    <button id="btnNextPagItem" onclick="navegarProximoItem()"
                            style="background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 1.1rem; padding: 0 0.25rem; visibility: hidden;">›</button>
                </div>
                <button class="close-modal" onclick="fecharModalItem()">✕</button>
            </div>
            
            <div class="tabs-container">
                <div class="tabs-nav">
                    <button class="tab-btn active" onclick="switchItemTab('item-tab-item')">Item</button>
                    <button class="tab-btn" onclick="switchItemTab('item-tab-fornecedor')">Fornecedor</button>
                    <button class="tab-btn" onclick="switchItemTab('item-tab-valores')">Valores</button>
                </div>
                
                <div class="tab-content active" id="item-tab-item">
                    <input type="hidden" id="itemNumero">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Quantidade *</label>
                            <input type="number" id="itemQtd" min="1" required>
                        </div>
                        <div class="form-group">
                            <label>Unidade *</label>
                            <select id="itemUnidade">
                                <option value="UN">UN</option>
                                <option value="MT">MT</option>
                                <option value="PÇ">PÇ</option>
                                <option value="CX">CX</option>
                                <option value="PT">PT</option>
                            </select>
                        </div>
                        <div class="form-group" style="grid-column: 1 / -1;">
                            <label>Descrição *</label>
                            <textarea id="itemDescricao" rows="4" required></textarea>
                        </div>
                    </div>
                </div>
                
                <div class="tab-content" id="item-tab-fornecedor">
                    <div class="form-grid">
                        <div class="form-group">
                            <label>Marca</label>
                            <input type="text" id="itemMarca">
                        </div>
                        <div class="form-group">
                            <label>Modelo</label>
                            <input type="text" id="itemModelo">
                        </div>
                    </div>
                </div>
                
                <div class="tab-content" id="item-tab-valores">
                    <div style="display: grid; grid-template-columns: 1fr; gap: 0.75rem; padding: 0.25rem 0;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">Porcentagem (%)</label>
                                <input type="number" id="itemPorcentagem" min="0" step="any" value="149" 
                                       style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); font-size:0.9rem; box-sizing:border-box;">
                            </div>
                            <div></div>
                            <div></div>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">Compra UNT</label>
                                <input type="number" id="itemEstimadoUnt" step="any" min="0"
                                       style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); font-size:0.9rem; box-sizing:border-box;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">Custo UNT</label>
                                <input type="number" id="itemCustoUnt" step="any" min="0"
                                       style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); font-size:0.9rem; box-sizing:border-box;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">Venda UNT</label>
                                <input type="number" id="itemVendaUnt" step="any" min="0"
                                       style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); font-size:0.9rem; box-sizing:border-box;">
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">Compra Total</label>
                                <input type="number" id="itemEstimadoTotal" step="any" min="0"
                                       style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); font-size:0.9rem; box-sizing:border-box;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">Custo Total</label>
                                <input type="number" id="itemCustoTotal" step="any" min="0"
                                       style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); font-size:0.9rem; box-sizing:border-box;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.8rem; font-weight:600; color:var(--text-secondary); display:block; margin-bottom:0.3rem;">Venda Total</label>
                                <input type="number" id="itemVendaTotal" step="any" min="0"
                                       style="width:100%; padding:0.55rem 0.75rem; border:1px solid var(--border-color); border-radius:6px; background:var(--bg-secondary); color:var(--text-primary); font-size:0.9rem; box-sizing:border-box;">
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div class="modal-actions">
                <button type="button" id="btnItemTabPrev" onclick="prevItemTab()" class="secondary" style="display: none;">Anterior</button>
                <button type="button" id="btnItemTabNext" onclick="nextItemTab()" class="secondary">Próximo</button>
                <button type="button" id="btnSalvarItem" onclick="salvarItemAtual()" class="success" style="display:none;">Salvar</button>
                <button type="button" onclick="fecharModalItem()" class="danger">Cancelar</button>
            </div>
        </div>
    `;
    return modal;
}

function calcularValoresItem() {
    const q = parseFloat(document.getElementById('itemQtd')?.value) || 0;
    const eu = parseFloat(document.getElementById('itemEstimadoUnt')?.value) || 0;
    const cu = parseFloat(document.getElementById('itemCustoUnt')?.value) || 0;
    const perc = parseFloat(document.getElementById('itemPorcentagem')?.value) || 0;
    
    const estimadoTotal = q * eu;
    const custoTotal = q * cu;
    
    // Campos de venda
    const vendaUntInput = document.getElementById('itemVendaUnt');
    const vendaTotalInput = document.getElementById('itemVendaTotal');
    
    // Verifica se o usuário editou manualmente (dataset.manual = 'true')
    const foiEditadoManual = vendaUntInput && vendaUntInput.dataset.manual === 'true';
    
    if (!foiEditadoManual) {
        // Se não foi editado manualmente, calcula automaticamente
        const vendaUnt = cu * (1 + perc / 100);
        if (vendaUntInput) {
            vendaUntInput.value = vendaUnt.toFixed(4).replace(/\.?0+$/, '');
        }
        if (vendaTotalInput) {
            vendaTotalInput.value = (vendaUnt * q).toFixed(2);
        }
    } else {
        // Se foi editado manualmente, só atualiza o total baseado no valor manual
        const vendaUnt = parseFloat(vendaUntInput.value) || 0;
        if (vendaTotalInput) {
            vendaTotalInput.value = (vendaUnt * q).toFixed(2);
        }
    }
    
    const etEl = document.getElementById('itemEstimadoTotal');
    const ctEl = document.getElementById('itemCustoTotal');
    
    if (etEl) etEl.value = estimadoTotal.toFixed(2);
    if (ctEl) ctEl.value = custoTotal.toFixed(2);
}

function configurarCalculosAutomaticos() {
    const modal = document.getElementById('modalItem');
    if (!modal) return;
    
    if (modal._calcListener) {
        modal.removeEventListener('input', modal._calcListener);
    }
    
    modal._calcListener = function(e) {
        const ids = ['itemQtd', 'itemEstimadoUnt', 'itemCustoUnt', 'itemPorcentagem', 'itemVendaUnt'];
        if (ids.includes(e.target.id)) {
            requestAnimationFrame(() => {
                calcularValoresItem();
            });
        }
    };
    
    modal.addEventListener('input', modal._calcListener);
    
    // Quando o usuário digitar no campo Venda Unitária, marca como manual
    const vendaUntInput = document.getElementById('itemVendaUnt');
    if (vendaUntInput) {
        vendaUntInput.addEventListener('input', function() {
            this.dataset.manual = 'true';
        });
    }
    
    const inputs = ['itemQtd', 'itemEstimadoUnt', 'itemCustoUnt', 'itemPorcentagem', 'itemVendaUnt'];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.removeEventListener('blur', calcularValoresItem);
            el.addEventListener('blur', calcularValoresItem);
        }
    });
}
    
function navegarItemAnterior() {
    if (modoNavegacaoGrupo) { navegarGrupoAnterior(); return; }
    if (editingItemIndex > 0) {
        salvarItemAtual(false);
        editingItemIndex--;
        mostrarModalItem(itens[editingItemIndex]);
    }
}

function navegarProximoItem() {
    if (modoNavegacaoGrupo) { navegarGrupoProximo(); return; }
    if (editingItemIndex < itens.length - 1) {
        salvarItemAtual(false);
        editingItemIndex++;
        mostrarModalItem(itens[editingItemIndex]);
    }
}

async function salvarItemAtual(fechar = true) {
    const item = itens[editingItemIndex];
    
    item.numero = parseInt(document.getElementById('itemNumero').value) || item.numero;
    item.descricao = toUpperCase(document.getElementById('itemDescricao').value);
    item.qtd = parseInt(document.getElementById('itemQtd').value);
    item.unidade = document.getElementById('itemUnidade').value;
    item.marca = toUpperCase(document.getElementById('itemMarca').value);
    item.modelo = toUpperCase(document.getElementById('itemModelo').value);
    item.estimado_unt = parseFloat(document.getElementById('itemEstimadoUnt').value || 0);
    item.estimado_total = parseFloat(document.getElementById('itemEstimadoTotal').value || 0);
    item.custo_unt = parseFloat(document.getElementById('itemCustoUnt').value || 0);
    item.custo_total = parseFloat(document.getElementById('itemCustoTotal').value || 0);
    item.porcentagem = parseFloat(document.getElementById('itemPorcentagem').value || 149);
    item.venda_unt = parseFloat(document.getElementById('itemVendaUnt').value || 0);
    item.venda_total = parseFloat(document.getElementById('itemVendaTotal').value || 0);
    
    // Se a venda unitária foi editada manualmente, recalcula a porcentagem
    if (item.custo_unt > 0) {
        item.porcentagem = ((item.venda_unt / item.custo_unt) - 1) * 100;
    }
    
    try {
        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        
        const isNew = item.id.startsWith('temp-');
        const url = isNew 
            ? `${API_URL}/licitacoes/${currentPregaoId}/itens`
            : `${API_URL}/licitacoes/${currentPregaoId}/itens/${item.id}`;
        const method = isNew ? 'POST' : 'PUT';
        
        const response = await fetch(url, {
            method: method,
            headers: headers,
            body: JSON.stringify(item)
        });
        
        if (response.ok) {
            const savedItem = await response.json();
            itens[editingItemIndex] = savedItem;
            if (fechar) {
                if (editandoGrupoIdx !== null) {
                    reconstruirGruposDeItens();
                    atualizarSelectsGrupos();
                    renderGrupos();
                } else {
                    atualizarMarcasItens();
                    renderItens();
                }
                showToast('Item salvo', 'success');
                fecharModalItemContexto();
            }
        }
    } catch (error) {
        console.error('Erro:', error);
        showToast('Erro ao salvar item', 'error');
    }
}

function fecharModalItem() {
    const modal = document.getElementById('modalItem');
    if (modal) modal.classList.remove('show');
    editingItemIndex = null;
    editandoGrupoIdx = null;
    editandoGrupoItemIdx = null;
    modoNavegacaoGrupo = false;
}

function fecharModalItemContexto() {
    fecharModalItem();
}

function syncItens() {
    carregarItens(currentPregaoId);
    showToast('Dados sincronizados', 'success');
}

function perguntarAssinaturaPDF() {
    if (!currentPregaoId) {
        showToast('Erro: Pregão não identificado', 'error');
        return;
    }
    const itensSelecionados = itens.filter(item => item.ganho);
    if (itensSelecionados.length === 0) {
        showToast('Marque ao menos um item (ganho) para gerar a proposta', 'error');
        return;
    }
    const modal = document.getElementById('modalAssinatura');
    if (modal) modal.classList.add('show');
}

function fecharModalAssinatura() {
    const modal = document.getElementById('modalAssinatura');
    if (modal) modal.classList.remove('show');
}

let fornecedoresDisponiveis = [];

function abrirModalCotacao() {
    const marcas = [...new Set(itens.filter(i => i.marca).map(i => i.marca))].sort();
    const select = document.getElementById('cotacaoFornecedor');
    select.innerHTML = '<option value="">Selecione...</option>' +
        marcas.map(m => `<option value="${m}">${m}</option>`).join('');
    document.getElementById('cotacaoTipo').value = 'descricao';
    document.getElementById('cotacaoMensagem').value = '';
    document.getElementById('modalCotacao').classList.add('show');
}

function fecharModalCotacao() {
    document.getElementById('modalCotacao').classList.remove('show');
}

function gerarMensagemCotacao() {
    const marca = document.getElementById('cotacaoFornecedor').value;
    const tipo = document.getElementById('cotacaoTipo').value;
    if (!marca) {
        document.getElementById('cotacaoMensagem').value = '';
        return;
    }
    const itensCotacao = itens.filter(item => item.marca === marca);
    if (itensCotacao.length === 0) {
        document.getElementById('cotacaoMensagem').value = 'Nenhum item com esta marca.';
        return;
    }
    const saudacao = obterSaudacao();
    let mensagem = `${saudacao}! \n\nSolicito, por gentileza, um orçamento para os itens mencionados a seguir:\n\n`;
    itensCotacao.forEach((item, idx) => {
        const numLista = idx + 1;
        if (tipo === 'descricao') {
            mensagem += `${numLista} - ${item.descricao}\n${item.qtd} ${item.unidade}\n\n`;
        } else {
            mensagem += `ITEM ${numLista} - ${item.modelo || item.descricao}\n${item.qtd} ${item.unidade}\n\n`;
        }
    });
    document.getElementById('cotacaoMensagem').value = mensagem;
}

function copiarMensagemCotacao() {
    const msg = document.getElementById('cotacaoMensagem').value;
    if (!msg) {
        showToast('Nenhuma mensagem para copiar', 'error');
        return;
    }
    navigator.clipboard.writeText(msg).then(() => {
        showToast('Mensagem copiada!', 'success');
    }).catch(() => {
        showToast('Erro ao copiar', 'error');
    });
}

function numeroPorExtenso(valor) {
    if (valor === 0) return 'ZERO REAIS';
    
    const unidades = ['', 'UM', 'DOIS', 'TRÊS', 'QUATRO', 'CINCO', 'SEIS', 'SETE', 'OITO', 'NOVE'];
    const dezenas = ['', 'DEZ', 'VINTE', 'TRINTA', 'QUARENTA', 'CINQUENTA', 'SESSENTA', 'SETENTA', 'OITENTA', 'NOVENTA'];
    const especiais = ['ONZE', 'DOZE', 'TREZE', 'CATORZE', 'QUINZE', 'DEZESSEIS', 'DEZESSETE', 'DEZOITO', 'DEZENOVE'];
    const centenas = ['', 'CENTO', 'DUZENTOS', 'TREZENTOS', 'QUATROCENTOS', 'QUINHENTOS', 'SEISCENTOS', 'SETECENTOS', 'OITOCENTOS', 'NOVECENTOS'];
    
    let inteiro = Math.floor(valor);
    let centavos = Math.round((valor - inteiro) * 100);
    
    function converterTresDigitos(num) {
        if (num === 0) return '';
        if (num === 100) return 'CEM';
        
        let resultado = [];
        let centena = Math.floor(num / 100);
        let resto = num % 100;
        
        if (centena > 0) {
            resultado.push(centenas[centena]);
        }
        
        if (resto > 0) {
            if (resto < 10) {
                resultado.push(unidades[resto]);
            } else if (resto < 20) {
                resultado.push(especiais[resto - 11]);
            } else {
                let dezena = Math.floor(resto / 10);
                let unidade = resto % 10;
                if (dezena > 0) {
                    resultado.push(dezenas[dezena]);
                }
                if (unidade > 0) {
                    resultado.push(unidades[unidade]);
                }
            }
        }
        
        return resultado.join(' E ');
    }
    
    let partes = [];
    
    if (inteiro > 0) {
        let milhares = Math.floor(inteiro / 1000);
        let restante = inteiro % 1000;
        
        if (milhares > 0) {
            if (milhares === 1) {
                partes.push('MIL');
            } else {
                let milharTexto = converterTresDigitos(milhares);
                partes.push(milharTexto + (milharTexto.endsWith('O') ? ' MIL' : ' MIL'));
            }
        }
        
        if (restante > 0) {
            partes.push(converterTresDigitos(restante));
        }
        
        let textoInteiro = partes.join(' E ');
        if (inteiro === 1) {
            textoInteiro = 'UM REAL';
        } else {
            textoInteiro += ' REAIS';
        }
        partes = [textoInteiro];
    }
    
    if (centavos > 0) {
        if (centavos === 1) {
            partes.push('UM CENTAVO');
        } else {
            partes.push(converterTresDigitos(centavos) + ' CENTAVOS');
        }
    }
    
    return partes.join(' E ');
}

// ============================================
// FUNÇÕES DO MODAL DE CONFIGURAÇÃO DA PROPOSTA
// ============================================
function abrirModalConfigProposta() {
    const modal = document.getElementById('modalConfigProposta');
    if (!modal) return;
    document.getElementById('configImpostoFederal').value = configProposta.impostoFederal;
    document.getElementById('configFreteVenda').value = configProposta.freteVenda;
    document.getElementById('configFreteCompra').value = configProposta.freteCompra;
    document.getElementById('configValidade').value = configProposta.validade;
    document.getElementById('configPrazoEntrega').value = configProposta.prazoEntrega;
    document.getElementById('configPrazoPagamento').value = configProposta.prazoPagamento;
    document.getElementById('configDadosBancarios').value = configProposta.dadosBancarios;
    document.getElementById('configAssinatura').value = configProposta.assinatura ? 'true' : 'false';
    modal.classList.add('show');
}

function fecharModalConfigProposta() {
    document.getElementById('modalConfigProposta').classList.remove('show');
}

function salvarConfigProposta() {
    configProposta.impostoFederal = parseFloat(document.getElementById('configImpostoFederal').value) || 9.7;
    configProposta.freteVenda = parseFloat(document.getElementById('configFreteVenda').value) || 5;
    configProposta.freteCompra = parseFloat(document.getElementById('configFreteCompra').value) || 0;
    configProposta.validade = document.getElementById('configValidade').value;
    configProposta.prazoEntrega = document.getElementById('configPrazoEntrega').value;
    configProposta.prazoPagamento = document.getElementById('configPrazoPagamento').value;
    configProposta.dadosBancarios = document.getElementById('configDadosBancarios').value;
    configProposta.assinatura = document.getElementById('configAssinatura').value === 'true';
    fecharModalConfigProposta();
    showToast('Configurações salvas', 'success');
}

// ============================================
// FUNÇÕES DE GERAÇÃO DE PDF DA PROPOSTA (usando configProposta)
// ============================================
async function gerarPDFsProposta(comAssinatura = true) {
    fecharModalAssinatura();
    if (!currentPregaoId) {
        showToast('Erro: Pregão não identificado', 'error');
        return;
    }
    
    const licitacao = licitacoes.find(l => l.id === currentPregaoId);
    if (!licitacao) {
        showToast('Erro: Licitação não encontrada', 'error');
        return;
    }
    
    const itensSelecionados = itens.filter(item => item.ganho);
    if (itensSelecionados.length === 0) {
        showToast('Marque ao menos um item (ganho) para gerar a proposta', 'error');
        return;
    }
    
    if (typeof window.jspdf === 'undefined') {
        let attempts = 0;
        const maxAttempts = 5;
        const checkInterval = setInterval(() => {
            attempts++;
            if (typeof window.jspdf !== 'undefined') {
                clearInterval(checkInterval);
                gerarPDFPropostaInterno(licitacao, comAssinatura);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                showToast('Erro: Biblioteca PDF não carregou. Recarregue a página (F5).', 'error');
            }
        }, 500);
        return;
    }
    
    gerarPDFPropostaInterno(licitacao, comAssinatura);
}

async function gerarPDFPropostaInterno(licitacao, comAssinatura = true) {
    let dadosBancarios = null;
    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        
        const response = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/dados-bancarios`, {
            method: 'GET',
            headers: headers
        });
        
        if (response.ok) {
            const data = await response.json();
            dadosBancarios = data.dados_bancarios;
        }
    } catch (error) {
        console.error('Erro ao buscar dados bancários:', error);
    }
    
    // Usar configurações salvas
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
  // ============================================
// FUNÇÃO COMPLETA DE GERAÇÃO DO PDF DA PROPOSTA
// ============================================
async function gerarPDFPropostaInterno(licitacao, comAssinatura = true) {
    let dadosBancarios = null;
    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        
        const response = await fetch(`${API_URL}/licitacoes/${currentPregaoId}/dados-bancarios`, {
            method: 'GET',
            headers: headers
        });
        
        if (response.ok) {
            const data = await response.json();
            dadosBancarios = data.dados_bancarios;
        }
    } catch (error) {
        console.error('Erro ao buscar dados bancários:', error);
    }

    // Usa as configurações salvas, mas permite sobrescrever com os valores do pregão se existirem
    const validade = configProposta.validade || licitacao.validade_proposta || '';
    const prazoEntrega = configProposta.prazoEntrega || licitacao.prazo_entrega || '';
    const prazoPagamento = configProposta.prazoPagamento || licitacao.prazo_pagamento || '';
    const dadosBancariosTexto = configProposta.dadosBancarios || dadosBancarios || '';
    const incluirAssinatura = configProposta.assinatura ? comAssinatura : false;

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    let y = 3;
    const margin = 15;
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const lineHeight = 5;
    const maxWidth = pageWidth - (2 * margin);

    // Função auxiliar para adicionar texto com quebra de linha
    function addTextWithWrap(text, x, yStart, maxW, lineH = 5) {
        const lines = doc.splitTextToSize(text, maxW);
        lines.forEach((line, index) => {
            if (yStart + (index * lineH) > pageHeight - 30) {
                yStart = addPageWithHeader();
            }
            doc.text(line, x, yStart + (index * lineH));
        });
        return yStart + (lines.length * lineH);
    }

    // Cabeçalho com logo (igual ao original)
    const logoHeader = new Image();
    logoHeader.crossOrigin = 'anonymous';
    logoHeader.src = 'I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';

    logoHeader.onload = function() {
        try {
            const logoWidth = 40;
            const logoHeight = (logoHeader.height / logoHeader.width) * logoWidth;
            const logoX = 5;
            const logoY = y;

            doc.setGState(new doc.GState({ opacity: 0.3 }));
            doc.addImage(logoHeader, 'PNG', logoX, logoY, logoWidth, logoHeight);
            doc.setGState(new doc.GState({ opacity: 1.0 }));

            const fontSize = logoHeight * 0.5;
            doc.setFontSize(fontSize);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(150, 150, 150);
            const textX = logoX + logoWidth + 1.2;
            const lineSpacing = fontSize * 0.5;
            const textY1 = logoY + fontSize * 0.85;
            doc.text('I.R COMÉRCIO E', textX, textY1);
            const textY2 = textY1 + lineSpacing;
            doc.text('MATERIAIS ELÉTRICOS LTDA', textX, textY2);
            doc.setTextColor(0, 0, 0);

            y = logoY + logoHeight + 8;

            continuarGeracaoPDFProposta(doc, licitacao, dadosBancariosTexto, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap, incluirAssinatura, validade, prazoEntrega, prazoPagamento);
        } catch (e) {
            console.log('Erro ao adicionar logo:', e);
            y = 25;
            continuarGeracaoPDFProposta(doc, licitacao, dadosBancariosTexto, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap, incluirAssinatura, validade, prazoEntrega, prazoPagamento);
        }
    };

    logoHeader.onerror = function() {
        console.log('Erro ao carregar logo, gerando PDF sem ela');
        y = 25;
        continuarGeracaoPDFProposta(doc, licitacao, dadosBancariosTexto, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap, incluirAssinatura, validade, prazoEntrega, prazoPagamento);
    };
}

function continuarGeracaoPDFProposta(doc, licitacao, dadosBancariosTexto, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap, comAssinatura, validade, prazoEntrega, prazoPagamento) {
    // Função para adicionar cabeçalho em novas páginas
    function adicionarCabecalho() {
        const logoHeaderImg = new Image();
        logoHeaderImg.crossOrigin = 'anonymous';
        logoHeaderImg.src = 'I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
        if (!logoHeaderImg.complete) {
            return 20; // fallback se a imagem não carregar
        }
        const headerY = 3;
        const logoWidth = 40;
        const logoHeight = (logoHeaderImg.height / logoHeaderImg.width) * logoWidth;
        const logoX = 5;
        doc.setGState(new doc.GState({ opacity: 0.3 }));
        doc.addImage(logoHeaderImg, 'PNG', logoX, headerY, logoWidth, logoHeight);
        doc.setGState(new doc.GState({ opacity: 1.0 }));
        const fontSize = logoHeight * 0.5;
        doc.setFontSize(fontSize);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(150, 150, 150);
        const textX = logoX + logoWidth + 1.2;
        const lineSpacing = fontSize * 0.5;
        const textY1 = headerY + fontSize * 0.85;
        doc.text('I.R COMÉRCIO E', textX, textY1);
        const textY2 = textY1 + lineSpacing;
        doc.text('MATERIAIS ELÉTRICOS LTDA', textX, textY2);
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        return headerY + logoHeight + 8;
    }

    function addPageWithHeader() {
        doc.addPage();
        return adicionarCabecalho();
    }

    function paginaCheia(yAtual, espaco = 40) {
        return yAtual > pageHeight - 30 - espaco;
    }

    // Título
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('PROPOSTA', pageWidth / 2, y, { align: 'center' });
    y += 8;
    doc.setFontSize(14);
    doc.text(`${licitacao.numero_pregao}${licitacao.uasg ? ' - ' + licitacao.uasg : ''}`, pageWidth / 2, y, { align: 'center' });
    y += 12;

    // Destinatário
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    doc.text('AO', margin, y);
    y += lineHeight + 1;
    if (licitacao.nome_orgao) {
        doc.setFont(undefined, 'bold');
        doc.text(toUpperCase(licitacao.nome_orgao), margin, y);
        doc.setFont(undefined, 'normal');
        y += lineHeight + 1;
    }
    doc.text('COMISSÃO PERMANENTE DE LICITAÇÃO', margin, y);
    y += lineHeight + 1;
    doc.text(`PREGÃO ELETRÔNICO: ${licitacao.numero_pregao}${licitacao.uasg ? '  UASG: ' + licitacao.uasg : ''}`, margin, y);
    y += 10;

    if (paginaCheia(y, 50)) y = addPageWithHeader();

    // Tabela de itens
    const itensSelecionados = itens.filter(item => item.ganho);
    const fmtValorPdf = (v, decimals = 2) => {
        return 'R$ ' + (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };
    const fmtUntPdf = (v) => {
        const n = v || 0;
        const s = n.toFixed(4).replace(/(\.(\d*?)?)0+$/, '$1').replace(/\.$/, '');
        return 'R$ ' + parseFloat(s || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
    };

    const tableWidth = pageWidth - (2 * margin);
    const colWidths = {
        item:     tableWidth * 0.05,
        descricao:tableWidth * 0.30,
        qtd:      tableWidth * 0.06,
        unid:     tableWidth * 0.05,
        marca:    tableWidth * 0.12,
        modelo:   tableWidth * 0.12,
        vunt:     tableWidth * 0.14,
        total:    tableWidth * 0.16
    };
    const itemRowHeight = 10;

    function desenharCabecalhoTabela() {
        doc.setFillColor(108, 117, 125);
        doc.setDrawColor(180, 180, 180);
        doc.rect(margin, y, tableWidth, itemRowHeight, 'FD');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'bold');
        let xp = margin;
        [
            ['ITEM', colWidths.item, 'center'],
            ['DESCRIÇÃO', colWidths.descricao, 'left'],
            ['QTD', colWidths.qtd, 'center'],
            ['UN', colWidths.unid, 'center'],
            ['MARCA', colWidths.marca, 'center'],
            ['MODELO', colWidths.modelo, 'center'],
            ['VD. UNT', colWidths.vunt, 'right'],
            ['VD. TOTAL', colWidths.total, 'right']
        ].forEach(([lbl, w, align]) => {
            doc.line(xp, y, xp, y + itemRowHeight);
            doc.text(lbl, xp + w / 2, y + 6.5, { align: align === 'center' ? 'center' : align === 'left' ? 'left' : 'right' });
            xp += w;
        });
        doc.line(xp, y, xp, y + itemRowHeight);
        y += itemRowHeight;
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(7.5);
        doc.setFont(undefined, 'normal');
    }

    function desenharLinhaItem(item, rowIndex) {
        const descricaoUpper = toUpperCase(item.descricao);
        const descLines = doc.splitTextToSize(descricaoUpper, colWidths.descricao - 4);
        const marcaWrap = doc.splitTextToSize(item.marca || '-', colWidths.marca - 2);
        const modeloWrap = doc.splitTextToSize(item.modelo || '-', colWidths.modelo - 2);
        const lineCount = Math.max(descLines.length, marcaWrap.length, modeloWrap.length);
        const rowH = Math.max(itemRowHeight, lineCount * 3.5 + 4);
        if (paginaCheia(y, rowH + 10)) {
            y = addPageWithHeader();
            desenharCabecalhoTabela();
        }
        const rowBg = (rowIndex % 2 === 0) ? [255,255,255] : [247,248,250];
        doc.setFillColor(...rowBg);
        doc.setDrawColor(180, 180, 180);
        doc.rect(margin, y, tableWidth, rowH, 'FD');
        let xp = margin;
        const cy = y + (rowH / 2) + 1.5;
        doc.line(xp, y, xp, y + rowH);
        doc.text(String(item.numero), xp + colWidths.item/2, cy, { align: 'center' });
        xp += colWidths.item; doc.line(xp, y, xp, y + rowH);
        let yt = y + 4; descLines.forEach(l => { doc.text(l, xp + 2, yt); yt += 3.5; });
        xp += colWidths.descricao; doc.line(xp, y, xp, y + rowH);
        doc.text(String(item.qtd || 1), xp + colWidths.qtd/2, cy, { align: 'center' });
        xp += colWidths.qtd; doc.line(xp, y, xp, y + rowH);
        doc.text(item.unidade || 'UN', xp + colWidths.unid/2, cy, { align: 'center' });
        xp += colWidths.unid; doc.line(xp, y, xp, y + rowH);
        let ym = y + 4; marcaWrap.forEach(ml => { doc.text(ml, xp + colWidths.marca/2, ym, { align:'center' }); ym += 3.5; });
        xp += colWidths.marca; doc.line(xp, y, xp, y + rowH);
        let ymo = y + 4; modeloWrap.forEach(ml => { doc.text(ml, xp + colWidths.modelo/2, ymo, { align:'center' }); ymo += 3.5; });
        xp += colWidths.modelo; doc.line(xp, y, xp, y + rowH);
        doc.text(fmtUntPdf(item.venda_unt), xp + colWidths.vunt/2, cy, { align: 'center' });
        xp += colWidths.vunt; doc.line(xp, y, xp, y + rowH);
        doc.text(fmtValorPdf(item.venda_total), xp + colWidths.total/2, cy, { align: 'center' });
        xp += colWidths.total; doc.line(xp, y, xp, y + rowH);
        y += rowH;
    }

    function desenharRodapeTabela(totalValor) {
        doc.setFillColor(240, 240, 240);
        doc.setFont(undefined, 'bold');
        doc.rect(margin, y, tableWidth, 8, 'FD');
        doc.text('TOTAL GERAL:', margin + tableWidth - colWidths.total - colWidths.vunt - 4, y + 5.5, { align: 'right' });
        doc.text(fmtValorPdf(totalValor), margin + tableWidth - 2, y + 5.5, { align: 'right' });
        doc.setFont(undefined, 'normal');
        y += 8;
    }

    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text('ITENS DA PROPOSTA', margin, y);
    y += 6;
    desenharCabecalhoTabela();
    itensSelecionados.forEach((item, index) => desenharLinhaItem(item, index));
    const totalGeral = itensSelecionados.reduce((acc, item) => acc + (item.venda_total || 0), 0);
    desenharRodapeTabela(totalGeral);

    y += 8;
    if (paginaCheia(y, 60)) y = addPageWithHeader();

    // Condições
    doc.setFontSize(10);
    function addCampoCondicao(label, valor) {
        if (!valor || valor.toString().trim() === '') return;
        doc.setFont(undefined, 'bold');
        const lw = doc.getTextWidth(label + ': ');
        doc.text(label + ': ', margin, y);
        doc.setFont(undefined, 'normal');
        const linhas = doc.splitTextToSize(valor.toString(), maxWidth - lw);
        doc.text(linhas[0], margin + lw, y);
        y += lineHeight;
        for (let i = 1; i < linhas.length; i++) {
            doc.text(linhas[i], margin, y);
            y += lineHeight;
        }
        y += 3;
    }

    const valorExtenso = numeroPorExtenso(totalGeral);
    addCampoCondicao('VALOR TOTAL DA PROPOSTA', `${fmtValorPdf(totalGeral)} (${valorExtenso})`);

    if (validade) addCampoCondicao('VALIDADE DA PROPOSTA', validade);
    if (prazoEntrega) addCampoCondicao('PRAZO DE ENTREGA', prazoEntrega);
    if (prazoPagamento) addCampoCondicao('FORMA DE PAGAMENTO', prazoPagamento);
    if (dadosBancariosTexto) addCampoCondicao('DADOS BANCÁRIOS', dadosBancariosTexto);

    y += 16;
    if (paginaCheia(y, 60)) y = addPageWithHeader();

    // Declarações padrão
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    const declaracoes = [
        'DECLARAMOS QUE NOS PREÇOS COTADOS ESTÃO INCLUÍDAS TODAS AS DESPESAS TAIS COMO FRETE (CIF), IMPOSTOS, TAXAS, SEGUROS, TRIBUTOS E DEMAIS ENCARGOS DE QUALQUER NATUREZA INCIDENTES SOBRE O OBJETO DO PREGÃO.',
        'DECLARAMOS QUE SOMOS OPTANTES PELO SIMPLES NACIONAL.',
        'DECLARAMOS QUE O OBJETO FORNECIDO NÃO É REMANUFATURADO OU RECONDICIONADO.'
    ];
    declaracoes.forEach(decl => {
        if (paginaCheia(y, 20)) y = addPageWithHeader();
        const linhas = doc.splitTextToSize(decl, maxWidth);
        linhas.forEach(linha => {
            if (paginaCheia(y, 10)) y = addPageWithHeader();
            doc.text(linha, pageWidth / 2, y, { align: 'center' });
            y += lineHeight;
        });
        y += 3;
    });
    y += 12;

    if (paginaCheia(y, 40)) y = addPageWithHeader();

    // Data atual
    const dataAtual = new Date();
    const dia = dataAtual.getDate();
    const meses = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO',
                   'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
    const mes = meses[dataAtual.getMonth()];
    const ano = dataAtual.getFullYear();
    doc.setFontSize(10);
    doc.setFont(undefined, 'normal');
    doc.text(`SERRA/ES, ${dia} DE ${mes} DE ${ano}`, pageWidth / 2, y, { align: 'center' });
    y += 5;

    // Assinatura (se solicitada)
    if (comAssinatura) {
        const assinatura = new Image();
        assinatura.crossOrigin = 'anonymous';
        assinatura.src = 'assinatura.png';
        assinatura.onload = function() {
            try {
                const imgWidth = 50;
                const imgHeight = (assinatura.height / assinatura.width) * imgWidth;
                doc.addImage(assinatura, 'PNG', (pageWidth / 2) - (imgWidth / 2), y + 2, imgWidth, imgHeight);
                let yFinal = y + imgHeight + 5;
                yFinal += 5;
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.text('ROSEMEIRE BICALHO DE LIMA GRAVINO', pageWidth / 2, yFinal, { align: 'center' });
                yFinal += 5;
                doc.setFontSize(9);
                doc.setFont(undefined, 'normal');
                doc.text('MG-10.078.568 / CPF: 045.160.616-78', pageWidth / 2, yFinal, { align: 'center' });
                yFinal += 5;
                doc.text('DIRETORA', pageWidth / 2, yFinal, { align: 'center' });
                finalizarPDF();
            } catch (e) {
                console.log('Erro ao adicionar assinatura:', e);
                gerarPDFSemAssinatura();
            }
        };
        assinatura.onerror = function() {
            console.log('Erro ao carregar assinatura, gerando PDF sem ela');
            gerarPDFSemAssinatura();
        };
    } else {
        gerarPDFSemAssinatura();
    }

    function gerarPDFSemAssinatura() {
        y += 20;
        doc.setDrawColor(0, 0, 0);
        doc.line(pageWidth / 2 - 40, y, pageWidth / 2 + 40, y);
        y += 5;
        doc.setFont(undefined, 'bold');
        doc.text('ROSEMEIRE BICALHO DE LIMA GRAVINO', pageWidth / 2, y, { align: 'center' });
        y += 5;
        doc.setFont(undefined, 'normal');
        doc.text('MG-10.078.568 / CPF: 045.160.616-78', pageWidth / 2, y, { align: 'center' });
        y += 5;
        doc.setFont(undefined, 'bold');
        doc.text('DIRETORA', pageWidth / 2, y, { align: 'center' });
        finalizarPDF();
    }

    function finalizarPDF() {
        // Rodapé
        const footerLines = [
            'I.R. COMÉRCIO E MATERIAIS ELÉTRICOS LTDA  |  CNPJ: 33.149.502/0001-38  |  IE: 083.780.74-2',
            'RUA TADORNA Nº 472, SALA 2, NOVO HORIZONTE – SERRA/ES  |  CEP: 29.163-318',
            'TELEFAX: (27) 3209-4291  |  E-MAIL: COMERCIAL.IRCOMERCIO@GMAIL.COM'
        ];
        const footerLineH = 5;
        const footerH = footerLines.length * footerLineH + 4;
        const totalPags = doc.internal.getNumberOfPages();
        for (let pg = 1; pg <= totalPags; pg++) {
            doc.setPage(pg);
            doc.setFontSize(8);
            doc.setFont(undefined, 'normal');
            doc.setTextColor(150, 150, 150);
            const fyBase = pageHeight - footerH + 2;
            footerLines.forEach((line, i) => {
                doc.text(line, pageWidth / 2, fyBase + (i * footerLineH), { align: 'center' });
            });
            doc.setTextColor(0, 0, 0);
        }
        const nomeArquivo = `PROPOSTA-${licitacao.numero_pregao}${licitacao.uasg ? '-' + licitacao.uasg : ''}.pdf`;
        doc.save(nomeArquivo);
        showToast('PDF gerado com sucesso!', 'success');
    }
}
