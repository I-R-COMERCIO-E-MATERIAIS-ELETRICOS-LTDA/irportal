// ============================================
// CONFIGURAÇÃO
// ============================================
const DEVELOPMENT_MODE = false;
const PORTAL_URL = window.location.origin;
const API_URL = window.location.origin + '/api';

let vendas = [];
let isOnline = false;
let sessionToken = null;
let currentMonth = new Date();

const mesesNomes = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

console.log('✅ Vendas iniciado');

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    if (DEVELOPMENT_MODE) { sessionToken = 'dev-mode'; inicializarApp(); }
    else { verificarAutenticacao(); }
});

function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('vendasSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('vendasSession');
    }
    if (!sessionToken) { mostrarTelaAcessoNegado(); return; }
    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:var(--bg-primary);color:var(--text-primary);text-align:center;padding:2rem;"><h1 style="font-size:2.2rem;margin-bottom:1rem;">${mensagem}</h1><p style="color:var(--text-secondary);margin-bottom:2rem;">Somente usuários autenticados podem acessar esta área.</p><a href="${PORTAL_URL}" style="display:inline-block;background:var(--btn-register);color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;">Ir para o Portal</a></div>`;
}

async function inicializarApp() {
    updateMonthDisplay();

    // Tenta sincronizar IMEDIATAMENTE (independente de online/offline – se falhar, apenas loga)
    try {
        console.log('🔄 Forçando sincronização inicial...');
        const res = await fetch(`${API_URL}/vendas/sincronizar`, {
            method: 'POST',
            headers: { 'X-Session-Token': sessionToken }
        });
        if (res.ok) {
            const data = await res.json();
            console.log('📊 Sincronização inicial:', data.message);
        } else {
            console.warn('Sincronização inicial falhou:', res.status);
        }
    } catch (e) {
        console.warn('Erro ao sincronizar (início):', e);
    }

    // Agora carrega a lista e verifica status periodicamente
    await checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

// ============================================
// CONEXÃO
// ============================================
async function checkServerStatus() {
    try {
        const r = await fetch(`${API_URL}/vendas`, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' },
            mode: 'cors'
        });
        if (!DEVELOPMENT_MODE && r.status === 401) {
            sessionStorage.removeItem('vendasSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }
        const wasOffline = !isOnline;
        isOnline = r.ok;
        if (wasOffline && isOnline) await loadVendas();
        return isOnline;
    } catch { isOnline = false; return false; }
}

async function loadVendas(showMsg = false) {
    try {
        const r = await fetch(`${API_URL}/vendas?_t=${Date.now()}`, {
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json', 'Cache-Control': 'no-cache' },
            mode: 'cors'
        });
        if (!DEVELOPMENT_MODE && r.status === 401) {
            sessionStorage.removeItem('vendasSession'); mostrarTelaAcessoNegado('Sessão expirou'); return;
        }
        if (!r.ok) {
            if (showMsg) showToast('Erro ao carregar', 'error');
            return;
        }
        vendas = await r.json();
        console.log(`✅ ${vendas.length} vendas carregadas`);
        updateDashboard(); filterVendas();
    } catch (err) {
        console.error(err);
        if (showMsg) showToast('Erro ao carregar', 'error');
    }
}

window.syncData = async function (silencioso = false) {
    const btns = document.querySelectorAll('button[onclick="syncData()"]');
    btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = 'spin 1s linear infinite'; });

    try {
        const res = await fetch(`${API_URL}/vendas/sincronizar`, {
            method: 'POST',
            headers: { 'X-Session-Token': sessionToken }
        });
        const data = await res.json();
        if (res.ok) {
            console.log('📊', data.message);
            if (!silencioso) showToast(data.message, 'success');
        } else {
            console.error('❌ Erro na sincronização:', data.error || data);
            if (!silencioso) showToast('Erro na sincronização', 'error');
        }
    } catch (e) {
        console.warn('Sync falhou:', e);
        if (!silencioso) showToast('Erro na sincronização', 'error');
    }

    await loadVendas(!silencioso);

    setTimeout(() => {
        btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = ''; });
    }, 1000);
};

function startPolling() {
    loadVendas();
    setInterval(() => { if (isOnline) loadVendas(); }, 15000);
}

// ============================================
// NAVEGAÇÃO
// ============================================
function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard(); filterVendas();
}
window.changeMonth = d => { currentMonth.setMonth(currentMonth.getMonth() + d); updateMonthDisplay(); };
window.selectMonth = idx => { currentMonth = new Date(currentMonth.getFullYear(), idx, 1); updateMonthDisplay(); window.toggleCalendar?.(); };

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const mes = getVendasMes();
    const pago = mes
        .filter(v => v.status_pagamento === 'PAGO' || /parcela/i.test(v.status_pagamento))
        .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);
    const receber = mes
        .filter(v => v.status_pagamento === 'A RECEBER')
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

// ============================================
// TABELA
// ============================================
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
    updateDashboard();
};

function renderVendas(lista) {
    const c = document.getElementById('vendasContainer');
    if (!c) return;
    if (!lista.length) {
        c.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }
    c.innerHTML = `<div style="overflow-x:auto;"><table><thead><tr><th>NF</th><th>Órgão</th><th>Vendedor</th><th>Origem</th><th>Valor NF</th><th>Status Frete</th><th>Status Pgto</th></tr></thead><tbody>${
        lista.map(v => `<tr data-id="${v.id}" style="cursor:pointer;" onclick="handleViewClick('${v.id}')">
            <td><strong>${v.numero_nf || '-'}</strong></td>
            <td style="max-width:200px;word-wrap:break-word;white-space:normal;">${v.nome_orgao || '-'}</td>
            <td>${v.vendedor || '-'}</td>
            <td><span class="badge ${v.origem === 'CONTROLE_FRETE' ? 'transito' : 'entregue'}" style="font-size:0.7rem;">${v.origem === 'CONTROLE_FRETE' ? 'Frete' : 'Receber'}</span></td>
            <td><strong>R$ ${parseFloat(v.valor_nf || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></td>
            <td>${badgeFrete(v.status_frete)}</td>
            <td>${badgePagto(v.status_pagamento)}</td>
        </tr>`).join('')
    }</tbody></table></div>`;
}

function badgeFrete(st) {
    if (!st) return '<span style="color:var(--text-secondary);">-</span>';
    const m = { 'EM TRÂNSITO': 'transito', 'ENTREGUE': 'entregue', 'AGUARDANDO COLETA': 'cancelado', 'EXTRAVIADO': 'devolvido' };
    return `<span class="badge ${m[st] || 'transito'}">${st}</span>`;
}
function badgePagto(st) {
    if (!st) return '<span style="color:var(--text-secondary);">-</span>';
    if (/parcela/i.test(st)) return `<span class="badge pago">${st}</span>`;
    if (st === 'PAGO') return '<span class="badge pago">PAGO</span>';
    if (st === 'A RECEBER') return '<span class="badge transito">A RECEBER</span>';
    return `<span class="badge transito">${st}</span>`;
}

// ============================================
// MODAL
// ============================================
window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return showToast('Venda não encontrada!', 'error');
    document.getElementById('modalNumeroNF').textContent = v.numero_nf || '-';
    const d = val => val ? new Date(val + 'T00:00:00').toLocaleDateString('pt-BR') : '-';
    const fmt = val => val ? `R$ ${parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';
    document.getElementById('modalBody').innerHTML = `
        <div class="info-section"><h4>Dados Gerais</h4>
            <p><strong>Órgão:</strong> ${v.nome_orgao || '-'}</p>
            <p><strong>Vendedor:</strong> ${v.vendedor || '-'}</p>
            <p><strong>Tipo NF:</strong> ${v.tipo_nf || '-'}</p>
            <p><strong>Data:</strong> ${d(v.data_emissao)}</p>
            <p><strong>Valor:</strong> ${fmt(v.valor_nf)}</p>
        </div>
        <div class="info-section"><h4>Frete</h4>
            <p><strong>Transportadora:</strong> ${v.transportadora || '-'}</p>
            <p><strong>Valor Frete:</strong> ${fmt(v.valor_frete)}</p>
            <p><strong>Destino:</strong> ${v.cidade_destino || '-'}</p>
            <p><strong>Previsão:</strong> ${d(v.previsao_entrega)}</p>
            <p><strong>Status:</strong> ${v.status_frete || '-'}</p>
        </div>
        <div class="info-section"><h4>Pagamento</h4>
            <p><strong>Banco:</strong> ${v.banco || '-'}</p>
            <p><strong>Vencimento:</strong> ${d(v.data_vencimento)}</p>
            <p><strong>Pago em:</strong> ${d(v.data_pagamento)}</p>
            <p><strong>Status:</strong> ${badgePagto(v.status_pagamento)}</p>
        </div>
    `;
    document.getElementById('infoModal').style.display = 'flex';
};
window.closeInfoModal = () => document.getElementById('infoModal').style.display = 'none';

// ============================================
// PDF
// ============================================
window.gerarPDF = function () {
    try {
        const { jsPDF } = window.jspdf; const doc = new jsPDF();
        doc.setFontSize(14);
        doc.text(`Vendas — ${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 14, 15);
        const rows = getVendasMes().map(v => [v.numero_nf || '-', v.nome_orgao || '-', v.vendedor || '-', `R$ ${parseFloat(v.valor_nf || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`, v.status_frete || '-', v.status_pagamento || '-']);
        doc.autoTable({ head: [['NF', 'Órgão', 'Vendedor', 'Valor', 'Status Frete', 'Status Pgto']], body: rows, startY: 22, styles: { fontSize: 8 } });
        doc.save(`vendas_${currentMonth.getFullYear()}_${String(currentMonth.getMonth() + 1).padStart(2, '0')}.pdf`);
        showToast('PDF gerado!', 'success');
    } catch (e) { console.error(e); showToast('Erro no PDF', 'error'); }
};

// ============================================
// UTILITÁRIOS
// ============================================
function showToast(msg, type) {
    document.querySelectorAll('.floating-message').forEach(m => m.remove());
    const div = document.createElement('div'); div.className = `floating-message ${type}`; div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(() => { div.style.animation = 'slideOutBottom 0.3s ease forwards'; setTimeout(() => div.remove(), 300); }, 3000);
}
window.updateDisplay = updateMonthDisplay;
