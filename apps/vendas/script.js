const DEVELOPMENT_MODE = false;
const API_URL = window.location.origin + '/api';
const VENDEDORES_VALIDOS = ['ROBERTO', 'ISAQUE', 'MIGUEL'];
// Apenas estes vendedores têm o filtro travado automaticamente no próprio nome
// ao serem identificados. Qualquer outro nome (ex.: Roberto) libera o módulo
// para visualização completa, sem travar o filtro.
const VENDEDORES_RESTRITOS = ['ISAQUE', 'MIGUEL'];
const PAGE_SIZE = 5;

let isOnline = false;
let lastDataHash = '';
let currentMonth = new Date();
let allVendas = [];
let sessionToken = null;
let calendarYear = new Date().getFullYear();
let vendedorLogado = null;
let painelAno = new Date().getFullYear();
let painelModo = 'geral'; // 'geral' (todos os vendedores) ou 'individual' (vendedor logado/selecionado)

// Índices com os dados brutos de controle_frete e contas_receber,
// usados para exibir observações, parcelas, cotação e data de entrega
// (informações que não são persistidas na tabela consolidada "vendas").
let fretesByNF = {};
let contasByNF = {};

// Estado de paginação dos modais de dashboard (Fora do Prazo, Pago, A Receber)
let modalPaginationState = {};
let modalPaginationRows = {};

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
    detectarVendedorLogado();
    await inicializarApp();
});

// ─── Identifica o vendedor logado (Roberto / Isaque / Miguel) ─────────────────
// O portal pode informar o vendedor via parâmetro de URL (?vendedor=ISAQUE),
// da mesma forma que informa o sessionToken. Quando identificado, o filtro
// "Vendedores" é travado automaticamente nesse nome.
function detectarVendedorLogado() {
    const urlParams = new URLSearchParams(window.location.search);
    let v = urlParams.get('vendedor') || sessionStorage.getItem('vendasVendedorLogado');
    if (v) {
        v = v.toUpperCase().trim();
        sessionStorage.setItem('vendasVendedorLogado', v);
    }
    vendedorLogado = (v && VENDEDORES_RESTRITOS.includes(v)) ? v : null;
}

function aplicarFiltroVendedorLogado() {
    if (!vendedorLogado) return;
    const sel = document.getElementById('filterVendedor');
    if (!sel) return;
    sel.value = vendedorLogado;
    sel.disabled = true;
    sel.title = 'Filtrado automaticamente pelo vendedor logado';
}

function getVendedorFiltroAtual() {
    return (document.getElementById('filterVendedor')?.value || '').toUpperCase().trim();
}

async function inicializarApp() {
    aplicarFiltroVendedorLogado();
    checkServerStatus();
    await syncData();
    await loadVendas();
    await loadFontes();
    updateMonthDisplay();
    updateDisplay();
    setInterval(checkServerStatus, 15000);
    setInterval(() => syncData(), 120000);
    setInterval(async () => { await loadVendas(); await loadFontes(); }, 30000);
}

// ─── Normaliza status_frete para comparação consistente ───────────────────────
function normalizeStatusFrete(status) {
    if (!status) return '';
    return status.toUpperCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/_/g, ' ');
}

// ─── Normaliza texto para busca (minúsculo e sem acentos) ─────────────────────
function normalizeSearch(str) {
    return String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ─── Normaliza número de NF (mesma lógica usada no backend) ───────────────────
function normalizeNF(numeroNF) {
    if (!numeroNF) return '';
    const str = String(numeroNF).trim().replace(/^0+/, '');
    return str || '0';
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
            await loadFontes();
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
        const newHash = JSON.stringify(data.map(v => v.id));
        if (newHash !== lastDataHash) {
            allVendas = data;
            lastDataHash = newHash;
            updateDisplay();
        }
    } catch (error) {
        console.error('❌ Erro ao carregar vendas:', error);
    }
}

// ─── Carrega dados brutos (observações, parcelas, cotação, data entrega) ──────
async function loadFontes() {
    try {
        const response = await fetch(`${API_URL}/vendas/fontes`, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken },
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        const novoFretesByNF = {};
        const novoContasByNF = {};

        (data.fretes || []).forEach(f => {
            const key = normalizeNF(f.numero_nf);
            if (!novoFretesByNF[key]) novoFretesByNF[key] = [];
            novoFretesByNF[key].push(f);
        });
        (data.contas || []).forEach(c => {
            const key = normalizeNF(c.numero_nf);
            if (!novoContasByNF[key]) novoContasByNF[key] = [];
            novoContasByNF[key].push(c);
        });

        fretesByNF = novoFretesByNF;
        contasByNF = novoContasByNF;
        updateDisplay();
    } catch (error) {
        console.error('❌ Erro ao carregar fontes:', error);
    }
}

function getAllContas() {
    return Object.values(contasByNF).flat();
}

function getParcelasConta(conta) {
    try {
        const obs = conta && conta.observacoes;
        if (!obs) return [];
        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
        if (parsed && Array.isArray(parsed.parcelas)) return parsed.parcelas;
        return [];
    } catch { return []; }
}

function getNotasConta(conta) {
    try {
        const obs = conta && conta.observacoes;
        if (!obs) return [];
        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
        if (parsed && Array.isArray(parsed.notas)) return parsed.notas;
        if (Array.isArray(parsed)) return parsed.filter(n => n && n.texto);
        return [];
    } catch { return []; }
}

function getNotasFrete(frete) {
    try {
        const obs = frete && frete.observacoes;
        if (!obs) return [];
        const parsed = typeof obs === 'string' ? JSON.parse(obs) : obs;
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function hasObservacoes(v) {
    const key = normalizeNF(v.numero_nf);
    const fretesArr = fretesByNF[key] || [];
    const contasArr = contasByNF[key] || [];
    const temFrete = fretesArr.some(f => getNotasFrete(f).length > 0);
    const temConta = contasArr.some(c => getNotasConta(c).length > 0);
    return temFrete || temConta;
}

// ─── Sincroniza dados via routes (silenciosamente — usada em segundo plano) ──
async function syncData() {
    try {
        const response = await fetch(`${API_URL}/vendas/sincronizar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
            mode: 'cors'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        if (result.success) {
            lastDataHash = '';
            await loadVendas();
            await loadFontes();
        }
        return result;
    } catch (error) {
        console.error('❌ Erro ao sincronizar:', error);
        return null;
    }
}

// ─── Sincronização manual (botão) — com feedback visual claro para o usuário ─
let syncingManualmente = false;
async function syncDataManual() {
    if (syncingManualmente) return;
    syncingManualmente = true;
    const btn = document.getElementById('syncBtn');
    if (btn) { btn.classList.add('syncing'); btn.disabled = true; }
    try {
        const result = await syncData();
        if (result && result.success) {
            showToast('Dados sincronizados com sucesso', 'success');
        } else if (result) {
            showToast(result.message || 'Sincronização concluída com avisos', 'warning');
        } else {
            showToast('Não foi possível sincronizar. Verifique a conexão.', 'error');
        }
    } finally {
        if (btn) { btn.classList.remove('syncing'); btn.disabled = false; }
        syncingManualmente = false;
    }
}

function updateDisplay() {
    loadDashboard();
    updateTable();
}

// ─── Regras de status (pagamento / frete / prazo) ──────────────────────────────
function isPago(v) {
    return (v.status_pagamento || '').toUpperCase().trim() === 'PAGO';
}

function isParcelaAberta(v) {
    return !isPago(v) && /parcela/i.test(v.status_pagamento || '');
}

function isForaDoPrazo(v) {
    const sf = normalizeStatusFrete(v.status_frete);
    if (sf === 'ENTREGUE') return false;
    if (!v.previsao_entrega) return false;
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const previsao = new Date(v.previsao_entrega + 'T00:00:00');
    previsao.setHours(0, 0, 0, 0);
    return previsao < hoje;
}

function getDisplayStatus(v) {
    if (isPago(v)) return { code: 'PAGO', label: 'PAGO' };
    if (isParcelaAberta(v)) return { code: 'PARCELA', label: (v.status_pagamento || '').toUpperCase().trim() };
    if (isForaDoPrazo(v)) return { code: 'FORA DO PRAZO', label: 'FORA DO PRAZO' };
    const sf = normalizeStatusFrete(v.status_frete);
    if (sf === 'ENTREGUE') return { code: 'ENTREGUE', label: 'ENTREGUE' };
    if (sf === 'AGUARDANDO COLETA') return { code: 'AGUARDANDO COLETA', label: 'AGUARDANDO COLETA' };
    if (sf === 'EXTRAVIADO') return { code: 'EXTRAVIADO', label: 'EXTRAVIADO' };
    if (sf === 'DEVOLVIDO') return { code: 'DEVOLVIDO', label: 'DEVOLVIDO' };
    if (!sf || sf === 'EM TRANSITO') return { code: 'EM TRÂNSITO', label: 'EM TRÂNSITO' };
    return { code: sf, label: sf };
}

function getStatusBadge(statusInfo) {
    const map = {
        'PAGO':              { class: 'pago',       text: 'PAGO' },
        'PARCELA':           { class: 'parcela',    text: statusInfo.label },
        'ENTREGUE':          { class: 'entregue',   text: 'ENTREGUE' },
        'EM TRÂNSITO':       { class: 'transito',   text: 'EM TRÂNSITO' },
        'AGUARDANDO COLETA': { class: 'aguardando', text: 'AGUARDANDO COLETA' },
        'FORA DO PRAZO':     { class: 'fora-prazo', text: 'FORA DO PRAZO' },
        'EXTRAVIADO':        { class: 'extraviado', text: 'EXTRAVIADO' },
        'DEVOLVIDO':         { class: 'devolvido',  text: 'DEVOLVIDO' }
    };
    const s = map[statusInfo.code] || { class: 'transito', text: statusInfo.label };
    return `<span class="badge ${s.class}">${s.text}</span>`;
}

// ─── Pagamentos ocorridos em um mês/ano (considera parcelas individualmente) ──
function getPagamentosDoMes(mes, ano, vendedorSel) {
    const linhas = [];
    getAllContas().forEach(c => {
        if (vendedorSel && (c.vendedor || '').toUpperCase().trim() !== vendedorSel) return;
        const parcelas = getParcelasConta(c);
        if (parcelas.length > 0) {
            parcelas.forEach(p => {
                if (!p.data) return;
                const d = new Date(p.data + 'T00:00:00');
                if (d.getMonth() === mes && d.getFullYear() === ano) {
                    linhas.push({
                        numero_nf: c.numero_nf,
                        data_emissao: c.data_emissao,
                        orgao: c.orgao,
                        valor_nf: parseFloat(p.valor) || 0,
                        data_pagamento: p.data
                    });
                }
            });
        } else if (c.data_pagamento) {
            const d = new Date(c.data_pagamento + 'T00:00:00');
            if (d.getMonth() === mes && d.getFullYear() === ano) {
                linhas.push({
                    numero_nf: c.numero_nf,
                    data_emissao: c.data_emissao,
                    orgao: c.orgao,
                    valor_nf: parseFloat(c.valor_pago) || parseFloat(c.valor) || 0,
                    data_pagamento: c.data_pagamento
                });
            }
        }
    });
    linhas.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    return linhas;
}

function somaPagamentosDoMes(mes, ano, vendedorSel) {
    return getPagamentosDoMes(mes, ano, vendedorSel).reduce((s, r) => s + (parseFloat(r.valor_nf) || 0), 0);
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function loadDashboard() {
    const currentYear = currentMonth.getFullYear();
    const currentMonthIndex = currentMonth.getMonth();
    const vendedorSel = getVendedorFiltroAtual();

    let totalAReceber = 0;
    let totalEntregue = 0;
    let totalFaturado = 0;
    let totalForaPrazo = 0;
    let totalValorFrete = 0;

    for (const v of allVendas) {
        if (vendedorSel && (v.vendedor || '').toUpperCase().trim() !== vendedorSel) continue;

        const valorNF = parseFloat(v.valor_nf) || 0;
        const statusFrete = normalizeStatusFrete(v.status_frete);

        // FATURADO / VALOR FRETE — pela data de emissão no mês selecionado
        if (v.data_emissao) {
            const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
            if (dataEmissao.getMonth() === currentMonthIndex && dataEmissao.getFullYear() === currentYear) {
                totalFaturado += valorNF;
                totalValorFrete += parseFloat(v.valor_frete) || 0;
                if (statusFrete === 'ENTREGUE') totalEntregue++;
            }
        }

        // A RECEBER — entregue e sem confirmação de pagamento total (saldo em aberto, qualquer mês)
        if (statusFrete === 'ENTREGUE' && !isPago(v)) {
            totalAReceber += valorNF;
        }

        // FORA DO PRAZO — monitoramento total, independente do mês (igual Controle de Frete)
        if (isForaDoPrazo(v)) {
            totalForaPrazo++;
        }
    }

    // PAGO — soma real dos pagamentos (inclusive parcelas) ocorridos no mês selecionado
    const totalPago = somaPagamentosDoMes(currentMonthIndex, currentYear, vendedorSel);

    document.getElementById('totalPago').textContent = formatCurrency(totalPago);
    document.getElementById('totalAReceber').textContent = formatCurrency(totalAReceber);
    document.getElementById('totalEntregue').textContent = totalEntregue;
    document.getElementById('totalFaturado').textContent = formatCurrency(totalFaturado);
    document.getElementById('totalForaPrazo').textContent = totalForaPrazo;
    document.getElementById('totalValorFrete').textContent = formatCurrency(totalValorFrete);

    const cardForaPrazo = document.getElementById('cardForaPrazo');
    if (cardForaPrazo) cardForaPrazo.classList.toggle('has-alert', totalForaPrazo > 0);
}

// ─── Tabela de vendas ─────────────────────────────────────────────────────────
function updateTable() {
    const container = document.getElementById('vendasContainer');
    if (!container) return;

    const vendedorSelecionado = getVendedorFiltroAtual();

    let filtered = allVendas.filter(v => {
        if (!v.data_emissao) return false;
        const dataEmissao = new Date(v.data_emissao + 'T00:00:00');
        return dataEmissao.getMonth() === currentMonth.getMonth() &&
               dataEmissao.getFullYear() === currentMonth.getFullYear();
    });

    if (vendedorSelecionado) {
        filtered = filtered.filter(v => (v.vendedor || '').toUpperCase().trim() === vendedorSelecionado);
    }

    const search = normalizeSearch(document.getElementById('search')?.value || '');
    const filterStatus = document.getElementById('filterStatus')?.value || '';

    if (search) {
        filtered = filtered.filter(v =>
            normalizeSearch(v.numero_nf).includes(search) ||
            normalizeSearch(v.nome_orgao).includes(search) ||
            normalizeSearch(v.vendedor).includes(search) ||
            normalizeSearch(v.cidade_destino).includes(search) ||
            normalizeSearch(v.contato_orgao).includes(search)
        );
    }

    if (filterStatus) {
        filtered = filtered.filter(v => getDisplayStatus(v).code === filterStatus);
    }

    filtered.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));

    if (!filtered.length) {
        container.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    const rows = filtered.map(v => {
        const statusInfo = getDisplayStatus(v);
        const rowClass = statusInfo.code === 'PAGO' ? 'row-pago' : (statusInfo.code === 'ENTREGUE' ? 'row-entregue' : '');
        const idx = allVendas.indexOf(v);
        const temObs = hasObservacoes(v);

        const alertIcon = temObs
            ? `<button class="action-btn alert-icon" onclick="event.stopPropagation();viewVenda(${idx},3)" title="Ver observações">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
               </button>`
            : '';

        return `<tr class="row-clickable ${rowClass}" onclick="viewVenda(${idx})">
            <td><strong>${v.numero_nf || '-'}</strong></td>
            <td>${formatDate(v.data_emissao)}</td>
            <td>${v.vendedor || '-'}</td>
            <td style="word-break:break-word;max-width:220px;">${v.nome_orgao || '-'}</td>
            <td><strong>${formatCurrency(v.valor_nf)}</strong></td>
            <td>${getStatusBadge(statusInfo)}</td>
            <td style="text-align:center;">${alertIcon}</td>
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
                        <th style="width:60px;"></th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ─── Modal de detalhe da venda (abas: Geral, Frete, Receber, Observações) ─────
function viewVenda(idx, activeTab = 0) {
    const venda = allVendas[idx];
    if (!venda) return;

    const key = normalizeNF(venda.numero_nf);
    const freteRaw = (fretesByNF[key] || [])[0] || null;
    const contaRaw = (contasByNF[key] || [])[0] || null;

    document.getElementById('modalNumeroNF').textContent = venda.numero_nf;

    const fmtV = v => (v !== null && v !== undefined && v !== '' && parseFloat(v) !== 0) ? formatCurrency(v) : '-';
    const fmtD = v => v ? formatDate(v) : '-';

    // Aba Geral
    document.getElementById('infoTabGeral').innerHTML = `
        <div class="info-section">
            <div class="info-row"><span class="info-label">Número da NF:</span><span class="info-value">${venda.numero_nf || '-'}</span></div>
            <div class="info-row"><span class="info-label">Data Emissão:</span><span class="info-value">${fmtD(venda.data_emissao)}</span></div>
            <div class="info-row"><span class="info-label">Valor NF:</span><span class="info-value">${fmtV(venda.valor_nf)}</span></div>
            <div class="info-row"><span class="info-label">Nome do Órgão:</span><span class="info-value">${venda.nome_orgao || '-'}</span></div>
            <div class="info-row"><span class="info-label">Cidade-UF:</span><span class="info-value">${venda.cidade_destino || '-'}</span></div>
            <div class="info-row"><span class="info-label">Contato:</span><span class="info-value">${venda.contato_orgao || '-'}</span></div>
            <div class="info-row"><span class="info-label">Vendedor:</span><span class="info-value">${venda.vendedor || '-'}</span></div>
        </div>`;

    // Aba Controle de Frete
    document.getElementById('infoTabFrete').innerHTML = `
        <div class="info-section">
            <div class="info-row"><span class="info-label">Transportadora:</span><span class="info-value">${venda.transportadora || '-'}</span></div>
            <div class="info-row"><span class="info-label">Valor Frete:</span><span class="info-value">${fmtV(venda.valor_frete)}</span></div>
            <div class="info-row"><span class="info-label">Data Coleta:</span><span class="info-value">${fmtD(venda.data_coleta)}</span></div>
            <div class="info-row"><span class="info-label">Previsão Entrega:</span><span class="info-value">${fmtD(venda.previsao_entrega)}</span></div>
            <div class="info-row"><span class="info-label">Data Entrega:</span><span class="info-value">${fmtD(freteRaw ? freteRaw.data_entrega : null)}</span></div>
            <div class="info-row"><span class="info-label">Cotação:</span><span class="info-value">${(freteRaw && freteRaw.cotacao) || '-'}</span></div>
        </div>`;

    // Aba Contas a Receber
    const parcelas = contaRaw ? getParcelasConta(contaRaw) : [];
    let parcelasHTML;
    if (parcelas.length > 0) {
        parcelasHTML = `
            <div class="info-row" style="display:block;border-bottom:none;">
                <span class="info-label" style="display:block;margin-bottom:.5rem;">Parcelas:</span>
                <table style="width:100%;">
                    <thead><tr><th>Parcela</th><th>Valor</th><th>Data Pagamento</th></tr></thead>
                    <tbody>${parcelas.map((p, i) => `<tr>
                        <td>${p.numero || (i + 1) + 'ª'}</td>
                        <td>${formatCurrency(p.valor)}</td>
                        <td>${p.data ? formatDate(p.data) : '-'}</td>
                    </tr>`).join('')}</tbody>
                </table>
            </div>`;
    } else {
        parcelasHTML = `<div class="info-row"><span class="info-label">Parcela:</span><span class="info-value">-</span></div>`;
    }
    document.getElementById('infoTabReceber').innerHTML = `
        <div class="info-section">
            <div class="info-row"><span class="info-label">Valor Pago Total:</span><span class="info-value">${fmtV(venda.valor_pago)}</span></div>
            <div class="info-row"><span class="info-label">Vencimento:</span><span class="info-value">${fmtD(venda.data_vencimento)}</span></div>
            <div class="info-row"><span class="info-label">Data Pagamento:</span><span class="info-value">${fmtD(venda.data_pagamento)}</span></div>
            <div class="info-row"><span class="info-label">Banco:</span><span class="info-value">${venda.banco || '-'}</span></div>
            ${parcelasHTML}
        </div>`;

    // Aba Observações (Controle de Frete + Contas a Receber)
    const notasFrete = freteRaw ? getNotasFrete(freteRaw) : [];
    const notasConta = contaRaw ? getNotasConta(contaRaw) : [];
    const todasNotas = [
        ...notasFrete.map(n => ({ origem: 'Controle de Frete', texto: n.texto, data: n.timestamp ? new Date(n.timestamp).toLocaleString('pt-BR') : '' })),
        ...notasConta.map(n => ({ origem: 'Contas a Receber', texto: n.texto, data: n.data || '' }))
    ];

    let obsHTML;
    if (todasNotas.length === 0) {
        obsHTML = '<p style="color:var(--text-secondary);font-style:italic;text-align:center;padding:1rem;">Nenhuma observação registrada</p>';
    } else {
        obsHTML = `<div class="observacoes-list-view">${todasNotas.map(n => `
            <div class="observacao-item-view">
                <div class="observacao-header">
                    <div class="observacao-info">
                        <span class="observacao-data">${n.origem}${n.data ? ' — ' + n.data : ''}</span>
                    </div>
                </div>
                <p class="observacao-texto">${n.texto || ''}</p>
            </div>`).join('')}</div>`;
    }
    document.getElementById('infoTabObs').innerHTML = `<div class="info-section"><h4>Observações</h4>${obsHTML}</div>`;

    const btns = document.querySelectorAll('#infoModal .tab-btn');
    switchInfoTab(activeTab, btns[activeTab]);
    document.getElementById('infoModal').classList.add('show');
}

function switchInfoTab(index, btnEl) {
    document.querySelectorAll('#infoModal .tab-btn').forEach((b, i) => b.classList.toggle('active', i === index));
    document.querySelectorAll('#infoModal .tab-content').forEach((c, i) => c.classList.toggle('active', i === index));
}

function closeInfoModal() {
    document.getElementById('infoModal').classList.remove('show');
}

// ─── Modais de dashboard paginados (Fora do Prazo / Pago / A Receber) ────────
const MODAL_CONFIG = {
    foraPrazo: {
        bodyId: 'foraPrazoModalBody',
        columns: [
            { label: 'NF', render: r => `<strong>${r.numero_nf || '-'}</strong>` },
            { label: 'Emissão', render: r => formatDate(r.data_emissao) },
            { label: 'Órgão', render: r => r.nome_orgao || '-' },
            { label: 'Previsão', render: r => `<span style="color:#EF4444;font-weight:600;">${formatDate(r.previsao_entrega)}</span>` }
        ]
    },
    pago: {
        bodyId: 'pagoModalBody',
        columns: [
            { label: 'NF', render: r => `<strong>${r.numero_nf || '-'}</strong>` },
            { label: 'Emissão', render: r => formatDate(r.data_emissao) },
            { label: 'Órgão', render: r => r.orgao || '-' },
            { label: 'Valor NF', render: r => formatCurrency(r.valor_nf) },
            { label: 'Dt. Pagamento', render: r => formatDate(r.data_pagamento) }
        ]
    },
    aReceber: {
        bodyId: 'aReceberModalBody',
        columns: [
            { label: 'NF', render: r => `<strong>${r.numero_nf || '-'}</strong>` },
            { label: 'Emissão', render: r => formatDate(r.data_emissao) },
            { label: 'Órgão', render: r => r.nome_orgao || '-' },
            { label: 'Valor NF', render: r => formatCurrency(r.valor_nf) }
        ]
    }
};

function closeModalGenerico(id) {
    const modal = document.getElementById(id);
    if (modal) modal.style.display = 'none';
}

function renderPaginatedModal(key) {
    const conf = MODAL_CONFIG[key];
    if (!conf) return;
    const rows = modalPaginationRows[key] || [];
    if (!modalPaginationState[key]) modalPaginationState[key] = { page: 1 };
    const state = modalPaginationState[key];
    const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;

    const body = document.getElementById(conf.bodyId);
    if (!body) return;

    if (rows.length === 0) {
        body.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhum registro encontrado</div>';
        return;
    }

    const start = (state.page - 1) * PAGE_SIZE;
    const pageRows = rows.slice(start, start + PAGE_SIZE);

    let html = `<div style="overflow-x:auto;"><table><thead><tr>${conf.columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>`;
    html += pageRows.map(r => `<tr>${conf.columns.map(c => `<td>${c.render(r)}</td>`).join('')}</tr>`).join('');
    html += `</tbody></table></div>`;

    if (totalPages > 1) {
        html += `<div class="alert-pagination">
            <button class="alert-page-btn" onclick="changeModalPage('${key}', -1)" ${state.page === 1 ? 'disabled' : ''}>‹</button>
            <span class="alert-page-info">${state.page} / ${totalPages}</span>
            <button class="alert-page-btn" onclick="changeModalPage('${key}', 1)" ${state.page === totalPages ? 'disabled' : ''}>›</button>
        </div>`;
    }

    body.innerHTML = html;
}

function changeModalPage(key, dir) {
    if (!modalPaginationState[key]) return;
    const totalPages = Math.max(1, Math.ceil((modalPaginationRows[key] || []).length / PAGE_SIZE));
    modalPaginationState[key].page = Math.max(1, Math.min(totalPages, modalPaginationState[key].page + dir));
    renderPaginatedModal(key);
}

function abrirModalForaPrazo() {
    const vendedorSel = getVendedorFiltroAtual();
    let lista = allVendas.filter(v => {
        if (vendedorSel && (v.vendedor || '').toUpperCase().trim() !== vendedorSel) return false;
        return isForaDoPrazo(v);
    });
    lista.sort((a, b) => (a.previsao_entrega || '').localeCompare(b.previsao_entrega || ''));
    modalPaginationRows.foraPrazo = lista;
    modalPaginationState.foraPrazo = { page: 1 };
    renderPaginatedModal('foraPrazo');
    document.getElementById('foraPrazoModal').style.display = 'flex';
}

function abrirModalPago() {
    const vendedorSel = getVendedorFiltroAtual();
    const linhas = getPagamentosDoMes(currentMonth.getMonth(), currentMonth.getFullYear(), vendedorSel);
    modalPaginationRows.pago = linhas;
    modalPaginationState.pago = { page: 1 };
    renderPaginatedModal('pago');
    document.getElementById('pagoModal').style.display = 'flex';
}

function abrirModalAReceber() {
    const vendedorSel = getVendedorFiltroAtual();
    let lista = allVendas.filter(v => {
        if (vendedorSel && (v.vendedor || '').toUpperCase().trim() !== vendedorSel) return false;
        return normalizeStatusFrete(v.status_frete) === 'ENTREGUE' && !isPago(v);
    });
    lista.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    modalPaginationRows.aReceber = lista;
    modalPaginationState.aReceber = { page: 1 };
    renderPaginatedModal('aReceber');
    document.getElementById('aReceberModal').style.display = 'flex';
}

// ─── Painel Geral (ícone de gráfico) ──────────────────────────────────────────
const MESES_ABREV = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

function abrirPainelGeral() {
    painelAno = new Date().getFullYear();
    // Vendedor logado (Isaque/Miguel) começa no modo Individual, já mostrando seus
    // próprios números; nos demais casos começa no modo Geral (todos combinados).
    painelModo = vendedorLogado ? 'individual' : 'geral';
    atualizarBotoesPainelModo();
    renderPainelGeral();
    document.getElementById('painelModal').style.display = 'flex';
}

function atualizarBotoesPainelModo() {
    document.getElementById('painelBtnGeral')?.classList.toggle('active', painelModo === 'geral');
    document.getElementById('painelBtnIndividual')?.classList.toggle('active', painelModo === 'individual');
}

// ─── Alterna entre "Geral" (todos os vendedores combinados) e "Individual" ────
// (vendedor logado, ou selecionado no filtro principal quando o módulo está
// liberado). Isso evita a necessidade de ficar filtrando toda hora.
function setPainelModo(modo) {
    painelModo = modo;
    atualizarBotoesPainelModo();
    renderPainelGeral();
}

// Retorna o vendedor a considerar dentro do Painel Geral, de acordo com o modo.
// No modo "geral" retorna '' (sem filtro) — o painel mostra apenas números,
// então não há necessidade de restringir por vendedor mesmo quando o filtro
// principal está travado para um vendedor específico.
function getVendedorPainelAtual() {
    if (painelModo === 'individual') {
        return vendedorLogado || getVendedorFiltroAtual();
    }
    return '';
}

function mudarAnoPainel(dir) {
    painelAno += dir;
    renderPainelGeral();
}

function computeMonthlySum(ano, vendedorSel, field) {
    const arr = new Array(12).fill(0);
    allVendas.forEach(v => {
        if (vendedorSel && (v.vendedor || '').toUpperCase().trim() !== vendedorSel) return;
        if (!v.data_emissao) return;
        const d = new Date(v.data_emissao + 'T00:00:00');
        if (d.getFullYear() !== ano) return;
        arr[d.getMonth()] += parseFloat(v[field]) || 0;
    });
    return arr;
}

function computeMonthlyAReceber(ano, vendedorSel) {
    const arr = new Array(12).fill(0);
    allVendas.forEach(v => {
        if (vendedorSel && (v.vendedor || '').toUpperCase().trim() !== vendedorSel) return;
        if (!v.data_emissao) return;
        const d = new Date(v.data_emissao + 'T00:00:00');
        if (d.getFullYear() !== ano) return;
        if (normalizeStatusFrete(v.status_frete) === 'ENTREGUE' && !isPago(v)) {
            arr[d.getMonth()] += parseFloat(v.valor_nf) || 0;
        }
    });
    return arr;
}

function computeMonthlyPago(ano, vendedorSel) {
    const arr = new Array(12).fill(0);
    for (let m = 0; m < 12; m++) arr[m] = somaPagamentosDoMes(m, ano, vendedorSel);
    return arr;
}

// modo: 'faturamento' (compara c/ mês anterior: sobe=verde, desce=vermelho),
// 'frete' (mesma comparação, porém invertida: sobe=vermelho, desce=azul),
// 'receber' (laranja quando há valor pendente no mês, senão neutro),
// 'pago' (sempre verde).
function renderMesesGrid(valores, modo) {
    let html = '<div class="painel-months-grid">';
    valores.forEach((val, i) => {
        let cls = 'neutral';

        if (modo === 'faturamento' || modo === 'frete') {
            if (val > 0) {
                const anterior = i > 0 ? valores[i - 1] : null;
                if (anterior) {
                    if (modo === 'faturamento') {
                        cls = val < anterior ? 'down' : 'up';
                    } else {
                        cls = val > anterior ? 'frete-up' : 'frete-down';
                    }
                }
            }
        } else if (modo === 'receber') {
            cls = val > 0 ? 'receber-has' : 'neutral';
        } else if (modo === 'pago') {
            cls = 'pago-green';
        }

        html += `<div class="painel-month-card">
            <div class="painel-month-name">${MESES_ABREV[i]}</div>
            <div class="painel-month-value ${cls}">${formatCurrency(val)}</div>
        </div>`;
    });
    html += '</div>';
    return html;
}

// Aba "Geral": mesmo estilo visual de cartão das demais abas (painel-month-card),
// com as cores fixas de cada dashboard equivalente na tela principal:
// Faturamento (neutro), Frete Total (azul), A Receber (laranja quando há saldo,
// senão neutro), Total Pago (verde).
function renderPainelResumo(faturamento, frete, receber, pago) {
    const itens = [
        { label: `Faturamento ${painelAno}`, valor: faturamento, cls: 'neutral' },
        { label: `Frete Total ${painelAno}`, valor: frete, cls: 'frete-down' },
        { label: `A Receber ${painelAno}`, valor: receber, cls: receber > 0 ? 'receber-has' : 'neutral' },
        { label: `Total Pago ${painelAno}`, valor: pago, cls: 'pago-green' }
    ];
    let html = '<div class="painel-months-grid">';
    itens.forEach(it => {
        html += `<div class="painel-month-card">
            <div class="painel-month-name">${it.label}</div>
            <div class="painel-month-value ${it.cls}">${formatCurrency(it.valor)}</div>
        </div>`;
    });
    html += '</div>';
    return html;
}

function renderPainelGeral() {
    const yearLabel = document.getElementById('painelYearLabel');
    if (yearLabel) yearLabel.textContent = painelAno;

    const vendedorSel = getVendedorPainelAtual();

    const label = document.getElementById('painelVendedorLabel');
    if (label) label.textContent = (painelModo === 'individual' && vendedorSel) ? `— ${vendedorSel}` : '';

    const faturamentoMes = computeMonthlySum(painelAno, vendedorSel, 'valor_nf');
    const freteMes       = computeMonthlySum(painelAno, vendedorSel, 'valor_frete');
    const receberMes     = computeMonthlyAReceber(painelAno, vendedorSel);
    const pagoMes        = computeMonthlyPago(painelAno, vendedorSel);

    const somaAno = arr => arr.reduce((s, v) => s + v, 0);

    document.getElementById('painelTabGeral').innerHTML = renderPainelResumo(
        somaAno(faturamentoMes), somaAno(freteMes), somaAno(receberMes), somaAno(pagoMes)
    );

    document.getElementById('painelTabFaturamento').innerHTML = renderMesesGrid(faturamentoMes, 'faturamento');
    document.getElementById('painelTabFrete').innerHTML       = renderMesesGrid(freteMes, 'frete');
    document.getElementById('painelTabReceber').innerHTML     = renderMesesGrid(receberMes, 'receber');
    document.getElementById('painelTabPago').innerHTML        = renderMesesGrid(pagoMes, 'pago');
}

function switchPainelTab(tab, btnEl) {
    const tabs = ['geral', 'faturamento', 'frete', 'receber', 'pago'];
    document.querySelectorAll('#painelModal .tab-btn').forEach((b, i) => b.classList.toggle('active', tabs[i] === tab));
    tabs.forEach(t => {
        const el = document.getElementById('painelTab' + t.charAt(0).toUpperCase() + t.slice(1));
        if (el) el.classList.toggle('active', t === tab);
    });
}

function filterVendas() {
    updateDisplay();
}
