// ============================================
// CONFIGURAÇÃO
// ============================================
const API_URL = window.location.origin + '/api';

let lucroData = [];
let isOnline = false;
let sessionToken = null;
let currentMonth = new Date();
let lastDataHash = '';
let currentFetchController = null;
let calendarYear = new Date().getFullYear();
let custoFixoMensal = 0;
let impostoManual = null; // null = automático, número = valor manual

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('lucroSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('lucroSession');
    }

    if (!sessionToken) {
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'SESSION_TOKEN') {
                sessionToken = event.data.token;
                sessionStorage.setItem('lucroSession', sessionToken);
                inicializarApp();
            }
        }, { once: true });

        if (window.parent !== window) {
            window.parent.postMessage({ type: 'REQUEST_SESSION_TOKEN' }, '*');
        }

        setTimeout(() => { if (!sessionToken) mostrarTelaAcessoNegado(); }, 3000);
        return;
    }

    inicializarApp();
});

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:var(--bg-primary);color:var(--text-primary);text-align:center;padding:2rem;">
            <h1 style="font-size:2.2rem;margin-bottom:1rem;">${mensagem}</h1>
            <p style="color:var(--text-secondary);margin-bottom:2rem;">Somente usuários autenticados podem acessar esta área.</p>
            <a href="${window.location.origin}" style="display:inline-block;background:var(--btn-register);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">IR PARA O PORTAL</a>
        </div>
    `;
}

function inicializarApp() {
    updateMonthDisplay();
    loadLucroReal();
    setInterval(() => { if (isOnline) loadLucroReal(); }, 30000);
}

// ============================================
// CONEXÃO
// ============================================
function updateConnectionStatus() { /* removida */ }

async function syncData() {
    const btnSync = document.getElementById('btnSync');
    if (btnSync) { btnSync.classList.add('syncing'); btnSync.disabled = true; }
    try {
        await fetch(`${API_URL}/monitorar-pedidos`, {
            method: 'POST',
            headers: { 'X-Session-Token': sessionToken }
        });
        await loadLucroReal();
        showMessage('DADOS SINCRONIZADOS', 'success');
    } catch {
        showMessage('ERRO AO SINCRONIZAR', 'error');
    } finally {
        if (btnSync) { btnSync.classList.remove('syncing'); btnSync.disabled = false; }
    }
}

// ============================================
// CARREGAR DADOS (com desduplicação por id)
// ============================================
async function loadLucroReal() {
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;
    const mes = currentMonth.getMonth() + 1;
    const ano = currentMonth.getFullYear();

    try {
        const response = await fetch(`${API_URL}/lucro-real?mes=${mes}&ano=${ano}`, {
            headers: { 'X-Session-Token': sessionToken },
            cache: 'no-cache',
            signal
        });

        if (response.status === 401) {
            sessionStorage.removeItem('lucroSession');
            mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU');
            return;
        }
        if (!response.ok) {
            isOnline = false;
            setTimeout(() => loadLucroReal(), 5000);
            return;
        }

        let data = await response.json();
        if (mes !== currentMonth.getMonth() + 1 || ano !== currentMonth.getFullYear()) return;

        // Remover duplicados baseado no campo "id" (UUID único)
        const seen = new Set();
        lucroData = data.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });

        isOnline = true;
        lastDataHash = JSON.stringify(lucroData.map(r => r.id));
        currentFetchController = null;

        custoFixoMensal = lucroData.length > 0
            ? (parseFloat(lucroData[0].custo_fixo_mensal) || 0)
            : 0;

        updateDisplay();
    } catch (error) {
        if (error.name === 'AbortError') return;
        isOnline = false;
        setTimeout(() => loadLucroReal(), 5000);
    }
}

// ============================================
// CUSTO FIXO
// ============================================
async function saveCustoFixo() {
    const valor = parseFloat(document.getElementById('custoFixoInput').value) || 0;
    const mes   = currentMonth.getMonth() + 1;
    const ano   = currentMonth.getFullYear();

    try {
        const response = await fetch(`${API_URL}/custo-fixo`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify({ mes, ano, custo_fixo_mensal: valor })
        });
        if (response.ok) {
            custoFixoMensal = valor;
            lucroData.forEach(r => r.custo_fixo_mensal = valor);
            updateDashboard();
            closeCustoFixoModal();
            showMessage('CUSTO FIXO ATUALIZADO', 'success');
        } else {
            throw new Error('Erro ao salvar');
        }
    } catch {
        showMessage('ERRO AO SALVAR', 'error');
    }
}

function abrirModalCustoFixo() {
    document.getElementById('custoFixoInput').value = custoFixoMensal;
    document.getElementById('editCustoFixoModal').classList.add('show');
}

function closeCustoFixoModal() {
    document.getElementById('editCustoFixoModal').classList.remove('show');
}

// ============================================
// IMPOSTO FEDERAL TOTAL MANUAL
// ============================================
function abrirModalImpostoFixo() {
    const value = impostoManual !== null ? impostoManual : lucroData.reduce((s, r) => s + (r.imposto_federal || 0), 0);
    document.getElementById('impostoFixoInput').value = value;
    document.getElementById('editImpostoModal').classList.add('show');
}

function closeImpostoModal() {
    document.getElementById('editImpostoModal').classList.remove('show');
}

function saveImpostoFixo() {
    const valor = parseFloat(document.getElementById('impostoFixoInput').value) || 0;
    impostoManual = valor;
    updateDashboard();
    closeImpostoModal();
    showMessage('IMPOSTO FEDERAL TOTAL ATUALIZADO', 'success');
}

// ============================================
// CONFIRMAÇÃO PARA VOLTAR AO CÁLCULO AUTOMÁTICO
// ============================================
function showConfirmAutoImposto() {
    document.getElementById('confirmAutoImpostoModal').classList.add('show');
    document.getElementById('btnSimAutoImposto').onclick = () => {
        impostoManual = null;
        updateDashboard();
        closeConfirmAutoImposto();
    };
    document.getElementById('btnNaoAutoImposto').onclick = () => {
        closeConfirmAutoImposto();
    };
}

function closeConfirmAutoImposto() {
    document.getElementById('confirmAutoImpostoModal').classList.remove('show');
}

// ============================================
// NAVEGAÇÃO DE MESES
// ============================================
function changeMonth(direction) {
    if (currentFetchController) currentFetchController.abort();
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);
    lucroData = [];
    lastDataHash = '';
    updateMonthDisplay();
    updateTable();
    loadLucroReal();
}

function updateMonthDisplay() {
    const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    document.getElementById('currentMonth').textContent =
        `${months[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
}

// ============================================
// DISPLAY
// ============================================
function updateDisplay() {
    updateMonthDisplay();
    updateDashboard();
    updateTable();
    updateVendedoresFilter();
}

function updateDashboard() {
    let totalVenda = 0, totalCusto = 0, totalFrete = 0, totalComissao = 0, totalImposto = 0, totalLucroBruto = 0;

    lucroData.forEach(r => {
        totalVenda    += r.venda           || 0;
        totalCusto    += r.custo           || 0;
        totalFrete    += r.frete           || 0;
        totalComissao += r.comissao        || 0;
        totalImposto  += r.imposto_federal || 0;
        totalLucroBruto += (r.venda || 0) - (r.custo || 0) - (r.frete || 0)
                         - (r.comissao || 0) - (r.imposto_federal || 0);
    });

    const impostoExibido = impostoManual !== null ? impostoManual : totalImposto;

    document.getElementById('totalVenda').innerHTML   = `<span class="stat-value-success">${formatarMoeda(totalVenda)}</span>`;
    document.getElementById('totalCusto').innerHTML   = `<span style="color:#EF4444;font-weight:700;">${formatarMoeda(totalCusto)}</span>`;
    document.getElementById('totalFrete').innerHTML   = `<span style="color:#3B82F6;font-weight:700;">${formatarMoeda(totalFrete)}</span>`;
    document.getElementById('totalImposto').innerHTML = `<span style="color:#EF4444;">${formatarMoeda(impostoExibido)}</span>`;

    const lucroBrutoEl = document.getElementById('totalLucroBruto');
    lucroBrutoEl.innerHTML = formatarMoeda(totalLucroBruto);
    lucroBrutoEl.className = 'stat-value';

    const comissaoEl = document.getElementById('totalComissao');
    comissaoEl.innerHTML = formatarMoeda(totalComissao);
    comissaoEl.className = 'stat-value stat-value-commission';

    const lucroRealCalc = totalLucroBruto - custoFixoMensal;
    const lucroRealEl   = document.getElementById('totalLucroReal');
    const iconLucroReal = document.getElementById('iconLucroReal');

    lucroRealEl.innerHTML   = formatarMoeda(lucroRealCalc);
    lucroRealEl.className   = 'stat-value';
    iconLucroReal.className = 'stat-icon';

    if (lucroRealCalc >= 0) {
        lucroRealEl.classList.add('stat-value-success');
        iconLucroReal.classList.add('stat-icon-success');
    } else {
        lucroRealEl.classList.add('stat-value-danger');
        iconLucroReal.classList.add('stat-icon-danger');
    }
}

function updateVendedoresFilter() {
    const vendedores = new Set(lucroData.map(r => r.vendedor).filter(Boolean));
    const select = document.getElementById('filterVendedor');
    const current = select.value;
    select.innerHTML = '<option value="">Vendedor</option>';
    Array.from(vendedores).sort().forEach(v => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = v;
        select.appendChild(opt);
    });
    select.value = current;
}

function filterLucroReal() { updateTable(); }

function updateTable() {
    const container = document.getElementById('lucroContainer');
    let filtered = [...lucroData];

    const search         = document.getElementById('search').value.toLowerCase();
    const filterVendedor = document.getElementById('filterVendedor').value;

    if (search) {
        filtered = filtered.filter(r =>
            (r.nf || '').toLowerCase().includes(search) ||
            (r.vendedor || '').toLowerCase().includes(search)
        );
    }
    if (filterVendedor) {
        filtered = filtered.filter(r => (r.vendedor || '') === filterVendedor);
    }

    filtered.sort((a, b) =>
        (a.nf || '').padStart(10, '0').localeCompare((b.nf || '').padStart(10, '0'))
    );

    if (filtered.length === 0) {
        container.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;">Nenhum registro encontrado</td></tr>';
        return;
    }

    let html = '';
    filtered.forEach(r => {
        const lucroReal  = (r.venda || 0) - (r.custo || 0) - (r.frete || 0)
                         - (r.comissao || 0) - (r.imposto_federal || 0);
        const margem     = r.venda ? (lucroReal / r.venda) * 100 : 0;
        const lucroClass = lucroReal >= 0 ? 'stat-value-success' : 'stat-value-danger';

        html += `
        <tr>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;"><strong>${(r.nf || '-').toUpperCase()}</strong></td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;">${(r.vendedor || '-').toUpperCase()}</td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;">${formatarMoeda(r.venda)}</td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;color:#EF4444;font-weight:700;">${formatarMoeda(r.custo)}</td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;">${formatarMoeda(r.frete)}</td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;">${formatarMoeda(r.comissao)}</td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;color:#EF4444;font-weight:700;">${formatarMoeda(r.imposto_federal)}</td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;font-weight:700;" class="${lucroClass}">${formatarMoeda(lucroReal)}</td>
            <td onclick="abrirEditModal('${r.codigo}')" style="cursor:pointer;">${margem.toFixed(2)}%</td>
            <td style="text-align:center;">
                <button onclick="showDeleteModal('${r.id}', '${(r.nf || '').toUpperCase()}')"
                        style="background:var(--btn-delete);color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">
                    Excluir
                </button>
            </td>
        </tr>`;
    });

    container.innerHTML = html;
}

// ============================================
// EXCLUSÃO – usando 'id' (UUID) para evitar 404
// ============================================
function showDeleteModal(id, nf) {
    const existing = document.getElementById('deleteModal');
    if (existing) existing.remove();

    const modalHTML = `
        <div class="modal-overlay" id="deleteModal" style="display:flex;">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="closeDeleteModal()">✕</button>
                <div class="modal-message-delete">Tem certeza que deseja excluir a NF <strong>${nf}</strong>?</div>
                <div class="modal-actions modal-actions-no-border">
                    <button type="button" onclick="confirmDelete('${id}')" class="danger">Sim</button>
                    <button type="button" onclick="closeDeleteModal()" class="success">Cancelar</button>
                </div>
            </div>
        </div>`;

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
    // Encontrar o registro local para exibir a mensagem com NF
    const registro = lucroData.find(r => r.id === id);
    const nf = registro ? (registro.nf || id) : id;

    try {
        // Rota DELETE agora usa :id (UUID)
        const response = await fetch(`${API_URL}/lucro-real/${id}`, {
            method: 'DELETE',
            headers: { 'X-Session-Token': sessionToken }
        });

        if (response.status === 401) {
            sessionStorage.removeItem('lucroSession');
            mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU');
            return;
        }
        if (!response.ok) throw new Error('Erro ao excluir');

        lucroData = lucroData.filter(r => r.id !== id);
        lastDataHash = JSON.stringify(lucroData.map(r => r.id));
        updateDisplay();
        showMessage(`NF ${nf} EXCLUÍDA`, 'error');
    } catch (error) {
        showMessage('ERRO AO EXCLUIR', 'error');
    }
}

// ============================================
// MODAL DE EDIÇÃO (CUSTO, COMISSÃO, IMPOSTO)
// ============================================
let currentEditCodigo = null;

function abrirEditModal(codigo) {
    const registro = lucroData.find(r => r.codigo === codigo);
    if (!registro) return;

    currentEditCodigo = codigo;
    document.getElementById('editNF').textContent    = registro.nf || '-';
    document.getElementById('editCusto').value       = registro.custo || 0;
    document.getElementById('editComissao').value    = registro.comissao || 0;
    document.getElementById('editImposto').value     = registro.imposto_federal || 0;

    ['editCusto', 'editComissao', 'editImposto'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', handleEnterKey);
    });

    document.getElementById('editModal').classList.add('show');
}

function handleEnterKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveEditModal(); }
}

function closeEditModal() {
    ['editCusto', 'editComissao', 'editImposto'].forEach(id => {
        document.getElementById(id).removeEventListener('keydown', handleEnterKey);
    });
    document.getElementById('editModal').classList.remove('show');
    currentEditCodigo = null;
}

async function saveEditModal() {
    if (!currentEditCodigo) return;

    const novoCusto    = parseFloat(document.getElementById('editCusto').value)    || 0;
    const novaComissao = parseFloat(document.getElementById('editComissao').value) || 0;
    const novoImposto  = parseFloat(document.getElementById('editImposto').value)  || 0;

    try {
        // PATCH usando 'codigo' (ou poderíamos migrar para 'id', mas manter compatibilidade)
        const response = await fetch(`${API_URL}/lucro-real/${currentEditCodigo}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify({ custo: novoCusto, comissao: novaComissao, imposto_federal: novoImposto })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Erro ao salvar');
        }

        const registro = lucroData.find(r => r.codigo === currentEditCodigo);
        if (registro) {
            registro.custo           = novoCusto;
            registro.comissao        = novaComissao;
            registro.imposto_federal = novoImposto;
        }

        updateTable();
        updateDashboard();
        closeEditModal();
        showMessage('VALORES ATUALIZADOS', 'success');

        // Se imposto manual estava ativo, perguntar se deseja retornar ao automático
        if (impostoManual !== null) {
            showConfirmAutoImposto();
        }
    } catch (error) {
        showMessage('ERRO AO SALVAR: ' + error.message, 'error');
    }
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================
function formatarMoeda(valor) {
    if (valor === null || valor === undefined) return 'R$ 0,00';
    return 'R$ ' + parseFloat(valor).toFixed(2)
        .replace('.', ',')
        .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function showMessage(message, type = 'success') {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 2000);
}
