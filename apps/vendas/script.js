const DEVELOPMENT_MODE = false;
const API_URL = window.location.origin + '/api';

// ─── Usuários e permissões ────────────────────────────────────────────────────
const ADMINS = ['ROBERTO', 'ROSEMEIRE'];
const ALL_VENDEDORES = ['ROBERTO', 'ISAQUE', 'MIGUEL'];

let isOnline = false;
let lastDataHash = '';
let currentMonth = new Date();
let allVendas = [];
let sessionToken = null;
let calendarYear = new Date().getFullYear();
let currentUser = null; // Será definido via sessionToken/URL param

console.log('🚀 Módulo Vendas iniciado');

document.addEventListener('DOMContentLoaded', async () => {
    if (DEVELOPMENT_MODE) {
        sessionToken = 'dev-mode';
        currentUser = 'ROBERTO'; // Para desenvolvimento
    } else {
        const urlParams = new URLSearchParams(window.location.search);
        sessionToken = urlParams.get('sessionToken') || sessionStorage.getItem('vendasSession');
        currentUser = (urlParams.get('user') || sessionStorage.getItem('vendasUser') || 'ROBERTO').toUpperCase().trim();
        if (!sessionToken) sessionToken = 'no-auth';
        if (urlParams.get('sessionToken')) sessionStorage.setItem('vendasSession', sessionToken);
        if (urlParams.get('user')) sessionStorage.setItem('vendasUser', currentUser);
    }

    setupUIByRole();
    await inicializarApp();
});

// ─── Configura a UI de acordo com o papel do usuário ─────────────────────────
function setupUIByRole() {
    const isAdmin = ADMINS.includes(currentUser);

    // Filtro de vendedores: apenas admins veem
    const filterVendedorWrapper = document.getElementById('filterVendedorWrapper');
    if (filterVendedorWrapper) {
        filterVendedorWrapper.style.display = isAdmin ? '' : 'none';
    }

    // Ícone de ranking (usuário): apenas admins
    const iconRanking = document.getElementById('iconRanking');
    if (iconRanking) {
        iconRanking.style.display = isAdmin ? '' : 'none';
    }

    // Pré-seleciona vendedor para não-admins
    if (!isAdmin) {
        const filterVendedor = document.getElementById('filterVendedor');
        if (filterVendedor) filterVendedor.value = currentUser;
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
}

// ─── Normalização de status ───────────────────────────────────────────────────
function normalizeStatusFrete(status) {
    if (!status) return '';
    return status.toUpperCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/_/g, ' ');
}

function resolveStatusFinal(v) {
    if (v.data_pagamento) return 'PAGO';
    const sf = normalizeStatusFrete(v.status_frete);
    if (sf === 'ENTREGUE') return 'ENTREGUE';
    if (sf === 'FORA DO PRAZO') return 'FORA DO PRAZO';
    if (v.previsao_entrega) {
        const previsao = new Date(v.previsao_entrega + 'T00:00:00');
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        if (previsao < hoje && sf !== 'ENTREGUE') return 'FORA DO PRAZO';
    }
    return sf || 'EM TRÂNSITO';
}

// ─── Helpers de exibição ──────────────────────────────────────────────────────
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

// ─── Navegação de meses ───────────────────────────────────────────────────────
const monthNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const monthNamesShort = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

function updateMonthDisplay() {
    const elem = document.getElementById('currentMonth');
    if (elem) elem.textContent = `${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
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
    const container = document.getElementById('calendarMonths');
    if (!container) return;
    container.innerHTML = monthNamesShort.map((m, i) => {
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
    document.getElementById('calendarModal')?.classList.remove('show');
}

// ─── Geração de PDF ───────────────────────────────────────────────────────────
window.gerarPDF = function () {
    const filterVendedor = document.getElementById('filterVendedor');
    const isAdmin = ADMINS.includes(currentUser);
    const vendedorSelecionado = isAdmin
        ? (filterVendedor?.value.toUpperCase().trim() || '')
        : currentUser;

    if (!vendedorSelecionado) {
        showToast('Selecione um Vendedor', 'error');
        return;
    }

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
    doc.setFontSize(16); doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE COMISSÃO', 105, 20, { align: 'center' });
    doc.setFontSize(11); doc.setFont(undefined, 'normal');
    doc.text(`Vendedor: ${vendedorSelecionado}`, 105, 28, { align: 'center' });
    doc.text(`Período (pagamentos): ${monthNames[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 105, 35, { align: 'center' });
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 105, 42, { align: 'center' });

    const tableData = vendasPagas.map(v => [
        v.numero_nf,
        v.nome_orgao || '-',
        formatDate(v.data_emissao),
        formatDate(v.data_pagamento),
        v.numero_parcela ? `${v.numero_parcela} parcelas` : '-',
        formatCurrency(v.valor_pago || v.valor_nf)
    ]);

    const totalPago = vendasPagas.reduce((sum, v) =>
        sum + (parseFloat(v.valor_pago) || parseFloat(v.valor_nf) || 0), 0);
    const comissao = totalPago * 0.01;

    doc.autoTable({
        startY: 50,
        head: [['NF', 'Órgão', 'Emissão', 'Pagamento', 'Parcelas', 'Valor Pago']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [100, 100, 100], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
        styles: { fontSize: 9, cellPadding: 3 },
        columnStyles: {
            0: { halign: 'center', cellWidth: 25 },
            1: { cellWidth: 'auto' },
            2: { halign: 'center', cellWidth: 25 },
            3: { halign: 'center', cellWidth: 25 },
            4: { halign: 'center', cellWidth: 25 },
            5: { halign: 'right', cellWidth: 30 }
        }
    });

    const finalY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(11); doc.setFont(undefined, 'bold');
    doc.text(`TOTAL PAGO NO MÊS: ${formatCurrency(totalPago)}`, 14, finalY);
    doc.text(`COMISSÃO (1%): ${formatCurrency(comissao)}`, 14, finalY + 7);
    doc.save(`COMISSAO_${vendedorSelecionado}_${monthNames[currentMonth.getMonth()]}_${currentMonth.getFullYear()}.pdf`);
    showToast('Relatório gerado com sucesso', 'success');
};

// ─── Status do servidor ───────────────────────────────────────────────────────
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
            await syncData();
            await loadVendas();
        }
    } catch {
        isOnline = false;
        const statusElem = document.getElementById('connectionStatus');
        if (statusElem) { statusElem.classList.remove('online'); statusElem.classList.add('offline'); }
    }
}

// ─── Carrega vendas da API ────────────────────────────────────────────────────
async function loadVendas() {
    try {
        const response = await fetch(`${API_URL}/vendas`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        const newHash = JSON.stringify(data.map(v => v.id + (v.updated_at || '')));
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

// ─── Filtra vendas pelo usuário atual ─────────────────────────────────────────
function getVendasParaUsuario() {
    const isAdmin = ADMINS.includes(currentUser);
    if (isAdmin) return allVendas;
    return allVendas.filter(v => (v.vendedor || '').toUpperCase().trim() === currentUser);
}

// ─── Dashboard principal ──────────────────────────────────────────────────────
function loadDashboard() {
    const currentYear       = currentMonth.getFullYear();
    const currentMonthIndex = currentMonth.getMonth();
    const vendas = getVendasParaUsuario();

    let totalPago      = 0;
    let totalAReceber  = 0;
    let totalEntregue  = 0;
    let totalFaturado  = 0;

    for (const v of vendas) {
        const valorNF      = parseFloat(v.valor_nf) || 0;
        const statusFrete  = normalizeStatusFrete(v.status_frete);

        if (v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalFaturado += valorNF;
            }
        }

        if (statusFrete === 'ENTREGUE' && v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalEntregue++;
            }
        }

        if (v.data_pagamento) {
            const dataPagamento = new Date(v.data_pagamento + 'T00:00:00');
            if (dataPagamento.getMonth() === currentMonthIndex && dataPagamento.getFullYear() === currentYear) {
                const valorPago = (v.valor_pago != null && !isNaN(parseFloat(v.valor_pago)))
                    ? parseFloat(v.valor_pago) : valorNF;
                totalPago += valorPago;
            }
        }

        if (statusFrete === 'ENTREGUE' && !v.data_pagamento) {
            totalAReceber += valorNF;
        }
    }

    document.getElementById('totalPago').textContent      = formatCurrency(totalPago);
    document.getElementById('totalAReceber').textContent  = formatCurrency(totalAReceber);
    document.getElementById('totalEntregue').textContent  = totalEntregue;
    document.getElementById('totalFaturado').textContent  = formatCurrency(totalFaturado);
}

// ─── Clique no dashboard PAGO → abre modal mensal ────────────────────────────
function openDashboardModal(tipo) {
    // tipo: 'pago' | 'faturado'
    const vendas = getVendasParaUsuario();
    const anoAtual = currentMonth.getFullYear();
    openMetricasModal(tipo, vendas, anoAtual);
}

function openMetricasModal(tipo, vendas, anoInicial) {
    const modal = document.getElementById('dashboardModal');
    if (!modal) return;
    modal.classList.add('show');
    renderDashboardModalContent(tipo, vendas, anoInicial);
}

function closeDashboardModal() {
    document.getElementById('dashboardModal')?.classList.remove('show');
}

function renderDashboardModalContent(tipo, vendas, ano) {
    const container = document.getElementById('dashboardModalContent');
    if (!container) return;

    // Calcula dados mensais para o ano
    const meses = Array.from({ length: 12 }, () => ({ pago: 0, faturado: 0, a_receber: 0 }));
    let totalAnoPago = 0, totalAnoFaturado = 0, totalAnoAReceber = 0;

    for (const v of vendas) {
        const valorNF   = parseFloat(v.valor_nf)   || 0;
        const valorPago = parseFloat(v.valor_pago) || 0;
        const sf = normalizeStatusFrete(v.status_frete);

        if (v.data_emissao) {
            const d = new Date(v.data_emissao + 'T00:00:00');
            if (d.getFullYear() === ano) {
                meses[d.getMonth()].faturado += valorNF;
                totalAnoFaturado += valorNF;
            }
        }
        if (v.data_pagamento) {
            const d = new Date(v.data_pagamento + 'T00:00:00');
            if (d.getFullYear() === ano) {
                const vp = valorPago || valorNF;
                meses[d.getMonth()].pago += vp;
                totalAnoPago += vp;
            }
        }
        if (sf === 'ENTREGUE' && !v.data_pagamento && v.data_emissao) {
            const d = new Date(v.data_emissao + 'T00:00:00');
            if (d.getFullYear() === ano) {
                meses[d.getMonth()].a_receber += valorNF;
                totalAnoAReceber += valorNF;
            }
        }
    }

    const isAdmin = ADMINS.includes(currentUser);
    const userLabel = isAdmin
        ? (document.getElementById('filterVendedor')?.value || 'Todos')
        : currentUser;

    container.innerHTML = `
        <div class="dbm-header">
            <button class="dbm-year-nav" onclick="changeDashboardYear(-1, '${tipo}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <h3 class="dbm-title">${ano} · ${userLabel}</h3>
            <button class="dbm-year-nav" onclick="changeDashboardYear(1, '${tipo}')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
        </div>

        <!-- Totais anuais -->
        <div class="dbm-totals">
            <div class="dbm-total-card dbm-total-pago">
                <div class="dbm-total-label">PAGO NO ANO</div>
                <div class="dbm-total-value">${formatCurrency(totalAnoPago)}</div>
            </div>
            <div class="dbm-total-card dbm-total-faturado">
                <div class="dbm-total-label">FATURADO NO ANO</div>
                <div class="dbm-total-value">${formatCurrency(totalAnoFaturado)}</div>
            </div>
            <div class="dbm-total-card dbm-total-receber">
                <div class="dbm-total-label">A RECEBER NO ANO</div>
                <div class="dbm-total-value">${formatCurrency(totalAnoAReceber)}</div>
            </div>
        </div>

        <!-- Grid mensal -->
        <div class="dbm-months-grid">
            ${meses.map((m, i) => `
                <div class="dbm-month-card">
                    <div class="dbm-month-name">${monthNamesShort[i]}</div>
                    <div class="dbm-month-stat dbm-stat-pago">
                        <span class="dbm-stat-label">Pago</span>
                        <span class="dbm-stat-val">${formatCurrency(m.pago)}</span>
                    </div>
                    <div class="dbm-month-stat dbm-stat-receber">
                        <span class="dbm-stat-label">A Receber</span>
                        <span class="dbm-stat-val">${formatCurrency(m.a_receber)}</span>
                    </div>
                    <div class="dbm-month-stat dbm-stat-faturado">
                        <span class="dbm-stat-label">Faturado</span>
                        <span class="dbm-stat-val">${formatCurrency(m.faturado)}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Guarda estado
    container.dataset.tipo = tipo;
    container.dataset.ano = ano;
}

function changeDashboardYear(dir, tipo) {
    const container = document.getElementById('dashboardModalContent');
    const novoAno = parseInt(container.dataset.ano) + dir;
    const vendas = getVendasParaUsuario();
    renderDashboardModalContent(tipo, vendas, novoAno);
}

// ─── Modal de Métricas (ícone de gráfico) ────────────────────────────────────
function openMetricasIndividual() {
    const modal = document.getElementById('metricasModal');
    if (!modal) return;
    modal.classList.add('show');
    const vendas = getVendasParaUsuario();
    renderMetricasIndividual(vendas, new Date().getFullYear());
}

function closeMetricasModal() {
    document.getElementById('metricasModal')?.classList.remove('show');
}

function renderMetricasIndividual(vendas, ano) {
    const container = document.getElementById('metricasModalContent');
    if (!container) return;

    const isAdmin = ADMINS.includes(currentUser);
    const userLabel = isAdmin
        ? (document.getElementById('filterVendedor')?.value.toUpperCase() || 'TODOS')
        : currentUser;

    // Calcula mensal
    const meses = Array.from({ length: 12 }, () => ({ pago: 0, faturado: 0, a_receber: 0 }));
    let totalPago = 0, totalFaturado = 0, totalAReceber = 0;

    for (const v of vendas) {
        const valorNF   = parseFloat(v.valor_nf)   || 0;
        const valorPago = parseFloat(v.valor_pago) || 0;
        const sf = normalizeStatusFrete(v.status_frete);

        if (v.data_emissao) {
            const d = new Date(v.data_emissao + 'T00:00:00');
            if (d.getFullYear() === ano) {
                meses[d.getMonth()].faturado += valorNF;
                totalFaturado += valorNF;
            }
        }
        if (v.data_pagamento) {
            const d = new Date(v.data_pagamento + 'T00:00:00');
            if (d.getFullYear() === ano) {
                const vp = valorPago || valorNF;
                meses[d.getMonth()].pago += vp;
                totalPago += vp;
            }
        }
        if (sf === 'ENTREGUE' && !v.data_pagamento && v.data_emissao) {
            const d = new Date(v.data_emissao + 'T00:00:00');
            if (d.getFullYear() === ano) {
                meses[d.getMonth()].a_receber += valorNF;
                totalAReceber += valorNF;
            }
        }
    }

    container.innerHTML = `
        <div class="dbm-header">
            <button class="dbm-year-nav" onclick="changeMetricasYear(-1)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <h3 class="dbm-title">Minhas Métricas · ${userLabel} · ${ano}</h3>
            <button class="dbm-year-nav" onclick="changeMetricasYear(1)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
        </div>

        <div class="dbm-totals">
            <div class="dbm-total-card dbm-total-pago">
                <div class="dbm-total-label">PAGO NO ANO</div>
                <div class="dbm-total-value">${formatCurrency(totalPago)}</div>
            </div>
            <div class="dbm-total-card dbm-total-faturado">
                <div class="dbm-total-label">FATURADO NO ANO</div>
                <div class="dbm-total-value">${formatCurrency(totalFaturado)}</div>
            </div>
            <div class="dbm-total-card dbm-total-receber">
                <div class="dbm-total-label">A RECEBER</div>
                <div class="dbm-total-value">${formatCurrency(totalAReceber)}</div>
            </div>
        </div>

        <div class="dbm-months-grid">
            ${meses.map((m, i) => `
                <div class="dbm-month-card">
                    <div class="dbm-month-name">${monthNamesShort[i]}</div>
                    <div class="dbm-month-stat dbm-stat-pago">
                        <span class="dbm-stat-label">Pago</span>
                        <span class="dbm-stat-val">${formatCurrency(m.pago)}</span>
                    </div>
                    <div class="dbm-month-stat dbm-stat-receber">
                        <span class="dbm-stat-label">A Receber</span>
                        <span class="dbm-stat-val">${formatCurrency(m.a_receber)}</span>
                    </div>
                    <div class="dbm-month-stat dbm-stat-faturado">
                        <span class="dbm-stat-label">Faturado</span>
                        <span class="dbm-stat-val">${formatCurrency(m.faturado)}</span>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    container.dataset.ano = ano;
}

function changeMetricasYear(dir) {
    const container = document.getElementById('metricasModalContent');
    const novoAno = parseInt(container.dataset.ano) + dir;
    const vendas = getVendasParaUsuario();
    renderMetricasIndividual(vendas, novoAno);
}

// ─── Modal de Ranking (apenas admins) ────────────────────────────────────────
function openRankingModal() {
    if (!ADMINS.includes(currentUser)) return;
    const modal = document.getElementById('rankingModal');
    if (!modal) return;
    modal.classList.add('show');
    renderRanking(new Date().getFullYear());
}

function closeRankingModal() {
    document.getElementById('rankingModal')?.classList.remove('show');
}

function renderRanking(ano) {
    const container = document.getElementById('rankingModalContent');
    if (!container) return;

    // Calcula por vendedor
    const dados = {};
    for (const vend of ALL_VENDEDORES) {
        dados[vend] = { pago: 0, faturado: 0 };
    }

    for (const v of allVendas) {
        const vend = (v.vendedor || '').toUpperCase().trim();
        if (!dados[vend]) continue;

        const valorNF   = parseFloat(v.valor_nf)   || 0;
        const valorPago = parseFloat(v.valor_pago) || 0;

        if (v.data_emissao) {
            const d = new Date(v.data_emissao + 'T00:00:00');
            if (d.getFullYear() === ano) dados[vend].faturado += valorNF;
        }
        if (v.data_pagamento) {
            const d = new Date(v.data_pagamento + 'T00:00:00');
            if (d.getFullYear() === ano) dados[vend].pago += valorPago || valorNF;
        }
    }

    // Ordena por faturado desc
    const ranking = ALL_VENDEDORES
        .map(v => ({ nome: v, ...dados[v] }))
        .sort((a, b) => b.faturado - a.faturado);

    const medalhas = ['🥇', '🥈', '🥉'];

    container.innerHTML = `
        <div class="dbm-header">
            <button class="dbm-year-nav" onclick="changeRankingYear(-1)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <h3 class="dbm-title">Ranking de Vendedores · ${ano}</h3>
            <button class="dbm-year-nav" onclick="changeRankingYear(1)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
        </div>

        <div class="ranking-grid">
            ${ranking.map((r, i) => `
                <div class="ranking-card">
                    <div class="ranking-position">${medalhas[i] || (i + 1)}</div>
                    <div class="ranking-nome">${r.nome}</div>
                    <div class="ranking-stats">
                        <div class="ranking-stat ranking-stat-pago">
                            <span class="ranking-stat-label">Pago</span>
                            <span class="ranking-stat-val">${formatCurrency(r.pago)}</span>
                        </div>
                        <div class="ranking-stat ranking-stat-faturado">
                            <span class="ranking-stat-label">Faturado</span>
                            <span class="ranking-stat-val">${formatCurrency(r.faturado)}</span>
                        </div>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    container.dataset.ano = ano;
}

function changeRankingYear(dir) {
    const container = document.getElementById('rankingModalContent');
    const novoAno = parseInt(container.dataset.ano) + dir;
    renderRanking(novoAno);
}

// ─── Tabela de vendas ─────────────────────────────────────────────────────────
function updateTable() {
    const container = document.getElementById('vendasContainer');
    if (!container) return;

    const isAdmin = ADMINS.includes(currentUser);
    const vendedorSelecionado = isAdmin
        ? (document.getElementById('filterVendedor')?.value || '').toUpperCase().trim()
        : currentUser;

    let filtered = allVendas.filter(v => {
        if (!v.data_emissao) return false;
        const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
        return dataEmissao.getMonth() === currentMonth.getMonth() &&
               dataEmissao.getFullYear() === currentMonth.getFullYear();
    });

    if (vendedorSelecionado) {
        filtered = filtered.filter(v =>
            (v.vendedor || '').toUpperCase().trim() === vendedorSelecionado
        );
    }

    const search       = (document.getElementById('search')?.value || '').toLowerCase();
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
    } else if (filterStatus === 'FORA DO PRAZO') {
        filtered = filtered.filter(v => resolveStatusFinal(v) === 'FORA DO PRAZO');
    }

    filtered.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));

    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    const rows = filtered.map(v => {
        const status   = resolveStatusFinal(v);
        let rowClass = '';
        if (status === 'PAGO') rowClass = 'row-pago';
        else if (status === 'ENTREGUE') rowClass = 'row-entregue';
        else if (status === 'FORA DO PRAZO') rowClass = 'row-fora-prazo';
        const idx = allVendas.indexOf(v);
        return `<tr class="${rowClass}">
            <td><strong>${v.numero_nf || '-'}</strong></td>
            <td>${formatDate(v.data_emissao)}</td>
            <td>${v.vendedor || '-'}</td>
            <td style="word-break:break-word;max-width:220px;">${v.nome_orgao || '-'}</td>
            <td><strong>${formatCurrency(v.valor_nf)}</strong></td>
            <td>${getStatusBadge(status, v.numero_parcela)}</td>
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

function getStatusBadge(status, numeroParcela) {
    const map = {
        'PAGO':          { class: 'pago',        text: numeroParcela ? `PAGO · ${numeroParcela} parcelas` : 'PAGO' },
        'ENTREGUE':      { class: 'entregue',    text: 'ENTREGUE' },
        'EM TRÂNSITO':   { class: 'transito',    text: 'EM TRÂNSITO' },
        'EM TRANSITO':   { class: 'transito',    text: 'EM TRÂNSITO' },
        'FORA DO PRAZO': { class: 'fora-prazo',  text: 'FORA DO PRAZO' },
        'AGUARDANDO COLETA': { class: 'aguardando', text: 'AG. COLETA' }
    };
    const s = map[status] || { class: 'transito', text: status };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

// ─── Modal de detalhe da venda ────────────────────────────────────────────────
function viewVenda(idx) {
    const venda = allVendas[idx];
    if (!venda) return;

    document.getElementById('modalNumeroNF').textContent = venda.numero_nf;
    const modalBody = document.getElementById('modalBody');
    if (!modalBody) return;

    const statusFinal = resolveStatusFinal(venda);

    // Seção de frete (dados do Controle de Frete)
    const secaoFrete = `
        <div class="info-section">
            <h4>🚚 Controle de Frete</h4>
            <p><strong>NF:</strong> ${venda.numero_nf || '-'}</p>
            <p><strong>Vendedor:</strong> ${venda.vendedor || '-'}</p>
            <p><strong>Órgão:</strong> ${venda.nome_orgao || '-'}</p>
            <p><strong>Valor NF:</strong> ${formatCurrency(venda.valor_nf)}</p>
            <p><strong>Emissão:</strong> ${formatDate(venda.data_emissao)}</p>
            <p><strong>Transportadora:</strong> ${venda.transportadora || '-'}</p>
            <p><strong>Status:</strong> ${getStatusBadge(statusFinal, venda.numero_parcela)}</p>
            <p><strong>Cidade Destino:</strong> ${venda.cidade_destino || '-'}</p>
            <p><strong>Previsão Entrega:</strong> ${formatDate(venda.previsao_entrega)}</p>
        </div>`;

    // Seção de pagamento (dados de Contas a Receber — só exibe se pago)
    const secaoPagamento = venda.data_pagamento ? `
        <div class="info-section">
            <h4>💰 Contas a Receber</h4>
            <p><strong>Valor Pago:</strong> ${formatCurrency(venda.valor_pago)}</p>
            ${venda.numero_parcela ? `<p><strong>Parcelas Pagas:</strong> ${venda.numero_parcela}</p>` : ''}
            <p><strong>Data Pagamento:</strong> ${formatDate(venda.data_pagamento)}</p>
            <p><strong>Banco:</strong> ${venda.banco || '-'}</p>
        </div>` : '';

    modalBody.innerHTML = secaoFrete + secaoPagamento;
    document.getElementById('infoModal').classList.add('show');
}

function closeInfoModal() {
    document.getElementById('infoModal').classList.remove('show');
}

function filterVendas() {
    updateDisplay();
}
