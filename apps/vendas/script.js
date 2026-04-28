const DEVELOPMENT_MODE = false;
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let vendas = [];
let sessionToken = null;
let currentMonth = new Date();

const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

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
        document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:var(--bg-primary);color:var(--text-primary);text-align:center;padding:2rem;">
            <h1>NÃO AUTORIZADO</h1><p>Sem token de sessão.</p></div>`;
        return;
    }
    inicializarApp();
});

async function inicializarApp() {
    updateMonthDisplay();
    // Força sincronização e carrega dados imediatamente
    await fetch(`${API_URL}/vendas/sincronizar`, {
        method: 'POST',
        headers: { 'X-Session-Token': sessionToken }
    }).then(r => r.json()).then(d => {
        if (d.success) console.log('📊 Sincronizado:', d.message);
        else showToast('Falha na sincronização', 'error');
    }).catch(() => showToast('Erro de rede na sincronização', 'error'));

    loadVendas();
    setInterval(loadVendas, 15000);
}

async function loadVendas() {
    try {
        const r = await fetch(`${API_URL}/vendas?_t=${Date.now()}`, {
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' }
        });
        if (r.ok) {
            vendas = await r.json();
            console.log(`✅ ${vendas.length} vendas carregadas`);
            updateDashboard();
            filterVendas();
        }
    } catch (e) { console.error(e); }
}

window.syncData = async function () {
    const btn = document.querySelector('button[onclick="syncData()"]');
    if (btn) { const svg = btn.querySelector('svg'); if (svg) svg.style.animation = 'spin 1s linear infinite'; }
    await fetch(`${API_URL}/vendas/sincronizar`, { method: 'POST', headers: { 'X-Session-Token': sessionToken } });
    await loadVendas();
    if (btn) { const svg = btn.querySelector('svg'); if (svg) svg.style.animation = ''; }
};

function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard(); filterVendas();
}
window.changeMonth = d => { currentMonth.setMonth(currentMonth.getMonth() + d); updateMonthDisplay(); };
window.selectMonth = idx => { currentMonth = new Date(currentMonth.getFullYear(), idx, 1); updateMonthDisplay(); if (window.toggleCalendar) window.toggleCalendar(); };

function updateDashboard() {
    const mes = getVendasMes();
    const pago = mes.filter(v => v.status_pagamento === 'PAGO' || /parcela/i.test(v.status_pagamento))
                    .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);
    const receber = mes.filter(v => v.status_pagamento === 'A RECEBER')
                       .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);
    const entregue = mes.filter(v => v.status_frete === 'ENTREGUE').length;
    const faturado = mes.reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);
    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('totalPago').textContent = fmt(pago);
    document.getElementById('totalAReceber').textContent = fmt(receber);
    document.getElementById('totalEntregue').textContent = entregue;
    document.getElementById('totalFaturado').textContent = fmt(faturado);
}
function getVendasMes() {
    return vendas.filter(v => {
        if (!v.data_emissao) return false;
        const d = new Date(v.data_emissao + 'T00:00:00');
        return d.getMonth() === currentMonth.getMonth() && d.getFullYear() === currentMonth.getFullYear();
    });
}

window.filterVendas = function () {
    const s = (document.getElementById('search')?.value || '').toLowerCase();
    const vend = document.getElementById('filterVendedor')?.value || '';
    const st = document.getElementById('filterStatus')?.value || '';
    let f = getVendasMes();
    if (vend) f = f.filter(v => v.vendedor === vend);
    if (st) f = f.filter(v => v.status_frete === st || v.status_pagamento === st || v.tipo_nf === st);
    if (s) f = f.filter(v => [v.numero_nf, v.nome_orgao, v.vendedor, v.transportadora, v.banco].some(x => x && x.toLowerCase().includes(s)));
    f.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderVendas(f);
};

function renderVendas(lista) {
    const c = document.getElementById('vendasContainer');
    if (!c) return;
    if (!lista.length) { c.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>'; return; }
    c.innerHTML = `<div style="overflow-x:auto;"><table><thead><tr><th>NF</th><th>Órgão</th><th>Vendedor</th><th>Origem</th><th>Valor NF</th><th>Status Frete</th><th>Status Pgto</th></tr></thead><tbody>${
        lista.map(v => `<tr data-id="${v.id}" style="cursor:pointer;" onclick="handleViewClick('${v.id}')">
            <td><strong>${v.numero_nf || '-'}</strong></td>
            <td style="max-width:200px;word-wrap:break-word;white-space:normal;">${v.nome_orgao || '-'}</td>
            <td>${v.vendedor || '-'}</td>
            <td><span class="badge ${v.origem === 'CONTROLE_FRETE' ? 'transito' : 'entregue'}" style="font-size:0.7rem;">${v.origem === 'CONTROLE_FRETE' ? 'Frete' : 'Receber'}</span></td>
            <td><strong>R$ ${parseFloat(v.valor_nf || 0).toLocaleString('pt-BR',{minimumFractionDigits:2})}</strong></td>
            <td>${badgeFrete(v.status_frete)}</td>
            <td>${badgePagto(v.status_pagamento)}</td>
        </tr>`).join('')
    }</tbody></table></div>`;
}

function badgeFrete(st) {
    if (!st) return '-';
    const m = {'EM TRÂNSITO':'transito','ENTREGUE':'entregue','AGUARDANDO COLETA':'cancelado'};
    return `<span class="badge ${m[st]||'transito'}">${st}</span>`;
}
function badgePagto(st) {
    if (!st) return '-';
    if (/parcela/i.test(st)) return `<span class="badge pago">${st}</span>`;
    return st === 'PAGO' ? '<span class="badge pago">PAGO</span>' : `<span class="badge transito">${st}</span>`;
}

window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return;
    document.getElementById('modalNumeroNF').textContent = v.numero_nf;
    const d = val => val ? new Date(val+'T00:00:00').toLocaleDateString('pt-BR') : '-';
    const fmt = val => val ? `R$ ${parseFloat(val).toLocaleString('pt-BR',{minimumFractionDigits:2})}` : '-';
    document.getElementById('modalBody').innerHTML = `
        <div class="info-section"><h4>Geral</h4><p><strong>Órgão:</strong> ${v.nome_orgao||'-'}</p><p><strong>Vendedor:</strong> ${v.vendedor||'-'}</p><p><strong>Data:</strong> ${d(v.data_emissao)}</p><p><strong>Valor:</strong> ${fmt(v.valor_nf)}</p></div>
        <div class="info-section"><h4>Frete</h4><p><strong>Transportadora:</strong> ${v.transportadora||'-'}</p><p><strong>Valor Frete:</strong> ${fmt(v.valor_frete)}</p><p><strong>Status:</strong> ${v.status_frete||'-'}</p></div>
        <div class="info-section"><h4>Pagamento</h4><p><strong>Banco:</strong> ${v.banco||'-'}</p><p><strong>Vencimento:</strong> ${d(v.data_vencimento)}</p><p><strong>Pago em:</strong> ${d(v.data_pagamento)}</p><p><strong>Status:</strong> ${badgePagto(v.status_pagamento)}</p></div>
    `;
    document.getElementById('infoModal').style.display = 'flex';
};
window.closeInfoModal = () => document.getElementById('infoModal').style.display = 'none';

window.gerarPDF = function () {
    const { jsPDF } = window.jspdf; const doc = new jsPDF();
    doc.autoTable({ head: [['NF','Órgão','Vendedor','Valor','Status Frete','Status Pgto']], body: getVendasMes().map(v => [v.numero_nf, v.nome_orgao, v.vendedor, `R$ ${parseFloat(v.valor_nf||0).toFixed(2)}`, v.status_frete||'', v.status_pagamento||'']) });
    doc.save('vendas.pdf');
};

function showToast(msg, type) {
    const div = document.createElement('div'); div.className = `floating-message ${type}`; div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3000);
}
