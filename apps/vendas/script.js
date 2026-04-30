// ============================================
// CONFIGURAÇÃO
// ============================================
const DEVELOPMENT_MODE = false;
const API_URL = window.location.origin + '/api';

let isOnline = false;
let lastDataHash = '';
let currentMonth = new Date();
let allVendas = [];
let sessionToken = null;
let calendarYear = new Date().getFullYear();

console.log('🚀 Módulo Vendas iniciado');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', async () => {
    if (DEVELOPMENT_MODE) {
        sessionToken = 'dev-mode';
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        sessionToken = urlParams.get('sessionToken') || sessionStorage.getItem('vendasSession');
        if (!sessionToken) sessionToken = 'no-auth';
        if (urlParams.get('sessionToken')) sessionStorage.setItem('vendasSession', sessionToken);
    }
    await inicializarApp();
});

async function inicializarApp() {
    checkServerStatus();
    await syncData();
    await loadVendas();
    updateMonthDisplay();
    setInterval(checkServerStatus, 15000);
    setInterval(() => syncData(), 300000);
    setInterval(loadVendas, 30000);
}

function updateMonthDisplay() {
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthStr = `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    const elem = document.getElementById('currentMonth');
    if (elem) elem.textContent = monthStr;
}

function changeMonth(direction) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);
    updateMonthDisplay();
    updateDisplay();
}

function toggleCalendar() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentMonth.getFullYear();
        renderCalendar();
        modal.classList.add('show');
    }
}

function changeCalendarYear(direction) {
    calendarYear += direction;
    renderCalendar();
}

function renderCalendar() {
    const yearElement = document.getElementById('calendarYear');
    const monthsContainer = document.getElementById('calendarMonths');
    if (!yearElement || !monthsContainer) return;
    yearElement.textContent = calendarYear;
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    monthsContainer.innerHTML = '';
    monthNames.forEach((name, index) => {
        const monthButton = document.createElement('div');
        monthButton.className = 'calendar-month';
        monthButton.textContent = name;
        if (calendarYear === currentMonth.getFullYear() && index === currentMonth.getMonth()) {
            monthButton.classList.add('current');
        }
        monthButton.onclick = () => selectMonth(index);
        monthsContainer.appendChild(monthButton);
    });
}

function selectMonth(monthIndex) {
    currentMonth = new Date(calendarYear, monthIndex, 1);
    updateMonthDisplay();
    updateDisplay();
    toggleCalendar();
}

// ============================================
// GERAR PDF (comissão baseada em data_pagamento)
// ============================================
window.gerarPDF = function () {
    const filterVendedor = document.getElementById('filterVendedor');
    const vendedorSelecionado = filterVendedor ? filterVendedor.value : '';
    if (!vendedorSelecionado) {
        showToast('Selecione um Vendedor', 'error');
        return;
    }
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    const vendasPagas = allVendas.filter(v => {
        if (!v.data_pagamento) return false;
        if (v.vendedor !== vendedorSelecionado) return false;
        const dataPagamento = new Date(v.data_pagamento + 'T00:00:00');
        return dataPagamento.getMonth() === currentMonth.getMonth() &&
               dataPagamento.getFullYear() === currentMonth.getFullYear();
    });

    if (vendasPagas.length === 0) {
        showToast('Nenhum pagamento encontrado para este vendedor', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE COMISSÃO', 105, 20, { align: 'center' });
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text(`Vendedor: ${vendedorSelecionado}`, 105, 30, { align: 'center' });
    doc.text(`Período: ${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 105, 37, { align: 'center' });
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 105, 44, { align: 'center' });

    const tableData = vendasPagas.map(v => [
        v.numero_nf,
        formatDate(v.data_emissao),
        formatDate(v.data_pagamento),
        formatCurrency(v.valor_nf)
    ]);

    const totalPago = vendasPagas.reduce((sum, v) => sum + (parseFloat(v.valor_nf) || 0), 0);
    const comissao = totalPago * 0.01;

    doc.autoTable({
        startY: 55,
        head: [['NF', 'Emissão', 'Data Pagamento', 'Valor']],
        body: tableData,
        theme: 'grid',
        headStyles: { fillColor: [100, 100, 100], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 10, cellPadding: 3 },
        columnStyles: { 0: { halign: 'center' }, 1: { halign: 'center' }, 2: { halign: 'center' }, 3: { halign: 'right' } }
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`TOTAL FATURADO: ${formatCurrency(totalPago)}`, 14, finalY);
    doc.text(`COMISSÃO (1%): ${formatCurrency(comissao)}`, 14, finalY + 7);
    doc.save(`RELATÓRIO DE COMISSÃO-${vendedorSelecionado}.pdf`);
    showToast('Relatório gerado com sucesso', 'success');
};

// ============================================
// SINCRONIZAÇÃO E CARREGAMENTO
// ============================================
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/health`, { method: 'GET', mode: 'cors' });
        const wasOffline = !isOnline;
        isOnline = response.ok;
        const statusElem = document.getElementById('connectionStatus');
        if (statusElem) {
            if (isOnline) {
                statusElem.classList.remove('offline');
                statusElem.classList.add('online');
            } else {
                statusElem.classList.remove('online');
                statusElem.classList.add('offline');
            }
        }
        if (wasOffline && isOnline) {
            console.log('✅ Conexão restaurada');
            await syncData();
            await loadVendas();
        }
    } catch (error) {
        console.error('❌ Erro ao verificar status:', error);
        isOnline = false;
        const statusElem = document.getElementById('connectionStatus');
        if (statusElem) {
            statusElem.classList.remove('online');
            statusElem.classList.add('offline');
        }
    }
}

async function loadVendas() {
    try {
        console.log('🔄 Carregando vendas...');
        const response = await fetch(`${API_URL}/vendas`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        console.log(`✅ ${data.length} vendas carregadas`);
        const newHash = JSON.stringify(data.map(v => v.id));
        if (newHash !== lastDataHash) {
            allVendas = data;
            lastDataHash = newHash;
            updateDisplay();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar vendas:', error);
        showToast('Erro ao carregar dados', 'error');
    }
}

async function syncData() {
    showToast('Sincronizando dados...', 'success');
    try {
        const response = await fetch(`${API_URL}/vendas/sincronizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        console.log('✅ Sincronização:', result);
        if (result.success) {
            showToast(`✅ ${result.message}`, 'success');
            lastDataHash = '';
            await loadVendas();
        } else {
            showToast(`Erro: ${result.message || 'Falha na sincronização'}`, 'error');
        }
    } catch (error) {
        console.error('❌ Erro ao sincronizar:', error);
        showToast('Erro ao sincronizar dados', 'error');
    }
}

function updateDisplay() {
    loadDashboard();
    updateTable();
}

// ============================================
// DASHBOARD
// ============================================
function loadDashboard() {
    const currentYear = currentMonth.getFullYear();
    const currentMonthIndex = currentMonth.getMonth();

    let totalPago = 0;
    let totalAReceber = 0;
    let totalEntregue = 0;
    let totalFaturado = 0;

    for (const v of allVendas) {
        const valor = parseFloat(v.valor_nf) || 0;

        if (v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalFaturado += valor;
            }
        }

        if (v.status_frete === 'ENTREGUE' && v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalEntregue++;
            }
        }

        if (v.data_pagamento) {
            const dataPagamento = new Date(v.data_pagamento + 'T00:00:00');
            if (dataPagamento.getMonth() === currentMonthIndex && dataPagamento.getFullYear() === currentYear) {
                totalPago += valor;
            }
        }

        const isEntregue = (v.status_frete === 'ENTREGUE');
        const isPago = (v.data_pagamento !== null && v.data_pagamento !== undefined);
        if (isEntregue && !isPago) {
            totalAReceber += valor;
        }
    }

    document.getElementById('totalPago').textContent = formatCurrency(totalPago);
    document.getElementById('totalAReceber').textContent = formatCurrency(totalAReceber);
    document.getElementById('totalEntregue').textContent = totalEntregue;
    document.getElementById('totalFaturado').textContent = formatCurrency(totalFaturado);
}

// ============================================
// TABELA (filtro por data de emissão)
// ============================================
function updateTable() {
    const container = document.getElementById('vendasContainer');
    if (!container) return;

    const filterVendedor = document.getElementById('filterVendedor');
    const vendedorSelecionado = filterVendedor ? filterVendedor.value : '';

    let monthVendas = allVendas.filter(v => {
        if (!v.data_emissao) return false;
        const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
        return dataEmissao.getMonth() === currentMonth.getMonth() &&
               dataEmissao.getFullYear() === currentMonth.getFullYear();
    });

    let filteredVendas = [...monthVendas];
    if (vendedorSelecionado) {
        filteredVendas = filteredVendas.filter(v => v.vendedor === vendedorSelecionado);
    }

    const searchElem = document.getElementById('search');
    const filterStatusElem = document.getElementById('filterStatus');
    const search = searchElem ? searchElem.value.toLowerCase() : '';
    const filterStatus = filterStatusElem ? filterStatusElem.value : '';

    if (search) {
        filteredVendas = filteredVendas.filter(v =>
            (v.numero_nf || '').toLowerCase().includes(search) ||
            (v.nome_orgao || '').toLowerCase().includes(search)
        );
    }

    if (filterStatus) {
        filteredVendas = filteredVendas.filter(v => {
            if (filterStatus === 'PAGO') {
                return v.data_pagamento !== null && v.data_pagamento !== undefined;
            }
            if (v.status_frete) {
                const statusNorm = normalizeStatus(v.status_frete);
                const filterNorm = normalizeStatus(filterStatus);
                return statusNorm === filterNorm;
            }
            return false;
        });
    }

    filteredVendas.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));

    if (filteredVendas.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    const table = `
        <div style="overflow-x: auto;">
            <table>
                <thead>
                    <tr>
                        <th>NF</th>
                        <th>Emissão</th>
                        <th>Vendedor</th>
                        <th>Órgão</th>
                        <th>Valor NF</th>
                        <th>Status</th>
                        <th style="text-align: center;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${filteredVendas.map(venda => {
                        const status = getStatus(venda);
                        const rowClass = status === 'PAGO' ? 'row-pago' : (status === 'ENTREGUE' ? 'row-entregue' : '');
                        return `
                        <tr class="${rowClass}">
                            <td><strong>${venda.numero_nf}</strong></td>
                            <td style="white-space: nowrap;">${formatDate(venda.data_emissao)}</td>
                            <td>${venda.vendedor}</td>
                            <td style="max-width: 200px; word-wrap: break-word;">${venda.nome_orgao}</td>
                            <td><strong>${formatCurrency(venda.valor_nf)}</strong></td>
                            <td>${getStatusBadge(status)}</td>
                            <td class="actions-cell" style="text-align: center; white-space: nowrap;">
                                <button class="action-btn view" onclick="viewVenda('${venda.id}')">Ver</button>
                            </td>
                        </tr>
                    `}).join('')}
                </tbody>
            </table>
        </div>
    `;
    container.innerHTML = table;
}

function normalizeStatus(status) {
    if (!status) return '';
    return status.toUpperCase().replace(/_/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function getStatus(venda) {
    if (venda.data_pagamento) return 'PAGO';
    if (venda.status_frete === 'ENTREGUE') return 'ENTREGUE';
    return venda.status_frete || 'EM TRÂNSITO';
}

function getStatusBadge(status) {
    const map = {
        'PAGO': { class: 'pago', text: 'PAGO' },
        'ENTREGUE': { class: 'entregue', text: 'ENTREGUE' },
        'EM TRÂNSITO': { class: 'transito', text: 'EM TRÂNSITO' }
    };
    const s = map[status] || { class: 'transito', text: status };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

function filterVendas() {
    updateDisplay();
}

function viewVenda(id) {
    const venda = allVendas.find(v => v.id === id);
    if (!venda) return;
    document.getElementById('modalNumeroNF').textContent = venda.numero_nf;
    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;

    if (venda.data_pagamento) {
        modalBody.innerHTML = `
            <div class="info-section">
                <h4>Pagamento</h4>
                <p><strong>NF:</strong> ${venda.numero_nf}</p>
                <p><strong>Vendedor:</strong> ${venda.vendedor}</p>
                <p><strong>Órgão:</strong> ${venda.nome_orgao}</p>
                <p><strong>Valor:</strong> ${formatCurrency(venda.valor_nf)}</p>
                <p><strong>Emissão:</strong> ${formatDate(venda.data_emissao)}</p>
                <p><strong>Pagamento:</strong> ${formatDate(venda.data_pagamento)}</p>
                <p><strong>Banco:</strong> ${venda.banco || '-'}</p>
                <p><strong>Status Pagto:</strong> ${venda.status_pagamento || 'PAGO'}</p>
            </div>
        `;
    } else {
        modalBody.innerHTML = `
            <div class="info-section">
                <h4>Frete</h4>
                <p><strong>NF:</strong> ${venda.numero_nf}</p>
                <p><strong>Vendedor:</strong> ${venda.vendedor}</p>
                <p><strong>Órgão:</strong> ${venda.nome_orgao}</p>
                <p><strong>Valor NF:</strong> ${formatCurrency(venda.valor_nf)}</p>
                <p><strong>Emissão:</strong> ${formatDate(venda.data_emissao)}</p>
                <p><strong>Transportadora:</strong> ${venda.transportadora || '-'}</p>
                <p><strong>Status:</strong> ${venda.status_frete}</p>
            </div>
        `;
    }
    document.getElementById('infoModal').classList.add('show');
}

function closeInfoModal() {
    document.getElementById('infoModal').classList.remove('show');
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
}

function formatCurrency(value) {
    if (value === null || value === undefined) return 'R$ 0,00';
    const num = parseFloat(value);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function showToast(message, type) {
    const old = document.querySelectorAll('.floating-message');
    old.forEach(el => el.remove());
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOutBottom 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}
