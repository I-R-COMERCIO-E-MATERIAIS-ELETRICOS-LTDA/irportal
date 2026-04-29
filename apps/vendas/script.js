// ============================================
// CONFIGURAÇÃO
// ============================================
const API_URL = window.location.origin + '/api';

let vendas       = [];
let sessionToken = null;
let currentUser  = null;
let currentMonth = new Date();
let calendarYear = new Date().getFullYear();

// Mapeamento de usuário → vendedor fixo (username em maiúsculo)
// "isaque-vendas"  e "miguel-vendas2" são os usernames do sistema
const PERFIL_VENDEDOR_MAP = {
    'ISAQUE':        'ISAQUE',
    'ISAQUE-VENDAS': 'ISAQUE',
    'MIGUEL':        'MIGUEL',
    'MIGUEL-VENDAS2':'MIGUEL',
    'MIGUEL-VENDAS': 'MIGUEL',
};
const ADMINS = ['ROBERTO', 'ROSEMEIRE'];

const MESES = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// ─── INICIALIZAÇÃO ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Token
    const urlParams = new URLSearchParams(window.location.search);
    const fromUrl   = urlParams.get('sessionToken');
    if (fromUrl) {
        sessionToken = fromUrl;
        sessionStorage.setItem('vendasSession', fromUrl);
    } else {
        sessionToken = sessionStorage.getItem('vendasSession');
    }

    if (!sessionToken) {
        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                        height:100vh;background:var(--bg-secondary);color:var(--text-primary);
                        text-align:center;padding:2rem;">
                <h1>NÃO AUTORIZADO</h1><p>Acesse pelo portal.</p>
            </div>`;
        return;
    }

    // Resolve usuário e carrega dados em paralelo para máxima velocidade
    const [_user] = await Promise.all([resolverUsuario()]);

    configurarFiltroVendedor();
    updateMonthDisplay();           // renderiza mês antes dos dados chegarem

    // Carrega dados sem sincronizar primeiro → mais rápido para o usuário
    await loadVendas();

    // Sincroniza em background sem bloquear a UI
    sincronizarDados().then(() => loadVendas());

    setInterval(loadVendas,       20000);   // refresh tabela a cada 20s
    setInterval(sincronizarDados, 300000);  // sync fontes a cada 5min
});

// ─── USUÁRIO / PERFIL ──────────────────────────────────────────────────────────
async function resolverUsuario() {
    try {
        const r = await fetch(`${window.location.origin}/api/verify-session`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ sessionToken }),
        });
        if (r.ok) {
            const d = await r.json();
            if (d.valid && d.session) currentUser = d.session;
        }
    } catch (_) {}
}

function getUserKey() {
    return (currentUser?.username || currentUser?.name || '').toUpperCase().trim();
}

/** Retorna o vendedor que este usuário pode ver, ou null se admin (vê tudo). */
function getVendedorFixo() {
    const key = getUserKey();
    return PERFIL_VENDEDOR_MAP[key] || null;
}

function isAdmin() {
    const key = getUserKey();
    return ADMINS.includes(key) || currentUser?.is_admin === true;
}

function configurarFiltroVendedor() {
    const sel = document.getElementById('filterVendedor');
    if (!sel) return;
    const fixo = getVendedorFixo();
    if (fixo) {
        sel.value    = fixo;
        sel.disabled = true;
        sel.style.opacity = '0.7';
        sel.style.cursor  = 'not-allowed';
    }
}

// ─── SINCRONIZAÇÃO (background) ────────────────────────────────────────────────
async function sincronizarDados() {
    try {
        const r = await fetch(`${API_URL}/vendas/sincronizar`, {
            method:  'POST',
            headers: { 'X-Session-Token': sessionToken },
        });
        const d = await r.json();
        if (d.success) console.log('📊 Sync:', d.message);
        else           console.warn('⚠️  Sync falhou:', d.error);
    } catch (e) { console.error('Erro sync:', e); }
}

// ─── CARGA DE DADOS ────────────────────────────────────────────────────────────
async function loadVendas() {
    try {
        const fixo = getVendedorFixo();
        const qs   = fixo ? `&vendedor=${encodeURIComponent(fixo)}` : '';
        const r    = await fetch(`${API_URL}/vendas?_t=${Date.now()}${qs}`, {
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' },
        });
        if (!r.ok) return;
        const data = await r.json();
        vendas = Array.isArray(data) ? data : [];
        console.log(`✅ ${vendas.length} vendas`);
        updateDashboard();
        filterVendas();
        atualizarStatusConexao(true);
    } catch (e) {
        console.error('Erro loadVendas:', e);
        atualizarStatusConexao(false);
    }
}

function atualizarStatusConexao(online) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    el.classList.toggle('online',  online);
    el.classList.toggle('offline', !online);
}

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
    if (el) el.textContent = `${MESES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard();
    filterVendas();
}

window.changeMonth = function (d) {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + d, 1);
    updateMonthDisplay();
};

window.selectMonth = function (idx) {
    currentMonth = new Date(calendarYear, idx, 1);
    updateMonthDisplay();
    toggleCalendar();
};

window.toggleCalendar = function () {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentMonth.getFullYear();
        renderCalendarWidget();
        modal.classList.add('show');
    }
};

window.changeCalendarYear = function (d) {
    calendarYear += d;
    renderCalendarWidget();
};

function renderCalendarWidget() {
    const y   = document.getElementById('calendarYear');
    const box = document.getElementById('calendarMonths');
    if (!y || !box) return;
    y.textContent = calendarYear;
    box.innerHTML = MESES.map((nome, i) => {
        const ativo = calendarYear === currentMonth.getFullYear() && i === currentMonth.getMonth();
        return `<div class="calendar-month${ativo ? ' current' : ''}" onclick="selectMonth(${i})">${nome}</div>`;
    }).join('');
}

// ─── STATUS HELPERS ────────────────────────────────────────────────────────────
/**
 * Resolve o status visual de uma venda:
 *   PAGO            → verde
 *   PARCELA x/y     → verde (parcial)
 *   ENTREGUE        → azul  (mercadoria chegou, ainda não paga → conta como A RECEBER)
 *   SIMPLES REMESSA / REMESSA DE AMOSTRA → cinza
 *   EM TRÂNSITO     → laranja
 */
function resolverStatus(v) {
    const sp = (v.status_pagamento || '').toUpperCase();
    const sf = (v.status_frete     || '').toUpperCase();
    const tn = (v.tipo_nf          || '').toUpperCase();

    if (sp === 'PAGO') return { label: 'PAGO', cls: 'st-pago' };

    if (/parcela/i.test(sp)) {
        const m = parseMeta(v.observacoes);
        const label = m ? `PARCELA ${m.ultima_num}/${m.total}` : sp;
        return { label, cls: 'st-parcela' };
    }

    if (tn.includes('SIMPLES REMESSA')    || sf.includes('SIMPLES REMESSA'))
        return { label: 'SIMPLES REMESSA',    cls: 'st-remessa' };
    if (tn.includes('REMESSA DE AMOSTRA') || sf.includes('REMESSA DE AMOSTRA'))
        return { label: 'REMESSA DE AMOSTRA', cls: 'st-remessa' };

    if (sf === 'ENTREGUE')          return { label: 'ENTREGUE',    cls: 'st-entregue' };
    if (sf === 'AGUARDANDO COLETA') return { label: sf,            cls: 'st-transito' };

    return { label: sf || 'EM TRÂNSITO', cls: 'st-transito' };
}

function parseMeta(obs) {
    if (!obs) return null;
    try {
        const p = typeof obs === 'string' ? JSON.parse(obs) : obs;
        if (p?.total) return p;
    } catch (_) {}
    return null;
}

// ─── DASHBOARD ─────────────────────────────────────────────────────────────────
function updateDashboard() {
    const mes = getVendasMes();

    let pago = 0, aReceber = 0, entregue = 0, faturado = 0;

    mes.forEach(v => {
        const sp   = (v.status_pagamento || '').toUpperCase();
        const sf   = (v.status_frete     || '').toUpperCase();
        const vnf  = parseFloat(v.valor_nf || 0);

        faturado += vnf;

        if (sp === 'PAGO') {
            pago += vnf;
        } else if (/parcela/i.test(sp)) {
            // Parcelas: soma o que foi pago até agora
            pago += parseFloat(v.valor_pago || 0);
        } else if (sf === 'ENTREGUE') {
            // Entregue mas não pago → A Receber
            aReceber += vnf;
        }

        if (sf === 'ENTREGUE') entregue++;
    });

    set('totalPago',      fmtMoeda(pago));
    set('totalAReceber',  fmtMoeda(aReceber));
    set('totalEntregue',  entregue);
    set('totalFaturado',  fmtMoeda(faturado));
}

function set(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

/** Vendas do mês corrente — data_emissao, com fallback em data_vencimento */
function getVendasMes() {
    return vendas.filter(v => {
        const ds = v.data_emissao || v.data_vencimento;
        if (!ds) return false;
        const d = new Date(ds + 'T00:00:00');
        return d.getMonth()    === currentMonth.getMonth() &&
               d.getFullYear() === currentMonth.getFullYear();
    });
}

// ─── FILTROS ───────────────────────────────────────────────────────────────────
window.filterVendas = function () {
    const busca = (document.getElementById('search')?.value || '').toLowerCase();
    const vend  =  document.getElementById('filterVendedor')?.value || '';
    const stFil =  document.getElementById('filterStatus')?.value  || '';

    let lista = getVendasMes();

    // Garante isolamento por vendedor
    const fixo = getVendedorFixo();
    if (fixo) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === fixo);
    } else if (vend) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === vend.toUpperCase());
    }

    // Filtro de status
    if (stFil) {
        lista = lista.filter(v => {
            const { label } = resolverStatus(v);
            if (stFil === 'PAGO')               return label === 'PAGO';
            if (stFil === 'PARCELA')            return label.startsWith('PARCELA');
            if (stFil === 'ENTREGUE')           return label === 'ENTREGUE';
            if (stFil === 'EM TRÂNSITO')        return label === 'EM TRÂNSITO';
            if (stFil === 'SIMPLES REMESSA')    return label === 'SIMPLES REMESSA';
            if (stFil === 'REMESSA DE AMOSTRA') return label === 'REMESSA DE AMOSTRA';
            return true;
        });
    }

    // Pesquisa textual
    if (busca) {
        lista = lista.filter(v =>
            [v.numero_nf, v.nome_orgao, v.vendedor, v.transportadora, v.banco]
                .some(x => x && x.toLowerCase().includes(busca))
        );
    }

    lista.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderVendas(lista);
};

// ─── TABELA ────────────────────────────────────────────────────────────────────
function renderVendas(lista) {
    const c = document.getElementById('vendasContainer');
    if (!c) return;

    if (!lista.length) {
        c.innerHTML = '<div style="text-align:center;padding:2.5rem;color:var(--text-secondary);">Nenhuma venda encontrada para este período.</div>';
        return;
    }

    const rows = lista.map(v => {
        const { label, cls } = resolverStatus(v);
        const sp = (v.status_pagamento || '').toUpperCase();

        // Cor de fundo da linha
        let bg = '';
        if (cls === 'st-pago')     bg = 'background:rgba(34,197,94,0.22);border-left:3px solid #22C55E;';
        if (cls === 'st-parcela')  bg = 'background:rgba(34,197,94,0.13);border-left:3px solid #86efac;';
        if (cls === 'st-entregue') bg = 'background:rgba(59,130,246,0.22);border-left:3px solid #3B82F6;';

        // Valor pago
        let vpTxt = '—';
        if (sp === 'PAGO') {
            vpTxt = fmtMoeda(v.valor_nf);
        } else if (/parcela/i.test(sp)) {
            const m = parseMeta(v.observacoes);
            vpTxt = fmtMoeda(m?.ultima_valor || v.valor_pago || 0);
        }

        return `
        <tr style="cursor:pointer;${bg}" onclick="handleViewClick('${v.id}')">
            <td><strong>${v.numero_nf || '—'}</strong></td>
            <td style="max-width:220px;word-wrap:break-word;white-space:normal;">${v.nome_orgao || '—'}</td>
            <td>${v.vendedor || '—'}</td>
            <td><strong>${fmtMoeda(v.valor_nf)}</strong></td>
            <td>${vpTxt}</td>
            <td><span class="badge ${cls}">${label}</span></td>
        </tr>`;
    }).join('');

    c.innerHTML = `
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>NF</th><th>Órgão</th><th>Vendedor</th>
                        <th>Valor NF</th><th>Valor Pago</th><th>Status</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ─── MODAL DETALHES ────────────────────────────────────────────────────────────
window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return;

    const sp    = (v.status_pagamento || '').toUpperCase();
    const isPago = sp === 'PAGO' || /parcela/i.test(sp);

    document.getElementById('modalNumeroNF').textContent = v.numero_nf || '—';

    let html = '';
    if (!isPago) {
        // Dados do controle de frete
        html = `
        <div class="info-section">
            <h4>📦 Nota Fiscal</h4>
            <p><strong>Órgão:</strong> ${v.nome_orgao || '—'}</p>
            <p><strong>Vendedor:</strong> ${v.vendedor || '—'}</p>
            <p><strong>Tipo NF:</strong> ${v.tipo_nf || '—'}</p>
            <p><strong>Data Emissão:</strong> ${fmtData(v.data_emissao)}</p>
            <p><strong>Valor NF:</strong> ${fmtMoeda(v.valor_nf)}</p>
            ${v.documento ? `<p><strong>Documento:</strong> ${v.documento}</p>` : ''}
            ${v.contato_orgao ? `<p><strong>Contato:</strong> ${v.contato_orgao}</p>` : ''}
        </div>
        <div class="info-section">
            <h4>🚚 Controle de Frete</h4>
            <p><strong>Transportadora:</strong> ${v.transportadora || '—'}</p>
            <p><strong>Valor Frete:</strong> ${fmtMoeda(v.valor_frete)}</p>
            <p><strong>Data Coleta:</strong> ${fmtData(v.data_coleta)}</p>
            <p><strong>Cidade Destino:</strong> ${v.cidade_destino || '—'}</p>
            <p><strong>Previsão Entrega:</strong> ${fmtData(v.previsao_entrega)}</p>
            <p><strong>Status:</strong> <span class="badge ${resolverStatus(v).cls}">${resolverStatus(v).label}</span></p>
        </div>`;
    } else {
        // Dados de contas a receber
        const meta = parseMeta(v.observacoes);
        let pgtoHtml = '';
        if (meta) {
            pgtoHtml = `
            <p><strong>Parcelas pagas:</strong> ${meta.ultima_num} / ${meta.total}</p>
            <p><strong>Valor última parcela:</strong> ${fmtMoeda(meta.ultima_valor)}</p>
            <p><strong>Total pago:</strong> ${fmtMoeda(v.valor_pago)}</p>`;
        } else {
            pgtoHtml = `<p><strong>Valor pago:</strong> ${fmtMoeda(v.valor_pago || v.valor_nf)}</p>`;
        }

        html = `
        <div class="info-section">
            <h4>📦 Nota Fiscal</h4>
            <p><strong>Órgão:</strong> ${v.nome_orgao || '—'}</p>
            <p><strong>Vendedor:</strong> ${v.vendedor || '—'}</p>
            <p><strong>Tipo NF:</strong> ${v.tipo_nf || '—'}</p>
            <p><strong>Data Emissão:</strong> ${fmtData(v.data_emissao)}</p>
            <p><strong>Valor NF:</strong> ${fmtMoeda(v.valor_nf)}</p>
        </div>
        <div class="info-section">
            <h4>💰 Contas a Receber</h4>
            <p><strong>Banco:</strong> ${v.banco || '—'}</p>
            <p><strong>Vencimento:</strong> ${fmtData(v.data_vencimento)}</p>
            <p><strong>Data Pagamento:</strong> ${fmtData(v.data_pagamento)}</p>
            <p><strong>Status:</strong> <span class="badge ${resolverStatus(v).cls}">${resolverStatus(v).label}</span></p>
            ${pgtoHtml}
        </div>`;
    }

    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('infoModal').style.display = 'flex';
};

window.closeInfoModal = () => {
    document.getElementById('infoModal').style.display = 'none';
};

// ─── PDF: RELATÓRIO DE COMISSÃO ────────────────────────────────────────────────
// Mostra as NFs PAGAS no mês selecionado do vendedor atual (ou selecionado).
// Calcula comissão de 1% sobre o total pago.
window.gerarPDF = function () {
    const { jsPDF } = window.jspdf;

    // Determina o vendedor alvo
    const fixo      = getVendedorFixo();
    const selVend   = document.getElementById('filterVendedor')?.value || '';
    const vendedor  = fixo || selVend;

    if (!vendedor) {
        showToast('Selecione um vendedor para gerar o relatório', 'error');
        return;
    }

    const mesTxt = `${MESES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;

    // NFs pagas no mês: filtra por data_pagamento (não data_emissao)
    // pois o enunciado pede "notas pagas do mês em questão"
    const pagas = vendas.filter(v => {
        if ((v.vendedor || '').toUpperCase() !== vendedor.toUpperCase()) return false;

        const sp = (v.status_pagamento || '').toUpperCase();
        if (sp !== 'PAGO' && !/parcela/i.test(sp)) return false;

        // Usa data_pagamento para determinar o mês do recebimento
        const dp = v.data_pagamento || v.data_emissao;
        if (!dp) return false;
        const d = new Date(dp + 'T00:00:00');
        return d.getMonth()    === currentMonth.getMonth() &&
               d.getFullYear() === currentMonth.getFullYear();
    });

    if (!pagas.length) {
        showToast('Nenhum pagamento encontrado neste mês', 'error');
        return;
    }

    // Total recebido (valor_nf para PAGO; valor_pago para parcelas)
    const totalRecebido = pagas.reduce((s, v) => {
        const sp = (v.status_pagamento || '').toUpperCase();
        return s + (/parcela/i.test(sp)
            ? parseFloat(v.valor_pago || 0)
            : parseFloat(v.valor_nf  || 0));
    }, 0);
    const comissao = totalRecebido * 0.01;

    const doc = new jsPDF();

    // Cabeçalho
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE COMISSÃO', 105, 20, { align: 'center' });

    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text(`Vendedor: ${vendedor.charAt(0) + vendedor.slice(1).toLowerCase()}`, 105, 30, { align: 'center' });
    doc.text(`Período: ${mesTxt}`, 105, 37, { align: 'center' });
    doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 105, 44, { align: 'center' });

    // Tabela de NFs pagas
    doc.autoTable({
        startY: 52,
        head: [['NF', 'Órgão', 'Emissão', 'Data Pagto', 'Valor NF', 'Valor Recebido']],
        body: pagas.map(v => {
            const sp  = (v.status_pagamento || '').toUpperCase();
            const vr  = /parcela/i.test(sp)
                ? parseFloat(v.valor_pago || 0)
                : parseFloat(v.valor_nf  || 0);
            return [
                v.numero_nf  || '—',
                v.nome_orgao || '—',
                fmtData(v.data_emissao),
                fmtData(v.data_pagamento),
                `R$ ${parseFloat(v.valor_nf || 0).toFixed(2)}`,
                `R$ ${vr.toFixed(2)}`,
            ];
        }),
        theme:       'grid',
        headStyles:  { fillColor: [100,100,100], textColor: [255,255,255], fontStyle: 'bold', halign: 'center' },
        styles:      { fontSize: 9, cellPadding: 3 },
        columnStyles:{
            0: { halign: 'center' },
            2: { halign: 'center' },
            3: { halign: 'center' },
            4: { halign: 'right'  },
            5: { halign: 'right'  },
        },
    });

    // Totais
    const fY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text(`TOTAL RECEBIDO: R$ ${totalRecebido.toFixed(2)}`, 14, fY);
    doc.text(`COMISSÃO (1%):  R$ ${comissao.toFixed(2)}`,      14, fY + 8);

    doc.save(`comissao_${vendedor}_${MESES[currentMonth.getMonth()]}_${currentMonth.getFullYear()}.pdf`);
    showToast('Relatório gerado!', 'success');
};

// ─── UTILITÁRIOS ───────────────────────────────────────────────────────────────
function fmtMoeda(v) {
    return `R$ ${parseFloat(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}
function fmtData(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}
function showToast(msg, type = 'info') {
    document.querySelectorAll('.floating-message').forEach(e => e.remove());
    const cores = { error: '#EF4444', success: '#22C55E', info: '#3B82F6' };
    const div   = document.createElement('div');
    div.className   = `floating-message ${type}`;
    div.textContent = msg;
    div.style.cssText = `
        position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;
        padding:.8rem 1.4rem;border-radius:10px;font-weight:600;font-size:.9rem;
        background:${cores[type]||cores.info};color:#fff;min-width:260px;
        box-shadow:0 4px 16px rgba(0,0,0,.25);animation:slideInBottom .3s ease;`;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOutBottom .3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 3000);
}
