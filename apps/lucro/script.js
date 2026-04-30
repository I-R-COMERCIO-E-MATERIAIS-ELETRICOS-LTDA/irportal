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
// SINCRONIZAÇÃO MANUAL
// ============================================
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
// CARREGAR DADOS
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

        // Remove duplicados pelo campo "id" (UUID único)
        const seen = new Set();
        lucroData = data.filter(item => {
            if (seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });

        // Calcula imposto e comissão automaticamente para registros sem valor manual
        lucroData.forEach(r => {
            // Marca se o registro tem valores manuais salvos no backend
            // Se o backend retornar imposto/comissao como 0, calculamos automaticamente
            // O campo _imposto_manual e _comissao_manual são usados localmente
            if (!r._impostoManualOverride) {
                r._impostoAuto = (r.venda || 0) * (11 / 100);
                r._comissaoAuto = (r.venda || 0) * (1.25 / 100);
            }
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
// HELPERS DE CÁLCULO AUTOMÁTICO
// ============================================
function calcularImpostoAuto(venda) {
    return (parseFloat(venda) || 0) * (11 / 100);
}

function calcularComissaoAuto(venda) {
    return (parseFloat(venda) || 0) * (1.25 / 100);
}

function getImpostoEfetivo(r) {
    // Usa o valor do campo imposto_federal do backend (que pode ter sido salvo manualmente)
    // Para o cálculo de linha, sempre usa o auto baseado na venda
    return calcularImpostoAuto(r.venda);
}

function getComissaoEfetiva(r) {
    return calcularComissaoAuto(r.venda);
}

// ============================================
// CUSTO FIXO MENSAL
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
// IMPOSTO FEDERAL TOTAL MANUAL (somente dashboard)
// ============================================
function abrirModalImpostoFixo() {
    const totalImpostoAuto = lucroData
        .filter(r => !r._cancelada)
        .reduce((s, r) => s + calcularImpostoAuto(r.venda), 0);

    const value = impostoManual !== null ? impostoManual : totalImpostoAuto;
    document.getElementById('impostoFixoInput').value = value.toFixed(2);
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

function calcularImpostoAutomatico() {
    impostoManual = null;
    updateDashboard();
    closeImpostoModal();
    showMessage('IMPOSTO VOLTOU AO CÁLCULO AUTOMÁTICO', 'success');
}

// ============================================
// NAVEGAÇÃO DE MESES
// ============================================
function changeMonth(direction) {
    if (currentFetchController) currentFetchController.abort();
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);
    lucroData = [];
    lastDataHash = '';
    // Reseta o imposto manual ao trocar de mês
    impostoManual = null;
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
    // Filtra apenas registros não cancelados para o dashboard
    const ativos = lucroData.filter(r => !r._cancelada);

    let totalVenda = 0, totalCusto = 0, totalFrete = 0, totalComissao = 0, totalImposto = 0;

    ativos.forEach(r => {
        totalVenda    += r.venda  || 0;
        totalCusto    += r.custo  || 0;
        totalFrete    += r.frete  || 0;
        totalComissao += calcularComissaoAuto(r.venda);
        totalImposto  += calcularImpostoAuto(r.venda);
    });

    const impostoExibido = impostoManual !== null ? impostoManual : totalImposto;

    const totalLucroBruto = totalVenda - totalCusto - totalFrete - totalComissao - impostoExibido;

    document.getElementById('totalVenda').innerHTML   = `<span class="stat-value-success">${formatarMoeda(totalVenda)}</span>`;
    document.getElementById('totalCusto').innerHTML   = `<span style="color:#EF4444;font-weight:700;">${formatarMoeda(totalCusto)}</span>`;
    document.getElementById('totalFrete').innerHTML   = `<span style="color:#3B82F6;font-weight:700;">${formatarMoeda(totalFrete)}</span>`;

    // Indicador visual se o imposto está em modo manual
    const impostoLabel = impostoManual !== null
        ? '<span style="font-size:0.7rem;color:#F59E0B;font-weight:600;margin-left:4px;">MANUAL</span>'
        : '';
    document.getElementById('totalImposto').innerHTML =
        `<span style="color:#EF4444;">${formatarMoeda(impostoExibido)}</span>${impostoLabel}`;

    const lucroBrutoEl = document.getElementById('totalLucroBruto');
    lucroBrutoEl.innerHTML   = formatarMoeda(totalLucroBruto);
    lucroBrutoEl.className   = 'stat-value';

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
        const cancelada = !!r._cancelada;

        // Valores calculados automaticamente
        const imposto  = calcularImpostoAuto(r.venda);
        const comissao = calcularComissaoAuto(r.venda);
        const lucroReal = cancelada ? 0 :
            (r.venda || 0) - (r.custo || 0) - (r.frete || 0) - comissao - imposto;
        const margem = (!cancelada && r.venda) ? (lucroReal / r.venda) * 100 : 0;
        const lucroClass = lucroReal >= 0 ? 'stat-value-success' : 'stat-value-danger';

        // Estilo para linhas canceladas
        const rowStyle = cancelada
            ? 'opacity:0.35;pointer-events:none;'
            : '';
        const cellStyle = cancelada ? 'text-decoration:line-through;' : '';

        // Botão de ação: Cancelar ou Desfazer
        const btnAcao = cancelada
            ? `<button onclick="desfazerCancelamento('${r.id}')"
                       style="background:#6B7280;color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;pointer-events:all;">
                   Desfazer
               </button>`
            : `<button onclick="showCancelModal('${r.id}', '${(r.nf || '').toUpperCase()}')"
                       style="background:var(--btn-delete);color:white;border:none;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">
                   Cancelar
               </button>`;

        html += `
        <tr style="${rowStyle}">
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};${cellStyle}"><strong>${(r.nf || '-').toUpperCase()}</strong></td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};${cellStyle}">${(r.vendedor || '-').toUpperCase()}</td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};${cellStyle}">${formatarMoeda(r.venda)}</td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};color:#EF4444;font-weight:700;${cellStyle}">${formatarMoeda(r.custo)}</td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};${cellStyle}">${formatarMoeda(r.frete)}</td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};${cellStyle}">${cancelada ? '-' : formatarMoeda(comissao)}</td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};color:#EF4444;font-weight:700;${cellStyle}">${cancelada ? '-' : formatarMoeda(imposto)}</td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};font-weight:700;${cellStyle}" class="${cancelada ? '' : lucroClass}">${cancelada ? '-' : formatarMoeda(lucroReal)}</td>
            <td onclick="${cancelada ? '' : `abrirEditModal('${r.codigo}')`}" style="cursor:${cancelada?'default':'pointer'};${cellStyle}">${cancelada ? '-' : margem.toFixed(2) + '%'}</td>
            <td style="text-align:center;">${btnAcao}</td>
        </tr>`;
    });

    container.innerHTML = html;
}

// ============================================
// CANCELAMENTO DE NF (substitui exclusão)
// ============================================
function showCancelModal(id, nf) {
    const existing = document.getElementById('cancelModal');
    if (existing) existing.remove();

    const modalHTML = `
        <div class="modal-overlay" id="cancelModal" style="display:flex;">
            <div class="modal-content modal-delete">
                <button class="close-modal" onclick="closeCancelModal()">✕</button>
                <div class="modal-message-delete">Deseja cancelar a NF <strong>${nf}</strong>?</div>
                <div class="modal-actions modal-actions-no-border">
                    <button type="button" onclick="confirmCancel('${id}')" class="danger">Sim, Cancelar</button>
                    <button type="button" onclick="closeCancelModal()" class="success">Voltar</button>
                </div>
            </div>
        </div>`;

    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function closeCancelModal() {
    const modal = document.getElementById('cancelModal');
    if (modal) {
        modal.style.animation = 'fadeOut 0.2s ease forwards';
        setTimeout(() => modal.remove(), 200);
    }
}

async function confirmCancel(id) {
    closeCancelModal();
    const registro = lucroData.find(r => r.id === id);
    if (!registro) return;

    try {
        // Salva o estado de cancelamento via PATCH
        const response = await fetch(`${API_URL}/lucro-real/${registro.codigo}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify({ cancelada: true })
        });

        if (response.status === 401) {
            sessionStorage.removeItem('lucroSession');
            mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU');
            return;
        }
        if (!response.ok) throw new Error('Erro ao cancelar');

        // Aplica localmente
        registro._cancelada = true;
        updateDisplay();
        showMessage(`NF ${registro.nf || id} CANCELADA`, 'error');
    } catch (error) {
        showMessage('ERRO AO CANCELAR: ' + error.message, 'error');
    }
}

async function desfazerCancelamento(id) {
    const registro = lucroData.find(r => r.id === id);
    if (!registro) return;

    try {
        const response = await fetch(`${API_URL}/lucro-real/${registro.codigo}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify({ cancelada: false })
        });

        if (!response.ok) throw new Error('Erro ao desfazer cancelamento');

        registro._cancelada = false;
        updateDisplay();
        showMessage(`NF ${registro.nf || id} REATIVADA`, 'success');
    } catch (error) {
        showMessage('ERRO AO DESFAZER: ' + error.message, 'error');
    }
}

// ============================================
// MODAL DE EDIÇÃO (apenas CUSTO)
// Imposto e comissão são calculados automaticamente:
//   Imposto = Venda × 11%
//   Comissão = Venda × 1,25%
// ============================================
let currentEditCodigo = null;

function abrirEditModal(codigo) {
    const registro = lucroData.find(r => r.codigo === codigo);
    if (!registro || registro._cancelada) return;

    currentEditCodigo = codigo;

    document.getElementById('editNF').textContent    = registro.nf || '-';
    document.getElementById('editCusto').value       = registro.custo || 0;

    // Exibe os valores calculados automaticamente como informativos
    const imposto  = calcularImpostoAuto(registro.venda);
    const comissao = calcularComissaoAuto(registro.venda);
    const el_imp  = document.getElementById('editImpostoInfo');
    const el_com  = document.getElementById('editComissaoInfo');
    if (el_imp)  el_imp.textContent  = formatarMoeda(imposto);
    if (el_com)  el_com.textContent  = formatarMoeda(comissao);

    document.getElementById('editCusto').addEventListener('keydown', handleEnterKey);
    document.getElementById('editModal').classList.add('show');
}

function handleEnterKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); saveEditModal(); }
}

function closeEditModal() {
    document.getElementById('editCusto').removeEventListener('keydown', handleEnterKey);
    document.getElementById('editModal').classList.remove('show');
    currentEditCodigo = null;
}

async function saveEditModal() {
    if (!currentEditCodigo) return;

    const novoCusto = parseFloat(document.getElementById('editCusto').value) || 0;

    // Calcula automaticamente
    const registro = lucroData.find(r => r.codigo === currentEditCodigo);
    if (!registro) return;

    const novaComissao = calcularComissaoAuto(registro.venda);
    const novoImposto  = calcularImpostoAuto(registro.venda);

    try {
        const response = await fetch(`${API_URL}/lucro-real/${currentEditCodigo}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            body: JSON.stringify({
                custo:           novoCusto,
                comissao:        novaComissao,
                imposto_federal: novoImposto
            })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Erro ao salvar');
        }

        registro.custo           = novoCusto;
        registro.comissao        = novaComissao;
        registro.imposto_federal = novoImposto;

        updateTable();
        updateDashboard();
        closeEditModal();
        showMessage('CUSTO ATUALIZADO', 'success');
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
        div.style.animation = 'slideOutBottom 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 2000);
}
