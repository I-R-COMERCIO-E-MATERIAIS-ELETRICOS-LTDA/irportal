const DEVELOPMENT_MODE = false;
const API_URL = window.location.origin + '/api';

let isOnline = false;
let lastDataHash = '';
let currentMonth = new Date();
let allVendas = [];
let sessionToken = null;
let calendarYear = new Date().getFullYear();

// Controle de modais de métricas e ranking
let currentMetricsYear = new Date().getFullYear();
let currentRankingYear = new Date().getFullYear();

// Usuário atual: pode ser "ROBERTO", "ISAQUE", "MIGUEL", "ROSEMEIRE"
let currentUser = null;
let isAdmin = false;

console.log('🚀 Módulo Vendas iniciado');

document.addEventListener('DOMContentLoaded', async () => {
    if (DEVELOPMENT_MODE) {
        sessionToken = 'dev-mode';
        // Para teste, defina um usuário manualmente (ex: "ROBERTO")
        // Em produção viria de autenticação
        defineCurrentUser();
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        sessionToken = urlParams.get('sessionToken') || sessionStorage.getItem('vendasSession');
        if (!sessionToken) sessionToken = 'no-auth';
        if (urlParams.get('sessionToken')) sessionStorage.setItem('vendasSession', sessionToken);
        defineCurrentUser();
    }
    await inicializarApp();
});

function defineCurrentUser() {
    // Simula identificação do usuário: pode vir de URL, localStorage, etc.
    // Para este exemplo, usamos um prompt apenas se não estiver definido
    let user = localStorage.getItem('currentUser');
    if (!user) {
        user = prompt("Digite seu nome (ROBERTO, ISAQUE, MIGUEL, ROSEMEIRE):", "ROBERTO");
        if (user) {
            user = user.toUpperCase().trim();
            localStorage.setItem('currentUser', user);
        } else {
            user = "ROBERTO";
        }
    }
    currentUser = user;
    isAdmin = (currentUser === "ROBERTO" || currentUser === "ROSEMEIRE");
    // Ajusta interface conforme permissão
    const filterContainer = document.getElementById('vendedorFilterContainer');
    if (filterContainer) {
        filterContainer.style.display = isAdmin ? 'flex' : 'none';
    }
    // Se não for admin, já aplica filtro fixo do vendedor
    if (!isAdmin) {
        const vendedorSelect = document.getElementById('filterVendedor');
        if (vendedorSelect) {
            // Esconde o select visualmente (já está display:none no container)
            vendedorSelect.value = currentUser;
        }
    }
    // Ícone de usuário (ranking) só aparece para admin
    const userIconBtn = document.getElementById('userIconBtn');
    if (userIconBtn) {
        userIconBtn.style.display = isAdmin ? 'flex' : 'none';
    }
}

async function inicializarApp() {
    checkServerStatus();
    await syncData();
    await loadVendas();
    updateMonthDisplay();
    setInterval(checkServerStatus, 15000);
    setInterval(() => syncData(), 120000);
    setInterval(loadVendas, 30000);

    // Adiciona eventos de clique nos cards
    document.getElementById('cardPago').addEventListener('click', () => openMetricsModal('pago'));
    document.getElementById('cardFaturado').addEventListener('click', () => openMetricsModal('faturado'));
    // Ícones do header
    document.getElementById('chartIconBtn').addEventListener('click', () => openMetricsModal('individual'));
    document.getElementById('userIconBtn').addEventListener('click', () => openRankingModal());
}

// ─── Normaliza status_frete ───────────────────────────────────────────
function normalizeStatusFrete(status) {
    if (!status) return '';
    return status.toUpperCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/_/g, ' ');
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

// ─── Filtro de vendas baseado no usuário atual ────────────────────────
function filterVendasByUser(vendas) {
    if (isAdmin) return vendas;
    return vendas.filter(v => (v.vendedor || '').toUpperCase().trim() === currentUser);
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

// ─── PDF (mantido igual, mas respeitando o vendedor logado) ──────────
window.gerarPDF = function () {
    const vendedorSelecionado = (() => {
        if (!isAdmin) return currentUser;
        const select = document.getElementById('filterVendedor');
        return select ? select.value.toUpperCase().trim() : '';
    })();
    if (!vendedorSelecionado) {
        showToast('Selecione um Vendedor', 'error');
        return;
    }
    const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const vendasPagas = allVendas.filter(v => {
        if (!v.data_pagamento) return false;
        if ((v.vendedor || '').toUpperCase().trim() !== vendedorSelecionado) return false;
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
    const totalPago = vendasPagas.reduce((sum, v) =>
        sum + (parseFloat(v.valor_pago) || parseFloat(v.valor_nf) || 0), 0);
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

// ─── Status do servidor ───────────────────────────────────────────────
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
    const currentYear       = currentMonth.getFullYear();
    const currentMonthIndex = currentMonth.getMonth();

    let totalPago      = 0;
    let totalAReceber  = 0;
    let totalEntregue  = 0;
    let totalFaturado  = 0;

    const vendasFiltradas = filterVendasByUser(allVendas);

    for (const v of vendasFiltradas) {
        const valorNF      = parseFloat(v.valor_nf) || 0;
        const statusFrete  = normalizeStatusFrete(v.status_frete);
        const isPago       = !!v.data_pagamento;

        // FATURADO (emissão no mês)
        if (v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalFaturado += valorNF;
            }
        }

        // ENTREGUE (status ENTREGUE e emissão no mês)
        if (statusFrete === 'ENTREGUE' && v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalEntregue++;
            }
        }

        // PAGO (data de pagamento no mês)
        if (isPago && v.data_pagamento) {
            const dataPagamento = new Date(v.data_pagamento + 'T00:00:00');
            if (dataPagamento.getMonth() === currentMonthIndex && dataPagamento.getFullYear() === currentYear) {
                const valorPago = (v.valor_pago != null && !isNaN(parseFloat(v.valor_pago))) ? parseFloat(v.valor_pago) : valorNF;
                totalPago += valorPago;
            }
        }

        // A RECEBER: entregue e não pago (qualquer mês)
        if (statusFrete === 'ENTREGUE' && !isPago) {
            totalAReceber += valorNF;
        }
    }

    document.getElementById('totalPago').textContent      = formatCurrency(totalPago);
    document.getElementById('totalAReceber').textContent  = formatCurrency(totalAReceber);
    document.getElementById('totalEntregue').textContent  = totalEntregue;
    document.getElementById('totalFaturado').textContent  = formatCurrency(totalFaturado);
}

function updateTable() {
    const container = document.getElementById('vendasContainer');
    if (!container) return;

    let filtered = allVendas.filter(v => {
        if (!v.data_emissao) return false;
        const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
        return dataEmissao.getMonth() === currentMonth.getMonth() &&
               dataEmissao.getFullYear() === currentMonth.getFullYear();
    });

    // Aplica filtro de vendedor (admin ou fixo)
    filtered = filterVendasByUser(filtered);

    const search      = (document.getElementById('search')?.value || '').toLowerCase();
    const filterStatus = document.getElementById('filterStatus')?.value || '';

    if (search) {
        filtered = filtered.filter(v =>
            (v.numero_nf || '').toLowerCase().includes(search) ||
            (v.nome_orgao || '').toLowerCase().includes(search)
        );
    }

    if (filterStatus === 'PAGO') {
        filtered = filtered.filter(v => !!v.data_pagamento);
    } else if (filterStatus === 'ENTREGUE') {
        filtered = filtered.filter(v =>
            normalizeStatusFrete(v.status_frete) === 'ENTREGUE' && !v.data_pagamento
        );
    } else if (filterStatus === 'EM TRÂNSITO') {
        filtered = filtered.filter(v =>
            normalizeStatusFrete(v.status_frete) === 'EM TRANSITO'
        );
    }

    filtered.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));

    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    const rows = filtered.map(v => {
        const statusFrete = normalizeStatusFrete(v.status_frete);
        const status = v.data_pagamento ? 'PAGO' : (statusFrete || 'EM TRANSITO');
        const rowClass = status === 'PAGO' ? 'row-pago' : (statusFrete === 'ENTREGUE' ? 'row-entregue' : '');
        const idx = allVendas.indexOf(v);
        return `<tr class="${rowClass}">
            <td><strong>${v.numero_nf || '-'}</strong></td>
            <td>${formatDate(v.data_emissao)}</td>
            <td>${v.vendedor || '-'}</td>
            <td style="word-break:break-word;max-width:220px;">${v.nome_orgao || '-'}</td>
            <td><strong>${formatCurrency(v.valor_nf)}</strong></td>
            <td>${getStatusBadge(status)}</td>
            <td><button class="action-btn view" onclick="viewVenda(${idx})">Ver</button></td>
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
        'PAGO':        { class: 'pago',     text: 'PAGO' },
        'ENTREGUE':    { class: 'entregue', text: 'ENTREGUE' },
        'EM TRANSITO': { class: 'transito', text: 'EM TRÂNSITO' }
    };
    const s = map[status] || { class: 'transito', text: status };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

function viewVenda(idx) {
    const venda = allVendas[idx];
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
                <p><strong>Parcela:</strong> ${venda.numero_parcela || '-'}</p>
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

// ─── MÉTRICAS (MODAL MENSAL/ANUAL) ────────────────────────────────────
function openMetricsModal(type) {
    currentMetricsYear = currentMonth.getFullYear();
    renderMetrics(type);
    document.getElementById('metricsModal').classList.add('show');
}

function renderMetrics(type) {
    const vendasFiltradas = filterVendasByUser(allVendas);
    const year = currentMetricsYear;
    const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

    let html = `<div style="margin-bottom: 20px; text-align:center;"><strong>Ano: ${year}</strong></div>`;
    html += `<div class="metrics-grid">`;

    for (let m = 0; m < 12; m++) {
        let pago = 0, aReceber = 0, faturado = 0;
        for (const v of vendasFiltradas) {
            const valorNF = parseFloat(v.valor_nf) || 0;
            const isPago = !!v.data_pagamento;
            const statusFrete = normalizeStatusFrete(v.status_frete);
            // Data de emissão para faturado
            if (v.data_emissao) {
                const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
                if (dataEmissao.getMonth() === m && dataEmissao.getFullYear() === year) {
                    faturado += valorNF;
                }
            }
            // Pagamento
            if (isPago && v.data_pagamento) {
                const dataPag = new Date(v.data_pagamento + 'T00:00:00');
                if (dataPag.getMonth() === m && dataPag.getFullYear() === year) {
                    const pagoVal = (v.valor_pago != null && !isNaN(parseFloat(v.valor_pago))) ? parseFloat(v.valor_pago) : valorNF;
                    pago += pagoVal;
                }
            }
            // A receber (entregue e não pago) - considerando emissão no mês
            if (statusFrete === 'ENTREGUE' && !isPago && v.data_emissao) {
                const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
                if (dataEmissao.getMonth() === m && dataEmissao.getFullYear() === year) {
                    aReceber += valorNF;
                }
            }
        }
        html += `
            <div class="metrics-month-card">
                <div class="metrics-month-title">${monthNames[m]}</div>
                <div class="metrics-item metrics-pago">Pago: ${formatCurrency(pago)}</div>
                <div class="metrics-item metrics-a-receber">A Receber: ${formatCurrency(aReceber)}</div>
                <div class="metrics-item metrics-faturado">Faturado: ${formatCurrency(faturado)}</div>
            </div>
        `;
    }
    // Totais anuais
    let totalPagoYear = 0, totalAReceberYear = 0, totalFaturadoYear = 0;
    for (const v of vendasFiltradas) {
        const valorNF = parseFloat(v.valor_nf) || 0;
        const isPago = !!v.data_pagamento;
        const statusFrete = normalizeStatusFrete(v.status_frete);
        if (v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getFullYear() === year) totalFaturadoYear += valorNF;
        }
        if (isPago && v.data_pagamento) {
            const dataPag = new Date(v.data_pagamento + 'T00:00:00');
            if (dataPag.getFullYear() === year) {
                const pagoVal = (v.valor_pago != null && !isNaN(parseFloat(v.valor_pago))) ? parseFloat(v.valor_pago) : valorNF;
                totalPagoYear += pagoVal;
            }
        }
        if (statusFrete === 'ENTREGUE' && !isPago && v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getFullYear() === year) totalAReceberYear += valorNF;
        }
    }
    html += `</div><div class="metrics-year-total">
                <strong>Total Ano ${year}:</strong> Pago ${formatCurrency(totalPagoYear)} | A Receber ${formatCurrency(totalAReceberYear)} | Faturado ${formatCurrency(totalFaturadoYear)}
            </div>`;
    document.getElementById('metricsBody').innerHTML = html;
    document.getElementById('metricsTitle').innerText = `Mensal - ${year}`;
}

function changeMetricsYear(delta) {
    currentMetricsYear += delta;
    renderMetrics('individual');
}

function closeMetricsModal() {
    document.getElementById('metricsModal').classList.remove('show');
}

// ─── RANKING ADMIN ────────────────────────────────────────────────────
function openRankingModal() {
    if (!isAdmin) return;
    currentRankingYear = new Date().getFullYear();
    renderRanking();
    document.getElementById('rankingModal').classList.add('show');
}

function renderRanking() {
    const year = currentRankingYear;
    const vendedores = ['ROBERTO', 'ISAQUE', 'MIGUEL'];
    let html = `<div style="margin-bottom: 20px; text-align:center;"><strong>Ano: ${year}</strong></div>`;
    html += `<div class="ranking-grid">`;
    for (const vendedor of vendedores) {
        let totalPago = 0, totalFaturado = 0;
        for (const v of allVendas) {
            if ((v.vendedor || '').toUpperCase().trim() !== vendedor) continue;
            const valorNF = parseFloat(v.valor_nf) || 0;
            const isPago = !!v.data_pagamento;
            if (v.data_emissao) {
                const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
                if (dataEmissao.getFullYear() === year) totalFaturado += valorNF;
            }
            if (isPago && v.data_pagamento) {
                const dataPag = new Date(v.data_pagamento + 'T00:00:00');
                if (dataPag.getFullYear() === year) {
                    const pagoVal = (v.valor_pago != null && !isNaN(parseFloat(v.valor_pago))) ? parseFloat(v.valor_pago) : valorNF;
                    totalPago += pagoVal;
                }
            }
        }
        html += `
            <div class="ranking-card">
                <div class="ranking-vendedor">${vendedor}</div>
                <div class="ranking-item">💰 Pago: ${formatCurrency(totalPago)}</div>
                <div class="ranking-item">📄 Faturado: ${formatCurrency(totalFaturado)}</div>
            </div>
        `;
    }
    html += `</div>`;
    document.getElementById('rankingBody').innerHTML = html;
}

function changeRankingYear(delta) {
    currentRankingYear += delta;
    renderRanking();
}

function closeRankingModal() {
    document.getElementById('rankingModal').classList.remove('show');
}
