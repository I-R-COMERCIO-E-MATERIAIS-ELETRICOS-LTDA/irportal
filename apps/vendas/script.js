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
console.log('📍 API URL:', API_URL);

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    if (DEVELOPMENT_MODE) {
        sessionToken = 'dev-mode';
        inicializarApp();
    } else {
        verificarAutenticacao();
    }
});

// ============================================
// AUTENTICAÇÃO
// ============================================
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

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p>
            <a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Ir para o Portal</a>
        </div>
    `;
}

function inicializarApp() {
    updateMonthDisplay();
    checkServerStatus();
    setInterval(checkServerStatus, 15000);
    startPolling();
}

// ============================================
// CONEXÃO E STATUS
// ============================================
async function checkServerStatus() {
    try {
        const response = await fetch(`${API_URL}/vendas`, {
            method: 'GET',
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' },
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('vendasSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return false;
        }

        const wasOffline = !isOnline;
        isOnline = response.ok;
        if (wasOffline && isOnline) await loadVendas();
        updateConnectionStatus();
        return isOnline;
    } catch {
        isOnline = false;
        updateConnectionStatus();
        return false;
    }
}

function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (el) el.className = isOnline ? 'connection-status online' : 'connection-status offline';
}

// ============================================
// CARREGAMENTO
// ============================================
async function loadVendas(showMessage = false) {
    if (!isOnline && !DEVELOPMENT_MODE) {
        if (showMessage) showToast('Sistema offline.', 'error');
        return;
    }

    try {
        const response = await fetch(`${API_URL}/vendas?_t=${Date.now()}`, {
            method: 'GET',
            headers: {
                'X-Session-Token': sessionToken,
                'Accept': 'application/json',
                'Cache-Control': 'no-cache'
            },
            mode: 'cors'
        });

        if (!DEVELOPMENT_MODE && response.status === 401) {
            sessionStorage.removeItem('vendasSession');
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }

        if (!response.ok) {
            if (showMessage) showToast('Erro ao sincronizar', 'error');
            return;
        }

        vendas = await response.json();
        console.log(`✅ ${vendas.length} vendas carregadas`);

        updateDashboard();
        filterVendas();
    } catch (err) {
        console.error('❌ Erro ao carregar vendas:', err);
        if (showMessage) showToast('Erro ao sincronizar', 'error');
    }
}

window.syncData = async function () {
    const btns = document.querySelectorAll('button[onclick="syncData()"]');
    btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = 'spin 1s linear infinite'; });

    // Dispara sincronização manual no backend
    if (isOnline) {
        try {
            await fetch(`${API_URL}/vendas/sincronizar`, {
                method: 'POST',
                headers: { 'X-Session-Token': sessionToken }
            });
        } catch (e) {
            console.warn('Sync manual falhou:', e);
        }
    }

    await loadVendas(true);
    setTimeout(() => {
        btns.forEach(b => { const s = b.querySelector('svg'); if (s) s.style.animation = ''; });
    }, 1000);
};

function startPolling() {
    loadVendas();
    setInterval(() => { if (isOnline) loadVendas(); }, 15000);
}

// ============================================
// NAVEGAÇÃO POR MESES
// ============================================
function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard();
    filterVendas();
}

window.changeMonth = function (direction) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + direction, 1);
    updateMonthDisplay();
};

// Compatibilidade com calendar.js
window.selectMonth = function (monthIndex) {
    currentMonth = new Date(currentMonth.getFullYear(), monthIndex, 1);
    updateMonthDisplay();
    window.toggleCalendar && window.toggleCalendar();
};

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const mesAtual = getVendasMes();

    const totalPago = mesAtual
        .filter(v => v.status_pagamento === 'PAGO')
        .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    const totalAReceber = mesAtual
        .filter(v => v.status_pagamento === 'A RECEBER')
        .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    const totalEntregue = mesAtual.filter(v => v.status_frete === 'ENTREGUE').length;

    const totalFaturado = mesAtual.reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    const fmt = v => `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const el = id => document.getElementById(id);
    if (el('totalPago')) el('totalPago').textContent = fmt(totalPago);
    if (el('totalAReceber')) el('totalAReceber').textContent = fmt(totalAReceber);
    if (el('totalEntregue')) el('totalEntregue').textContent = totalEntregue;
    if (el('totalFaturado')) el('totalFaturado').textContent = fmt(totalFaturado);
}

function getVendasMes() {
    return vendas.filter(v => {
        if (!v.data_emissao) return false;
        const d = new Date(v.data_emissao + 'T00:00:00');
        return d.getMonth() === currentMonth.getMonth() &&
               d.getFullYear() === currentMonth.getFullYear();
    });
}

// ============================================
// FILTRO E RENDERIZAÇÃO
// ============================================
window.filterVendas = function () {
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const vendedor = document.getElementById('filterVendedor')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';

    let filtered = getVendasMes();

    if (vendedor) filtered = filtered.filter(v => v.vendedor === vendedor);
    if (status) {
        filtered = filtered.filter(v => {
            // Verificar em ambos os campos de status
            return v.status_frete === status ||
                   v.status_pagamento === status ||
                   v.tipo_nf === status;
        });
    }
    if (search) {
        filtered = filtered.filter(v => {
            return [v.numero_nf, v.nome_orgao, v.vendedor, v.transportadora, v.banco]
                .some(f => f && f.toString().toLowerCase().includes(search));
        });
    }

    filtered.sort((a, b) => {
        const nA = parseInt(a.numero_nf) || 0;
        const nB = parseInt(b.numero_nf) || 0;
        return nA - nB;
    });

    renderVendas(filtered);
    updateDashboard();
};

function renderVendas(lista) {
    const container = document.getElementById('vendasContainer');
    if (!container) return;

    if (!lista || lista.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 2rem; color: var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    container.innerHTML = `
        <div style="overflow-x: auto;">
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
                        <th style="text-align: center;">Ações</th>
                    </tr>
                </thead>
                <tbody>
                    ${lista.map(v => `
                    <tr data-id="${v.id}">
                        <td><strong>${v.numero_nf || '-'}</strong></td>
                        <td style="max-width: 200px; word-wrap: break-word; white-space: normal;">${v.nome_orgao || '-'}</td>
                        <td>${v.vendedor || '-'}</td>
                        <td><span class="badge ${v.origem === 'CONTROLE_FRETE' ? 'transito' : 'entregue'}" style="font-size:0.7rem;">${v.origem === 'CONTROLE_FRETE' ? 'Frete' : 'Receber'}</span></td>
                        <td><strong>R$ ${parseFloat(v.valor_nf || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></td>
                        <td>${getStatusFreteBadge(v.status_frete)}</td>
                        <td>${getStatusPagamentoBadge(v.status_pagamento)}</td>
                        <td class="actions-cell" style="text-align: center; white-space: nowrap;">
                            <button class="action-btn view" onclick="handleViewClick('${v.id}')" title="Ver detalhes">Ver</button>
                        </td>
                    </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function getStatusFreteBadge(status) {
    if (!status) return '<span style="color: var(--text-secondary);">-</span>';
    const map = {
        'EM TRÂNSITO': 'transito',
        'ENTREGUE': 'entregue',
        'AGUARDANDO COLETA': 'cancelado',
        'EXTRAVIADO': 'devolvido',
        'DEVOLVIDO': 'devolvido'
    };
    return `<span class="badge ${map[status] || 'transito'}">${status}</span>`;
}

function getStatusPagamentoBadge(status) {
    if (!status) return '<span style="color: var(--text-secondary);">-</span>';
    const map = { 'PAGO': 'entregue', 'A RECEBER': 'transito' };
    return `<span class="badge ${map[status] || 'transito'}">${status}</span>`;
}

// ============================================
// MODAL DE VISUALIZAÇÃO
// ============================================
window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return showToast('Venda não encontrada!', 'error');

    const d = val => val ? formatDate(val) : '-';
    const fmt = val => val ? `R$ ${parseFloat(val).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}` : '-';

    document.getElementById('modalNumeroNF').textContent = v.numero_nf || '-';

    const body = document.getElementById('modalBody');
    if (body) {
        body.innerHTML = `
            <div class="info-section">
                <h4>Dados Gerais</h4>
                <p><strong>Órgão:</strong> ${v.nome_orgao || '-'}</p>
                <p><strong>Vendedor:</strong> ${v.vendedor || '-'}</p>
                <p><strong>Tipo NF:</strong> ${v.tipo_nf || '-'}</p>
                <p><strong>Data Emissão:</strong> ${d(v.data_emissao)}</p>
                <p><strong>Valor NF:</strong> ${fmt(v.valor_nf)}</p>
                <p><strong>Origem:</strong> ${v.origem === 'CONTROLE_FRETE' ? 'Controle de Frete' : 'Contas a Receber'}</p>
            </div>
            ${v.origem === 'CONTROLE_FRETE' ? `
            <div class="info-section">
                <h4>Dados de Frete</h4>
                <p><strong>Transportadora:</strong> ${v.transportadora || '-'}</p>
                <p><strong>Valor Frete:</strong> ${fmt(v.valor_frete)}</p>
                <p><strong>Cidade Destino:</strong> ${v.cidade_destino || '-'}</p>
                <p><strong>Previsão Entrega:</strong> ${d(v.previsao_entrega)}</p>
                <p><strong>Status Frete:</strong> ${v.status_frete || '-'}</p>
            </div>` : ''}
            ${v.origem === 'CONTAS_RECEBER' ? `
            <div class="info-section">
                <h4>Dados de Pagamento</h4>
                <p><strong>Banco:</strong> ${v.banco || '-'}</p>
                <p><strong>Vencimento:</strong> ${d(v.data_vencimento)}</p>
                <p><strong>Data Pagamento:</strong> ${d(v.data_pagamento)}</p>
                <p><strong>Status Pagamento:</strong> ${v.status_pagamento || '-'}</p>
            </div>` : ''}
        `;
    }

    const modal = document.getElementById('infoModal');
    if (modal) modal.style.display = 'flex';
};

window.closeInfoModal = function () {
    const modal = document.getElementById('infoModal');
    if (modal) modal.style.display = 'none';
};

// ============================================
// PDF
// ============================================
window.gerarPDF = function () {
    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        doc.setFontSize(14);
        doc.text(`Vendas — ${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 14, 15);

        const filtered = getVendasMes();
        const rows = filtered.map(v => [
            v.numero_nf || '-',
            v.nome_orgao || '-',
            v.vendedor || '-',
            `R$ ${parseFloat(v.valor_nf || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`,
            v.status_frete || '-',
            v.status_pagamento || '-'
        ]);

        doc.autoTable({
            head: [['NF', 'Órgão', 'Vendedor', 'Valor', 'Status Frete', 'Status Pgto']],
            body: rows,
            startY: 22,
            styles: { fontSize: 8 }
        });

        doc.save(`vendas_${currentMonth.getFullYear()}_${String(currentMonth.getMonth() + 1).padStart(2, '0')}.pdf`);
        showToast('PDF gerado com sucesso!', 'success');
    } catch (err) {
        console.error('Erro ao gerar PDF:', err);
        showToast('Erro ao gerar PDF', 'error');
    }
};

// ============================================
// CALENDÁRIO — compatibilidade com calendar.js
// ============================================
window.updateDisplay = updateMonthDisplay;

// ============================================
// UTILITÁRIOS
// ============================================
function formatDate(d) {
    if (!d) return '-';
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

function showToast(message, type) {
    document.querySelectorAll('.floating-message').forEach(m => m.remove());
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOutBottom 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}

console.log('✅ Script vendas carregado com sucesso!');
