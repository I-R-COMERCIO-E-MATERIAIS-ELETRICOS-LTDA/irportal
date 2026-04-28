const DEVELOPMENT_MODE = false;
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let vendas = [];
let sessionToken = null;
let currentMonth = new Date();

const mesesNomes = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('vendasSession', tokenFromUrl);
    } else {
        sessionToken = sessionStorage.getItem('vendasSession');
    }
    if (!sessionToken) {
        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                        height:100vh;background:var(--bg-primary);color:var(--text-primary);
                        text-align:center;padding:2rem;">
                <h1>NÃO AUTORIZADO</h1><p>Sem token de sessão.</p>
            </div>`;
        return;
    }
    inicializarApp();
});

async function inicializarApp() {
    updateMonthDisplay();

    // Sincroniza ao abrir e depois a cada 5 minutos
    await sincronizarDados();
    await loadVendas();

    setInterval(loadVendas, 15000);          // recarrega tabela a cada 15s
    setInterval(sincronizarDados, 300000);   // sincroniza fontes a cada 5min
}

async function sincronizarDados() {
    try {
        const r = await fetch(`${API_URL}/vendas/sincronizar`, {
            method: 'POST',
            headers: { 'X-Session-Token': sessionToken }
        });
        const d = await r.json();
        if (d.success) {
            console.log('📊 Sincronizado:', d.message);
        } else {
            console.warn('⚠️ Falha na sincronização:', d.error);
            showToast('Falha na sincronização', 'error');
        }
    } catch (e) {
        console.error('Erro de rede na sincronização:', e);
        showToast('Erro de rede na sincronização', 'error');
    }
}

async function loadVendas() {
    try {
        const r = await fetch(`${API_URL}/vendas?_t=${Date.now()}`, {
            headers: {
                'X-Session-Token': sessionToken,
                'Accept': 'application/json'
            }
        });
        if (r.ok) {
            const dados = await r.json();
            vendas = Array.isArray(dados) ? dados : [];
            console.log(`✅ ${vendas.length} vendas carregadas`);
            updateDashboard();
            filterVendas();
        } else {
            console.error('Erro ao carregar vendas:', r.status);
        }
    } catch (e) {
        console.error('Erro ao carregar vendas:', e);
    }
}

// Botão de sincronização manual
window.syncData = async function () {
    const btn = document.querySelector('button[onclick="syncData()"]');
    const svg = btn?.querySelector('svg');
    if (svg) svg.style.animation = 'spin 1s linear infinite';

    showToast('Sincronizando...', 'info');
    await sincronizarDados();
    await loadVendas();
    showToast('Dados atualizados!', 'success');

    if (svg) svg.style.animation = '';
};

// ─── NAVEGAÇÃO DE MÊS ──────────────────────────────────────────────────────────
function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard();
    filterVendas();
}

window.changeMonth = function (delta) {
    currentMonth.setMonth(currentMonth.getMonth() + delta);
    updateMonthDisplay();
};

window.selectMonth = function (idx) {
    currentMonth = new Date(currentMonth.getFullYear(), idx, 1);
    updateMonthDisplay();
    if (window.toggleCalendar) window.toggleCalendar();
};

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
function updateDashboard() {
    const mes = getVendasMes();

    // Pago = status PAGO ou qualquer variação de PARCELA
    const pago = mes
        .filter(v => v.status_pagamento === 'PAGO' || /parcela/i.test(v.status_pagamento || ''))
        .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    // A Receber = status A RECEBER (pode ser null também para fretes sem pagamento)
    const receber = mes
        .filter(v => !v.status_pagamento || v.status_pagamento === 'A RECEBER')
        .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    const entregue = mes.filter(v => v.status_frete === 'ENTREGUE').length;
    const faturado = mes.reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('totalPago').textContent      = fmt(pago);
    document.getElementById('totalAReceber').textContent  = fmt(receber);
    document.getElementById('totalEntregue').textContent  = entregue;
    document.getElementById('totalFaturado').textContent  = fmt(faturado);
}

/**
 * Retorna as vendas do mês/ano atual.
 * Usa data_emissao se disponível; caso contrário usa data_vencimento como fallback
 * para não perder registros vindos somente de contas_receber.
 */
function getVendasMes() {
    return vendas.filter(v => {
        // Tenta data_emissao primeiro, depois data_vencimento como fallback
        const dataStr = v.data_emissao || v.data_vencimento;
        if (!dataStr) return false;
        const d = new Date(dataStr + 'T00:00:00');
        return (
            d.getMonth()    === currentMonth.getMonth() &&
            d.getFullYear() === currentMonth.getFullYear()
        );
    });
}

// ─── FILTROS E TABELA ──────────────────────────────────────────────────────────
window.filterVendas = function () {
    const s    = (document.getElementById('search')?.value || '').toLowerCase();
    const vend = document.getElementById('filterVendedor')?.value || '';
    const st   = document.getElementById('filterStatus')?.value  || '';

    let f = getVendasMes();

    if (vend) f = f.filter(v => v.vendedor === vend);
    if (st)   f = f.filter(v =>
        v.status_frete     === st ||
        v.status_pagamento === st ||
        v.tipo_nf          === st
    );
    if (s) f = f.filter(v =>
        [v.numero_nf, v.nome_orgao, v.vendedor, v.transportadora, v.banco]
            .some(x => x && x.toLowerCase().includes(s))
    );

    // Ordena por número de NF
    f.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));

    renderVendas(f);
};

function renderVendas(lista) {
    const c = document.getElementById('vendasContainer');
    if (!c) return;

    if (!lista.length) {
        c.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    c.innerHTML = `
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Vendedor</th>
                        <th>Origem</th>
                        <th>Valor NF</th>
                        <th>Status Frete</th>
                        <th>Status Pgto</th>
                    </tr>
                </thead>
                <tbody>
                    ${lista.map(v => `
                        <tr data-id="${v.id}" style="cursor:pointer;" onclick="handleViewClick('${v.id}')">
                            <td><strong>${v.numero_nf || '-'}</strong></td>
                            <td style="max-width:200px;word-wrap:break-word;white-space:normal;">
                                ${v.nome_orgao || '-'}
                            </td>
                            <td>${v.vendedor || '-'}</td>
                            <td>
                                <span class="badge ${v.origem === 'CONTROLE_FRETE' ? 'transito' : 'entregue'}"
                                      style="font-size:0.7rem;">
                                    ${v.origem === 'CONTROLE_FRETE' ? 'Frete' : 'Receber'}
                                </span>
                            </td>
                            <td>
                                <strong>R$ ${parseFloat(v.valor_nf || 0)
                                    .toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong>
                            </td>
                            <td>${badgeFrete(v.status_frete)}</td>
                            <td>${badgePagto(v.status_pagamento)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>`;
}

function badgeFrete(st) {
    if (!st) return '<span style="color:var(--text-secondary);font-size:0.8rem;">—</span>';
    const m = {
        'EM TRÂNSITO':       'transito',
        'ENTREGUE':          'entregue',
        'AGUARDANDO COLETA': 'cancelado',
        'EXTRAVIADO':        'cancelado',
    };
    return `<span class="badge ${m[st] || 'transito'}">${st}</span>`;
}

function badgePagto(st) {
    if (!st || st === 'A RECEBER') {
        return `<span class="badge transito">${st || 'A RECEBER'}</span>`;
    }
    if (/parcela/i.test(st)) return `<span class="badge pago">${st}</span>`;
    if (st === 'PAGO')        return `<span class="badge pago">PAGO</span>`;
    return `<span class="badge transito">${st}</span>`;
}

// ─── MODAL DE DETALHES ─────────────────────────────────────────────────────────
window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return;

    document.getElementById('modalNumeroNF').textContent = v.numero_nf || '-';

    const fmtData = val => val ? new Date(val + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
    const fmtVal  = val => val
        ? `R$ ${parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`
        : '-';

    document.getElementById('modalBody').innerHTML = `
        <div class="info-section">
            <h4>Geral</h4>
            <p><strong>NF:</strong> ${v.numero_nf || '-'}</p>
            <p><strong>Órgão:</strong> ${v.nome_orgao || '-'}</p>
            <p><strong>Vendedor:</strong> ${v.vendedor || '-'}</p>
            <p><strong>Tipo NF:</strong> ${v.tipo_nf || '-'}</p>
            <p><strong>Data Emissão:</strong> ${fmtData(v.data_emissao)}</p>
            <p><strong>Valor NF:</strong> ${fmtVal(v.valor_nf)}</p>
            <p><strong>Origem:</strong> ${v.origem === 'CONTROLE_FRETE' ? 'Controle de Frete' : 'Contas a Receber'}</p>
        </div>
        <div class="info-section">
            <h4>Frete</h4>
            <p><strong>Transportadora:</strong> ${v.transportadora || '-'}</p>
            <p><strong>Valor Frete:</strong> ${fmtVal(v.valor_frete)}</p>
            <p><strong>Data Coleta:</strong> ${fmtData(v.data_coleta)}</p>
            <p><strong>Cidade Destino:</strong> ${v.cidade_destino || '-'}</p>
            <p><strong>Previsão Entrega:</strong> ${fmtData(v.previsao_entrega)}</p>
            <p><strong>Status Frete:</strong> ${v.status_frete ? badgeFrete(v.status_frete) : '-'}</p>
        </div>
        <div class="info-section">
            <h4>Pagamento</h4>
            <p><strong>Banco:</strong> ${v.banco || '-'}</p>
            <p><strong>Vencimento:</strong> ${fmtData(v.data_vencimento)}</p>
            <p><strong>Pago em:</strong> ${fmtData(v.data_pagamento)}</p>
            <p><strong>Valor Pago:</strong> ${fmtVal(v.valor_pago)}</p>
            <p><strong>Status Pgto:</strong> ${badgePagto(v.status_pagamento)}</p>
        </div>`;

    document.getElementById('infoModal').style.display = 'flex';
};

window.closeInfoModal = () => {
    document.getElementById('infoModal').style.display = 'none';
};

// ─── PDF ───────────────────────────────────────────────────────────────────────
window.gerarPDF = function () {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const mes = getVendasMes();

    doc.setFontSize(14);
    doc.text(`Vendas - ${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 14, 15);

    doc.autoTable({
        startY: 22,
        head: [['NF', 'Órgão', 'Vendedor', 'Valor NF', 'Status Frete', 'Status Pgto']],
        body: mes.map(v => [
            v.numero_nf          || '-',
            v.nome_orgao         || '-',
            v.vendedor           || '-',
            `R$ ${parseFloat(v.valor_nf || 0).toFixed(2)}`,
            v.status_frete       || '-',
            v.status_pagamento   || '-',
        ]),
        styles: { fontSize: 9 },
        headStyles: { fillColor: [107, 114, 128] },
    });

    doc.save(`vendas_${mesesNomes[currentMonth.getMonth()]}_${currentMonth.getFullYear()}.pdf`);
};

// ─── TOAST ─────────────────────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = msg;
    div.style.cssText = `
        position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;
        padding:0.75rem 1.25rem;border-radius:8px;font-weight:600;
        font-size:0.875rem;animation:fadeIn 0.3s ease;
        background:${type === 'error' ? '#EF4444' : type === 'success' ? '#22C55E' : '#3B82F6'};
        color:#fff;box-shadow:0 4px 12px rgba(0,0,0,0.15);
    `;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}
