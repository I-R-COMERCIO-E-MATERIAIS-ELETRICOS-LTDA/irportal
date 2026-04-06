// CONFIGURAÇÃO PARA MONOREPO
const PORTAL_URL = 'https://irportal.onrender.com'; // usado apenas para redirecionamento de logout/erro
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:10000/api'
    : `${window.location.origin}/api`; // importante: usa o mesmo servidor do monorepo

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
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;

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
        
        if (wasOffline && isOnline) await loadLicitacoes();
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
    if (statusElement) statusElement.className = isOnline ? 'connection-status online' : 'connection-status offline';
}

function startPolling() {
    loadLicitacoes();
    setInterval(() => { if (isOnline) loadLicitacoes(); }, 10000);
}

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

async function loadLicitacoes() {
    if (!isOnline) return;
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;

    const mesFetch = isAllMonths ? null : currentMonth.getMonth() + 1;
    const anoFetch = isAllMonths ? null : currentMonth.getFullYear();

    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;

        let url = `${API_URL}/licitacoes`;
        if (!isAllMonths && mesFetch && anoFetch) url += `?mes=${mesFetch}&ano=${anoFetch}`;

        const response = await fetch(url, { method: 'GET', headers, mode: 'cors', signal });
        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        if (!response.ok) {
            console.error('❌ Erro ao carregar licitações:', response.status);
            return;
        }

        const data = await response.json();
        if ((isAllMonths && mesFetch !== null) || (!isAllMonths && (mesFetch !== currentMonth.getMonth()+1 || anoFetch !== currentMonth.getFullYear()))) return;

        licitacoes = data;
        atualizarStatusOcorridos();
        const newHash = JSON.stringify(licitacoes.map(l => l.id));
        if (newHash !== lastDataHash) {
            lastDataHash = newHash;
            updateDisplay();
        }
    } catch (error) {
        if (error.name !== 'AbortError') console.error('❌ Erro ao carregar:', error);
    } finally {
        if (currentFetchController && !currentFetchController.signal.aborted) currentFetchController = null;
    }
}

function atualizarStatusOcorridos() {
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    licitacoes.forEach(licitacao => {
        if (licitacao.status !== 'GANHO' && licitacao.data) {
            const dataLicitacao = new Date(licitacao.data + 'T00:00:00');
            if (dataLicitacao < hoje && licitacao.status !== 'OCORRIDO') licitacao.status = 'OCORRIDO';
        }
    });
}

async function syncData() {
    console.log('🔄 Iniciando sincronização...');
    if (!isOnline) { showToast('Erro ao sincronizar', 'error'); return; }

    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        let url = `${API_URL}/licitacoes`;
        if (!isAllMonths) url += `?mes=${currentMonth.getMonth()+1}&ano=${currentMonth.getFullYear()}`;

        const response = await fetch(url, { method: 'GET', headers, mode: 'cors', cache: 'no-cache', signal: controller.signal });
        clearTimeout(timeoutId);

        if (response.status === 401) {
            sessionStorage.removeItem('licitacoesSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        if (!response.ok) throw new Error(`Erro ao sincronizar: ${response.status}`);

        const data = await response.json();
        licitacoes = data;
        atualizarStatusOcorridos();
        lastDataHash = JSON.stringify(licitacoes.map(l => l.id));
        updateDisplay();
        showToast('Dados sincronizados', 'success');
    } catch (error) {
        if (error.name === 'AbortError') showToast('Timeout: Operação demorou muito', 'error');
        else showToast('Erro ao sincronizar', 'error');
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
    const abertos = licitacoes.filter(l => l.status === 'ABERTO').length;
    const ganhos = licitacoes.filter(l => l.status === 'GANHO').length;
    const ocorridos = licitacoes.filter(l => l.status === 'OCORRIDO').length;
    document.getElementById('totalLicitacoes').textContent = total;
    document.getElementById('totalAbertos').textContent = abertos;
    document.getElementById('totalGanhos').textContent = ganhos;
    document.getElementById('totalOcorridos').textContent = ocorridos;
}

function populateMonthFilter() {
    const select = document.getElementById('filterMes');
    if (!select) return;
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
    
    const filtered = licitacoes.filter(licitacao => {
        const matchSearch = !search || 
            toUpperCase(licitacao.responsavel).includes(search) ||
            toUpperCase(licitacao.numero_licitacao).includes(search) ||
            toUpperCase(licitacao.uasg || '').includes(search) ||
            toUpperCase(licitacao.nome_orgao || '').includes(search);
        const matchResp = !filterResp || licitacao.responsavel === filterResp;
        const matchStatus = !filterStatus || licitacao.status === filterStatus;
        return matchSearch && matchResp && matchStatus;
    });
    displayLicitacoes(filtered);
}

function displayLicitacoes(licitacoesToDisplay) {
    const container = document.getElementById('licitacoesContainer');
    if (!licitacoesToDisplay.length) {
        container.innerHTML = '<td><td colspan="8" style="text-align: center; padding: 2rem;">Nenhuma licitação encontrada</td></tr>';
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
                        <input type="checkbox" id="check-${licitacao.id}" ${checked} onchange="toggleGanho('${licitacao.id}', this.checked)" class="styled-checkbox">
                        <label for="check-${licitacao.id}" class="checkbox-label-styled"></label>
                    </div>
                </td>
                <td><strong>${licitacao.responsavel || '-'}</strong></td>
                <td>${dataFormatada}</td>
                <td>${hora}</td>
                <td><strong>${licitacao.numero_licitacao}</strong></td>
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

async function toggleGanho(id, ganho) {
    if (!isOnline) { showToast('Sistema offline. Não foi possível atualizar.', 'error'); loadLicitacoes(); return; }
    const licitacao = licitacoes.find(l => l.id === id);
    if (!licitacao) return;
    licitacao.ganho = ganho;
    if (ganho) licitacao.status = 'GANHO';
    else {
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        const dataLicitacao = new Date(licitacao.data + 'T00:00:00');
        licitacao.status = dataLicitacao < hoje ? 'OCORRIDO' : 'ABERTO';
    }
    
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) headers['X-Session-Token'] = sessionToken;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch(`${API_URL}/licitacoes/${id}`, {
            method: 'PUT', headers, body: JSON.stringify(licitacao), mode: 'cors', signal: controller.signal
        });
        clearTimeout(timeoutId);
        if (response.status === 401) { sessionStorage.removeItem('licitacoesSession'); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        if (!response.ok) throw new Error('Erro ao atualizar');
        updateDisplay();
        showToast(ganho ? `Licitação ${licitacao.numero_licitacao} ganha` : 'Marcação removida', ganho ? 'success' : 'error');
    } catch (error) {
        console.error(error);
        showToast(error.name === 'AbortError' ? 'Timeout' : 'Erro ao atualizar status', 'error');
        loadLicitacoes();
    }
}

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
    if (showCancelMessage) showToast('Registro cancelado', 'error');
}

function resetForm() {
    document.getElementById('responsavel').value = '';
    document.getElementById('dataLicitacao').value = '';
    document.getElementById('horaLicitacao').value = '';
    document.getElementById('numeroLicitacao').value = '';
    document.getElementById('uasg').value = '';
    document.getElementById('nomeOrgao').value = '';
    document.getElementById('municipio').value = '';
    document.getElementById('uf').value = '';
    document.getElementById('validadeProposta').value = '';
    document.getElementById('prazoEntrega').value = '';
    document.getElementById('prazoPagamento').value = '';
    document.getElementById('banco').value = '';
    document.getElementById('disputaPor').value = 'ITEM';
    
    document.getElementById('telefonesContainer').innerHTML = `<div class="input-with-button"><input type="text" class="telefone-input" placeholder="TELEFONE"><button type="button" onclick="addTelefone()" class="btn-add">+</button></div>`;
    document.getElementById('emailsContainer').innerHTML = `<div class="input-with-button"><input type="email" class="email-input" placeholder="E-MAIL"><button type="button" onclick="addEmail()" class="btn-add">+</button></div>`;
    detalhes = [];
    document.querySelectorAll('.detalhe-item').forEach(item => item.classList.remove('selected'));
}

function addTelefone() {
    const container = document.getElementById('telefonesContainer');
    const div = document.createElement('div');
    div.className = 'input-with-button';
    div.innerHTML = `<input type="text" class="telefone-input" placeholder="TELEFONE"><button type="button" onclick="removeTelefone(this)" class="btn-remove">−</button>`;
    container.appendChild(div);
    setupUpperCaseInputs();
}

function removeTelefone(btn) { btn.parentElement.remove(); }
function getTelefones() { return Array.from(document.querySelectorAll('.telefone-input')).map(i => i.value.trim()).filter(v => v !== ''); }

function addEmail() {
    const container = document.getElementById('emailsContainer');
    const div = document.createElement('div');
    div.className = 'input-with-button';
    div.innerHTML = `<input type="email" class="email-input" placeholder="E-MAIL"><button type="button" onclick="removeEmail(this)" class="btn-remove">−</button>`;
    container.appendChild(div);
}
function removeEmail(btn) { btn.parentElement.remove(); }
function getEmails() { return Array.from(document.querySelectorAll('.email-input')).map(i => i.value.trim().toUpperCase()).filter(v => v !== ''); }

function toggleDetalhe(element, nome) {
    element.classList.toggle('selected');
    const index = detalhes.indexOf(nome);
    if (index > -1) detalhes.splice(index, 1);
    else detalhes.push(nome);
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

function nextTab() { if (currentTab < tabs.length - 1) { currentTab++; switchTab(tabs[currentTab]); } }
function previousTab() { if (currentTab > 0) { currentTab--; switchTab(tabs[currentTab]); } }

async function salvarLicitacao() {
    const dataLicitacao = document.getElementById('dataLicitacao').value;
    const numeroLicitacao = toUpperCase(document.getElementById('numeroLicitacao').value);
    if (!dataLicitacao || !numeroLicitacao) { showToast('Preencha os campos obrigatórios (Data e Nº Licitação)', 'error'); return; }
    const responsavel = document.getElementById('responsavel').value;
    const licitacao = {
        responsavel: responsavel || null,
        data: dataLicitacao,
        hora: document.getElementById('horaLicitacao').value || null,
        numero_licitacao: numeroLicitacao,
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
    if (!isOnline) { showToast('Sistema offline', 'error'); closeFormModal(false); return; }
    try {
        const url = editingId ? `${API_URL}/licitacoes/${editingId}` : `${API_URL}/licitacoes`;
        const method = editingId ? 'PUT' : 'POST';
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        const response = await fetch(url, { method, headers, body: JSON.stringify(licitacao), mode: 'cors', signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.status === 401) { sessionStorage.removeItem('licitacoesSession'); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        if (!response.ok) throw new Error(`Erro ${response.status}`);
        const saved = await response.json();
        showToast(editingId ? `Licitação ${saved.numero_licitacao} atualizada` : `Licitação ${saved.numero_licitacao} registrada`, 'success');
        closeFormModal(false);
        await loadLicitacoes();
    } catch (error) {
        showToast(error.name === 'AbortError' ? 'Timeout' : `Erro: ${error.message}`, 'error');
    }
}

async function editLicitacao(id) {
    editingId = id;
    const licitacao = licitacoes.find(l => l.id === id);
    if (!licitacao) return;
    document.getElementById('formTitle').textContent = `Editar Licitação Nº ${licitacao.numero_licitacao}`;
    document.getElementById('responsavel').value = licitacao.responsavel;
    document.getElementById('dataLicitacao').value = licitacao.data;
    document.getElementById('horaLicitacao').value = licitacao.hora || '';
    document.getElementById('numeroLicitacao').value = licitacao.numero_licitacao;
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
    if (licitacao.telefones && licitacao.telefones.length) {
        licitacao.telefones.forEach((tel, index) => {
            const div = document.createElement('div');
            div.className = 'input-with-button';
            div.innerHTML = `<input type="text" class="telefone-input" placeholder="TELEFONE" value="${tel}"><button type="button" onclick="${index === 0 ? 'addTelefone()' : 'removeTelefone(this)'}" class="btn-${index === 0 ? 'add">+' : 'remove">−'}</button>`;
            telefonesContainer.appendChild(div);
        });
    } else {
        telefonesContainer.innerHTML = `<div class="input-with-button"><input type="text" class="telefone-input" placeholder="TELEFONE"><button type="button" onclick="addTelefone()" class="btn-add">+</button></div>`;
    }
    
    const emailsContainer = document.getElementById('emailsContainer');
    emailsContainer.innerHTML = '';
    if (licitacao.emails && licitacao.emails.length) {
        licitacao.emails.forEach((email, index) => {
            const div = document.createElement('div');
            div.className = 'input-with-button';
            div.innerHTML = `<input type="email" class="email-input" placeholder="E-MAIL" value="${email}"><button type="button" onclick="${index === 0 ? 'addEmail()' : 'removeEmail(this)'}" class="btn-${index === 0 ? 'add">+' : 'remove">−'}</button>`;
            emailsContainer.appendChild(div);
        });
    } else {
        emailsContainer.innerHTML = `<div class="input-with-button"><input type="email" class="email-input" placeholder="E-MAIL"><button type="button" onclick="addEmail()" class="btn-add">+</button></div>`;
    }
    
    detalhes = licitacao.detalhes || [];
    document.querySelectorAll('.detalhe-item').forEach(item => {
        item.classList.remove('selected');
        if (detalhes.includes(item.textContent)) item.classList.add('selected');
    });
    document.getElementById('formModal').classList.add('show');
    currentTab = 0;
    switchTab(tabs[0]);
    setupUpperCaseInputs();
}

function viewLicitacao(id) {
    const licitacao = licitacoes.find(l => l.id === id);
    if (!licitacao) return;
    document.getElementById('modalNumero').textContent = licitacao.numero_licitacao;
    document.getElementById('info-tab-geral').innerHTML = `<div class="info-section"><p><strong>Responsável:</strong> ${licitacao.responsavel}</p><p><strong>Data:</strong> ${licitacao.data ? new Date(licitacao.data + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}</p><p><strong>Hora:</strong> ${licitacao.hora || '-'}</p><p><strong>Disputa por:</strong> ${licitacao.disputa_por || 'ITEM'}</p><p><strong>Status:</strong> <span class="status-badge ${licitacao.status === 'GANHO' ? 'success' : licitacao.status === 'ABERTO' ? 'warning' : licitacao.status === 'OCORRIDO' ? 'danger' : 'default'}">${licitacao.status}</span></p></div>`;
    document.getElementById('info-tab-orgao').innerHTML = `<div class="info-section"><p><strong>Nº Licitação:</strong> ${licitacao.numero_licitacao}</p><p><strong>UASG:</strong> ${licitacao.uasg || '-'}</p><p><strong>Nome do Órgão:</strong> ${licitacao.nome_orgao || '-'}</p><p><strong>Município:</strong> ${licitacao.municipio || '-'}</p><p><strong>UF:</strong> ${licitacao.uf || '-'}</p></div>`;
    const telefonesHtml = licitacao.telefones && licitacao.telefones.length ? licitacao.telefones.map(t => `<p>• ${t}</p>`).join('') : '<p>-</p>';
    const emailsHtml = licitacao.emails && licitacao.emails.length ? licitacao.emails.map(e => `<p>• ${e}</p>`).join('') : '<p>-</p>';
    document.getElementById('info-tab-contato').innerHTML = `<div class="info-section"><h4>Telefones</h4>${telefonesHtml}</div><div class="info-section"><h4>E-mails</h4>${emailsHtml}</div>`;
    document.getElementById('info-tab-prazos').innerHTML = `<div class="info-section"><p><strong>Validade da Proposta:</strong> ${licitacao.validade_proposta || '-'}</p><p><strong>Prazo de Entrega:</strong> ${licitacao.prazo_entrega || '-'}</p><p><strong>Prazo de Pagamento:</strong> ${licitacao.prazo_pagamento || '-'}</p></div>`;
    const detalhesHtml = licitacao.detalhes && licitacao.detalhes.length ? licitacao.detalhes.map(d => `<p>✓ ${d}</p>`).join('') : '<p>Nenhum detalhe selecionado</p>';
    document.getElementById('info-tab-detalhes').innerHTML = `<div class="info-section"><h4>Detalhes Selecionados</h4>${detalhesHtml}</div><div class="info-section"><p><strong>Banco:</strong> ${licitacao.banco || '-'}</p></div>`;
    document.getElementById('infoModal').classList.add('show');
    currentInfoTab = 0;
    switchInfoTab(infoTabs[0]);
}

function closeInfoModal() { document.getElementById('infoModal').classList.remove('show'); }

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

function nextInfoTab() { if (currentInfoTab < infoTabs.length - 1) { currentInfoTab++; switchInfoTab(infoTabs[currentInfoTab]); } }
function previousInfoTab() { if (currentInfoTab > 0) { currentInfoTab--; switchInfoTab(infoTabs[currentInfoTab]); } }

function openDeleteModal(id) { deleteId = id; document.getElementById('deleteModal').classList.add('show'); }
function closeDeleteModal() { deleteId = null; document.getElementById('deleteModal').classList.remove('show'); }

async function confirmarExclusao() {
    closeDeleteModal();
    if (!isOnline) { showToast('Sistema offline. Não foi possível excluir.', 'error'); return; }
    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(`${API_URL}/licitacoes/${deleteId}`, { method: 'DELETE', headers, mode: 'cors', signal: controller.signal });
        clearTimeout(timeoutId);
        if (response.status === 401) { sessionStorage.removeItem('licitacoesSession'); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        if (!response.ok) throw new Error('Erro ao deletar');
        const licitacaoExcluida = licitacoes.find(l => l.id === deleteId);
        licitacoes = licitacoes.filter(l => l.id !== deleteId);
        lastDataHash = JSON.stringify(licitacoes.map(l => l.id));
        updateDisplay();
        showToast(`Licitação ${licitacaoExcluida?.numero_licitacao} excluída`, 'error');
    } catch (error) {
        showToast(error.name === 'AbortError' ? 'Timeout' : 'Erro ao excluir licitação', 'error');
    }
}

// ============================================
// GESTÃO DE ITENS E GRUPOS
// ============================================

let currentLicitacaoId = null;
let itens = [];
let editingItemIndex = null;
let selectedItens = new Set();
let currentItemsView = 'proposta';
let marcasItens = new Set();

let grupos = [];
let editandoGrupoIdx = null;
let editandoGrupoItemIdx = null;
let modoNavegacaoGrupo = false;

function mostrarTelaItens() {
    document.querySelector('.container').style.display = 'none';
    let telaItens = document.getElementById('telaItens');
    if (!telaItens) {
        telaItens = criarTelaItens();
        document.body.querySelector('.app-content').appendChild(telaItens);
    }
    telaItens.style.display = 'block';
    const licitacao = licitacoes.find(l => l.id === currentLicitacaoId);
    if (licitacao) {
        const tituloEl = document.getElementById('tituloItens');
        if (tituloEl) {
            const uasgPart = licitacao.uasg ? ` — UASG ${licitacao.uasg}` : '';
            tituloEl.textContent = `Licitação ${licitacao.numero_licitacao}${uasgPart}`;
        }
    }
}

function voltarLicitacoes() {
    document.getElementById('telaItens').style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    currentLicitacaoId = null;
    itens = [];
}

function criarTelaItens() {
    const div = document.createElement('div');
    div.id = 'telaItens';
    div.className = 'container';
    div.innerHTML = `
        <div class="header">
            <div class="header-left">
                <div>
                    <h1>Itens da Licitação</h1>
                    <p id="tituloItens" style="color: var(--text-secondary); font-size: 0.8rem; font-weight: 400; margin-top: 2px;"></p>
                </div>
            </div>
            <div style="display: flex; gap: 0.75rem; align-items:center;">
                <button onclick="adicionarItem()" style="background: #22C55E; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">+ Item</button>
                <button onclick="abrirModalIntervalo()" style="background: #6B7280; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">+ Intervalo</button>
                <button onclick="abrirModalExcluirItens()" style="background: #EF4444; color: white; border: none; padding: 0.65rem 1.25rem; border-radius: 8px; cursor: pointer; font-size: 0.9rem; font-weight: 600;">Excluir</button>
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
                
                <button onclick="abrirModalExequibilidade(currentLicitacaoId)" style="background: transparent; border: none; color: var(--text-secondary); cursor: pointer; padding: 0.5rem; display: flex; align-items: center;" title="Comprovante de Exequibilidade">
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

        <div class="modal-overlay" id="modalIntervalo">
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header"><h3 class="modal-title">Adicionar Intervalo</h3><button class="close-modal" onclick="fecharModalIntervalo()">✕</button></div>
                <div class="form-grid"><div class="form-group" style="grid-column:1/-1;"><label>Intervalo de itens <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10, 15-20)</span></label><input type="text" id="inputIntervalo" placeholder="Ex: 1-5, 10, 15-20"></div></div>
                <div class="modal-actions"><button class="secondary" onclick="fecharModalIntervalo();showToast('Registro cancelado','error')">Cancelar</button><button class="success" onclick="confirmarAdicionarIntervalo()">Adicionar</button></div>
            </div>
        </div>

        <div class="modal-overlay" id="modalExcluirItens">
            <div class="modal-content" style="max-width:520px;">
                <div class="modal-header"><h3 class="modal-title">Excluir Itens</h3><button class="close-modal" onclick="fecharModalExcluirItens()">✕</button></div>
                <div class="form-grid"><div class="form-group" style="grid-column:1/-1;"><label>Intervalo a excluir <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10)</span></label><input type="text" id="inputExcluirIntervalo" placeholder="Ex: 1-5, 10"></div></div>
                <div class="modal-actions"><button class="secondary" onclick="fecharModalExcluirItens();showToast('Registro cancelado','error')">Cancelar</button><button class="danger" onclick="confirmarExcluirItens()">Excluir</button></div>
            </div>
        </div>
    `;
    return div;
}

function criarModalItem() {
    const modal = document.createElement('div');
    modal.id = 'modalItem';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content large" style="max-width: 680px; width: 90vw;">
            <div class="modal-header" style="align-items: center;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <button id="btnPrevPagItem" onclick="navegarItemAnterior()" style="background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 1.1rem; padding: 0 0.25rem; visibility: hidden;">‹</button>
                    <h3 class="modal-title" id="modalItemTitle">Item</h3>
                    <button id="btnNextPagItem" onclick="navegarProximoItem()" style="background: none; border: none; cursor: pointer; color: var(--text-secondary); font-size: 1.1rem; padding: 0 0.25rem; visibility: hidden;">›</button>
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
                        <div class="form-group"><label>Quantidade *</label><input type="number" id="itemQtd" min="1" required></div>
                        <div class="form-group"><label>Unidade *</label><select id="itemUnidade"><option value="UN">UN</option><option value="MT">MT</option><option value="PÇ">PÇ</option><option value="CX">CX</option><option value="PT">PT</option></select></div>
                        <div class="form-group" style="grid-column: 1 / -1;"><label>Descrição *</label><textarea id="itemDescricao" rows="4" required></textarea></div>
                    </div>
                </div>
                <div class="tab-content" id="item-tab-fornecedor">
                    <div class="form-grid"><div class="form-group"><label>Marca</label><input type="text" id="itemMarca"></div><div class="form-group"><label>Modelo</label><input type="text" id="itemModelo"></div></div>
                </div>
                <div class="tab-content" id="item-tab-valores">
                    <div style="display: grid; grid-template-columns: 1fr; gap: 0.75rem; padding: 0.25rem 0;">
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                            <div class="form-group" style="margin:0;"><label>Porcentagem (%)</label><input type="number" id="itemPorcentagem" min="0" step="any" value="149"></div><div></div><div></div>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                            <div class="form-group" style="margin:0;"><label>Compra UNT</label><input type="number" id="itemEstimadoUnt" step="any" min="0"></div>
                            <div class="form-group" style="margin:0;"><label>Custo UNT</label><input type="number" id="itemCustoUnt" step="any" min="0"></div>
                            <div class="form-group" style="margin:0;"><label>Venda UNT</label><input type="number" id="itemVendaUnt" step="any" min="0"></div>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.75rem;">
                            <div class="form-group" style="margin:0;"><label>Compra Total</label><input type="number" id="itemEstimadoTotal" step="any" min="0"></div>
                            <div class="form-group" style="margin:0;"><label>Custo Total</label><input type="number" id="itemCustoTotal" step="any" min="0"></div>
                            <div class="form-group" style="margin:0;"><label>Venda Total</label><input type="number" id="itemVendaTotal" step="any" min="0"></div>
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

function mostrarTelaGrupos() {
    document.querySelector('.container').style.display = 'none';
    let telaGrupos = document.getElementById('telaGrupos');
    if (!telaGrupos) {
        telaGrupos = criarTelaGrupos();
        document.body.querySelector('.app-content').appendChild(telaGrupos);
    }
    telaGrupos.style.display = 'block';
    const licitacao = licitacoes.find(l => l.id === currentLicitacaoId);
    if (licitacao) {
        const el = document.getElementById('tituloGrupos');
        if (el) el.textContent = `Licitação ${licitacao.numero_licitacao}${licitacao.uasg ? ' — UASG ' + licitacao.uasg : ''}`;
    }
    carregarGrupos();
}

function voltarLicitacoesDeGrupos() {
    const tela = document.getElementById('telaGrupos');
    if (tela) tela.style.display = 'none';
    document.querySelector('.container').style.display = 'block';
    currentLicitacaoId = null;
    itens = [];
    grupos = [];
}

function criarTelaGrupos() {
    const div = document.createElement('div');
    div.id = 'telaGrupos';
    div.className = 'container';
    div.innerHTML = `
        <div class="header">
            <div class="header-left"><div><h1>Grupos da Licitação</h1><p id="tituloGrupos" style="color:var(--text-secondary);font-size:0.8rem;font-weight:400;margin-top:2px;"></p></div></div>
            <div style="display:flex;gap:0.75rem;align-items:center;">
                <button onclick="abrirModalNovoGrupo()" style="background:#22C55E;color:white;border:none;padding:0.65rem 1.25rem;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">+ Grupo</button>
                <button onclick="abrirModalIntervaloGrupos()" style="background:#6B7280;color:white;border:none;padding:0.65rem 1.25rem;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">+ Intervalo</button>
                <button onclick="abrirModalExcluirGrupo()" style="background:#EF4444;color:white;border:none;padding:0.65rem 1.25rem;border-radius:8px;cursor:pointer;font-size:0.9rem;font-weight:600;">Excluir</button>
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
                <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.35-4.35"></path></svg>
                <input type="text" id="searchGrupos" placeholder="Pesquisar grupos" oninput="renderGrupos()">
                <div class="search-bar-filters">
                    <div class="filter-dropdown-inline"><select id="filterGrupoGrupos" onchange="onChangeFilterGrupo()"><option value="">Grupo</option></select><svg class="dropdown-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                    <div class="filter-dropdown-inline"><select id="filterMarcaGrupos" onchange="renderGrupos()"><option value="">Marca</option></select><svg class="dropdown-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg></div>
                </div>
                <button onclick="abrirModalCotacao()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Cotação"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg></button>
                <button onclick="perguntarAssinaturaPDFGrupos()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Gerar Proposta PDF"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg></button>
                <button onclick="abrirModalExequibilidade(currentLicitacaoId)" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Comprovante de Exequibilidade"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="18" rx="2" ry="2"></rect><line x1="8" y1="9" x2="16" y2="9"></line><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="12" y2="17"></line></svg></button>
                <button onclick="syncGrupos()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Sincronizar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/></svg></button>
                <button onclick="voltarLicitacoesDeGrupos()" style="background:transparent;border:none;color:var(--text-secondary);cursor:pointer;padding:0.5rem;display:flex;align-items:center;" title="Voltar"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg></button>
            </div>
        </div>
        <div id="gruposWrapper" style="margin-top:0.5rem;"><div style="text-align:center;padding:3rem;color:var(--text-secondary);">Nenhum grupo cadastrado</div></div>
        <div class="modal-overlay" id="modalNovoGrupo"><div class="modal-content" style="max-width:520px;"><div class="modal-header"><h3 class="modal-title">Novo Grupo / Lote</h3><button class="close-modal" onclick="fecharModalNovoGrupo()">✕</button></div><div class="form-grid"><div class="form-group"><label>Tipo</label><select id="novoGrupoTipo"><option value="GRUPO">Grupo</option><option value="LOTE">Lote</option></select></div><div class="form-group"><label>Número</label><input type="number" id="novoGrupoNumero" min="1" placeholder="Nº do grupo"></div><div class="form-group" style="grid-column:1/-1;"><label>Itens do grupo <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10, 15-20)</span></label><input type="text" id="novoGrupoItens" placeholder="Ex: 1-5, 10, 15-20"></div></div><div class="modal-actions"><button class="secondary" onclick="fecharModalNovoGrupo();showToast('Registro cancelado','error')">Cancelar</button><button class="success" onclick="confirmarNovoGrupo()">Criar Grupo</button></div></div></div>
        <div class="modal-overlay" id="modalExcluirGrupo"><div class="modal-content" style="max-width:520px;"><div class="modal-header"><h3 class="modal-title">Excluir Grupo / Lote</h3><button class="close-modal" onclick="fecharModalExcluirGrupo()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn active">Selecionar</button></div><div class="tab-content active"><div class="form-grid"><div class="form-group" style="grid-column:1/-1;"><label>Selecione o grupo a excluir</label><select id="excluirGrupoSelect"><option value="">Selecione...</option></select></div></div></div></div><div class="modal-actions"><button class="danger" onclick="confirmarExcluirGrupo()">Excluir</button><button class="secondary" onclick="fecharModalExcluirGrupo()">Cancelar</button></div></div></div>
        <div class="modal-overlay" id="modalAssinaturaGrupos"><div class="modal-content modal-delete"><button class="close-modal" onclick="document.getElementById('modalAssinaturaGrupos').classList.remove('show')">✕</button><div class="modal-message-delete">Deseja incluir a assinatura padrão na proposta?</div><div class="modal-actions modal-actions-no-border"><button class="success" onclick="gerarPDFGruposComAssinatura(true)">Sim</button><button class="danger" onclick="gerarPDFGruposComAssinatura(false)">Não</button></div></div></div>
        <div class="modal-overlay" id="modalIntervaloGrupos"><div class="modal-content" style="max-width:600px;"><div class="modal-header"><h3 class="modal-title">Adicionar Grupos em Intervalo</h3><button class="close-modal" onclick="fecharModalIntervaloGrupos()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn active" onclick="switchIntervaloTab('intervalo-tab-config')">Configuração</button><button class="tab-btn" onclick="switchIntervaloTab('intervalo-tab-itens')">Itens</button></div><div class="tab-content active" id="intervalo-tab-config"><div class="form-grid"><div class="form-group"><label>Tipo</label><select id="intervGrupoTipo" onchange="atualizarLinhasIntervalo()"><option value="GRUPO">Grupo</option><option value="LOTE">Lote</option></select></div><div class="form-group"><label>Quantidade de grupos</label><input type="number" id="intervGrupoQtd" min="1" max="50" value="1" placeholder="Ex: 3" oninput="atualizarLinhasIntervalo()"></div></div></div><div class="tab-content" id="intervalo-tab-itens"><div id="intervGrupoLinhas" style="display:flex;flex-direction:column;gap:0.75rem;max-height:300px;overflow-y:auto;"></div></div></div><div class="modal-actions"><button type="button" id="btnIntervaloPrev" class="secondary" style="display:none;" onclick="prevIntervaloTab()">Anterior</button><button type="button" id="btnIntervaloNext" class="secondary" onclick="nextIntervaloTab()">Próximo</button><button type="button" id="btnIntervaloCriar" class="success" style="display:none;" onclick="confirmarIntervaloGrupos()">Criar Grupos</button><button type="button" class="danger" onclick="fecharModalIntervaloGrupos()">Cancelar</button></div></div></div>
    `;
    return div;
}

async function carregarItens(licitacaoId) {
    if (!isOnline) return;
    try {
        const headers = { 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        const response = await fetch(`${API_URL}/licitacoes/${licitacaoId}/itens`, { method: 'GET', headers });
        if (response.status === 401) { sessionStorage.removeItem('licitacoesSession'); mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
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
    for (const item of itens) if (item.marca) novas.add(item.marca);
    marcasItens = novas;
    const select = document.getElementById('filterMarcaItens');
    if (select) {
        const cur = select.value;
        select.innerHTML = '<option value="">Marca</option>' + Array.from(novas).sort().map(m => `<option value="${m}"${m===cur?' selected':''}>${m}</option>`).join('');
    }
}

function filterItens() {
    const search = document.getElementById('searchItens')?.value.toLowerCase() || '';
    const marca = document.getElementById('filterMarcaItens')?.value || '';
    const filtered = itens.filter(item => {
        const matchSearch = !search || (item.descricao || '').toLowerCase().includes(search) || (item.marca && item.marca.toLowerCase().includes(search)) || item.numero.toString().includes(search);
        const matchMarca = !marca || item.marca === marca;
        return matchSearch && matchMarca;
    });
    renderItens(filtered);
}

function fmtTotal(v) { return 'R$ ' + (v || 0).toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}); }
function fmtUnt(v) {
    const n = v || 0;
    if (n===0) return 'R$ 0,00';
    const s = n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:6});
    return 'R$ ' + s.replace(/,?0+$/, m => m===',00' ? ',00' : m.replace(/0+$/,'') || ',00');
}

function renderItens(itensToRender = itens) {
    const container = document.getElementById('itensContainer');
    if (!container) return;
    if (itensToRender.length === 0) { container.innerHTML = '<tr><td colspan="13" style="text-align:center;padding:2rem;">Nenhum item cadastrado</td></tr>'; return; }
    let totCompra=0, totCusto=0, totVenda=0;
    const parts = [];
    for (let idx=0; idx<itensToRender.length; idx++) {
        const item = itensToRender[idx];
        const vendaUnt = item.venda_unt || 0;
        const compraUnt = item.estimado_unt || 0;
        const estTotal = item.estimado_total || 0;
        const custoTotal = item.custo_total || 0;
        const vendaTotal = item.venda_total || 0;
        totCompra += estTotal; totCusto += custoTotal; totVenda += vendaTotal;
        const vm = compraUnt > 0 && vendaUnt > compraUnt;
        const rc = (item.ganho ? 'item-ganho row-won' : '') + (vm ? ' row-venda-alta' : '');
        const cbId = 'ig-'+item.id;
        const ck = item.ganho ? ' checked' : '';
        parts.push(`<tr class="${rc}" ondblclick="editarItem('${item.id}')" oncontextmenu="showItemContextMenu(event,'${item.id}')">
            <td style="text-align:center;padding:8px;"><div class="checkbox-wrapper"><input type="checkbox" id="${cbId}"${ck}${vm?' onclick="event.preventDefault();event.stopPropagation()"':' onchange="toggleItemGanho(\''+item.id+'\',this.checked)" onclick="event.stopPropagation()"} class="styled-checkbox${vm?' cb-venda-alta':''}"><label for="${cbId}" class="checkbox-label-styled${vm?' cb-label-venda-alta':''}">${vm?'✕':''}</label></div></td>
            <td style="text-align:center;"><strong>${item.numero}</strong></td>
            <td class="descricao-cell" style="text-align:left;">${item.descricao || '-'}</td>
            <td style="text-align:center;">${item.qtd || 1}</td>
            <td style="text-align:center;">${item.unidade || 'UN'}</td>
            <td style="text-align:center;vertical-align:middle;">${item.marca || '-'}</td>
            <td style="text-align:center;vertical-align:middle;">${item.modelo || '-'}</td>
            <td style="text-align:right;">${fmtUnt(compraUnt)}</td>
            <td style="text-align:right;">${fmtTotal(estTotal)}</td>
            <td style="text-align:right;">${fmtUnt(item.custo_unt || 0)}</td>
            <td style="text-align:right;">${fmtTotal(custoTotal)}</td>
            <td style="text-align:right;">${fmtUnt(vendaUnt)}</td>
            <td style="text-align:right;">${fmtTotal(vendaTotal)}</td>
        </tr>`);
    }
    container.innerHTML = parts.join('');
    const totaisContainer = document.getElementById('itensTotaisBar');
    if (totaisContainer) totaisContainer.innerHTML = `<span><strong>COMPRA TOTAL:</strong> ${fmtTotal(totCompra)}</span><span><strong>CUSTO TOTAL:</strong> ${fmtTotal(totCusto)}</span><span><strong>VENDA TOTAL:</strong> ${fmtTotal(totVenda)}</span>`;
}

function showItemContextMenu(event, itemId) {
    event.preventDefault();
    const existingMenu = document.getElementById('contextMenu');
    if (existingMenu) existingMenu.remove();
    const menu = document.createElement('div');
    menu.id = 'contextMenu';
    menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;background:white;border:1px solid #E5E7EB;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;min-width:150px;padding:0.5rem 0;`;
    menu.innerHTML = `<div onclick="excluirItemContexto('${itemId}')" style="padding:0.75rem 1rem;cursor:pointer;color:#EF4444;font-weight:500;display:flex;align-items:center;gap:0.5rem;" onmouseover="this.style.background='#FEE2E2'" onmouseout="this.style.background='white'"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Excluir</div>`;
    document.body.appendChild(menu);
    const closeMenu = () => { menu.remove(); document.removeEventListener('click', closeMenu); };
    setTimeout(() => document.addEventListener('click', closeMenu), 100);
}

async function excluirItemContexto(itemId) {
    try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        if (!itemId.startsWith('temp-')) {
            const response = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens/${itemId}`, { method: 'DELETE', headers });
            if (!response.ok) throw new Error('Erro ao excluir');
        }
        itens = itens.filter(item => item.id !== itemId);
        selectedItens.delete(itemId);
        renderItens();
        showToast('Item excluído', 'success');
    } catch (error) { console.error(error); showToast('Erro ao excluir item', 'error'); }
}

async function toggleItemGanho(id, ganho) {
    const item = itens.find(i => i.id === id);
    if (!item) return;
    item.ganho = ganho;
    const cb = document.getElementById('ig-'+id) || document.getElementById('grp-'+id);
    if (cb) {
        cb.checked = ganho;
        const row = cb.closest('tr');
        if (row) ganho ? row.classList.add('item-ganho','row-won') : row.classList.remove('item-ganho','row-won');
    }
    try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        if (!String(id).startsWith('temp-')) fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens/${id}`, { method: 'PUT', headers, body: JSON.stringify(item) }).catch(e => console.error('Erro ao salvar ganho:', e));
    } catch(e) { console.error(e); }
}

function payloadItemSeguro(fields) {
    return {
        licitacao_id: fields.licitacao_id,
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
        grupo_tipo: fields.grupo_tipo,
        grupo_numero: fields.grupo_numero
    };
}

async function adicionarItem() {
    const numero = itens.length > 0 ? Math.max(...itens.map(i => i.numero)) + 1 : 1;
    const novoItem = payloadItemSeguro({ licitacao_id: currentLicitacaoId, numero });
    try {
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if (sessionToken) headers['X-Session-Token'] = sessionToken;
        const r = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novoItem) });
        if (r.ok) { const saved = await r.json(); itens.push(saved); renderItens(); showToast('Item salvo', 'success'); }
        else throw new Error('Erro '+r.status);
    } catch(e) { console.error(e); showToast('Erro ao criar item', 'error'); }
}

function abrirModalIntervalo() { const m = document.getElementById('modalIntervalo'); if(m){ document.getElementById('inputIntervalo').value=''; m.classList.add('show'); } }
function fecharModalIntervalo() { const m = document.getElementById('modalIntervalo'); if(m) m.classList.remove('show'); showToast('Registro cancelado','error'); }
function confirmarAdicionarIntervalo() { const intervalo = document.getElementById('inputIntervalo').value.trim(); fecharModalIntervalo(); if(intervalo) adicionarIntervalo(intervalo); }

async function adicionarIntervalo(intervalo) {
    let numeros = [];
    const partes = intervalo.split(',').map(p=>p.trim());
    for(const parte of partes){
        if(parte.includes('-')){
            let [inicio,fim] = parte.split('-').map(n=>parseInt(n.trim()));
            if(isNaN(inicio)||isNaN(fim)||inicio>fim){ showToast('Intervalo inválido','error'); return; }
            for(let i=inicio;i<=fim;i++) numeros.push(i);
        } else {
            let num = parseInt(parte);
            if(isNaN(num)){ showToast('Número inválido','error'); return; }
            numeros.push(num);
        }
    }
    const numerosExistentes = new Set(itens.map(i=>i.numero));
    const duplicatas = numeros.filter(n=>numerosExistentes.has(n));
    if(duplicatas.length){ showToast(`Itens ${duplicatas.join(', ')} já existem — ignorados`,'error'); numeros = numeros.filter(n=>!numerosExistentes.has(n)); if(!numeros.length) return; }
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if(sessionToken) headers['X-Session-Token'] = sessionToken;
    let criados=0;
    for(const numero of numeros){
        const novoItem = payloadItemSeguro({ licitacao_id: currentLicitacaoId, numero });
        try{
            const r = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novoItem) });
            if(r.ok){ itens.push(await r.json()); criados++; }
        }catch(e){ console.error(e); }
    }
    itens.sort((a,b)=>a.numero-b.numero);
    renderItens();
    showToast('Item salvo','success');
}

function abrirModalExcluirItens() { const m = document.getElementById('modalExcluirItens'); if(m){ document.getElementById('inputExcluirIntervalo').value=''; m.classList.add('show'); } }
function fecharModalExcluirItens() { const m = document.getElementById('modalExcluirItens'); if(m) m.classList.remove('show'); }
async function confirmarExcluirItens() {
    const intervalo = document.getElementById('inputExcluirIntervalo').value.trim();
    fecharModalExcluirItens();
    if(!intervalo){ showToast('Digite um intervalo para excluir','error'); return; }
    const numeros = parsearIntervalo(intervalo);
    if(!numeros) return;
    const idsParaExcluir = itens.filter(item => numeros.includes(item.numero)).map(item=>item.id);
    if(idsParaExcluir.length===0){ showToast('Nenhum item encontrado no intervalo informado','error'); return; }
    await excluirItensPorIds(idsParaExcluir);
}

function parsearIntervalo(intervalo) {
    const numeros=[];
    const partes=intervalo.split(',').map(p=>p.trim());
    for(const parte of partes){
        if(parte.includes('-')){
            const [inicio,fim]=parte.split('-').map(n=>parseInt(n.trim()));
            if(isNaN(inicio)||isNaN(fim)||inicio>fim){ showToast('Intervalo inválido','error'); return null; }
            for(let i=inicio;i<=fim;i++) numeros.push(i);
        } else {
            const num=parseInt(parte);
            if(isNaN(num)){ showToast('Número inválido','error'); return null; }
            numeros.push(num);
        }
    }
    return numeros;
}

async function excluirItensPorIds(ids) {
    try{
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if(sessionToken) headers['X-Session-Token'] = sessionToken;
        const idsServidor = ids.filter(id=>!id.startsWith('temp-'));
        if(idsServidor.length){
            const response = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens/delete-multiple`, { method:'POST', headers, body:JSON.stringify({ ids: idsServidor }) });
            if(!response.ok) throw new Error('Erro ao excluir');
        }
        const idsSet = new Set(ids);
        itens = itens.filter(item=>!idsSet.has(item.id));
        ids.forEach(id=>selectedItens.delete(id));
        renderItens();
        showToast('Itens excluídos','success');
    }catch(error){ console.error(error); showToast('Erro ao excluir itens','error'); }
}

function editarItem(id) {
    const item = itens.find(i=>i.id===id);
    if(!item) return;
    editingItemIndex = itens.indexOf(item);
    mostrarModalItem(item);
}

function mostrarModalItem(item) {
    let modal = document.getElementById('modalItem');
    if(!modal){ modal = criarModalItem(); document.body.appendChild(modal); }
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
    const vendaUntInput = document.getElementById('itemVendaUnt');
    if(vendaUntInput) vendaUntInput.dataset.manual = 'false';
    modoNavegacaoGrupo = false;
    document.getElementById('modalItemTitle').textContent = `Item ${item.numero}`;
    const prevPag = document.getElementById('btnPrevPagItem');
    const nextPag = document.getElementById('btnNextPagItem');
    if(prevPag) prevPag.style.visibility = editingItemIndex > 0 ? 'visible' : 'hidden';
    if(nextPag) nextPag.style.visibility = editingItemIndex < itens.length-1 ? 'visible' : 'hidden';
    currentItemTab=0;
    switchItemTab('item-tab-item');
    modal.classList.add('show');
    configurarCalculosAutomaticos();
    setTimeout(calcularValoresItem,50);
    setTimeout(setupUpperCaseInputs,50);
}

let currentItemTab = 0;
const itemTabs = ['item-tab-item','item-tab-fornecedor','item-tab-valores'];

function switchItemTab(tabId){
    itemTabs.forEach((tab,idx)=>{
        const el = document.getElementById(tab);
        const btn = document.querySelectorAll('#modalItem .tab-btn')[idx];
        if(el) el.classList.remove('active');
        if(btn) btn.classList.remove('active');
    });
    const activeEl = document.getElementById(tabId);
    const activeIdx = itemTabs.indexOf(tabId);
    const activeBtn = document.querySelectorAll('#modalItem .tab-btn')[activeIdx];
    if(activeEl) activeEl.classList.add('active');
    if(activeBtn) activeBtn.classList.add('active');
    currentItemTab = activeIdx;
    const btnPrev = document.getElementById('btnItemTabPrev');
    const btnNext = document.getElementById('btnItemTabNext');
    const btnSalvar = document.getElementById('btnSalvarItem');
    const isLast = currentItemTab === itemTabs.length-1;
    if(btnPrev) btnPrev.style.display = currentItemTab===0 ? 'none' : 'inline-block';
    if(btnNext) btnNext.style.display = isLast ? 'none' : 'inline-block';
    if(btnSalvar) btnSalvar.style.display = isLast ? 'inline-block' : 'none';
}

function nextItemTab(){ if(currentItemTab < itemTabs.length-1){ currentItemTab++; switchItemTab(itemTabs[currentItemTab]); } }
function prevItemTab(){ if(currentItemTab > 0){ currentItemTab--; switchItemTab(itemTabs[currentItemTab]); } }
function navegarItemAnterior(){ if(editingItemIndex > 0){ salvarItemAtual(false); editingItemIndex--; mostrarModalItem(itens[editingItemIndex]); } }
function navegarProximoItem(){ if(editingItemIndex < itens.length-1){ salvarItemAtual(false); editingItemIndex++; mostrarModalItem(itens[editingItemIndex]); } }

function calcularValoresItem(){
    const q = parseFloat(document.getElementById('itemQtd')?.value) || 0;
    const eu = parseFloat(document.getElementById('itemEstimadoUnt')?.value) || 0;
    const cu = parseFloat(document.getElementById('itemCustoUnt')?.value) || 0;
    const perc = parseFloat(document.getElementById('itemPorcentagem')?.value) || 0;
    const estimadoTotal = q * eu;
    const custoTotal = q * cu;
    const vendaUntInput = document.getElementById('itemVendaUnt');
    const vendaTotalInput = document.getElementById('itemVendaTotal');
    const foiEditadoManual = vendaUntInput && vendaUntInput.dataset.manual === 'true';
    if(!foiEditadoManual && vendaUntInput){
        const vendaUnt = cu * (1 + perc / 100);
        vendaUntInput.value = vendaUnt.toFixed(4).replace(/\.?0+$/,'');
        if(vendaTotalInput) vendaTotalInput.value = (vendaUnt * q).toFixed(2);
    } else if(vendaUntInput && vendaTotalInput){
        const vendaUnt = parseFloat(vendaUntInput.value) || 0;
        vendaTotalInput.value = (vendaUnt * q).toFixed(2);
    }
    const etEl = document.getElementById('itemEstimadoTotal');
    const ctEl = document.getElementById('itemCustoTotal');
    if(etEl) etEl.value = estimadoTotal.toFixed(2);
    if(ctEl) ctEl.value = custoTotal.toFixed(2);
}

function configurarCalculosAutomaticos(){
    const modal = document.getElementById('modalItem');
    if(!modal) return;
    if(modal._calcListener) modal.removeEventListener('input',modal._calcListener);
    modal._calcListener = function(e){
        if(['itemQtd','itemEstimadoUnt','itemCustoUnt','itemPorcentagem','itemVendaUnt'].includes(e.target.id)) requestAnimationFrame(()=>calcularValoresItem());
    };
    modal.addEventListener('input',modal._calcListener);
    const vendaUntInput = document.getElementById('itemVendaUnt');
    if(vendaUntInput) vendaUntInput.addEventListener('input',function(){ this.dataset.manual = 'true'; });
    ['itemQtd','itemEstimadoUnt','itemCustoUnt','itemPorcentagem','itemVendaUnt'].forEach(id=>{
        const el = document.getElementById(id);
        if(el){ el.removeEventListener('blur',calcularValoresItem); el.addEventListener('blur',calcularValoresItem); }
    });
}

async function salvarItemAtual(fechar = true){
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
    if(item.custo_unt > 0) item.porcentagem = ((item.venda_unt / item.custo_unt) - 1) * 100;
    try{
        const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
        if(sessionToken) headers['X-Session-Token'] = sessionToken;
        const isNew = item.id.startsWith('temp-');
        const url = isNew ? `${API_URL}/licitacoes/${currentLicitacaoId}/itens` : `${API_URL}/licitacoes/${currentLicitacaoId}/itens/${item.id}`;
        const method = isNew ? 'POST' : 'PUT';
        const response = await fetch(url, { method, headers, body: JSON.stringify(item) });
        if(response.ok){
            const savedItem = await response.json();
            itens[editingItemIndex] = savedItem;
            if(fechar){
                if(editandoGrupoIdx !== null){
                    reconstruirGruposDeItens();
                    atualizarSelectsGrupos();
                    renderGrupos();
                } else {
                    atualizarMarcasItens();
                    renderItens();
                }
                showToast('Item salvo','success');
                fecharModalItem();
            }
        }
    }catch(error){ console.error(error); showToast('Erro ao salvar item','error'); }
}

function fecharModalItem(){
    const modal = document.getElementById('modalItem');
    if(modal) modal.classList.remove('show');
    editingItemIndex = null;
    editandoGrupoIdx = null;
    editandoGrupoItemIdx = null;
    modoNavegacaoGrupo = false;
}

function syncItens(){ carregarItens(currentLicitacaoId); showToast('Dados sincronizados','success'); }

// GRUPOS
async function carregarGrupos(){ await carregarItens(currentLicitacaoId); reconstruirGruposDeItens(); atualizarSelectsGrupos(); renderGrupos(); }
function reconstruirGruposDeItens(){
    const mapa = new Map();
    itens.forEach(item=>{
        if(!item.grupo_tipo || item.grupo_numero==null) return;
        const key = item.grupo_tipo+'-'+item.grupo_numero;
        if(!mapa.has(key)) mapa.set(key,{ tipo:item.grupo_tipo, numero:parseInt(item.grupo_numero), itens:[] });
        mapa.get(key).itens.push(item);
    });
    grupos = Array.from(mapa.values()).sort((a,b)=>a.numero-b.numero);
    grupos.forEach(g=>g.itens.sort((a,b)=>(a.numero||0)-(b.numero||0)));
}
function atualizarSelectsGrupos(){
    const gSel = document.getElementById('filterGrupoGrupos');
    if(!gSel) return;
    const cur = gSel.value;
    gSel.innerHTML = '<option value="">Grupo</option>'+grupos.map(g=>`<option value="${g.tipo}-${g.numero}">${g.tipo} ${g.numero}</option>`).join('');
    gSel.value = cur;
    onChangeFilterGrupo();
}
function onChangeFilterGrupo(){
    const gKey = document.getElementById('filterGrupoGrupos')?.value||'';
    const mSel = document.getElementById('filterMarcaGrupos');
    if(!mSel) return;
    const marcas = new Set();
    if(gKey){
        const g = grupoByKey(gKey);
        (g?.itens||[]).forEach(i=>{ if(i.marca) marcas.add(i.marca); });
    }
    mSel.innerHTML = '<option value="">Marca</option>'+Array.from(marcas).sort().map(m=>`<option value="${m}">${m}</option>`).join('');
    renderGrupos();
}
function grupoByKey(key){ const [tipo,num]=key.split('-'); return grupos.find(g=>g.tipo===tipo && String(g.numero)===num); }
function renderGrupos(){
    const wrapper = document.getElementById('gruposWrapper');
    if(!wrapper) return;
    const search = (document.getElementById('searchGrupos')?.value||'').toLowerCase();
    const gKey = document.getElementById('filterGrupoGrupos')?.value||'';
    const marcaFiltro = gKey ? (document.getElementById('filterMarcaGrupos')?.value||'') : '';
    let gruposRender = gKey ? [grupoByKey(gKey)].filter(Boolean) : grupos;
    if(!gruposRender.length){ wrapper.innerHTML='<div style="text-align:center;padding:3rem;color:var(--text-secondary);">Nenhum grupo cadastrado</div>'; return; }
    const cards=[];
    for(const grupo of gruposRender){
        let its = grupo.itens;
        if(marcaFiltro) its = its.filter(i=>i.marca===marcaFiltro);
        if(search) its = its.filter(i=>(i.descricao||'').toLowerCase().includes(search)||(i.marca||'').toLowerCase().includes(search)||String(i.numero).includes(search));
        const lbl = grupo.tipo+' '+grupo.numero;
        let totC=0, totCu=0, totV=0;
        const rowParts = [];
        const grupoAllGanho = grupo.itens.every(i=>i.ganho);
        for(let idx=0; idx<its.length; idx++){
            const item = its[idx];
            const vm = (item.venda_unt||0)>(item.estimado_unt||0) && (item.estimado_unt||0)>0;
            totC += item.estimado_total||0; totCu += item.custo_total||0; totV += item.venda_total||0;
            const rowClass = grupoAllGanho ? 'item-ganho row-won' : (vm ? 'row-venda-alta' : '');
            rowParts.push(`<tr class="${rowClass}" ondblclick="editarItemGrupoById('${item.id}')" oncontextmenu="showItemContextMenu(event,'${item.id}')">
                <td style="width:60px;text-align:center;"><strong>${item.numero}</strong></td>
                <td class="descricao-cell" style="min-width:350px;text-align:left;">${item.descricao||'-'}</td>
                <td style="width:80px;text-align:center;">${item.qtd||1}</td>
                <td style="width:80px;text-align:center;">${item.unidade||'UN'}</td>
                <td style="width:120px;text-align:center;vertical-align:middle;">${item.marca||'-'}</td>
                <td style="width:120px;text-align:center;vertical-align:middle;">${item.modelo||'-'}</td>
                <td style="width:120px;text-align:right;">${fmtTotal(item.estimado_total||0)}</td>
                <td style="width:120px;text-align:right;">${fmtTotal(item.custo_total||0)}</td>
                <td style="width:120px;text-align:right;">${fmtUnt(item.venda_unt||0)}</td>
                <td style="width:120px;text-align:right;">${fmtTotal(item.venda_total||0)}</td>
            </tr>`);
        }
        const grupoGanho = grupo.itens.length>0 && grupo.itens.every(i=>i.ganho);
        const grupoGanhoId = 'grp-ganho-'+grupo.tipo+'-'+grupo.numero;
        const grupoGanhoChk = grupoGanho ? ' checked' : '';
        cards.push(`<div class="card table-card" style="margin-bottom:0.5rem;"><div style="background:#1e3a5f;display:flex;align-items:center;justify-content:center;padding:8px 14px;border-radius:8px 8px 0 0;gap:0.75rem;position:relative;"><div class="checkbox-wrapper" style="position:absolute; left:14px;"><input type="checkbox" id="${grupoGanhoId}"${grupoGanhoChk} onchange="toggleGrupoGanho('${grupo.tipo}',${grupo.numero},this.checked)" class="styled-checkbox"><label for="${grupoGanhoId}" class="checkbox-label-styled"></label></div><label for="${grupoGanhoId}" style="font-weight:700;font-size:1rem;color:#fff;cursor:pointer;margin:0;text-align:center;">${lbl}</label></div><div style="overflow-x:auto;"><table style="min-width:1260px;border-collapse:collapse;width:100%;"><thead><tr><th style="width:60px;text-align:center;">ITEM</th><th style="min-width:350px;text-align:left;">DESCRIÇÃO</th><th style="width:80px;text-align:center;">QTD</th><th style="width:80px;text-align:center;">UN</th><th style="width:120px;text-align:center;">MARCA</th><th style="width:120px;text-align:center;">MODELO</th><th style="width:120px;text-align:right;">COMPRA TOTAL</th><th style="width:120px;text-align:right;">CUSTO TOTAL</th><th style="width:120px;text-align:right;">VENDA UNT</th><th style="width:120px;text-align:right;">VENDA TOTAL</th></tr></thead><tbody>${rowParts.join('')}</tbody></table></div></div><div style="display:flex;gap:3rem;padding:1rem 1rem 0.25rem 1rem;font-size:10pt;color:var(--text-primary);margin-top:0.5rem;margin-bottom:1.5rem;"><span><strong>COMPRA TOTAL:</strong> ${fmtTotal(totC)}</span><span><strong>CUSTO TOTAL:</strong> ${fmtTotal(totCu)}</span><span><strong>VENDA TOTAL:</strong> ${fmtTotal(totV)}</span></div>`);
    }
    wrapper.innerHTML = cards.join('');
}
function abrirModalNovoGrupo(){
    const maxN = grupos.reduce((m,g)=>Math.max(m,g.numero),0);
    document.getElementById('novoGrupoNumero').value = maxN+1;
    document.getElementById('novoGrupoItens').value = '';
    document.getElementById('novoGrupoTipo').value = 'GRUPO';
    document.getElementById('modalNovoGrupo').classList.add('show');
}
function fecharModalNovoGrupo(){ document.getElementById('modalNovoGrupo').classList.remove('show'); }
async function confirmarNovoGrupo(){
    const tipo = document.getElementById('novoGrupoTipo').value;
    const numero = parseInt(document.getElementById('novoGrupoNumero').value);
    const itensStr = document.getElementById('novoGrupoItens').value.trim();
    if(!numero || !itensStr){ showToast('Preencha número e itens do grupo','error'); return; }
    const numeros = parsearIntervalo(itensStr);
    if(!numeros || numeros.length===0) return;
    fecharModalNovoGrupo();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if(sessionToken) headers['X-Session-Token'] = sessionToken;
    for(const numItem of numeros){
        const jaExiste = itens.find(i=>i.grupo_tipo===tipo && i.grupo_numero===numero && i.numero===numItem);
        if(jaExiste) continue;
        const novo = payloadItemSeguro({ licitacao_id: currentLicitacaoId, numero:numItem, descricao:'', qtd:1, unidade:'UN', marca:'', modelo:'', estimado_unt:0, estimado_total:0, custo_unt:0, custo_total:0, porcentagem:149, venda_unt:0, venda_total:0, ganho:false, grupo_tipo:tipo, grupo_numero:numero });
        try{
            const r = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novo) });
            if(r.ok) itens.push(await r.json());
        }catch(e){ console.error(e); }
    }
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
    const grupoNovo = grupos.find(g=>g.tipo===tipo && g.numero===numero);
    if(grupoNovo && grupoNovo.itens.length>0){ showToast('Grupo criado','success'); abrirEdicaoGrupoItem(grupoNovo,0); }
}
function abrirEdicaoGrupoItem(grupo, idxItem){
    editandoGrupoIdx = grupos.indexOf(grupo);
    editandoGrupoItemIdx = idxItem;
    const item = grupo.itens[idxItem];
    editingItemIndex = itens.indexOf(item);
    mostrarModalItemGrupo(item,grupo,idxItem);
}
function editarItemGrupoById(itemId){
    const item = itens.find(i=>i.id===itemId);
    if(!item) return;
    const grupo = grupos.find(g=>g.itens.includes(item));
    if(!grupo){ editingItemIndex = itens.indexOf(item); mostrarModalItem(item); return; }
    const idxItem = grupo.itens.indexOf(item);
    abrirEdicaoGrupoItem(grupo, idxItem);
}
function mostrarModalItemGrupo(item,grupo,idxItem){
    let modal = document.getElementById('modalItem');
    if(!modal){ modal = criarModalItem(); document.body.appendChild(modal); }
    document.getElementById('itemNumero').value = item.numero||'';
    document.getElementById('itemDescricao').value = item.descricao||'';
    document.getElementById('itemQtd').value = item.qtd||1;
    document.getElementById('itemUnidade').value = item.unidade||'UN';
    document.getElementById('itemMarca').value = item.marca||'';
    document.getElementById('itemModelo').value = item.modelo||'';
    document.getElementById('itemEstimadoUnt').value = item.estimado_unt||'';
    document.getElementById('itemEstimadoTotal').value = item.estimado_total||'';
    document.getElementById('itemCustoUnt').value = item.custo_unt||'';
    document.getElementById('itemCustoTotal').value = item.custo_total||'';
    document.getElementById('itemPorcentagem').value = item.porcentagem??149;
    document.getElementById('itemVendaUnt').value = item.venda_unt||'';
    document.getElementById('itemVendaTotal').value = item.venda_total||'';
    const vendaUntInput = document.getElementById('itemVendaUnt');
    if(vendaUntInput) vendaUntInput.dataset.manual = 'false';
    const tituloEl = document.getElementById('modalItemTitle');
    if(tituloEl) tituloEl.textContent = `Item ${item.numero}`;
    const btnPrev = document.getElementById('btnPrevPagItem');
    const btnNext = document.getElementById('btnNextPagItem');
    const temAnterior = idxItem>0 || editandoGrupoIdx>0;
    const temProximo = idxItem<grupo.itens.length-1 || editandoGrupoIdx<grupos.length-1;
    if(btnPrev) btnPrev.style.visibility = temAnterior ? 'visible' : 'hidden';
    if(btnNext) btnNext.style.visibility = temProximo ? 'visible' : 'hidden';
    modoNavegacaoGrupo = true;
    currentItemTab=0;
    switchItemTab(itemTabs[0]);
    modal.classList.add('show');
    configurarCalculosAutomaticos();
    setTimeout(calcularValoresItem,50);
    setTimeout(setupUpperCaseInputs,50);
}
async function navegarGrupoAnterior(){
    await salvarItemAtual(false);
    let gi=editandoGrupoIdx, ii=editandoGrupoItemIdx-1;
    if(ii<0){ gi--; if(gi<0) return; ii=grupos[gi].itens.length-1; }
    editandoGrupoIdx=gi; editandoGrupoItemIdx=ii;
    const grupo = grupos[gi];
    editingItemIndex = itens.indexOf(grupo.itens[ii]);
    mostrarModalItemGrupo(grupo.itens[ii],grupo,ii);
}
async function navegarGrupoProximo(){
    await salvarItemAtual(false);
    let gi=editandoGrupoIdx, ii=editandoGrupoItemIdx+1;
    if(ii>=grupos[gi].itens.length){ gi++; if(gi>=grupos.length) return; ii=0; }
    editandoGrupoIdx=gi; editandoGrupoItemIdx=ii;
    const grupo = grupos[gi];
    editingItemIndex = itens.indexOf(grupo.itens[ii]);
    mostrarModalItemGrupo(grupo.itens[ii],grupo,ii);
}
function abrirModalExcluirGrupo(){
    const sel = document.getElementById('excluirGrupoSelect');
    if(!sel) return;
    sel.innerHTML = '<option value="">Selecione...</option>'+grupos.map(g=>`<option value="${g.tipo}-${g.numero}">${g.tipo} ${g.numero} (${g.itens.length} item(s))</option>`).join('');
    document.getElementById('modalExcluirGrupo').classList.add('show');
}
function fecharModalExcluirGrupo(){ document.getElementById('modalExcluirGrupo').classList.remove('show'); }
async function confirmarExcluirGrupo(){
    const val = document.getElementById('excluirGrupoSelect').value;
    if(!val){ showToast('Selecione um grupo','error'); return; }
    const grupo = grupoByKey(val);
    if(!grupo) return;
    fecharModalExcluirGrupo();
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if(sessionToken) headers['X-Session-Token'] = sessionToken;
    const ids = grupo.itens.map(i=>i.id).filter(id=>!String(id).startsWith('temp-'));
    for(const id of ids){
        try{ await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens/${id}`, { method:'DELETE', headers }); }catch(e){}
    }
    itens = itens.filter(i=>!(i.grupo_tipo===grupo.tipo && i.grupo_numero===grupo.numero));
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
    showToast('Grupo excluído','error');
}
const intervaloTabs = ['intervalo-tab-config','intervalo-tab-itens'];
let currentIntervaloTab=0;
function switchIntervaloTab(tabId){
    const allTabs = document.querySelectorAll('#modalIntervaloGrupos .tab-content');
    const allBtns = document.querySelectorAll('#modalIntervaloGrupos .tab-btn');
    allTabs.forEach(t=>t.classList.remove('active'));
    allBtns.forEach(b=>b.classList.remove('active'));
    const active = document.getElementById(tabId);
    if(active) active.classList.add('active');
    currentIntervaloTab = intervaloTabs.indexOf(tabId);
    if(allBtns[currentIntervaloTab]) allBtns[currentIntervaloTab].classList.add('active');
    const isLast = currentIntervaloTab === intervaloTabs.length-1;
    const prev = document.getElementById('btnIntervaloPrev');
    const next = document.getElementById('btnIntervaloNext');
    const criar = document.getElementById('btnIntervaloCriar');
    if(prev) prev.style.display = currentIntervaloTab===0 ? 'none' : 'inline-block';
    if(next) next.style.display = isLast ? 'none' : 'inline-block';
    if(criar) criar.style.display = isLast ? 'inline-block' : 'none';
}
function nextIntervaloTab(){ if(currentIntervaloTab < intervaloTabs.length-1){ currentIntervaloTab++; switchIntervaloTab(intervaloTabs[currentIntervaloTab]); } }
function prevIntervaloTab(){ if(currentIntervaloTab > 0){ currentIntervaloTab--; switchIntervaloTab(intervaloTabs[currentIntervaloTab]); } }
function abrirModalIntervaloGrupos(){
    document.getElementById('intervGrupoTipo').value = 'GRUPO';
    document.getElementById('intervGrupoQtd').value = 1;
    atualizarLinhasIntervalo();
    switchIntervaloTab('intervalo-tab-config');
    document.getElementById('modalIntervaloGrupos').classList.add('show');
}
function fecharModalIntervaloGrupos(){ document.getElementById('modalIntervaloGrupos').classList.remove('show'); }
function atualizarLinhasIntervalo(){
    const tipo = document.getElementById('intervGrupoTipo').value;
    const qtd = parseInt(document.getElementById('intervGrupoQtd').value)||1;
    const container = document.getElementById('intervGrupoLinhas');
    const maxN = grupos.reduce((m,g)=>Math.max(m,g.numero),0);
    let html='';
    for(let i=0;i<qtd;i++){
        const n = maxN+i+1;
        html+=`<div style="display:grid;grid-template-columns:auto 1fr 2fr;gap:0.75rem;align-items:end;padding:0.75rem;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border-color);">
            <div style="font-weight:700;font-size:0.9rem;color:var(--primary);white-space:nowrap;">${tipo} ${n}</div>
            <div class="form-group" style="margin:0;"><label style="font-size:0.8rem;">Número</label><input type="number" class="ig-numero" value="${n}" min="1" style="width:100%;padding:0.5rem 0.65rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-primary);font-size:0.9rem;"></div>
            <div class="form-group" style="margin:0;"><label style="font-size:0.8rem;">Itens (ex: 1-5, 10)</label><input type="text" class="ig-itens" placeholder="Ex: 1-5, 10" style="width:100%;padding:0.5rem 0.65rem;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-primary);font-size:0.9rem;"></div>
        </div>`;
    }
    container.innerHTML = html;
}
async function confirmarIntervaloGrupos(){
    const tipo = document.getElementById('intervGrupoTipo').value;
    const linhas = document.getElementById('intervGrupoLinhas').querySelectorAll('div[style*="grid"]');
    if(linhas.length===0){ showToast('Adicione ao menos um grupo','error'); return; }
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if(sessionToken) headers['X-Session-Token'] = sessionToken;
    let totalCriados=0;
    fecharModalIntervaloGrupos();
    for(const linha of linhas){
        const numGrupo = parseInt(linha.querySelector('.ig-numero').value);
        const itensStr = linha.querySelector('.ig-itens').value.trim();
        if(!numGrupo || !itensStr) continue;
        const numerosItens = parsearIntervalo(itensStr);
        if(!numerosItens) continue;
        for(const numItem of numerosItens){
            const jaExiste = itens.find(i=>i.grupo_tipo===tipo && i.grupo_numero===numGrupo && String(i.numero)===String(numItem));
            if(jaExiste) continue;
            const novo = payloadItemSeguro({ licitacao_id: currentLicitacaoId, numero:numItem, grupo_tipo:tipo, grupo_numero:numGrupo });
            try{
                const r = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens`, { method:'POST', headers, body:JSON.stringify(novo) });
                if(r.ok){ itens.push(await r.json()); totalCriados++; }
            }catch(e){ console.error(e); }
        }
    }
    reconstruirGruposDeItens();
    atualizarSelectsGrupos();
    renderGrupos();
    showToast('Grupos criados','success');
}
async function toggleGrupoGanho(tipo,numero,ganho){
    const grupoItens = itens.filter(i=>i.grupo_tipo===tipo && parseInt(i.grupo_numero)===parseInt(numero));
    const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if(sessionToken) headers['X-Session-Token'] = sessionToken;
    for(const item of grupoItens){
        item.ganho = ganho;
        if(!String(item.id).startsWith('temp-')) fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/itens/${item.id}`, { method:'PUT', headers, body:JSON.stringify(item) }).catch(e=>console.error(e));
    }
    renderGrupos();
}
function syncGrupos(){ carregarGrupos(); showToast('Dados sincronizados','success'); }
function perguntarAssinaturaPDFGrupos(){
    const temGanho = itens.some(i=>i.ganho && i.grupo_tipo);
    if(!temGanho){ showToast('Marque ao menos um item (ganho) para gerar a proposta','error'); return; }
    document.getElementById('modalAssinaturaGrupos').classList.add('show');
}
async function gerarPDFGruposComAssinatura(comAssinatura){
    document.getElementById('modalAssinaturaGrupos').classList.remove('show');
    const licitacao = licitacoes.find(l=>l.id===currentLicitacaoId);
    if(!licitacao) return;
    let dadosBancarios = null;
    try{
        const h={ 'Accept': 'application/json' };
        if(sessionToken) h['X-Session-Token'] = sessionToken;
        const r = await fetch(`${API_URL}/licitacoes/${licitacao.id}/dados-bancarios`, { headers:h });
        if(r.ok){ const d = await r.json(); dadosBancarios = d.dados_bancarios || null; }
    }catch(e){}
    const estrutura = grupos.map(g=>({ grupo:g, itens:g.itens.filter(i=>i.ganho) })).filter(e=>e.itens.length>0);
    if(estrutura.length===0){ showToast('Nenhum item ganho encontrado','error'); return; }
    if(typeof window.jspdf==='undefined'){ showToast('Biblioteca PDF não carregou. Recarregue (F5).','error'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const margin=20, pageWidth=doc.internal.pageSize.width, pageHeight=doc.internal.pageSize.height;
    let y=3;
    const logo = new Image();
    logo.crossOrigin='anonymous';
    logo.src='I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
    logo.onload=()=>continuarGeracaoPDFProposta(doc,licitacao,dadosBancarios,y,margin,pageWidth,pageHeight,5,pageWidth-2*margin,comAssinatura,estrutura);
    logo.onerror=()=>continuarGeracaoPDFProposta(doc,licitacao,dadosBancarios,25,margin,pageWidth,pageHeight,5,pageWidth-2*margin,comAssinatura,estrutura);
}

function perguntarAssinaturaPDF(){
    if(!currentLicitacaoId){ showToast('Erro: Licitação não identificada','error'); return; }
    const itensSelecionados = itens.filter(item=>item.ganho);
    if(itensSelecionados.length===0){ showToast('Marque ao menos um item (ganho) para gerar a proposta','error'); return; }
    const modal = document.getElementById('modalAssinatura');
    if(modal) modal.classList.add('show');
}
function fecharModalAssinatura(){ const modal = document.getElementById('modalAssinatura'); if(modal) modal.classList.remove('show'); }
async function gerarPDFsProposta(comAssinatura){
    fecharModalAssinatura();
    if(!currentLicitacaoId){ showToast('Erro: Licitação não identificada','error'); return; }
    const licitacao = licitacoes.find(l=>l.id===currentLicitacaoId);
    if(!licitacao){ showToast('Erro: Licitação não encontrada','error'); return; }
    const itensSelecionados = itens.filter(item=>item.ganho);
    if(itensSelecionados.length===0){ showToast('Marque ao menos um item (ganho) para gerar a proposta','error'); return; }
    if(typeof window.jspdf==='undefined'){
        let attempts=0;
        const checkInterval = setInterval(()=>{
            attempts++;
            if(typeof window.jspdf!=='undefined'){ clearInterval(checkInterval); gerarPDFPropostaInterno(licitacao,comAssinatura); }
            else if(attempts>=5){ clearInterval(checkInterval); showToast('Erro: Biblioteca PDF não carregou. Recarregue a página (F5).','error'); }
        },500);
        return;
    }
    gerarPDFPropostaInterno(licitacao,comAssinatura);
}
async function gerarPDFPropostaInterno(licitacao, comAssinatura){
    let dadosBancarios = null;
    try{
        const headers={ 'Accept': 'application/json' };
        if(sessionToken) headers['X-Session-Token'] = sessionToken;
        const response = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/dados-bancarios`, { method:'GET', headers });
        if(response.ok){ const data = await response.json(); dadosBancarios = data.dados_bancarios; }
    }catch(e){ console.error('Erro ao buscar dados bancários:',e); }
    const validade = configProposta.validade || licitacao.validade_proposta || '';
    const prazoEntrega = configProposta.prazoEntrega || licitacao.prazo_entrega || '';
    const prazoPagamento = configProposta.prazoPagamento || licitacao.prazo_pagamento || '';
    const dadosBancariosTexto = configProposta.dadosBancarios || dadosBancarios || '';
    const incluirAssinatura = configProposta.assinatura ? comAssinatura : false;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y = 3;
    const margin = 15, pageWidth = doc.internal.pageSize.width, pageHeight = doc.internal.pageSize.height, lineHeight=5, maxWidth = pageWidth-2*margin;
    function addPageWithHeader(){ doc.addPage(); return 20; }
    function paginaCheia(yAtual, espaco=40){ return yAtual > pageHeight-30-espaco; }
    const logoHeader = new Image();
    logoHeader.crossOrigin='anonymous';
    logoHeader.src='I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
    logoHeader.onload = function(){
        try{
            const logoWidth=40, logoHeight=(logoHeader.height/logoHeader.width)*logoWidth, logoX=5, logoY=y;
            doc.setGState(new doc.GState({ opacity:0.3 }));
            doc.addImage(logoHeader,'PNG',logoX,logoY,logoWidth,logoHeight);
            doc.setGState(new doc.GState({ opacity:1.0 }));
            const fontSize = logoHeight*0.5;
            doc.setFontSize(fontSize); doc.setFont(undefined,'bold'); doc.setTextColor(150,150,150);
            const textX = logoX+logoWidth+1.2;
            const lineSpacing = fontSize*0.5;
            doc.text('I.R COMÉRCIO E',textX,logoY+fontSize*0.85);
            doc.text('MATERIAIS ELÉTRICOS LTDA',textX,logoY+fontSize*0.85+lineSpacing);
            doc.setTextColor(0,0,0);
            y = logoY+logoHeight+8;
            continuarGeracaoPDFProposta(doc,licitacao,dadosBancariosTexto,y,margin,pageWidth,pageHeight,lineHeight,maxWidth,incluirAssinatura,validade,prazoEntrega,prazoPagamento);
        }catch(e){ continuarGeracaoPDFProposta(doc,licitacao,dadosBancariosTexto,25,margin,pageWidth,pageHeight,lineHeight,maxWidth,incluirAssinatura,validade,prazoEntrega,prazoPagamento); }
    };
    logoHeader.onerror = ()=>continuarGeracaoPDFProposta(doc,licitacao,dadosBancariosTexto,25,margin,pageWidth,pageHeight,lineHeight,maxWidth,incluirAssinatura,validade,prazoEntrega,prazoPagamento);
}
function continuarGeracaoPDFProposta(doc,licitacao,dadosBancariosTexto,y,margin,pageWidth,pageHeight,lineHeight,maxWidth,comAssinatura,validade,prazoEntrega,prazoPagamento){
    const itensSelecionados = itens.filter(item=>item.ganho);
    const fmtValorPdf = (v,d=2)=>'R$ '+(v||0).toLocaleString('pt-BR',{minimumFractionDigits:d,maximumFractionDigits:d});
    const fmtUntPdf = (v)=>{
        const n=v||0; const s=n.toFixed(4).replace(/(\.(\d*?)?)0+$/,'$1').replace(/\.$/,'');
        return 'R$ '+parseFloat(s||0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4});
    };
    function addPageWithHeader(){
        doc.addPage();
        const logoH = new Image(); logoH.crossOrigin='anonymous'; logoH.src='I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
        if(logoH.complete){
            const lw=40, lh=(logoH.height/logoH.width)*lw;
            doc.setGState(new doc.GState({ opacity:0.3 }));
            doc.addImage(logoH,'PNG',5,3,lw,lh);
            doc.setGState(new doc.GState({ opacity:1.0 }));
            const fs=lh*0.5;
            doc.setFontSize(fs); doc.setFont(undefined,'bold'); doc.setTextColor(150,150,150);
            doc.text('I.R COMÉRCIO E',5+lw+1.2,3+fs*0.85);
            doc.text('MATERIAIS ELÉTRICOS LTDA',5+lw+1.2,3+fs*0.85+fs*0.5);
            doc.setTextColor(0,0,0);
            return 3+lh+8;
        } else return 20;
    }
    function paginaCheia(yAtual,espaco=40){ return yAtual > pageHeight-30-espaco; }
    doc.setFontSize(18); doc.setFont(undefined,'bold'); doc.text('PROPOSTA',pageWidth/2,y,{align:'center'}); y+=8;
    doc.setFontSize(14); doc.text(`${licitacao.numero_licitacao}${licitacao.uasg?' - '+licitacao.uasg:''}`,pageWidth/2,y,{align:'center'}); y+=12;
    doc.setFontSize(10); doc.setTextColor(0,0,0); doc.text('AO',margin,y); y+=lineHeight+1;
    if(licitacao.nome_orgao){ doc.setFont(undefined,'bold'); doc.text(toUpperCase(licitacao.nome_orgao),margin,y); doc.setFont(undefined,'normal'); y+=lineHeight+1; }
    doc.text('COMISSÃO PERMANENTE DE LICITAÇÃO',margin,y); y+=lineHeight+1;
    doc.text(`PREGÃO ELETRÔNICO: ${licitacao.numero_licitacao}${licitacao.uasg?'  UASG: '+licitacao.uasg:''}`,margin,y); y+=10;
    if(paginaCheia(y,50)) y=addPageWithHeader();
    const tableWidth = pageWidth-2*margin;
    const colWidths = { item:tableWidth*0.05, descricao:tableWidth*0.30, qtd:tableWidth*0.06, unid:tableWidth*0.05, marca:tableWidth*0.12, modelo:tableWidth*0.12, vunt:tableWidth*0.14, total:tableWidth*0.16 };
    const itemRowHeight=10;
    function desenharCabecalhoTabela(){
        doc.setFillColor(108,117,125); doc.setDrawColor(180,180,180); doc.rect(margin,y,tableWidth,itemRowHeight,'FD'); doc.setTextColor(255,255,255); doc.setFontSize(7.5); doc.setFont(undefined,'bold');
        let xp=margin;
        [['ITEM',colWidths.item,'center'],['DESCRIÇÃO',colWidths.descricao,'left'],['QTD',colWidths.qtd,'center'],['UN',colWidths.unid,'center'],['MARCA',colWidths.marca,'center'],['MODELO',colWidths.modelo,'center'],['VD. UNT',colWidths.vunt,'right'],['VD. TOTAL',colWidths.total,'right']].forEach(([lbl,w,align])=>{
            doc.line(xp,y,xp,y+itemRowHeight); doc.text(lbl,xp+w/2,y+6.5,{align:align==='center'?'center':align==='left'?'left':'right'}); xp+=w;
        });
        doc.line(xp,y,xp,y+itemRowHeight); y+=itemRowHeight; doc.setTextColor(0,0,0); doc.setFontSize(7.5); doc.setFont(undefined,'normal');
    }
    function desenharLinhaItem(item,rowIndex){
        const descricaoUpper = toUpperCase(item.descricao);
        const descLines = doc.splitTextToSize(descricaoUpper,colWidths.descricao-4);
        const marcaWrap = doc.splitTextToSize(item.marca||'-',colWidths.marca-2);
        const modeloWrap = doc.splitTextToSize(item.modelo||'-',colWidths.modelo-2);
        const lineCount = Math.max(descLines.length,marcaWrap.length,modeloWrap.length);
        const rowH = Math.max(itemRowHeight, lineCount*3.5+4);
        if(paginaCheia(y,rowH+10)){ y=addPageWithHeader(); desenharCabecalhoTabela(); }
        const rowBg = (rowIndex%2===0)?[255,255,255]:[247,248,250];
        doc.setFillColor(...rowBg); doc.setDrawColor(180,180,180); doc.rect(margin,y,tableWidth,rowH,'FD');
        let xp=margin; const cy = y+(rowH/2)+1.5;
        doc.line(xp,y,xp,y+rowH); doc.text(String(item.numero),xp+colWidths.item/2,cy,{align:'center'}); xp+=colWidths.item; doc.line(xp,y,xp,y+rowH);
        let yt=y+4; descLines.forEach(l=>{ doc.text(l,xp+2,yt); yt+=3.5; });
        xp+=colWidths.descricao; doc.line(xp,y,xp,y+rowH);
        doc.text(String(item.qtd||1),xp+colWidths.qtd/2,cy,{align:'center'}); xp+=colWidths.qtd; doc.line(xp,y,xp,y+rowH);
        doc.text(item.unidade||'UN',xp+colWidths.unid/2,cy,{align:'center'}); xp+=colWidths.unid; doc.line(xp,y,xp,y+rowH);
        let ym=y+4; marcaWrap.forEach(ml=>{ doc.text(ml,xp+colWidths.marca/2,ym,{align:'center'}); ym+=3.5; });
        xp+=colWidths.marca; doc.line(xp,y,xp,y+rowH);
        let ymo=y+4; modeloWrap.forEach(ml=>{ doc.text(ml,xp+colWidths.modelo/2,ymo,{align:'center'}); ymo+=3.5; });
        xp+=colWidths.modelo; doc.line(xp,y,xp,y+rowH);
        doc.text(fmtUntPdf(item.venda_unt),xp+colWidths.vunt/2,cy,{align:'center'}); xp+=colWidths.vunt; doc.line(xp,y,xp,y+rowH);
        doc.text(fmtValorPdf(item.venda_total),xp+colWidths.total/2,cy,{align:'center'}); xp+=colWidths.total; doc.line(xp,y,xp,y+rowH);
        y+=rowH;
    }
    function desenharRodapeTabela(totalValor){
        doc.setFillColor(240,240,240); doc.setFont(undefined,'bold'); doc.rect(margin,y,tableWidth,8,'FD');
        doc.text('TOTAL GERAL:',margin+tableWidth-colWidths.total-colWidths.vunt-4,y+5.5,{align:'right'});
        doc.text(fmtValorPdf(totalValor),margin+tableWidth-2,y+5.5,{align:'right'});
        doc.setFont(undefined,'normal'); y+=8;
    }
    doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.text('ITENS DA PROPOSTA',margin,y); y+=6;
    desenharCabecalhoTabela();
    itensSelecionados.forEach((item,index)=>desenharLinhaItem(item,index));
    const totalGeral = itensSelecionados.reduce((acc,item)=>acc+(item.venda_total||0),0);
    desenharRodapeTabela(totalGeral);
    y+=8; if(paginaCheia(y,60)) y=addPageWithHeader();
    doc.setFontSize(10);
    function addCampoCondicao(label,valor){
        if(!valor || valor.toString().trim()==='') return;
        doc.setFont(undefined,'bold'); const lw = doc.getTextWidth(label+': ');
        doc.text(label+': ',margin,y); doc.setFont(undefined,'normal');
        const linhas = doc.splitTextToSize(valor.toString(),maxWidth-lw);
        doc.text(linhas[0],margin+lw,y); y+=lineHeight;
        for(let i=1;i<linhas.length;i++){ doc.text(linhas[i],margin,y); y+=lineHeight; }
        y+=3;
    }
    const valorExtenso = numeroPorExtenso(totalGeral);
    addCampoCondicao('VALOR TOTAL DA PROPOSTA',`${fmtValorPdf(totalGeral)} (${valorExtenso})`);
    if(validade) addCampoCondicao('VALIDADE DA PROPOSTA',validade);
    if(prazoEntrega) addCampoCondicao('PRAZO DE ENTREGA',prazoEntrega);
    if(prazoPagamento) addCampoCondicao('FORMA DE PAGAMENTO',prazoPagamento);
    if(dadosBancariosTexto) addCampoCondicao('DADOS BANCÁRIOS',dadosBancariosTexto);
    y+=16; if(paginaCheia(y,60)) y=addPageWithHeader();
    doc.setFontSize(10); doc.setFont(undefined,'normal');
    const declaracoes = [
        'DECLARAMOS QUE NOS PREÇOS COTADOS ESTÃO INCLUÍDAS TODAS AS DESPESAS TAIS COMO FRETE (CIF), IMPOSTOS, TAXAS, SEGUROS, TRIBUTOS E DEMAIS ENCARGOS DE QUALQUER NATUREZA INCIDENTES SOBRE O OBJETO DO PREGÃO.',
        'DECLARAMOS QUE SOMOS OPTANTES PELO SIMPLES NACIONAL.',
        'DECLARAMOS QUE O OBJETO FORNECIDO NÃO É REMANUFATURADO OU RECONDICIONADO.'
    ];
    declaracoes.forEach(decl=>{
        if(paginaCheia(y,20)) y=addPageWithHeader();
        const linhas = doc.splitTextToSize(decl,maxWidth);
        linhas.forEach(linha=>{ if(paginaCheia(y,10)) y=addPageWithHeader(); doc.text(linha,pageWidth/2,y,{align:'center'}); y+=lineHeight; });
        y+=3;
    });
    y+=12; if(paginaCheia(y,40)) y=addPageWithHeader();
    const dataAtual = new Date(); const dia = dataAtual.getDate();
    const meses = ['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO'];
    const mes = meses[dataAtual.getMonth()]; const ano = dataAtual.getFullYear();
    doc.setFontSize(10); doc.setFont(undefined,'normal'); doc.text(`SERRA/ES, ${dia} DE ${mes} DE ${ano}`,pageWidth/2,y,{align:'center'}); y+=5;
    if(comAssinatura){
        const assinatura = new Image(); assinatura.crossOrigin='anonymous'; assinatura.src='assinatura.png';
        assinatura.onload=function(){
            try{
                const imgWidth=50, imgHeight=(assinatura.height/assinatura.width)*imgWidth;
                doc.addImage(assinatura,'PNG',(pageWidth/2)-(imgWidth/2),y+2,imgWidth,imgHeight);
                let yFinal = y+imgHeight+5;
                yFinal+=5; doc.setFontSize(10); doc.setFont(undefined,'bold'); doc.text('ROSEMEIRE BICALHO DE LIMA GRAVINO',pageWidth/2,yFinal,{align:'center'});
                yFinal+=5; doc.setFontSize(9); doc.setFont(undefined,'normal'); doc.text('MG-10.078.568 / CPF: 045.160.616-78',pageWidth/2,yFinal,{align:'center'});
                yFinal+=5; doc.text('DIRETORA',pageWidth/2,yFinal,{align:'center'});
                finalizarPDF();
            }catch(e){ finalizarPDF(); }
        };
        assinatura.onerror=function(){ finalizarPDF(); };
    } else {
        y+=20; doc.setDrawColor(0,0,0); doc.line(pageWidth/2-40,y,pageWidth/2+40,y); y+=5;
        doc.setFont(undefined,'bold'); doc.text('ROSEMEIRE BICALHO DE LIMA GRAVINO',pageWidth/2,y,{align:'center'}); y+=5;
        doc.setFont(undefined,'normal'); doc.text('MG-10.078.568 / CPF: 045.160.616-78',pageWidth/2,y,{align:'center'}); y+=5;
        doc.setFont(undefined,'bold'); doc.text('DIRETORA',pageWidth/2,y,{align:'center'});
        finalizarPDF();
    }
    function finalizarPDF(){
        const footerLines = ['I.R. COMÉRCIO E MATERIAIS ELÉTRICOS LTDA  |  CNPJ: 33.149.502/0001-38  |  IE: 083.780.74-2','RUA TADORNA Nº 472, SALA 2, NOVO HORIZONTE – SERRA/ES  |  CEP: 29.163-318','TELEFAX: (27) 3209-4291  |  E-MAIL: COMERCIAL.IRCOMERCIO@GMAIL.COM'];
        const footerLineH=5, footerH = footerLines.length*footerLineH+4;
        const totalPags = doc.internal.getNumberOfPages();
        for(let pg=1; pg<=totalPags; pg++){
            doc.setPage(pg); doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(150,150,150);
            const fyBase = pageHeight - footerH + 2;
            footerLines.forEach((line,i)=>{ doc.text(line,pageWidth/2,fyBase+(i*footerLineH),{align:'center'}); });
            doc.setTextColor(0,0,0);
        }
        doc.save(`PROPOSTA-${licitacao.numero_licitacao}${licitacao.uasg?'-'+licitacao.uasg:''}.pdf`);
        showToast('PDF gerado com sucesso!','success');
    }
}
function abrirModalConfigProposta(){
    const modal = document.getElementById('modalConfigProposta');
    if(!modal) return;
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
function fecharModalConfigProposta(){ document.getElementById('modalConfigProposta').classList.remove('show'); }
function salvarConfigProposta(){
    configProposta.impostoFederal = parseFloat(document.getElementById('configImpostoFederal').value) || 9.7;
    configProposta.freteVenda = parseFloat(document.getElementById('configFreteVenda').value) || 5;
    configProposta.freteCompra = parseFloat(document.getElementById('configFreteCompra').value) || 0;
    configProposta.validade = document.getElementById('configValidade').value;
    configProposta.prazoEntrega = document.getElementById('configPrazoEntrega').value;
    configProposta.prazoPagamento = document.getElementById('configPrazoPagamento').value;
    configProposta.dadosBancarios = document.getElementById('configDadosBancarios').value;
    configProposta.assinatura = document.getElementById('configAssinatura').value === 'true';
    fecharModalConfigProposta();
    showToast('Configurações salvas','success');
}
function obterSaudacao(){
    const hora = new Date().getHours();
    if(hora>=5 && hora<12) return 'Bom dia';
    if(hora>=12 && hora<18) return 'Boa tarde';
    return 'Boa noite';
}
function abrirModalCotacao(){
    const marcas = [...new Set(itens.filter(i=>i.marca).map(i=>i.marca))].sort();
    const select = document.getElementById('cotacaoFornecedor');
    select.innerHTML = '<option value="">Selecione...</option>'+marcas.map(m=>`<option value="${m}">${m}</option>`).join('');
    document.getElementById('cotacaoTipo').value = 'descricao';
    document.getElementById('cotacaoMensagem').value = '';
    document.getElementById('modalCotacao').classList.add('show');
}
function fecharModalCotacao(){ document.getElementById('modalCotacao').classList.remove('show'); }
function gerarMensagemCotacao(){
    const marca = document.getElementById('cotacaoFornecedor').value;
    const tipo = document.getElementById('cotacaoTipo').value;
    if(!marca){ document.getElementById('cotacaoMensagem').value = ''; return; }
    const itensCotacao = itens.filter(item=>item.marca===marca);
    if(itensCotacao.length===0){ document.getElementById('cotacaoMensagem').value = 'Nenhum item com esta marca.'; return; }
    const saudacao = obterSaudacao();
    let mensagem = `${saudacao}! \n\nSolicito, por gentileza, um orçamento para os itens mencionados a seguir:\n\n`;
    itensCotacao.forEach((item,idx)=>{
        const numLista = idx+1;
        if(tipo==='descricao') mensagem += `${numLista} - ${item.descricao}\n${item.qtd} ${item.unidade}\n\n`;
        else mensagem += `ITEM ${numLista} - ${item.modelo || item.descricao}\n${item.qtd} ${item.unidade}\n\n`;
    });
    document.getElementById('cotacaoMensagem').value = mensagem;
}
function copiarMensagemCotacao(){
    const msg = document.getElementById('cotacaoMensagem').value;
    if(!msg){ showToast('Nenhuma mensagem para copiar','error'); return; }
    navigator.clipboard.writeText(msg).then(()=>showToast('Mensagem copiada!','success')).catch(()=>showToast('Erro ao copiar','error'));
}
function numeroPorExtenso(valor){
    if(valor===0) return 'ZERO REAIS';
    const unidades=['','UM','DOIS','TRÊS','QUATRO','CINCO','SEIS','SETE','OITO','NOVE'];
    const dezenas=['','DEZ','VINTE','TRINTA','QUARENTA','CINQUENTA','SESSENTA','SETENTA','OITENTA','NOVENTA'];
    const especiais=['ONZE','DOZE','TREZE','CATORZE','QUINZE','DEZESSEIS','DEZESSETE','DEZOITO','DEZENOVE'];
    const centenas=['','CENTO','DUZENTOS','TREZENTOS','QUATROCENTOS','QUINHENTOS','SEISCENTOS','SETECENTOS','OITOCENTOS','NOVECENTOS'];
    let inteiro = Math.floor(valor);
    let centavos = Math.round((valor - inteiro)*100);
    function converterTresDigitos(num){
        if(num===0) return '';
        if(num===100) return 'CEM';
        let resultado=[];
        let centena = Math.floor(num/100);
        let resto = num%100;
        if(centena>0) resultado.push(centenas[centena]);
        if(resto>0){
            if(resto<10) resultado.push(unidades[resto]);
            else if(resto<20) resultado.push(especiais[resto-11]);
            else{
                let dezena = Math.floor(resto/10);
                let unidade = resto%10;
                if(dezena>0) resultado.push(dezenas[dezena]);
                if(unidade>0) resultado.push(unidades[unidade]);
            }
        }
        return resultado.join(' E ');
    }
    let partes=[];
    if(inteiro>0){
        let milhares = Math.floor(inteiro/1000);
        let restante = inteiro%1000;
        if(milhares>0){
            if(milhares===1) partes.push('MIL');
            else{ let milharTexto = converterTresDigitos(milhares); partes.push(milharTexto+(milharTexto.endsWith('O')?' MIL':' MIL')); }
        }
        if(restante>0) partes.push(converterTresDigitos(restante));
        let textoInteiro = partes.join(' E ');
        if(inteiro===1) textoInteiro = 'UM REAL';
        else textoInteiro += ' REAIS';
        partes = [textoInteiro];
    }
    if(centavos>0){
        if(centavos===1) partes.push('UM CENTAVO');
        else partes.push(converterTresDigitos(centavos)+' CENTAVOS');
    }
    return partes.join(' E ');
}
// ========== EXEQUIBILIDADE (simplificada) ==========
let exequibilidadeData = { intervalo:'', impostoFederal:9.7, freteVenda:5, freteCompra:0 };
function abrirModalExequibilidade(licitacaoId){
    currentLicitacaoId = licitacaoId;
    let modal = document.getElementById('modalExequibilidade');
    if(!modal){
        modal = document.createElement('div');
        modal.id='modalExequibilidade'; modal.className='modal-overlay';
        modal.innerHTML=`<div class="modal-content" style="max-width:600px;"><div class="modal-header"><h3 class="modal-title">Comprovante de Exequibilidade</h3><button class="close-modal" onclick="fecharModalExequibilidade()">✕</button></div><div class="tabs-container"><div class="tabs-nav"><button class="tab-btn active" onclick="switchExeTab('exe-tab-geral')">Geral</button><button class="tab-btn" onclick="switchExeTab('exe-tab-valores')">Valores</button></div><div class="tab-content active" id="exe-tab-geral"><div class="form-group"><label>Intervalo de Itens <span style="color:var(--text-secondary);font-weight:400;">(ex: 1-5, 10, 15-20 ou deixe vazio para todos)</span></label><input type="text" id="exeIntervalo" placeholder="Ex: 1-5, 10, 15-20"></div></div><div class="tab-content" id="exe-tab-valores"><div class="form-grid"><div class="form-group"><label>Imposto Federal (%)</label><input type="number" id="exeImpostoFederal" step="0.1" min="0" max="100" value="9.7"></div><div class="form-group"><label>Frete Venda (%)</label><input type="number" id="exeFreteVenda" step="0.1" min="0" max="100" value="5"></div><div class="form-group"><label>Frete Compra (R$)</label><input type="number" id="exeFreteCompra" step="0.01" min="0" value="0"></div></div></div></div><div class="modal-actions"><button type="button" id="btnExePrev" class="secondary" style="display:none;" onclick="prevExeTab()">Anterior</button><button type="button" id="btnExeNext" class="secondary" onclick="nextExeTab()">Próximo</button><button type="button" id="btnExeGerar" class="success" style="display:none;" onclick="gerarComprovanteExequibilidade()">Gerar Comprovante</button><button type="button" class="danger" onclick="fecharModalExequibilidade()">Cancelar</button></div></div>`;
        document.body.appendChild(modal);
    }
    document.getElementById('exeIntervalo').value='';
    document.getElementById('exeImpostoFederal').value='9.7';
    document.getElementById('exeFreteVenda').value='5';
    document.getElementById('exeFreteCompra').value='0';
    modal.classList.add('show');
    switchExeTab('exe-tab-geral');
}
function fecharModalExequibilidade(){ const m = document.getElementById('modalExequibilidade'); if(m) m.classList.remove('show'); }
const exeTabs = ['exe-tab-geral','exe-tab-valores']; let currentExeTab=0;
function switchExeTab(tabId){
    const allTabs = document.querySelectorAll('#modalExequibilidade .tab-content');
    const allBtns = document.querySelectorAll('#modalExequibilidade .tab-btn');
    allTabs.forEach(t=>t.classList.remove('active')); allBtns.forEach(b=>b.classList.remove('active'));
    const active = document.getElementById(tabId); if(active) active.classList.add('active');
    currentExeTab = exeTabs.indexOf(tabId); if(allBtns[currentExeTab]) allBtns[currentExeTab].classList.add('active');
    const isLast = currentExeTab===exeTabs.length-1;
    const prev = document.getElementById('btnExePrev'); const next = document.getElementById('btnExeNext'); const gerar = document.getElementById('btnExeGerar');
    if(prev) prev.style.display = currentExeTab===0 ? 'none' : 'inline-block';
    if(next) next.style.display = isLast ? 'none' : 'inline-block';
    if(gerar) gerar.style.display = isLast ? 'inline-block' : 'none';
}
function nextExeTab(){ if(currentExeTab < exeTabs.length-1){ currentExeTab++; switchExeTab(exeTabs[currentExeTab]); } }
function prevExeTab(){ if(currentExeTab > 0){ currentExeTab--; switchExeTab(exeTabs[currentExeTab]); } }
async function gerarComprovanteExequibilidade(){
    const intervalo = document.getElementById('exeIntervalo').value.trim();
    const impostoFederal = parseFloat(document.getElementById('exeImpostoFederal').value)||9.7;
    const freteVenda = parseFloat(document.getElementById('exeFreteVenda').value)||5;
    const freteCompra = parseFloat(document.getElementById('exeFreteCompra').value)||0;
    fecharModalExequibilidade();
    const licitacao = licitacoes.find(l=>l.id===currentLicitacaoId);
    if(!licitacao){ showToast('Erro: Licitação não encontrada','error'); return; }
    let itensFiltrados = [...itens];
    if(intervalo){
        const numeros = parsearIntervalo(intervalo);
        if(numeros) itensFiltrados = itens.filter(item=>numeros.includes(item.numero));
    }
    if(itensFiltrados.length===0){ showToast('Nenhum item encontrado no intervalo informado','error'); return; }
    let dadosBancarios = null;
    try{
        const headers={ 'Accept':'application/json' };
        if(sessionToken) headers['X-Session-Token']=sessionToken;
        const r = await fetch(`${API_URL}/licitacoes/${currentLicitacaoId}/dados-bancarios`,{ headers });
        if(r.ok){ const d = await r.json(); dadosBancarios = d.dados_bancarios; }
    }catch(e){}
    if(typeof window.jspdf==='undefined'){ showToast('Erro: Biblioteca PDF não carregou. Recarregue a página (F5).','error'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    let y=3; const margin=15, pageWidth=doc.internal.pageSize.width, pageHeight=doc.internal.pageSize.height, lineHeight=5, maxWidth=pageWidth-2*margin, footerMargin=30;
    function adicionarCabecalho(){
        const logoHeaderImg = new Image(); logoHeaderImg.crossOrigin='anonymous'; logoHeaderImg.src='I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
        const logoWidth=40, logoHeight=15, logoX=5, headerY=3;
        doc.setGState(new doc.GState({ opacity:0.3 })); doc.addImage(logoHeaderImg,'PNG',logoX,headerY,logoWidth,logoHeight); doc.setGState(new doc.GState({ opacity:1.0 }));
        doc.setFontSize(8); doc.setFont(undefined,'bold'); doc.setTextColor(150,150,150);
        doc.text('I.R COMÉRCIO E',logoX+logoWidth+1.2,headerY+5); doc.text('MATERIAIS ELÉTRICOS LTDA',logoX+logoWidth+1.2,headerY+10);
        doc.setTextColor(0,0,0); return headerY+logoHeight+8;
    }
    function addPageWithHeader(){ doc.addPage(); return adicionarCabecalho(); }
    function paginaCheia(yAtual, espaco=40){ return yAtual > pageHeight-footerMargin-espaco; }
    y = adicionarCabecalho(); y+=5;
    doc.setFontSize(16); doc.setFont(undefined,'bold'); doc.text('TABELA DE CUSTOS E FORMAÇÃO DE PREÇOS',pageWidth/2,y,{align:'center'}); y+=8;
    doc.setFontSize(12); doc.text(`${licitacao.numero_licitacao}${licitacao.uasg?' - '+licitacao.uasg:''}`,pageWidth/2,y,{align:'center'}); y+=12;
    doc.setFontSize(10); doc.setFont(undefined,'bold'); doc.text('INFORMAÇÕES DO PROCESSO',margin,y); y+=6; doc.setFont(undefined,'normal');
    doc.text(`PREGÃO: ${licitacao.numero_licitacao}`,margin,y); y+=5;
    doc.text(`ÓRGÃO: ${licitacao.nome_orgao||'NÃO INFORMADO'} - ${licitacao.uasg||''}`,margin,y); y+=5;
    doc.text(`${licitacao.municipio||''} - ${licitacao.uf||''}`,margin,y); y+=10;
    doc.setFont(undefined,'bold'); doc.text('INFORMAÇÕES DA EMPRESA',margin,y); y+=6; doc.setFont(undefined,'normal');
    doc.text('FORNECEDOR: I.R. COMÉRCIO E MATERIAIS ELÉTRICOS LTDA',margin,y); doc.text('TEL: (27) 3209-4291',pageWidth-margin-50,y,{align:'right'}); y+=5;
    doc.text('CNPJ/CPF: 33.149.502/0001-38',margin,y); y+=5;
    doc.text('ENDEREÇO: RUA TADORNA, Nº 472, SALA 2',margin,y); y+=5;
    doc.text('BAIRRO: NOVO HORIZONTE',margin,y); y+=5;
    doc.text(`CIDADE: SERRA      UF: ES`,margin,y); doc.text(`CEP: 29.163-318`,pageWidth-margin-30,y,{align:'right'}); y+=5;
    if(dadosBancarios){ doc.text(`DADOS BANCÁRIOS: ${dadosBancarios}`,margin,y); y+=5; }
    y+=5; if(paginaCheia(y,80)) y=addPageWithHeader();
    doc.setFont(undefined,'bold'); doc.text('COMPOSIÇÃO DE CUSTOS',margin,y); y+=8;
    const colWidths = { item:15, descricao:50, qtd:12, un:10, marca:20, modelo:20, custoUnt:20, freteCompra:20, impFed:20, freteVenda:20, vendaUnt:20, lucroReal:20, percLucro:15 };
    const tableWidth = Object.values(colWidths).reduce((a,b)=>a+b,0);
    const startX = (pageWidth-tableWidth)/2;
    doc.setFillColor(108,117,125); doc.setDrawColor(180,180,180); doc.rect(startX,y,tableWidth,10,'FD'); doc.setTextColor(255,255,255); doc.setFontSize(6); doc.setFont(undefined,'bold');
    let xp=startX;
    const headers = [['ITEM',colWidths.item,'center'],['DESCRIÇÃO',colWidths.descricao,'left'],['QTD',colWidths.qtd,'center'],['UN',colWidths.un,'center'],['MARCA',colWidths.marca,'center'],['MODELO',colWidths.modelo,'center'],['CUSTO\nUNT',colWidths.custoUnt,'right'],['FRETE\nCOMPRA',colWidths.freteCompra,'right'],['IMP\nFED',colWidths.impFed,'right'],['FRETE\nVENDA',colWidths.freteVenda,'right'],['VENDA\nUNT',colWidths.vendaUnt,'right'],['LUCRO\nREAL',colWidths.lucroReal,'right'],['% LUCRO',colWidths.percLucro,'right']];
    headers.forEach(([lbl,w])=>{ doc.line(xp,y,xp,y+10); const lines=lbl.split('\n'); lines.forEach((line,i)=>doc.text(line,xp+w/2,y+4+(i*3),{align:'center'})); xp+=w; }); doc.line(xp,y,xp,y+10);
    y+=10; doc.setTextColor(0,0,0); doc.setFontSize(6); doc.setFont(undefined,'normal');
    let totalGeralVenda=0;
    itensFiltrados.forEach((item,idx)=>{
        if(paginaCheia(y,50)){ y=addPageWithHeader(); doc.setFillColor(108,117,125); doc.setDrawColor(180,180,180); doc.rect(startX,y,tableWidth,10,'FD'); doc.setTextColor(255,255,255); doc.setFont(undefined,'bold'); xp=startX; headers.forEach(([lbl,w])=>{ doc.line(xp,y,xp,y+10); const lines=lbl.split('\n'); lines.forEach((line,i)=>doc.text(line,xp+w/2,y+4+(i*3),{align:'center'})); xp+=w; }); doc.line(xp,y,xp,y+10); y+=10; doc.setTextColor(0,0,0); doc.setFont(undefined,'normal'); }
        const vendaUnt = item.venda_unt||0; const custoUnt = item.custo_unt||0;
        const impostoFederalValor = vendaUnt*(impostoFederal/100);
        const freteVendaValor = vendaUnt*(freteVenda/100);
        const lucroReal = vendaUnt - freteVendaValor - impostoFederalValor - freteCompra - custoUnt;
        const percLucro = vendaUnt>0 ? (lucroReal/vendaUnt)*100 : 0;
        totalGeralVenda += vendaUnt*(item.qtd||1);
        doc.setFillColor(255,255,255); doc.setDrawColor(180,180,180); doc.rect(startX,y,tableWidth,8,'FD');
        xp=startX;
        const values = [[String(item.numero||''),'center'],[item.descricao||'','left'],[String(item.qtd||1),'center'],[item.unidade||'UN','center'],[item.marca||'-','center'],[item.modelo||'-','center'],['R$ '+custoUnt.toFixed(2),'right'],['R$ '+freteCompra.toFixed(2),'right'],['R$ '+impostoFederalValor.toFixed(2),'right'],['R$ '+freteVendaValor.toFixed(2),'right'],['R$ '+vendaUnt.toFixed(2),'right'],['R$ '+lucroReal.toFixed(2),'right'],[percLucro.toFixed(1)+'%','right']];
        values.forEach(([val,align],i)=>{
            doc.line(xp,y,xp,y+8);
            const w = Object.values(colWidths)[i];
            const textX = align==='left'?xp+2:(align==='right'?xp+w-2:xp+w/2);
            if(i===1){ const lines = doc.splitTextToSize(val,w-4); lines.forEach((line,j)=>doc.text(line,textX,y+4+(j*3))); }
            else doc.text(val,textX,y+5,{align:align});
            xp+=w;
        });
        doc.line(xp,y,xp,y+8); y+=8;
    });
    y+=5; if(paginaCheia(y,40)) y=addPageWithHeader();
    const dataAtual = new Date(); const dia = dataAtual.getDate(); const meses=['JANEIRO','FEVEREIRO','MARÇO','ABRIL','MAIO','JUNHO','JULHO','AGOSTO','SETEMBRO','OUTUBRO','NOVEMBRO','DEZEMBRO']; const mes = meses[dataAtual.getMonth()]; const ano = dataAtual.getFullYear();
    doc.setFontSize(10); doc.setFont(undefined,'normal'); doc.text(`SERRA/ES, ${dia} DE ${mes} DE ${ano}`,pageWidth/2,y,{align:'center'}); y+=15;
    const assinatura = new Image(); assinatura.crossOrigin='anonymous'; assinatura.src='assinatura.png';
    try{ const imgWidth=50, imgHeight=15; doc.addImage(assinatura,'PNG',(pageWidth/2)-(imgWidth/2),y-5,imgWidth,imgHeight); }catch(e){ doc.line(pageWidth/2-40,y,pageWidth/2+40,y); }
    y+=10; doc.setFont(undefined,'bold'); doc.text('ROSEMEIRE BICALHO DE LIMA GRAVINO',pageWidth/2,y,{align:'center'}); y+=5;
    doc.setFont(undefined,'normal'); doc.text('MG-10.078.568 / CPF: 045.160.616-78',pageWidth/2,y,{align:'center'}); y+=5;
    doc.text('DIRETORA',pageWidth/2,y,{align:'center'});
    const footerLines = ['I.R. COMÉRCIO E MATERIAIS ELÉTRICOS LTDA  |  CNPJ: 33.149.502/0001-38  |  IE: 083.780.74-2','RUA TADORNA Nº 472, SALA 2, NOVO HORIZONTE – SERRA/ES  |  CEP: 29.163-318','TELEFAX: (27) 3209-4291  |  E-MAIL: COMERCIAL.IRCOMERCIO@GMAIL.COM'];
    const footerLineH=5; const footerH = footerLines.length*footerLineH+4; const totalPags = doc.internal.getNumberOfPages();
    for(let pg=1; pg<=totalPags; pg++){ doc.setPage(pg); doc.setFontSize(8); doc.setFont(undefined,'normal'); doc.setTextColor(150,150,150); const fyBase = pageHeight - footerH + 2; footerLines.forEach((line,i)=>{ doc.text(line,pageWidth/2,fyBase+(i*footerLineH),{align:'center'}); }); doc.setTextColor(0,0,0); }
    doc.save(`COMPROVANTE-EXEQUIBILIDADE-${licitacao.numero_licitacao}${licitacao.uasg?'-'+licitacao.uasg:''}.pdf`);
    showToast('Comprovante gerado com sucesso!','success');
}
