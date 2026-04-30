// ============================================
// CONFIGURAÇÃO
// ============================================
const DEVELOPMENT_MODE = false;
const API_URL = window.location.origin + '/api';
const PORTAL_URL = 'https://ir-comercio-portal-zcan.onrender.com';

let isOnline = false;
let lastDataHash = '';
let currentMonth = new Date();
let allVendas = [];
let sessionToken = null;
let calendarYear = new Date().getFullYear();

console.log('🚀 Vendas Consolidada iniciada');
console.log('📍 API URL:', API_URL);

document.addEventListener('DOMContentLoaded', () => {
    if (DEVELOPMENT_MODE) {
        sessionToken = 'dev-mode';
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        sessionToken = urlParams.get('sessionToken') || sessionStorage.getItem('vendasSession');
        if (!sessionToken) sessionToken = 'no-auth';
        if (urlParams.get('sessionToken')) sessionStorage.setItem('vendasSession', sessionToken);
    }
    inicializarApp();
});

function inicializarApp() {
    checkServerStatus();
    loadVendas();
    updateMonthDisplay();
    setInterval(checkServerStatus, 15000);
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
// GERAR PDF
// ============================================
window.gerarPDF = function() {
    const filterVendedor = document.getElementById('filterVendedor');
    const vendedorSelecionado = filterVendedor ? filterVendedor.value : '';
    if (!vendedorSelecionado) {
        showToast('Selecione um Vendedor', 'error');
        return;
    }
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

    // Pagamentos no mês atual (independente da emissão)
    const vendasPagas = allVendas.filter(v => {
        if (v.origem !== 'CONTAS_RECEBER' || !v.data_pagamento) return false;
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
    doc.text(`TOTAL: ${formatCurrency(totalPago)}`, 14, finalY);
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
            await loadVendas();
        }
    } catch (error) {
        console.error('❌ Erro ao verificar status do servidor:', error);
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
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
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
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        const result = await response.json();
        console.log('✅ Sincronização:', result);
        if (result.success) {
            showToast(`✅ ${result.message}`, 'success');
            lastDataHash = '';
            await loadVendas();
        } else {
            showToast(`Erro: ${result.message || 'Sincronização falhou'}`, 'error');
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
// DASHBOARD CORRIGIDO
// ============================================
function loadDashboard() {
    const currentYear = currentMonth.getFullYear();
    const currentMonthIndex = currentMonth.getMonth();

    let totalPago = 0;      // Pagamentos realizados no mês (data_pagamento)
    let totalAReceber = 0;  // Entregues mas não pagos (qualquer mês)
    let totalEntregue = 0;   // Entregas no mês (baseado na data_emissão)
    let totalFaturado = 0;   // Faturamento no mês (data_emissão)

    for (const v of allVendas) {
        const valor = parseFloat(v.valor_nf) || 0;

        // --- FATURADO (emissão no mês) ---
        if (v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalFaturado += valor;
            }
        }

        // --- ENTREGUE (entregas no mês, consideramos status_frete = ENTREGUE E emissão no mês) ---
        if (v.status_frete === 'ENTREGUE' && v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalEntregue++;
            }
        }

        // --- PAGO (data_pagamento no mês) ---
        if (v.data_pagamento) {
            const dataPagamento = new Date(v.data_pagamento + 'T00:00:00');
            if (dataPagamento.getMonth() === currentMonthIndex && dataPagamento.getFullYear() === currentYear) {
                totalPago += valor;
            }
        }

        // --- A RECEBER (entregues E não pagos) ---
        const isEntregue = (v.status_frete === 'ENTREGUE');
        const isPago = (v.data_pagamento !== null && v.data_pagamento !== undefined);
        if (isEntregue && !isPago) {
            totalAReceber += valor;
        }
    }

    // Atualizar elementos HTML
    document.getElementById('totalPago').textContent = formatCurrency(totalPago);
    document.getElementById('totalAReceber').textContent = formatCurrency(totalAReceber);
    document.getElementById('totalEntregue').textContent = totalEntregue;
    document.getElementById('totalFaturado').textContent = formatCurrency(totalFaturado);
}

// ============================================
// RENDERIZAÇÃO DA TABELA (sem alterações relevantes)
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
                return v.origem === 'CONTAS_RECEBER' && v.data_pagamento;
            }
            if (v.origem === 'CONTROLE_FRETE') {
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
                        const statusInfo = getStatusInfo(status);
                        const rowClass = statusInfo.rowClass;
                        return `
                        <tr class="${rowClass}">
                            <td><strong>${venda.numero_nf}</strong></td>
                            <td style="white-space: nowrap;">${formatDate(venda.data_emissao)}</td>
                            <td>${venda.vendedor}</td>
                            <td style="max-width: 200px; word-wrap: break-word; white-space: normal;">${venda.nome_orgao}</td>
                            <td><strong>${formatCurrency(venda.valor_nf)}</strong></td>
                            <td>${getStatusBadge(status)}</td>
                            <td class="actions-cell" style="text-align: center; white-space: nowrap;">
                                <button class="action-btn view" onclick="viewVenda('${venda.id}')" title="Ver detalhes">Ver</button>
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
    if (venda.origem === 'CONTAS_RECEBER' && venda.data_pagamento) return 'PAGO';
    if (venda.origem === 'CONTROLE_FRETE') return venda.status_frete || 'EM_TRANSITO';
    return 'EM_TRANSITO';
}

function getStatusInfo(status) {
    const map = {
        'PAGO': { rowClass: 'row-pago' },
        'ENTREGUE': { rowClass: 'row-entregue' }
    };
    return map[status] || { rowClass: '' };
}

function getStatusBadge(status) {
    const map = {
        'PAGO': { class: 'pago', text: 'PAGO' },
        'ENTREGUE': { class: 'entregue', text: 'ENTREGUE' },
        'EM_TRANSITO': { class: 'transito', text: 'EM TRÂNSITO' },
        'EM TRÂNSITO': { class: 'transito', text: 'EM TRÂNSITO' },
        'AGUARDANDO_COLETA': { class: 'aguardando', text: 'AGUARDANDO COLETA' },
        'AGUARDANDO COLETA': { class: 'aguardando', text: 'AGUARDANDO COLETA' },
        'EXTRAVIADO': { class: 'extraviado', text: 'EXTRAVIADO' },
        'DEVOLVIDO': { class: 'devolvido', text: 'DEVOLVIDO' }
    };
    const s = map[status] || { class: 'transito', text: status.replace(/_/g, ' ') };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

function filterVendas() {
    updateDisplay();
}

function viewVenda(id) {
    const venda = allVendas.find(v => v.id === id);
    if (!venda) return;
    const nfElem = document.getElementById('modalNumeroNF');
    if (nfElem) nfElem.textContent = venda.numero_nf;
    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;

    if (venda.origem === 'CONTAS_RECEBER') {
        modalBody.innerHTML = `
            <div class="info-section">
                <h4>Informações da Conta</h4>
                <p><strong>Número NF:</strong> ${venda.numero_nf}</p>
                <p><strong>Vendedor:</strong> ${venda.vendedor}</p>
                <p><strong>Órgão:</strong> ${venda.nome_orgao}</p>
                <p><strong>Valor:</strong> ${formatCurrency(venda.valor_nf)}</p>
                <p><strong>Data Emissão:</strong> ${formatDate(venda.data_emissao)}</p>
                <p><strong>Data Vencimento:</strong> ${formatDate(venda.data_vencimento)}</p>
                <p><strong>Data Pagamento:</strong> ${venda.data_pagamento ? formatDate(venda.data_pagamento) : '-'}</p>
                <p><strong>Banco:</strong> ${venda.banco || '-'}</p>
                <p><strong>Status:</strong> <span class="badge pago">${venda.status_pagamento}</span></p>
                ${venda.observacoes ? `<p><strong>Observações:</strong> ${venda.observacoes}</p>` : ''}
            </div>
        `;
    } else {
        modalBody.innerHTML = `
            <div class="info-section">
                <h4>Informações do Frete</h4>
                <p><strong>Número NF:</strong> ${venda.numero_nf}</p>
                <p><strong>Vendedor:</strong> ${venda.vendedor}</p>
                <p><strong>Órgão:</strong> ${venda.nome_orgao}</p>
                <p><strong>Valor NF:</strong> ${formatCurrency(venda.valor_nf)}</p>
                <p><strong>Data Emissão:</strong> ${formatDate(venda.data_emissao)}</p>
                ${venda.documento ? `<p><strong>Documento:</strong> ${venda.documento}</p>` : ''}
                ${venda.contato_orgao ? `<p><strong>Contato:</strong> ${venda.contato_orgao}</p>` : ''}
                <p><strong>Transportadora:</strong> ${venda.transportadora || '-'}</p>
                <p><strong>Valor Frete:</strong> ${formatCurrency(venda.valor_frete)}</p>
                ${venda.data_coleta ? `<p><strong>Data Coleta:</strong> ${formatDate(venda.data_coleta)}</p>` : ''}
                ${venda.cidade_destino ? `<p><strong>Cidade Destino:</strong> ${venda.cidade_destino}</p>` : ''}
                ${venda.previsao_entrega ? `<p><strong>Previsão Entrega:</strong> ${formatDate(venda.previsao_entrega)}</p>` : ''}
                <p><strong>Status:</strong> <span class="badge entregue">${venda.status_frete}</span></p>
            </div>
        `;
    }
    const modal = document.getElementById('infoModal');
    if (modal) modal.classList.add('show');
}

function closeInfoModal() {
    const modal = document.getElementById('infoModal');
    if (modal) modal.classList.remove('show');
}

function formatDate(dateString) {
    if (!dateString || dateString === '-') return '-';
    const date = new Date(dateString + 'T00:00:00');
    return date.toLocaleDateString('pt-BR');
}

function formatCurrency(value) {
    if (!value) return 'R$ 0,00';
    const num = parseFloat(value);
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
