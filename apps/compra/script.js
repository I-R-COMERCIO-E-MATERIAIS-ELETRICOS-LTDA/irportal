const DEVELOPMENT_MODE = false;
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let ordens = [];
let currentMonth = new Date();
let editingId = null;
let itemCounter = 0;
let currentTab = 0;
let currentInfoTab = 0;
let isOnline = false;
let sessionToken = null;
let lastDataHash = '';
let fornecedoresCache = {};   // cache global — nunca zerado ao trocar de mês
let ultimoNumeroGlobal = 0;   // maior número de ordem do banco inteiro
let currentFetchController = null;  // AbortController — cancela fetch anterior ao trocar de mês
let currentUserName = null;
const KNOWN_RESPONSAVEIS = ['ROBERTO', 'ISAQUE', 'MIGUEL'];

const tabs = ['tab-geral', 'tab-fornecedor', 'tab-pedido', 'tab-entrega', 'tab-pagamento'];

// ------------------------------------------------------------
// FUNÇÃO AUXILIAR PARA CONVERTER STRING EM NÚMERO (ACEITA VÍRGULA)
// ------------------------------------------------------------
function parseFloatLocale(str) {
    if (typeof str !== 'string') return NaN;
    const cleaned = str.replace(/\s+/g, '').replace(',', '.');
    const num = parseFloat(cleaned);
    return isNaN(num) ? NaN : num;
}

function detectResponsavelFromUser(name) {
    if (!name) return null;
    const upper = name.trim().toUpperCase();
    for (const resp of KNOWN_RESPONSAVEIS) {
        if (upper === resp || upper.startsWith(resp + ' ') || upper.startsWith(resp + '.')) return resp;
    }
    return null;
}

console.log('🚀 Ordem de Compra iniciada');
console.log('📍 API URL:', API_URL);
console.log('🔧 Modo desenvolvimento:', DEVELOPMENT_MODE);

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
    if (DEVELOPMENT_MODE) {
        console.log('⚠️ MODO DESENVOLVIMENTO ATIVADO');
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
        sessionStorage.setItem('ordemCompraSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('ordemCompraSession');
    }

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    inicializarApp();
    fetchSessionUser();
}

async function fetchSessionUser() {
    if (!sessionToken) return;
    try {
        const r = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        if (!r.ok) return;
        const d = await r.json();
        if (d.valid && d.session && d.session.name) currentUserName = d.session.name;
    } catch (e) { /* silencioso */ }
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
    // Carrega dados imediatamente — sem aguardar health check
    loadOrdensDirectly();
    loadUltimoNumero();
    loadFornecedoresGlobal();
    // Health check e polling em paralelo
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    setInterval(() => { if (isOnline) loadOrdensDirectly(); }, 10000);
}

async function checkServerStatus() {
    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(`${API_URL.replace('/api', '')}/health`, {
            method: 'GET',
            headers: headers,
            mode: 'cors',
            cache: 'no-cache'
        });

        const wasOffline = !isOnline;
        isOnline = response.ok;
        
        if (wasOffline && isOnline) {
            console.log('✅ SERVIDOR ONLINE');
            await Promise.all([loadOrdensDirectly(), loadUltimoNumero(), loadFornecedoresGlobal()]);
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


// loadOrdensDirectly: cancela fetch anterior via AbortController,
// garante que apenas o mês atualmente visível é renderizado
async function loadOrdensDirectly() {
    // Cancela qualquer requisição anterior em voo
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;

    // Captura o mês/ano no momento do clique — imutável para este fetch
    const mesFetch = currentMonth.getMonth();
    const anoFetch = currentMonth.getFullYear();

    try {
        const headers = { 'Accept': 'application/json' };
        if (!DEVELOPMENT_MODE && sessionToken) headers['X-Session-Token'] = sessionToken;

        const response = await fetch(
            `${API_URL}/ordens?mes=${mesFetch}&ano=${anoFetch}`,
            { method: 'GET', headers, mode: 'cors', cache: 'no-cache', signal }
        );

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('ordemCompraSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        if (!response.ok) return;

        const data = await response.json();

        // Descarta se o usuário já trocou de mês enquanto esperava
        if (mesFetch !== currentMonth.getMonth() || anoFetch !== currentMonth.getFullYear()) return;

        ordens = data;
        isOnline = true;
        updateConnectionStatus();
        mesclarCacheFornecedores(data);
        lastDataHash = JSON.stringify(ordens.map(o => o.id));
        currentFetchController = null; // fetch concluído
        updateDisplay();
    } catch (error) {
        if (error.name === 'AbortError') return; // fetch cancelado — normal
        console.error('Erro ao carregar ordens:', error);
    }
}

// ============================================
// FORNECEDORES GLOBAIS — autocomplete todos os meses
// ============================================
async function loadFornecedoresGlobal() {
    if (!isOnline && !DEVELOPMENT_MODE) return;
    try {
        const headers = { 'Accept': 'application/json' };
        if (!DEVELOPMENT_MODE && sessionToken) headers['X-Session-Token'] = sessionToken;
        const response = await fetch(`${API_URL}/fornecedores`, { headers, cache: 'no-cache' });
        if (!response.ok) return;
        const lista = await response.json();
        lista.forEach(f => {
            const razao = (f.razao_social || '').trim().toUpperCase();
            if (razao && !fornecedoresCache[razao]) {
                fornecedoresCache[razao] = {
                    razaoSocial: (f.razao_social || '').toUpperCase(),
                    nomeFantasia: (f.nome_fantasia || '').toUpperCase(),
                    cnpj: f.cnpj || '',
                    enderecoFornecedor: (f.endereco_fornecedor || '').toUpperCase(),
                    site: f.site || '',
                    contato: (f.contato || '').toUpperCase(),
                    telefone: f.telefone || '',
                    email: f.email || ''
                };
            }
        });
        console.log(`👥 ${Object.keys(fornecedoresCache).length} fornecedores em cache global`);
    } catch (e) { console.error('❌ loadFornecedoresGlobal:', e); }
}

// ============================================
// ÚLTIMO NÚMERO GLOBAL — contador do dashboard
// ============================================
async function loadUltimoNumero() {
    if (!isOnline && !DEVELOPMENT_MODE) return;
    try {
        const headers = { 'Accept': 'application/json' };
        if (!DEVELOPMENT_MODE && sessionToken) headers['X-Session-Token'] = sessionToken;
        const response = await fetch(`${API_URL}/ordens/ultimo-numero`, { headers, cache: 'no-cache' });
        if (!response.ok) return;
        const data = await response.json();
        ultimoNumeroGlobal = data.ultimoNumero || 0;
        console.log(`🔢 Último número global: ${ultimoNumeroGlobal}`);
        updateDashboard();
    } catch (e) { console.error('❌ loadUltimoNumero:', e); }
}

// FUNÇÃO DE SINCRONIZAÇÃO DE DADOS - MENSAGENS SIMPLIFICADAS
async function syncData() {
    console.log('🔄 Iniciando sincronização...');
    
    if (!isOnline && !DEVELOPMENT_MODE) {
        showToast('Erro ao sincronizar', 'error');
        console.log('❌ Sincronização cancelada: servidor offline');
        return;
    }

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const mes = currentMonth.getMonth();
        const ano = currentMonth.getFullYear();
        const response = await fetch(`${API_URL}/ordens?mes=${mes}&ano=${ano}`, {
            method: 'GET',
            headers: headers,
            mode: 'cors',
            cache: 'no-cache'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('ordemCompraSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            throw new Error(`Erro ao sincronizar: ${response.status}`);
        }

        const data = await response.json();
        ordens = data;

        mesclarCacheFornecedores(data);

        lastDataHash = JSON.stringify(ordens.map(o => o.id));
        updateDisplay();

        console.log(`✅ Sincronização concluída: ${ordens.length} ordens em ${mes + 1}/${ano}`);
        showToast('Dados sincronizados', 'success');
        
    } catch (error) {
        console.error('❌ Erro na sincronização:', error);
        showToast('Erro ao sincronizar', 'error');
    }
}

// Mescla no cache global — nunca apaga fornecedores de outros meses
function mesclarCacheFornecedores(lista) {
    lista.forEach(ordem => {
        const razaoSocial = toUpperCase(ordem.razao_social || ordem.razaoSocial || '').trim();
        if (!razaoSocial) return;
        fornecedoresCache[razaoSocial] = {
            razaoSocial: toUpperCase(ordem.razao_social || ordem.razaoSocial),
            nomeFantasia: toUpperCase(ordem.nome_fantasia || ordem.nomeFantasia || ''),
            cnpj: ordem.cnpj || '',
            enderecoFornecedor: toUpperCase(ordem.endereco_fornecedor || ordem.enderecoFornecedor || ''),
            site: ordem.site || '',
            contato: toUpperCase(ordem.contato || ''),
            telefone: ordem.telefone || '',
            email: ordem.email || ''
        };
    });
    console.log(`📋 ${Object.keys(fornecedoresCache).length} fornecedores em cache`);
}

// Alias de compatibilidade
function atualizarCacheFornecedores(lista) { mesclarCacheFornecedores(lista); }

function buscarFornecedoresSimilares(termo) {
    termo = toUpperCase(termo).trim();
    if (termo.length < 2) return [];
    
    return Object.keys(fornecedoresCache)
        .filter(key => key.includes(termo))
        .map(key => fornecedoresCache[key])
        .slice(0, 5);
}

function preencherDadosFornecedor(fornecedor) {
    document.getElementById('razaoSocial').value = fornecedor.razaoSocial;
    document.getElementById('nomeFantasia').value = fornecedor.nomeFantasia;
    document.getElementById('cnpj').value = fornecedor.cnpj;
    document.getElementById('enderecoFornecedor').value = fornecedor.enderecoFornecedor;
    document.getElementById('site').value = fornecedor.site;
    document.getElementById('contato').value = fornecedor.contato;
    document.getElementById('telefone').value = fornecedor.telefone;
    document.getElementById('email').value = fornecedor.email;
    
    const suggestionsDiv = document.getElementById('fornecedorSuggestions');
    if (suggestionsDiv) suggestionsDiv.remove();
    
    showToast('Dados do fornecedor preenchidos!', 'success');
}

function setupFornecedorAutocomplete() {
    const razaoSocialInput = document.getElementById('razaoSocial');
    if (!razaoSocialInput) return;
    
    const newInput = razaoSocialInput.cloneNode(true);
    razaoSocialInput.parentNode.replaceChild(newInput, razaoSocialInput);
    
    newInput.addEventListener('input', function(e) {
        const termo = e.target.value;
        
        let suggestionsDiv = document.getElementById('fornecedorSuggestions');
        if (suggestionsDiv) suggestionsDiv.remove();
        
        if (termo.length < 2) return;
        
        const fornecedores = buscarFornecedoresSimilares(termo);
        
        if (fornecedores.length === 0) return;
        
        suggestionsDiv = document.createElement('div');
        suggestionsDiv.id = 'fornecedorSuggestions';
        suggestionsDiv.style.cssText = `
            position: absolute;
            z-index: 1000;
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            max-height: 300px;
            overflow-y: auto;
            width: 100%;
            margin-top: 4px;
        `;
        
        fornecedores.forEach(fornecedor => {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 12px;
                cursor: pointer;
                border-bottom: 1px solid var(--border-color);
                transition: background 0.2s;
            `;
            
            item.innerHTML = `
                <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">
                    ${fornecedor.razaoSocial}
                </div>
                <div style="font-size: 0.85rem; color: var(--text-secondary);">
                    ${fornecedor.cnpj}${fornecedor.nomeFantasia ? ' | ' + fornecedor.nomeFantasia : ''}
                </div>
            `;
            
            item.addEventListener('mouseenter', () => {
                item.style.background = 'var(--table-hover)';
            });
            
            item.addEventListener('mouseleave', () => {
                item.style.background = 'transparent';
            });
            
            item.addEventListener('click', () => {
                preencherDadosFornecedor(fornecedor);
            });
            
            suggestionsDiv.appendChild(item);
        });
        
        const formGroup = newInput.closest('.form-group');
        formGroup.style.position = 'relative';
        formGroup.appendChild(suggestionsDiv);
    });
    
    document.addEventListener('click', function(e) {
        if (!e.target.closest('.form-group')) {
            const suggestionsDiv = document.getElementById('fornecedorSuggestions');
            if (suggestionsDiv) suggestionsDiv.remove();
        }
    });
}

function changeMonth(direction) {
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    ordens = [];
    lastDataHash = '';
    updateMonthDisplay();
    // Limpa tabela imediatamente — sem rastro do mês anterior
    const container = document.getElementById('ordensContainer');
    if (container) container.innerHTML = '';
    loadOrdensDirectly();
}

function updateMonthDisplay() {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthName = months[currentMonth.getMonth()];
    const year = currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = `${monthName} ${year}`;
}

function switchTab(tabId) {
    const tabIndex = tabs.indexOf(tabId);
    if (tabIndex !== -1) {
        currentTab = tabIndex;
        showTab(currentTab);
        updateNavigationButtons();
    }
}

function showTab(index) {
    const tabButtons = document.querySelectorAll('#formModal .tab-btn');
    const tabContents = document.querySelectorAll('#formModal .tab-content');
    
    tabButtons.forEach(btn => btn.classList.remove('active'));
    tabContents.forEach(content => content.classList.remove('active'));
    
    if (tabButtons[index]) tabButtons[index].classList.add('active');
    if (tabContents[index]) tabContents[index].classList.add('active');
}

function updateNavigationButtons() {
    const btnPrevious = document.getElementById('btnPrevious');
    const btnNext = document.getElementById('btnNext');
    const btnSave = document.getElementById('btnSave');
    
    if (!btnPrevious || !btnNext || !btnSave) return;
    
    if (currentTab > 0) {
        btnPrevious.style.display = 'inline-flex';
    } else {
        btnPrevious.style.display = 'none';
    }
    
    if (currentTab < tabs.length - 1) {
        btnNext.style.display = 'inline-flex';
        btnSave.style.display = 'none';
    } else {
        btnNext.style.display = 'none';
        btnSave.style.display = 'inline-flex';
    }
}

function nextTab() {
    if (currentTab < tabs.length - 1) {
        currentTab++;
        showTab(currentTab);
        updateNavigationButtons();
    }
}

function previousTab() {
    if (currentTab > 0) {
        currentTab--;
        showTab(currentTab);
        updateNavigationButtons();
    }
}

function switchInfoTab(tabId) {
    const infoTabs = ['info-tab-geral', 'info-tab-fornecedor', 'info-tab-pedido', 'info-tab-entrega', 'info-tab-pagamento'];
    const currentIndex = infoTabs.indexOf(tabId);
    
    if (currentIndex !== -1) {
        currentInfoTab = currentIndex;
    }
    
    document.querySelectorAll('#infoModal .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelectorAll('#infoModal .tab-content').forEach(content => {
        content.classList.remove('active');
    });
    
    const clickedBtn = event?.target?.closest('.tab-btn');
    if (clickedBtn) {
        clickedBtn.classList.add('active');
    } else {
        document.querySelectorAll('#infoModal .tab-btn')[currentIndex]?.classList.add('active');
    }
    document.getElementById(tabId).classList.add('active');
    
    updateInfoNavigationButtons();
}

function updateInfoNavigationButtons() {
    const btnInfoPrevious = document.getElementById('btnInfoPrevious');
    const btnInfoNext = document.getElementById('btnInfoNext');
    const btnInfoClose = document.getElementById('btnInfoClose');
    
    if (!btnInfoPrevious || !btnInfoNext || !btnInfoClose) return;
    
    const totalTabs = 5;
    
    if (currentInfoTab > 0) {
        btnInfoPrevious.style.display = 'inline-flex';
    } else {
        btnInfoPrevious.style.display = 'none';
    }
    
    if (currentInfoTab < totalTabs - 1) {
        btnInfoNext.style.display = 'inline-flex';
    } else {
        btnInfoNext.style.display = 'none';
    }
    
    btnInfoClose.style.display = 'inline-flex';
}

function nextInfoTab() {
    const infoTabs = ['info-tab-geral', 'info-tab-fornecedor', 'info-tab-pedido', 'info-tab-entrega', 'info-tab-pagamento'];
    if (currentInfoTab < infoTabs.length - 1) {
        currentInfoTab++;
        switchInfoTab(infoTabs[currentInfoTab]);
    }
}

function previousInfoTab() {
    const infoTabs = ['info-tab-geral', 'info-tab-fornecedor', 'info-tab-pedido', 'info-tab-entrega', 'info-tab-pagamento'];
    if (currentInfoTab > 0) {
        currentInfoTab--;
        switchInfoTab(infoTabs[currentInfoTab]);
    }
}

function openFormModal() {
    editingId = null;
    currentTab = 0;
    itemCounter = 0;
    
    const nextNumber = getNextOrderNumber();
    const today = new Date().toISOString().split('T')[0];
    const autoResponsavel = detectResponsavelFromUser(currentUserName) || '';
    
    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content" style="max-width: 1200px;">
                <div class="modal-header">
                    <h3 class="modal-title">Nova Ordem de Compra</h3>
                    <button class="close-modal" onclick="closeFormModal(true)">✕</button>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchTab('tab-geral')">Geral</button>
                        <button class="tab-btn" onclick="switchTab('tab-fornecedor')">Fornecedor</button>
                        <button class="tab-btn" onclick="switchTab('tab-pedido')">Pedido</button>
                        <button class="tab-btn" onclick="switchTab('tab-entrega')">Entrega</button>
                        <button class="tab-btn" onclick="switchTab('tab-pagamento')">Pagamento</button>
                    </div>

                    <form id="ordemForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="">
                        
                        <div class="tab-content active" id="tab-geral">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="numeroOrdem">Número da Ordem *</label>
                                    <input type="text" id="numeroOrdem" value="${nextNumber}" required>
                                </div>
                                <div class="form-group">
                                    <label for="responsavel">Responsável</label>
                                    <input type="text" id="responsavel" value="${autoResponsavel}" readonly style="background:var(--input-bg);cursor:default;" tabindex="-1">
                                </div>
                                <div class="form-group">
                                    <label for="dataOrdem">Data da Ordem *</label>
                                    <input type="date" id="dataOrdem" value="${today}" required>
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-fornecedor">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="razaoSocial">Razão Social *</label>
                                    <input type="text" id="razaoSocial" required>
                                </div>
                                <div class="form-group">
                                    <label for="nomeFantasia">Nome Fantasia</label>
                                    <input type="text" id="nomeFantasia">
                                </div>
                                <div class="form-group">
                                    <label for="cnpj">CNPJ *</label>
                                    <input type="text" id="cnpj" required>
                                </div>
                                <div class="form-group">
                                    <label for="enderecoFornecedor">Endereço</label>
                                    <input type="text" id="enderecoFornecedor">
                                </div>
                                <div class="form-group">
                                    <label for="site">Site</label>
                                    <input type="text" id="site">
                                </div>
                                <div class="form-group">
                                    <label for="contato">Contato</label>
                                    <input type="text" id="contato">
                                </div>
                                <div class="form-group">
                                    <label for="telefone">Telefone</label>
                                    <input type="text" id="telefone">
                                </div>
                                <div class="form-group">
                                    <label for="email">E-mail</label>
                                    <input type="email" id="email">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-pedido">
                            <button type="button" onclick="addItem()" class="success small" style="margin-bottom: 1rem;">+ Adicionar Item</button>
                            <div style="overflow-x: auto;">
                                <table class="items-table">
                                    <thead>
                                        <tr>
                                            <th style="width: 40px;">Item</th>
                                            <th style="min-width: 200px;">Especificação</th>
                                            <th style="width: 80px;">QTD</th>
                                            <th style="width: 80px;">Unid</th>
                                            <th style="width: 100px;">Valor UN</th>
                                            <th style="width: 100px;">IPI</th>
                                            <th style="width: 100px;">ST</th>
                                            <th style="width: 120px;">Total</th>
                                            <th style="width: 80px;"></th>
                                        </tr>
                                    </thead>
                                    <tbody id="itemsBody"></tbody>
                                </table>
                            </div>
                            <div class="form-group" style="margin-top: 1rem;">
                                <label for="valorTotalOrdem">Valor Total da Ordem</label>
                                <input type="text" id="valorTotalOrdem" readonly value="R$ 0,00">
                            </div>
                            <div class="form-group">
                                <label for="frete">Frete</label>
                                <input type="text" id="frete" value="CIF" placeholder="Ex: CIF, FOB">
                            </div>
                        </div>

                        <div class="tab-content" id="tab-entrega">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="localEntrega">Local de Entrega</label>
                                    <input type="text" id="localEntrega" value="RUA TADORNA Nº 472, SALA 2, NOVO HORIZONTE - SERRA/ES  |  CEP: 29.163-318">
                                </div>
                                <div class="form-group">
                                    <label for="prazoEntrega">Prazo de Entrega</label>
                                    <input type="text" id="prazoEntrega" value="IMEDIATO" placeholder="Ex: 10 dias úteis">
                                </div>
                                <div class="form-group">
                                    <label for="transporte">Transporte</label>
                                    <input type="text" id="transporte" value="FORNECEDOR" placeholder="Ex: Por conta do fornecedor">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-pagamento">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="formaPagamento">Forma de Pagamento *</label>
                                    <input type="text" id="formaPagamento" required placeholder="Ex: Boleto, PIX, Cartão">
                                </div>
                                <div class="form-group">
                                    <label for="prazoPagamento">Prazo de Pagamento *</label>
                                    <input type="text" id="prazoPagamento" required placeholder="Ex: 30 dias">
                                </div>
                                <div class="form-group">
                                    <label for="dadosBancarios">Dados Bancários</label>
                                    <textarea id="dadosBancarios" rows="3"></textarea>
                                </div>
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button type="button" id="btnPrevious" onclick="previousTab()" class="secondary" style="display: none;">Anterior</button>
                            <button type="button" id="btnNext" onclick="nextTab()" class="secondary">Próximo</button>
                            <button type="submit" id="btnSave" class="save" style="display: none;">Salvar</button>
                            <button type="button" onclick="closeFormModal(true)" class="secondary">Cancelar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    addItem();
    
    setTimeout(() => {
        setupFornecedorAutocomplete();
        setupUpperCaseInputs();
        updateNavigationButtons();
        document.getElementById('numeroOrdem')?.focus();
    }, 100);
}

function closeFormModal(showCancelMessage = false) {
    const modal = document.getElementById('formModal');
    if (modal) {
        const editId = document.getElementById('editId')?.value;
        const isEditing = editId && editId !== '';
        
        if (showCancelMessage) {
            showToast(isEditing ? 'Atualização cancelada' : 'Registro cancelado', 'error');
        }
        
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

function addItem() {
    itemCounter++;
    const tbody = document.getElementById('itemsBody');
    const row = document.createElement('tr');
    row.innerHTML = `
        <td style="text-align: center;">${itemCounter}</td>
        <td>
            <textarea class="item-especificacao" placeholder="Descrição do item..." rows="2"></textarea>
        </td>
        <td>
            <input type="number" class="item-qtd" min="0" step="0.01" value="1" onchange="calculateItemTotal(this)">
        </td>
        <td>
            <input type="text" class="item-unid" value="UN" placeholder="UN">
        </td>
        <td>
            <input type="number" class="item-valor" min="0" step="0.01" value="0" onchange="calculateItemTotal(this)">
        </td>
        <td>
            <input type="text" class="item-ipi" placeholder="Ex: 15.50" onchange="calculateItemTotal(this)">
        </td>
        <td>
            <input type="text" class="item-st" placeholder="Ex: Não incluído">
        </td>
        <td>
            <input type="text" class="item-total" readonly value="R$ 0,00">
        </td>
        <td style="text-align: center;">
            <button type="button" class="danger small" onclick="removeItem(this)">Excluir</button>
        </td>
    `;
    tbody.appendChild(row);
    
    setTimeout(() => {
        setupUpperCaseInputs();
    }, 50);
}

function removeItem(btn) {
    const row = btn.closest('tr');
    row.remove();
    recalculateOrderTotal();
    renumberItems();
}

function renumberItems() {
    const rows = document.querySelectorAll('#itemsBody tr');
    rows.forEach((row, index) => {
        row.cells[0].textContent = index + 1;
    });
    itemCounter = rows.length;
}

// ------------------------------------------------------------
// FUNÇÃO calculateItemTotal AGORA INCLUI O IPI NO TOTAL DO ITEM
// ------------------------------------------------------------
function calculateItemTotal(input) {
    const row = input.closest('tr');
    const qtd = parseFloat(row.querySelector('.item-qtd').value) || 0;
    const valor = parseFloat(row.querySelector('.item-valor').value) || 0;
    const ipiStr = row.querySelector('.item-ipi').value;
    const ipiNum = parseFloatLocale(ipiStr);
    let total = qtd * valor;
    if (!isNaN(ipiNum)) {
        total += ipiNum; // soma o valor do IPI (em reais)
    }
    row.querySelector('.item-total').value = formatCurrency(total);
    recalculateOrderTotal();
}

function recalculateOrderTotal() {
    const totals = document.querySelectorAll('.item-total');
    let sum = 0;
    totals.forEach(input => {
        const value = input.value.replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
        sum += parseFloat(value) || 0;
    });
    const totalInput = document.getElementById('valorTotalOrdem');
    if (totalInput) {
        totalInput.value = formatCurrency(sum);
    }
}

async function handleSubmit(event) {
    event.preventDefault();
    
    const items = [];
    const rows = document.querySelectorAll('#itemsBody tr');
    rows.forEach((row, index) => {
        items.push({
            item: index + 1,
            especificacao: toUpperCase(row.querySelector('.item-especificacao').value),
            quantidade: parseFloat(row.querySelector('.item-qtd').value) || 0,
            unidade: toUpperCase(row.querySelector('.item-unid').value),
            valorUnitario: parseFloat(row.querySelector('.item-valor').value) || 0,
            ipi: row.querySelector('.item-ipi').value, // mantém como string
            st: toUpperCase(row.querySelector('.item-st').value || ''),
            valorTotal: row.querySelector('.item-total').value
        });
    });
    
    const formData = {
        numeroOrdem: document.getElementById('numeroOrdem').value,
        responsavel: toUpperCase(document.getElementById('responsavel').value),
        dataOrdem: document.getElementById('dataOrdem').value,
        razaoSocial: toUpperCase(document.getElementById('razaoSocial').value),
        nomeFantasia: toUpperCase(document.getElementById('nomeFantasia').value),
        cnpj: document.getElementById('cnpj').value,
        enderecoFornecedor: toUpperCase(document.getElementById('enderecoFornecedor').value),
        site: document.getElementById('site').value,
        contato: toUpperCase(document.getElementById('contato').value),
        telefone: document.getElementById('telefone').value,
        email: document.getElementById('email').value,
        items: items,
        valorTotal: document.getElementById('valorTotalOrdem').value,
        frete: toUpperCase(document.getElementById('frete').value),
        localEntrega: toUpperCase(document.getElementById('localEntrega').value),
        prazoEntrega: toUpperCase(document.getElementById('prazoEntrega').value),
        transporte: toUpperCase(document.getElementById('transporte').value),
        formaPagamento: toUpperCase(document.getElementById('formaPagamento').value),
        prazoPagamento: toUpperCase(document.getElementById('prazoPagamento').value),
        dadosBancarios: toUpperCase(document.getElementById('dadosBancarios').value),
        status: 'aberta'
    };
    
    if (!isOnline && !DEVELOPMENT_MODE) {
        showToast('Sistema offline. Dados não foram salvos.', 'error');
        closeFormModal();
        return;
    }

    try {
        const url = editingId ? `${API_URL}/ordens/${editingId}` : `${API_URL}/ordens`;
        const method = editingId ? 'PUT' : 'POST';

        const headers = {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(url, {
            method,
            headers: headers,
            body: JSON.stringify(formData),
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('ordemCompraSession');
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

        const savedData = await response.json();

        if (editingId) {
            const index = ordens.findIndex(o => String(o.id) === String(editingId));
            if (index !== -1) ordens[index] = savedData;
            showToast('Ordem atualizada com sucesso!', 'success');
        } else {
            ordens.push(savedData);
            const novoNum = parseInt(savedData.numero_ordem) || 0;
            if (novoNum > ultimoNumeroGlobal) ultimoNumeroGlobal = novoNum;
            showToast('Ordem criada com sucesso!', 'success');
        }

        lastDataHash = JSON.stringify(ordens.map(o => o.id));
        updateDisplay();
        closeFormModal();
    } catch (error) {
        console.error('Erro completo:', error);
        showToast(`Erro: ${error.message}`, 'error');
    }
}

async function editOrdem(id) {
    const ordem = ordens.find(o => String(o.id) === String(id));
    if (!ordem) {
        showToast('Ordem não encontrada!', 'error');
        return;
    }
    
    editingId = id;
    currentTab = 0;
    itemCounter = 0;
    
    const modalHTML = `
        <div class="modal-overlay" id="formModal" style="display: flex;">
            <div class="modal-content" style="max-width: 1200px;">
                <div class="modal-header">
                    <h3 class="modal-title">Editar Ordem de Compra</h3>
                    <button class="close-modal" onclick="closeFormModal(true)">✕</button>
                </div>
                
                <div class="tabs-container">
                    <div class="tabs-nav">
                        <button class="tab-btn active" onclick="switchTab('tab-geral')">Geral</button>
                        <button class="tab-btn" onclick="switchTab('tab-fornecedor')">Fornecedor</button>
                        <button class="tab-btn" onclick="switchTab('tab-pedido')">Pedido</button>
                        <button class="tab-btn" onclick="switchTab('tab-entrega')">Entrega</button>
                        <button class="tab-btn" onclick="switchTab('tab-pagamento')">Pagamento</button>
                    </div>

                    <form id="ordemForm" onsubmit="handleSubmit(event)">
                        <input type="hidden" id="editId" value="${ordem.id}">
                        
                        <div class="tab-content active" id="tab-geral">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="numeroOrdem">Número da Ordem *</label>
                                    <input type="text" id="numeroOrdem" value="${ordem.numero_ordem || ordem.numeroOrdem}" required>
                                </div>
                                <div class="form-group">
                                    <label for="responsavel">Responsável</label>
                                    <input type="text" id="responsavel" value="${toUpperCase(ordem.responsavel || '')}" readonly style="background:var(--input-bg);cursor:default;" tabindex="-1">
                                </div>
                                <div class="form-group">
                                    <label for="dataOrdem">Data da Ordem *</label>
                                    <input type="date" id="dataOrdem" value="${ordem.data_ordem || ordem.dataOrdem}" required>
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-fornecedor">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="razaoSocial">Razão Social *</label>
                                    <input type="text" id="razaoSocial" value="${toUpperCase(ordem.razao_social || ordem.razaoSocial)}" required>
                                </div>
                                <div class="form-group">
                                    <label for="nomeFantasia">Nome Fantasia</label>
                                    <input type="text" id="nomeFantasia" value="${toUpperCase(ordem.nome_fantasia || ordem.nomeFantasia || '')}">
                                </div>
                                <div class="form-group">
                                    <label for="cnpj">CNPJ *</label>
                                    <input type="text" id="cnpj" value="${ordem.cnpj}" required>
                                </div>
                                <div class="form-group">
                                    <label for="enderecoFornecedor">Endereço</label>
                                    <input type="text" id="enderecoFornecedor" value="${toUpperCase(ordem.endereco_fornecedor || ordem.enderecoFornecedor || '')}">
                                </div>
                                <div class="form-group">
                                    <label for="site">Site</label>
                                    <input type="text" id="site" value="${ordem.site || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="contato">Contato</label>
                                    <input type="text" id="contato" value="${toUpperCase(ordem.contato || '')}">
                                </div>
                                <div class="form-group">
                                    <label for="telefone">Telefone</label>
                                    <input type="text" id="telefone" value="${ordem.telefone || ''}">
                                </div>
                                <div class="form-group">
                                    <label for="email">E-mail</label>
                                    <input type="email" id="email" value="${ordem.email || ''}">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-pedido">
                            <button type="button" onclick="addItem()" class="success small" style="margin-bottom: 1rem;">+ Adicionar Item</button>
                            <div style="overflow-x: auto;">
                                <table class="items-table">
                                    <thead>
                                        <tr>
                                            <th style="width: 40px;">Item</th>
                                            <th style="min-width: 200px;">Especificação</th>
                                            <th style="width: 80px;">QTD</th>
                                            <th style="width: 80px;">Unid</th>
                                            <th style="width: 100px;">Valor UN</th>
                                            <th style="width: 100px;">IPI</th>
                                            <th style="width: 100px;">ST</th>
                                            <th style="width: 120px;">Total</th>
                                            <th style="width: 80px;"></th>
                                        </tr>
                                    </thead>
                                    <tbody id="itemsBody"></tbody>
                                </table>
                            </div>
                            <div class="form-group" style="margin-top: 1rem;">
                                <label for="valorTotalOrdem">Valor Total da Ordem</label>
                                <input type="text" id="valorTotalOrdem" readonly value="${ordem.valor_total || ordem.valorTotal}">
                            </div>
                            <div class="form-group">
                                <label for="frete">Frete</label>
                                <input type="text" id="frete" value="${toUpperCase(ordem.frete || 'CIF')}" placeholder="Ex: CIF, FOB">
                            </div>
                        </div>

                        <div class="tab-content" id="tab-entrega">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="localEntrega">Local de Entrega</label>
                                    <input type="text" id="localEntrega" value="${toUpperCase(ordem.local_entrega || ordem.localEntrega || 'RUA TADORNA Nº 472, SALA 2, NOVO HORIZONTE - SERRA/ES  |  CEP: 29.163-318')}">
                                </div>
                                <div class="form-group">
                                    <label for="prazoEntrega">Prazo de Entrega</label>
                                    <input type="text" id="prazoEntrega" value="${toUpperCase(ordem.prazo_entrega || ordem.prazoEntrega || 'IMEDIATO')}" placeholder="Ex: 10 dias úteis">
                                </div>
                                <div class="form-group">
                                    <label for="transporte">Transporte</label>
                                    <input type="text" id="transporte" value="${toUpperCase(ordem.transporte || 'FORNECEDOR')}" placeholder="Ex: Por conta do fornecedor">
                                </div>
                            </div>
                        </div>

                        <div class="tab-content" id="tab-pagamento">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label for="formaPagamento">Forma de Pagamento *</label>
                                    <input type="text" id="formaPagamento" value="${toUpperCase(ordem.forma_pagamento || ordem.formaPagamento)}" required placeholder="Ex: Boleto, PIX, Cartão">
                                </div>
                                <div class="form-group">
                                    <label for="prazoPagamento">Prazo de Pagamento *</label>
                                    <input type="text" id="prazoPagamento" value="${toUpperCase(ordem.prazo_pagamento || ordem.prazoPagamento)}" required placeholder="Ex: 30 dias">
                                </div>
                                <div class="form-group">
                                    <label for="dadosBancarios">Dados Bancários</label>
                                    <textarea id="dadosBancarios" rows="3">${toUpperCase(ordem.dados_bancarios || ordem.dadosBancarios || '')}</textarea>
                                </div>
                            </div>
                        </div>

                        <div class="modal-actions">
                            <button type="button" id="btnPrevious" onclick="previousTab()" class="secondary" style="display: none;">Anterior</button>
                            <button type="button" id="btnNext" onclick="nextTab()" class="secondary">Próximo</button>
                            <button type="submit" id="btnSave" class="save" style="display: none;">Atualizar</button>
                            <button type="button" onclick="closeFormModal(true)" class="secondary">Cancelar</button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
    
    setTimeout(() => {
        setupFornecedorAutocomplete();
        setupUpperCaseInputs();
        updateNavigationButtons();
    }, 100);
    
    if (ordem.items && ordem.items.length > 0) {
        ordem.items.forEach(item => {
            addItem();
            const row = document.querySelector('#itemsBody tr:last-child');
            if (row) {
                row.querySelector('.item-especificacao').value = toUpperCase(item.especificacao || '');
                row.querySelector('.item-qtd').value = item.quantidade || 1;
                row.querySelector('.item-unid').value = toUpperCase(item.unidade || 'UN');
                row.querySelector('.item-valor').value = item.valorUnitario || item.valor_unitario || 0;
                row.querySelector('.item-ipi').value = item.ipi || '';  // valor original
                row.querySelector('.item-st').value = toUpperCase(item.st || '');
                // Recalcula o total do item (incluindo IPI) e atualiza o campo
                calculateItemTotal(row.querySelector('.item-valor')); // qualquer input serve para acionar
            }
        });
    } else {
        addItem();
    }
}

async function deleteOrdem(id) {
    showDeleteModal(id);
}

function showDeleteModal(id) {
    const modalHTML = `
        <div class="modal-overlay" id="deleteModal" style="display: flex;">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="closeDeleteModal()">✕</button>
                <div class="modal-message-delete">
                    Tem certeza que deseja excluir esta ordem?
                </div>
                <div class="modal-actions modal-actions-no-border">
                    <button type="button" onclick="confirmDelete('${id}')" class="danger">Sim</button>
                    <button type="button" onclick="closeDeleteModal()" class="secondary">Cancelar</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function closeDeleteModal() {
    const modal = document.getElementById('deleteModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

async function confirmDelete(id) {
    closeDeleteModal();

    if (!isOnline && !DEVELOPMENT_MODE) {
        showToast('Sistema offline. Não foi possível excluir.', 'error');
        return;
    }

    try {
        const headers = {
            'Accept': 'application/json'
        };
        
        if (!DEVELOPMENT_MODE && sessionToken) {
            headers['X-Session-Token'] = sessionToken;
        }

        const response = await fetch(`${API_URL}/ordens/${id}`, {
            method: 'DELETE',
            headers: headers,
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('ordemCompraSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) throw new Error('Erro ao deletar');

        ordens = ordens.filter(o => String(o.id) !== String(id));
        lastDataHash = JSON.stringify(ordens.map(o => o.id));
        updateDisplay();
        showToast('Ordem excluída com sucesso!', 'success');
    } catch (error) {
        console.error('Erro ao deletar:', error);
        showToast('Erro ao excluir ordem', 'error');
    }
}

async function toggleStatus(id) {
    const ordem = ordens.find(o => String(o.id) === String(id));
    if (!ordem) return;

    const novoStatus = ordem.status === 'aberta' ? 'fechada' : 'aberta';
    const old = { status: ordem.status };
    ordem.status = novoStatus;
    updateDisplay();
    
    if (novoStatus === 'fechada') {
        showToast(`Ordem marcada como ${novoStatus}!`, 'success');
    } else {
        showToast(`Ordem marcada como ${novoStatus}!`, 'error');
    }

    if (isOnline || DEVELOPMENT_MODE) {
        try {
            const headers = {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            };
            
            if (!DEVELOPMENT_MODE && sessionToken) {
                headers['X-Session-Token'] = sessionToken;
            }

            const response = await fetch(`${API_URL}/ordens/${id}/status`, {
                method: 'PATCH',
                headers: headers,
                body: JSON.stringify({ status: novoStatus }),
                mode: 'cors'
            });

            if (!DEVELOPMENT_MODE && response.status === 401) {
                sessionStorage.removeItem('ordemCompraSession');
                mostrarTelaAcessoNegado('Sua sessão expirou');
                return;
            }

            if (!response.ok) throw new Error('Erro ao atualizar');

            const data = await response.json();
            const index = ordens.findIndex(o => String(o.id) === String(id));
            if (index !== -1) ordens[index] = data;
        } catch (error) {
            ordem.status = old.status;
            updateDisplay();
            showToast('Erro ao atualizar status', 'error');
        }
    }
}

function viewOrdem(id) {
    const ordem = ordens.find(o => String(o.id) === String(id));
    if (!ordem) return;
    
    currentInfoTab = 0;
    
    document.getElementById('modalNumero').textContent = ordem.numero_ordem || ordem.numeroOrdem;
    
    document.getElementById('info-tab-geral').innerHTML = `
        <div class="info-section">
            <h4>Informações Gerais</h4>
            <p><strong>Responsável:</strong> ${toUpperCase(ordem.responsavel)}</p>
            <p><strong>Data:</strong> ${formatDate(ordem.data_ordem || ordem.dataOrdem)}</p>
            <p><strong>Status:</strong> <span class="badge ${ordem.status}">${ordem.status.toUpperCase()}</span></p>
        </div>
    `;
    
    document.getElementById('info-tab-fornecedor').innerHTML = `
        <div class="info-section">
            <h4>Dados do Fornecedor</h4>
            <p><strong>Razão Social:</strong> ${toUpperCase(ordem.razao_social || ordem.razaoSocial)}</p>
            ${ordem.nome_fantasia || ordem.nomeFantasia ? `<p><strong>Nome Fantasia:</strong> ${toUpperCase(ordem.nome_fantasia || ordem.nomeFantasia)}</p>` : ''}
            <p><strong>CNPJ:</strong> ${ordem.cnpj}</p>
            ${ordem.endereco_fornecedor || ordem.enderecoFornecedor ? `<p><strong>Endereço:</strong> ${toUpperCase(ordem.endereco_fornecedor || ordem.enderecoFornecedor)}</p>` : ''}
            ${ordem.site ? `<p><strong>Site:</strong> ${ordem.site}</p>` : ''}
            ${ordem.contato ? `<p><strong>Contato:</strong> ${toUpperCase(ordem.contato)}</p>` : ''}
            ${ordem.telefone ? `<p><strong>Telefone:</strong> ${ordem.telefone}</p>` : ''}
            ${ordem.email ? `<p><strong>E-mail:</strong> ${ordem.email}</p>` : ''}
        </div>
    `;
    
    document.getElementById('info-tab-pedido').innerHTML = `
        <div class="info-section">
            <h4>Itens do Pedido</h4>
            <div style="overflow-x: auto;">
                <table style="width: 100%; margin-top: 0.5rem;">
                    <thead>
                        <tr>
                            <th>Item</th>
                            <th>Especificação</th>
                            <th>QTD</th>
                            <th>Unid</th>
                            <th>Valor UN</th>
                            <th>IPI</th>
                            <th>ST</th>
                            <th>Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${ordem.items.map(item => `
                            <tr>
                                <td>${item.item}</td>
                                <td>${toUpperCase(item.especificacao)}</td>
                                <td>${item.quantidade}</td>
                                <td>${toUpperCase(item.unidade)}</td>
                                <td>${formatCurrency(item.valorUnitario || item.valor_unitario || 0)}</td>
                                <td>${item.ipi ? (isNaN(parseFloatLocale(item.ipi)) ? toUpperCase(item.ipi) : formatCurrency(parseFloatLocale(item.ipi))) : '-'}</td>
                                <td>${toUpperCase(item.st || '-')}</td>
                                <td>${item.valorTotal || item.valor_total}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <p style="margin-top: 1rem; font-size: 1.1rem;"><strong>Valor Total:</strong> ${ordem.valor_total || ordem.valorTotal}</p>
            ${ordem.frete ? `<p><strong>Frete:</strong> ${toUpperCase(ordem.frete)}</p>` : ''}
        </div>
    `;
    
    document.getElementById('info-tab-entrega').innerHTML = `
        <div class="info-section">
            <h4>Informações de Entrega</h4>
            ${ordem.local_entrega || ordem.localEntrega ? `<p><strong>Local de Entrega:</strong> ${toUpperCase(ordem.local_entrega || ordem.localEntrega)}</p>` : ''}
            ${ordem.prazo_entrega || ordem.prazoEntrega ? `<p><strong>Prazo de Entrega:</strong> ${toUpperCase(ordem.prazo_entrega || ordem.prazoEntrega)}</p>` : ''}
            ${ordem.transporte ? `<p><strong>Transporte:</strong> ${toUpperCase(ordem.transporte)}</p>` : ''}
        </div>
    `;
    
    document.getElementById('info-tab-pagamento').innerHTML = `
        <div class="info-section">
            <h4>Dados de Pagamento</h4>
            <p><strong>Forma de Pagamento:</strong> ${toUpperCase(ordem.forma_pagamento || ordem.formaPagamento)}</p>
            <p><strong>Prazo de Pagamento:</strong> ${toUpperCase(ordem.prazo_pagamento || ordem.prazoPagamento)}</p>
            ${ordem.dados_bancarios || ordem.dadosBancarios ? `<p><strong>Dados Bancários:</strong> ${toUpperCase(ordem.dados_bancarios || ordem.dadosBancarios)}</p>` : ''}
        </div>
    `;
    
    document.querySelectorAll('#infoModal .tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('#infoModal .tab-content').forEach(content => content.classList.remove('active'));
    document.querySelectorAll('#infoModal .tab-btn')[0].classList.add('active');
    document.getElementById('info-tab-geral').classList.add('active');
    
    document.getElementById('infoModal').classList.add('show');
    
    setTimeout(() => {
        updateInfoNavigationButtons();
    }, 100);
}

function closeInfoModal() {
    const modal = document.getElementById('infoModal');
    if (modal) {
        modal.classList.remove('show');
    }
}

function filterOrdens() {
    updateTable();
}

function updateDisplay() {
    updateMonthDisplay();
    updateDashboard();
    updateTable();
    updateResponsaveisFilter();
}

function updateDashboard() {
    const monthOrdens = getOrdensForCurrentMonth();
    const totalFechadas = monthOrdens.filter(o => o.status === 'fechada').length;
    const totalAbertas = monthOrdens.filter(o => o.status === 'aberta').length;
    
    // Contador global — não zera ao navegar entre meses
    const ultimoNumero = ultimoNumeroGlobal;
    
    let valorTotalMes = 0;
    monthOrdens.forEach(ordem => {
        const valorStr = (ordem.valor_total || ordem.valorTotal || 'R$ 0,00')
            .replace('R$', '')
            .replace(/\./g, '')
            .replace(',', '.')
            .trim();
        const valor = parseFloat(valorStr) || 0;
        valorTotalMes += valor;
    });
    
    document.getElementById('totalOrdens').textContent = ultimoNumero;
    document.getElementById('totalFechadas').textContent = totalFechadas;
    document.getElementById('totalAbertas').textContent = totalAbertas;
    document.getElementById('valorTotal').textContent = formatCurrency(valorTotalMes);
    
    const cardAbertas = document.getElementById('cardAbertas');
    if (!cardAbertas) return;
    
    let pulseBadge = cardAbertas.querySelector('.pulse-badge');
    
    if (totalAbertas > 0) {
        cardAbertas.classList.add('has-alert');
        
        if (!pulseBadge) {
            pulseBadge = document.createElement('div');
            pulseBadge.className = 'pulse-badge';
            cardAbertas.appendChild(pulseBadge);
        }
        pulseBadge.textContent = totalAbertas;
        pulseBadge.style.display = 'flex';
    } else {
        cardAbertas.classList.remove('has-alert');
        if (pulseBadge) {
            pulseBadge.style.display = 'none';
        }
    }
}

function updateTable() {
    const container = document.getElementById('ordensContainer');
    let filteredOrdens = getOrdensForCurrentMonth();
    
    const search = document.getElementById('search').value.toLowerCase();
    const filterResp = document.getElementById('filterResponsavel').value;
    const filterStatus = document.getElementById('filterStatus').value;
    
    if (search) {
        filteredOrdens = filteredOrdens.filter(o => 
            (o.numero_ordem || o.numeroOrdem || '').toLowerCase().includes(search) ||
            (o.razao_social || o.razaoSocial || '').toLowerCase().includes(search) ||
            (o.responsavel || '').toLowerCase().includes(search)
        );
    }
    
    if (filterResp) {
        filteredOrdens = filteredOrdens.filter(o => o.responsavel === filterResp);
    }
    
    if (filterStatus) {
        filteredOrdens = filteredOrdens.filter(o => o.status === filterStatus);
    }
    
    if (filteredOrdens.length === 0) {
        // Só mostra 'vazio' se não há fetch ativo para este mês
        if (currentFetchController) return;
        container.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:2rem;">Nenhuma ordem encontrada</td></tr>`;
        return;
    }
    
    filteredOrdens.sort((a, b) => {
        const numA = parseInt(a.numero_ordem || a.numeroOrdem);
        const numB = parseInt(b.numero_ordem || b.numeroOrdem);
        return numA - numB;
    });
    
    container.innerHTML = filteredOrdens.map(ordem => `
        <tr class="${ordem.status === 'fechada' ? 'row-fechada' : ''}">
            <td style="text-align: center; padding: 8px;">
                <div class="checkbox-wrapper">
                    <input 
                        type="checkbox" 
                        id="check-${ordem.id}"
                        ${ordem.status === 'fechada' ? 'checked' : ''}
                        onchange="toggleStatus('${ordem.id}')"
                        class="styled-checkbox"
                    >
                    <label for="check-${ordem.id}" class="checkbox-label-styled"></label>
                </div>
            </td>
            <td><strong>${ordem.numero_ordem || ordem.numeroOrdem}</strong></td>
            <td>${toUpperCase(ordem.responsavel)}</td>
            <td>${toUpperCase(ordem.razao_social || ordem.razaoSocial)}</td>
            <td style="white-space: nowrap;">${formatDate(ordem.data_ordem || ordem.dataOrdem)}</td>
            <td><strong>${ordem.valor_total || ordem.valorTotal}</strong></td>
            <td>
                <span class="badge ${ordem.status}">${ordem.status.toUpperCase()}</span>
            </td>
            <td class="actions-cell">
                <div class="actions">
                    <button onclick="viewOrdem('${ordem.id}')" class="action-btn view" title="Ver detalhes">Ver</button>
                    <button onclick="editOrdem('${ordem.id}')" class="action-btn edit" title="Editar">Editar</button>
                    <button onclick="generatePDFFromTable('${ordem.id}')" class="action-btn success" title="Gerar PDF">PDF</button>
                    <button onclick="deleteOrdem('${ordem.id}')" class="action-btn delete" title="Excluir">Excluir</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function updateResponsaveisFilter() {
    const responsaveis = new Set();
    ordens.forEach(o => {
        if (o.responsavel?.trim()) {
            responsaveis.add(o.responsavel.trim());
        }
    });

    const select = document.getElementById('filterResponsavel');
    if (select) {
        const currentValue = select.value;
        select.innerHTML = '<option value="">Todos</option>';
        Array.from(responsaveis).sort().forEach(r => {
            const option = document.createElement('option');
            option.value = r;
            option.textContent = toUpperCase(r);
            select.appendChild(option);
        });
        select.value = currentValue;
    }
}

function getOrdensForCurrentMonth() {
    // Dados já filtrados pelo servidor via ?mes=&ano=
    return ordens;
}

function getNextOrderNumber() {
    // Usa número global para evitar duplicatas entre meses
    return ultimoNumeroGlobal > 0 ? (ultimoNumeroGlobal + 1).toString() : '1250';
}

function formatDate(dateString) {
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
}

// FORMATO MONETÁRIO BRASILEIRO
function formatCurrency(value) {
    const num = parseFloat(value);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function showToast(message, type = 'success') {
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


// GERAÇÃO DE PDF
function generatePDFFromTable(id) {
    const ordem = ordens.find(o => String(o.id) === String(id));
    if (!ordem) {
        showToast('Ordem não encontrada!', 'error');
        return;
    }
    
    if (typeof window.jspdf === 'undefined') {
        let attempts = 0;
        const maxAttempts = 5;
        const checkInterval = setInterval(() => {
            attempts++;
            if (typeof window.jspdf !== 'undefined') {
                clearInterval(checkInterval);
                generatePDFForOrdem(ordem);
            } else if (attempts >= maxAttempts) {
                clearInterval(checkInterval);
                showToast('Erro: Biblioteca PDF não carregou. Recarregue a página (F5).', 'error');
                console.error('jsPDF não encontrado após múltiplas tentativas!');
            }
        }, 500);
        return;
    }
    
    generatePDFForOrdem(ordem);
}

function generatePDFForOrdem(ordem) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    let y = 3;
    const margin = 15;
    const pageWidth = doc.internal.pageSize.width;
    const pageHeight = doc.internal.pageSize.height;
    const lineHeight = 5;
    const maxWidth = pageWidth - (2 * margin);
    
    function addTextWithWrap(text, x, yStart, maxW, lineH = 5) {
        const lines = doc.splitTextToSize(text, maxW);
        lines.forEach((line, index) => {
            if (yStart + (index * lineH) > pageHeight - 30) {
                doc.addPage();
                yStart = 20;
            }
            doc.text(line, x, yStart + (index * lineH));
        });
        return yStart + (lines.length * lineH);
    }
    
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
            
            continuarGeracaoPDF(doc, ordem, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap);
            
        } catch (e) {
            console.log('Erro ao adicionar logo no cabeçalho:', e);
            y = 25;
            continuarGeracaoPDF(doc, ordem, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap);
        }
    };
    
    logoHeader.onerror = function() {
        console.log('Erro ao carregar logo do cabeçalho, gerando PDF sem ela');
        y = 25;
        continuarGeracaoPDF(doc, ordem, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap);
    };
}

function continuarGeracaoPDF(doc, ordem, y, margin, pageWidth, pageHeight, lineHeight, maxWidth, addTextWithWrap) {
    const logoHeaderImg = new Image();
    logoHeaderImg.crossOrigin = 'anonymous';
    logoHeaderImg.src = 'I.R.-COMERCIO-E-MATERIAIS-ELETRICOS-LTDA-PDF.png';
    
    logoHeaderImg.onload = function() {
        gerarPDFComCabecalho();
    };
    
    logoHeaderImg.onerror = function() {
        console.log('Erro ao carregar logo do cabeçalho');
        gerarPDFComCabecalho();
    };
    
    function gerarPDFComCabecalho() {
        const logoCarregada = logoHeaderImg.complete && logoHeaderImg.naturalHeight !== 0;
        
        function adicionarCabecalho() {
            if (!logoCarregada) {
                return 20;
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
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.2);
            
            return headerY + logoHeight + 8;
        }
        
        function addPageWithHeader() {
            doc.addPage();
            const newY = adicionarCabecalho();
            return newY;
        }
        
        addTextWithWrap = function(text, x, yStart, maxW, lineH = 5) {
            const lines = doc.splitTextToSize(text, maxW);
            lines.forEach((line, index) => {
                if (yStart + (index * lineH) > pageHeight - 30) {
                    yStart = addPageWithHeader();
                }
                doc.text(line, x, yStart + (index * lineH));
            });
            return yStart + (lines.length * lineH);
        };
    
        doc.setFontSize(18);
        doc.setFont(undefined, 'bold');
        doc.setTextColor(0, 0, 0);
        doc.text('ORDEM DE COMPRA', pageWidth / 2, y, { align: 'center' });
    
        y += 8;
        doc.setFontSize(14);
        doc.text(`Nº ${ordem.numero_ordem || ordem.numeroOrdem}`, pageWidth / 2, y, { align: 'center' });
        
        y += 12;
        
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'bold');
        doc.text('DADOS PARA FATURAMENTO', margin, y);
        
        y += lineHeight + 1;
        doc.setFont(undefined, 'bold');
        doc.text('I.R. COMÉRCIO E MATERIAIS ELÉTRICOS LTDA', margin, y);
        
        y += lineHeight + 1;
        doc.setFont(undefined, 'normal');
        doc.text('CNPJ: 33.149.502/0001-38  |  IE: 083.780.74-2', margin, y);
        
        y += lineHeight + 1;
        doc.text('RUA TADORNA Nº 472, SALA 2', margin, y);
        
        y += lineHeight + 1;
        doc.text('NOVO HORIZONTE - SERRA/ES  |  CEP: 29.163-318', margin, y);
        
        y += lineHeight + 1;
        doc.text('TELEFAX: (27) 3209-4291  |  E-MAIL: COMERCIAL.IRCOMERCIO@GMAIL.COM', margin, y);
        
        y += 10;
        
        doc.setFont(undefined, 'bold');
        doc.text('DADOS DO FORNECEDOR', margin, y);
        
        y += lineHeight + 1;
        
        doc.setFont(undefined, 'normal');
        doc.text('RAZÃO SOCIAL: ', margin, y);
        const razaoSocialWidth = doc.getTextWidth('RAZÃO SOCIAL: ');
        doc.setFont(undefined, 'bold');
        const razaoSocialTexto = toUpperCase(ordem.razao_social || ordem.razaoSocial);
        const razaoLines = doc.splitTextToSize(razaoSocialTexto, maxWidth - razaoSocialWidth);
        doc.text(razaoLines[0], margin + razaoSocialWidth, y);
        y += lineHeight;
        
        if (razaoLines.length > 1) {
            for (let i = 1; i < razaoLines.length; i++) {
                doc.text(razaoLines[i], margin, y);
                y += lineHeight;
            }
        }

        if (ordem.nome_fantasia || ordem.nomeFantasia) {
            y += 1;
            doc.setFont(undefined, 'normal');
            doc.text('NOME FANTASIA: ', margin, y);
            const nomeFantasiaWidth = doc.getTextWidth('NOME FANTASIA: ');
            doc.setFont(undefined, 'normal');
            const nomeFantasiaTexto = toUpperCase(ordem.nome_fantasia || ordem.nomeFantasia);
            const nomeLines = doc.splitTextToSize(nomeFantasiaTexto, maxWidth - nomeFantasiaWidth);
            doc.text(nomeLines[0], margin + nomeFantasiaWidth, y);
            y += lineHeight;
            
            if (nomeLines.length > 1) {
                for (let i = 1; i < nomeLines.length; i++) {
                    doc.text(nomeLines[i], margin, y);
                    y += lineHeight;
                }
            }
        }

        y += 1;
        doc.setFont(undefined, 'normal');
        doc.text('CNPJ: ', margin, y);
        const cnpjWidth = doc.getTextWidth('CNPJ: ');
        doc.setFont(undefined, 'bold');
        doc.text(`${ordem.cnpj}`, margin + cnpjWidth, y);
        y += lineHeight;

        if (ordem.endereco_fornecedor || ordem.enderecoFornecedor) {
            y += 1;
            doc.setFont(undefined, 'normal');
            doc.text('ENDEREÇO: ', margin, y);
            const enderecoWidth = doc.getTextWidth('ENDEREÇO: ');
            const enderecoTexto = toUpperCase(ordem.endereco_fornecedor || ordem.enderecoFornecedor);
            const enderecoLines = doc.splitTextToSize(enderecoTexto, maxWidth - enderecoWidth);
            doc.text(enderecoLines[0], margin + enderecoWidth, y);
            y += lineHeight;
            
            if (enderecoLines.length > 1) {
                for (let i = 1; i < enderecoLines.length; i++) {
                    doc.text(enderecoLines[i], margin, y);
                    y += lineHeight;
                }
            }
        }

        if (ordem.site) {
            y += 1;
            doc.setFont(undefined, 'normal');
            doc.text('SITE: ', margin, y);
            const siteWidth = doc.getTextWidth('SITE: ');
            doc.text(ordem.site, margin + siteWidth, y);
            y += lineHeight;
        }

        if (ordem.contato) {
            y += 1;
            doc.setFont(undefined, 'normal');
            doc.text('CONTATO: ', margin, y);
            const contatoWidth = doc.getTextWidth('CONTATO: ');
            const contatoTexto = toUpperCase(ordem.contato);
            const contatoLines = doc.splitTextToSize(contatoTexto, maxWidth - contatoWidth);
            doc.text(contatoLines[0], margin + contatoWidth, y);
            y += lineHeight;
            
            if (contatoLines.length > 1) {
                for (let i = 1; i < contatoLines.length; i++) {
                    doc.text(contatoLines[i], margin, y);
                    y += lineHeight;
                }
            }
        }

        if (ordem.telefone) {
            y += 1;
            doc.setFont(undefined, 'normal');
            doc.text('TELEFONE: ', margin, y);
            const telefoneWidth = doc.getTextWidth('TELEFONE: ');
            doc.text(`${ordem.telefone}`, margin + telefoneWidth, y);
            y += lineHeight;
        }

        if (ordem.email) {
            y += 1;
            doc.setFont(undefined, 'normal');
            doc.text('E-MAIL: ', margin, y);
            const emailWidth = doc.getTextWidth('E-MAIL: ');
            doc.text(ordem.email, margin + emailWidth, y);
            y += lineHeight;
        }
        
        y += 8;
        
        if (y > pageHeight - 50) {
            y = addPageWithHeader();
        }
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text('ITENS DO PEDIDO', margin, y);
        
        y += 6;
        
        const tableWidth = pageWidth - (2 * margin);
        const colWidths = {
            item: tableWidth * 0.05,
            especificacao: tableWidth * 0.35,
            qtd: tableWidth * 0.08,
            unid: tableWidth * 0.08,
            valorUn: tableWidth * 0.12,
            ipi: tableWidth * 0.10,
            st: tableWidth * 0.10,
            total: tableWidth * 0.12
        };
        
        const itemRowHeight = 10;
        
        doc.setFillColor(108, 117, 125);
        doc.setDrawColor(180, 180, 180);
        doc.rect(margin, y, tableWidth, itemRowHeight, 'FD');
        
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        
        let xPos = margin;
        
        doc.line(xPos, y, xPos, y + itemRowHeight);
        doc.text('ITEM', xPos + (colWidths.item / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.item;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        doc.text('ESPECIFICAÇÃO', xPos + (colWidths.especificacao / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.especificacao;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        doc.text('QTD', xPos + (colWidths.qtd / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.qtd;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        doc.text('UNID', xPos + (colWidths.unid / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.unid;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        doc.text('VALOR UN', xPos + (colWidths.valorUn / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.valorUn;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        doc.text('IPI', xPos + (colWidths.ipi / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.ipi;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        doc.text('ST', xPos + (colWidths.st / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.st;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        doc.text('TOTAL', xPos + (colWidths.total / 2), y + 6.5, { align: 'center' });
        xPos += colWidths.total;
        doc.line(xPos, y, xPos, y + itemRowHeight);
        
        y += itemRowHeight;
        
        doc.setTextColor(0, 0, 0);
        doc.setFontSize(8);
        doc.setFont(undefined, 'normal');
        
        ordem.items.forEach((item, index) => {
            const especificacaoUpper = toUpperCase(item.especificacao);
            const maxWidthEspec = colWidths.especificacao - 6;
            const especLines = doc.splitTextToSize(especificacaoUpper, maxWidthEspec);
            const lineCount = especLines.length;
            const necessaryHeight = Math.max(itemRowHeight, lineCount * 4 + 4);
            
            if (y + necessaryHeight > pageHeight - 30) {
                y = addPageWithHeader();
            }
            
            if (index % 2 !== 0) {
                doc.setFillColor(240, 240, 240);
                doc.rect(margin, y, tableWidth, necessaryHeight, 'F');
            }
            
            xPos = margin;
            
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.3);
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            doc.setFontSize(8);
            doc.setFont(undefined, 'normal');
            doc.text(item.item.toString(), xPos + (colWidths.item / 2), y + (necessaryHeight / 2) + 1.5, { align: 'center' });
            xPos += colWidths.item;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            doc.text(especLines, xPos + 3, y + 4);
            xPos += colWidths.especificacao;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            doc.text(item.quantidade.toString(), xPos + (colWidths.qtd / 2), y + (necessaryHeight / 2) + 1.5, { align: 'center' });
            xPos += colWidths.qtd;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            doc.text(toUpperCase(item.unidade), xPos + (colWidths.unid / 2), y + (necessaryHeight / 2) + 1.5, { align: 'center' });
            xPos += colWidths.unid;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            const valorUn = item.valorUnitario || item.valor_unitario || 0;
            const valorUnFormatted = parseFloat(valorUn).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
            doc.text(valorUnFormatted, xPos + (colWidths.valorUn / 2), y + (necessaryHeight / 2) + 1.5, { align: 'center' });
            xPos += colWidths.valorUn;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            // ------------------------------------------------------------
            // CAMPO IPI: se for numérico, exibe como moeda; senão, exibe o texto original
            // ------------------------------------------------------------
            const ipiValor = item.ipi;
            let ipiDisplay = '-';
            if (ipiValor && ipiValor.trim() !== '') {
                const ipiNum = parseFloatLocale(ipiValor);
                if (!isNaN(ipiNum)) {
                    ipiDisplay = ipiNum.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                } else {
                    ipiDisplay = toUpperCase(ipiValor);
                }
            }
            doc.text(ipiDisplay, xPos + (colWidths.ipi / 2), y + (necessaryHeight / 2) + 1.5, { align: 'center' });
            xPos += colWidths.ipi;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            doc.text(toUpperCase(item.st || '-'), xPos + (colWidths.st / 2), y + (necessaryHeight / 2) + 1.5, { align: 'center' });
            xPos += colWidths.st;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            doc.text(item.valorTotal || item.valor_total, xPos + (colWidths.total / 2), y + (necessaryHeight / 2) + 1.5, { align: 'center' });
            xPos += colWidths.total;
            doc.line(xPos, y, xPos, y + necessaryHeight);
            
            doc.line(margin, y + necessaryHeight, margin + tableWidth, y + necessaryHeight);
            
            y += necessaryHeight;
        });
        
        y += 8;
        
        if (y > pageHeight - 40) {
            y = addPageWithHeader();
        }
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text(`VALOR TOTAL: ${ordem.valor_total || ordem.valorTotal}`, margin, y);
        
        y += 10;
        
        if (y > pageHeight - 60) {
            y = addPageWithHeader();
        }
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text('LOCAL DE ENTREGA:', margin, y);
        y += 5;
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        
        const localPadrao = 'RUA TADORNA Nº 472, SALA 2, NOVO HORIZONTE - SERRA/ES  |  CEP: 29.163-318';
        const localEntregaPDF = (ordem.local_entrega || ordem.localEntrega || '').trim() !== '' 
            ? toUpperCase(ordem.local_entrega || ordem.localEntrega)
            : localPadrao;
        
        y = addTextWithWrap(localEntregaPDF, margin, y, maxWidth);
        
        y += 10;
        
        if (y > pageHeight - 50) {
            y = addPageWithHeader();
        }
        
        doc.setFontSize(10);
        doc.setFont(undefined, 'bold');
        doc.text('PRAZO DE ENTREGA:', margin, y);
        doc.setFont(undefined, 'normal');
        doc.text(toUpperCase(ordem.prazo_entrega || ordem.prazoEntrega || '-'), margin + 42, y);
        
        doc.setFont(undefined, 'bold');
        doc.text('FRETE:', pageWidth - margin - 35, y);
        doc.setFont(undefined, 'normal');
        doc.text(toUpperCase(ordem.frete || '-'), pageWidth - margin - 20, y);
        
        y += 6;
        
        doc.setFont(undefined, 'bold');
        doc.text('TRANSPORTE:', margin, y);
        doc.setFont(undefined, 'normal');
        doc.text(toUpperCase(ordem.transporte || '-'), margin + 30, y);
        
        y += 10;
        
        if (y > pageHeight - 60) {
            y = addPageWithHeader();
        }
        
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text('CONDIÇÕES DE PAGAMENTO:', margin, y);
        y += 5;
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text(`FORMA: ${toUpperCase(ordem.forma_pagamento || ordem.formaPagamento)}`, margin, y);
        y += 5;
        doc.text(`PRAZO: ${toUpperCase(ordem.prazo_pagamento || ordem.prazoPagamento)}`, margin, y);
        
        if (ordem.dados_bancarios || ordem.dadosBancarios) {
            y += 5;
            doc.setFont(undefined, 'bold');
            doc.text('DADOS BANCÁRIOS:', margin, y);
            y += 5;
            doc.setFont(undefined, 'normal');
            const bancarioUpper = toUpperCase(ordem.dados_bancarios || ordem.dadosBancarios);
            y = addTextWithWrap(bancarioUpper, margin, y, maxWidth);
        }
        
        y += 15;
        
        if (y > pageHeight - 80) {
            y = addPageWithHeader();
        }
        
        // DATA ATUAL (NÃO A DATA DA ORDEM) - CORREÇÃO PRINCIPAL
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
                
                yFinal += 12;
                
                if (yFinal > pageHeight - 30) {
                    yFinal = addPageWithHeader();
                }
                
                doc.setFillColor(240, 240, 240);
                doc.rect(margin, yFinal, pageWidth - (2 * margin), 22, 'F');
                doc.setDrawColor(200, 200, 200);
                doc.rect(margin, yFinal, pageWidth - (2 * margin), 22, 'S');
                
                yFinal += 6;
                doc.setFontSize(10);
                doc.setFont(undefined, 'bold');
                doc.setTextColor(255, 82, 29);
                doc.text('ATENÇÃO SR. FORNECEDOR:', margin + 5, yFinal);
                
                yFinal += 5;
                doc.setTextColor(0, 0, 0);
                doc.setFont(undefined, 'normal');
                doc.setFontSize(9);
                doc.text(`1) GENTILEZA MENCIONAR NA NOTA FISCAL O Nº ${ordem.numero_ordem || ordem.numeroOrdem}`, margin + 5, yFinal);
                
                yFinal += 5;
                doc.text('2) FAVOR ENVIAR A NOTA FISCAL ELETRÔNICA (ARQUIVO .XML) PARA: FINANCEIRO.IRCOMERCIO@GMAIL.COM', margin + 5, yFinal);
                
                doc.save(`${toUpperCase(ordem.razao_social || ordem.razaoSocial)}-${ordem.numero_ordem || ordem.numeroOrdem}.pdf`);
                showToast('PDF gerado com sucesso!', 'success');
                
            } catch (e) {
                console.log('Erro ao adicionar assinatura:', e);
                gerarPDFSemAssinatura();
            }
        };

        assinatura.onerror = function() {
            console.log('Erro ao carregar assinatura, gerando PDF sem ela');
            gerarPDFSemAssinatura();
        };
        
        function gerarPDFSemAssinatura() {
            let yFinal = y + 5;
            
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
            
            yFinal += 12;
            
            if (yFinal > pageHeight - 30) {
                yFinal = addPageWithHeader();
            }
            
            doc.setFillColor(240, 240, 240);
            doc.rect(margin, yFinal, pageWidth - (2 * margin), 22, 'F');
            doc.setDrawColor(200, 200, 200);
            doc.rect(margin, yFinal, pageWidth - (2 * margin), 22, 'S');
            
            yFinal += 6;
            doc.setFontSize(10);
            doc.setFont(undefined, 'bold');
            doc.setTextColor(255, 82, 29);
            doc.text('ATENÇÃO SR. FORNECEDOR:', margin + 5, yFinal);
            
            yFinal += 5;
            doc.setTextColor(0, 0, 0);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(9);
            doc.text(`1) GENTILEZA MENCIONAR NA NOTA FISCAL O Nº ${ordem.numero_ordem || ordem.numeroOrdem}`, margin + 5, yFinal);
            
            yFinal += 5;
            doc.text('2) FAVOR ENVIAR A NOTA FISCAL ELETRÔNICA (ARQUIVO .XML) PARA: FINANCEIRO.IRCOMERCIO@GMAIL.COM', margin + 5, yFinal);
            
            doc.save(`${toUpperCase(ordem.razao_social || ordem.razaoSocial)}-${ordem.numero_ordem || ordem.numeroOrdem}.pdf`);
            showToast('PDF gerado (sem assinatura)', 'success');
        }
    }
}
