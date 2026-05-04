const DEVELOPMENT_MODE = false;
const API_URL = window.location.origin + '/api';

let isOnline = false;
let lastDataHash = '';
let currentMonth = new Date();
let allVendas = [];
let sessionToken = null;
let calendarYear = new Date().getFullYear();

console.log('🚀 Módulo Vendas iniciado');

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
    setInterval(() => syncData(), 120000);
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
    calendarYear = currentMonth.getFullYear();
    renderCalendar();
    modal.classList.toggle('show');
}

function renderCalendar() {
    const yearElem = document.getElementById('calendarYear');
    if (yearElem) yearElem.textContent = calendarYear;

    const monthNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun',
                        'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    const container = document.getElementById('calendarMonths');
    if (!container) return;

    container.innerHTML = monthNames.map((m, i) => {
        const isCurrent = i === currentMonth.getMonth() && calendarYear === currentMonth.getFullYear();
        return `<div class="calendar-month${isCurrent ? ' current' : ''}" onclick="selectMonth(${i})">${m}</div>`;
    }).join('');
}

function changeCalendarYear(dir) {
    calendarYear += dir;
    renderCalendar();
}

function selectMonth(monthIndex) {
    currentMonth = new Date(calendarYear, monthIndex, 1);
    updateMonthDisplay();
    updateDisplay();
    const modal = document.getElementById('calendarModal');
    if (modal) modal.classList.remove('show');
}

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
        showToast('Nenhum pagamento encontrado para este vendedor no período', 'error');
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.setFontSize(16);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE COMISSÃO', 105, 20, { align: 'center' });
    doc.setFontSize(11);
    doc.setFont(undefined, 'normal');
    doc.text(`Vendedor: ${vendedorSelecionado}`, 105, 28, { align: 'center' });
    doc.text(`Período (pagamentos): ${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 105, 35, { align: 'center' });
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 105, 42, { align: 'center' });

    const tableData = vendasPagas.map(v => [
        v.numero_nf,
        v.nome_orgao || '-',
        formatDate(v.data_emissao),
        formatDate(v.data_pagamento),
        formatCurrency(v.valor_pago || v.valor_nf)
    ]);

    const totalPago = vendasPagas.reduce((sum, v) => sum + (parseFloat(v.valor_pago) || parseFloat(v.valor_nf) || 0), 0);
    const comissao = totalPago * 0.01;

    doc.autoTable({
        startY: 50,
        head: [['NF', 'Órgão', 'Emissão', 'Data Pagamento', 'Valor Pago']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 25 },
            1: { cellWidth: 'auto' },
            2: { halign: 'center', cellWidth: 25 },
            3: { halign: 'center', cellWidth: 25 },
            4: { halign: 'right', cellWidth: 30 }
        }
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11);
    doc.setFont(undefined, 'bold');
    doc.text(`TOTAL PAGO NO MÊS: ${formatCurrency(totalPago)}`, 14, finalY);
    doc.text(`COMISSÃO (1%): ${formatCurrency(comissao)}`, 14, finalY + 7);

    doc.save(`COMISSAO_${vendedorSelecionado}_${monthNames[currentMonth.getMonth()]}_${currentMonth.getFullYear()}.pdf`);
    showToast('Relatório gerado com sucesso', 'success');
};

async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/health`, { method: 'GET', mode: 'cors' });
        const wasOffline = !isOnline;
        isOnline = response.ok;
        const statusElem = document.getElementById('connectionStatus');
        if (statusElem) {
            statusElem.classList.toggle('online', isOnline);
            statusElem.classList.toggle('offline', !isOnline);
        }
        if (wasOffline && isOnline) {
            console.log('✅ Conexão restaurada');
            await syncData();
            await loadVendas();
        }
    } catch (error) {
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

function loadDashboard() {
    const currentYear = currentMonth.getFullYear();
    const currentMonthIndex = currentMonth.getMonth();

    let totalPago = 0;
    let totalAReceber = 0;
    let totalEntregue = 0;
    let totalFaturado = 0;

    for (const v of allVendas) {
        const valorNF = parseFloat(v.valor_nf) || 0;

        // FATURADO (data de emissão)
        if (v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalFaturado += valorNF;
            }
        }

        // ENTREGUE (data de emissão + status entregue)
        if (v.status_frete === 'ENTREGUE' && v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalEntregue++;
            }
        }

        // PAGO (data de pagamento, independente da emissão)
        if (v.data_pagamento) {
            const dataPagamento = new Date(v.data_pagamento + 'T00:00:00');
            if (dataPagamento.getMonth() === currentMonthIndex && dataPagamento.getFullYear() === currentYear) {
                const valorPago = (v.valor_pago !== null && !isNaN(parseFloat(v.valor_pago))) ? parseFloat(v.valor_pago) : valorNF;
                totalPago += valorPago;
            }
        }

        // A RECEBER: NF entregue E não paga (independente do mês)
        if (v.status_frete === 'ENTREGUE' && !v.data_pagamento) {
            totalAReceber += valorNF;
        }
    }

    document.getElementById('totalPago').textContent = formatCurrency(totalPago);
    document.getElementById('totalAReceber').textContent = formatCurrency(totalAReceber);
    document.getElementById('totalEntregue').textContent = totalEntregue;
    document.getElementById('totalFaturado').textContent = formatCurrency(totalFaturado);
}

function updateTable() {
    const container = document.getElementById('vendasContainer');
    if (!container) return;

    const vendedorSelecionado = document.getElementById('filterVendedor')?.value || '';

    let filtered = allVendas.filter(v => {
        if (!v.data_emissao) return false;
        const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
        return dataEmissao.getMonth() === currentMonth.getMonth() &&
               dataEmissao.getFullYear() === currentMonth.getFullYear();
    });

    if (vendedorSelecionado) {
        filtered = filtered.filter(v => v.vendedor === vendedorSelecionado);
    }

    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const filterStatus = document.getElementById('filterStatus')?.value || '';

    if (search) {
        filtered = filtered.filter(v =>
            (v.numero_nf || '').toLowerCase().includes(search) ||
            (v.nome_orgao || '').toLowerCase().includes(search)
        );
    }

    if (filterStatus === 'PAGO') filtered = filtered.filter(v => v.data_pagamento);
    else if (filterStatus === 'ENTREGUE') filtered = filtered.filter(v => v.status_frete === 'ENTREGUE' && !v.data_pagamento);
    else if (filterStatus === 'EM TRÂNSITO') filtered = filtered.filter(v => v.status_frete === 'EM TRÂNSITO');

    filtered.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));

    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    // ✅ CORREÇÃO: HTML da tabela com estrutura correta
    const rows = filtered.map(v => {
        const status = v.data_pagamento ? 'PAGO' : (v.status_frete || 'EM TRÂNSITO');
        const rowClass = status === 'PAGO' ? 'row-pago' : (status === 'ENTREGUE' ? 'row-entregue' : '');
        const nfEscaped = String(v.id).replace(/'/g, "\\'");
        return `<tr class="${rowClass}">
            <td><strong>${v.numero_nf || '-'}</strong></td>
            <td>${formatDate(v.data_emissao)}</td>
            <td>${v.vendedor || '-'}</td>
            <td style="word-break:break-word;max-width:220px;">${v.nome_orgao || '-'}</td>
            <td><strong>${formatCurrency(v.valor_nf)}</strong></td>
            <td>${getStatusBadge(status)}</td>
            <td><button class="action-btn view" onclick="viewVenda('${nfEscaped}')">Ver</button></td>
        </tr>`;
    }).join('');

    container.innerHTML = `
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>NF</th>
                        <th>Emissão</th>
                        <th>Vendedor</th>
                        <th>Órgão</th>
                        <th>Valor NF</th>
                        <th>Status</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
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

function viewVenda(id) {
    const venda = allVendas.find(v => String(v.id) === String(id));
    if (!venda) return;
    document.getElementById('modalNumeroNF').textContent = venda.numero_nf;
    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;

    if (venda.data_pagamento) {
        modalBody.innerHTML = `
            <div class="info-section">
                <h4>Pagamento</h4>
                <p><strong>NF:</strong> ${venda.numero_nf}</p>
                <p><strong>Vendedor:</strong> ${venda.vendedor || '-'}</p>
                <p><strong>Órgão:</strong> ${venda.nome_orgao || '-'}</p>
                <p><strong>Valor NF:</strong> ${formatCurrency(venda.valor_nf)}</p>
                <p><strong>Valor Pago:</strong> ${formatCurrency(venda.valor_pago)}</p>
                <p><strong>Emissão:</strong> ${formatDate(venda.data_emissao)}</p>
                <p><strong>Pagamento:</strong> ${formatDate(venda.data_pagamento)}</p>
                <p><strong>Banco:</strong> ${venda.banco || '-'}</p>
            </div>`;
    } else {
        modalBody.innerHTML = `
            <div class="info-section">
                <h4>Frete</h4>
                <p><strong>NF:</strong> ${venda.numero_nf}</p>
                <p><strong>Vendedor:</strong> ${venda.vendedor || '-'}</p>
                <p><strong>Órgão:</strong> ${venda.nome_orgao || '-'}</p>
                <p><strong>Valor NF:</strong> ${formatCurrency(venda.valor_nf)}</p>
                <p><strong>Emissão:</strong> ${formatDate(venda.data_emissao)}</p>
                <p><strong>Transportadora:</strong> ${venda.transportadora || '-'}</p>
                <p><strong>Status Frete:</strong> ${venda.status_frete || '-'}</p>
                <p><strong>Cidade Destino:</strong> ${venda.cidade_destino || '-'}</p>
                <p><strong>Previsão Entrega:</strong> ${formatDate(venda.previsao_entrega)}</p>
            </div>`;
    }

    document.getElementById('infoModal').classList.add('show');
}

function closeInfoModal() {
    document.getElementById('infoModal').classList.remove('show');
}

function filterVendas() {
    updateDisplay();
}

function formatDate(d) {
    if (!d) return '-';
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

function formatCurrency(v) {
    const num = parseFloat(v);
    if (isNaN(num)) return 'R$ 0,00';
    return `R$ ${num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function showToast(msg, type) {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}
