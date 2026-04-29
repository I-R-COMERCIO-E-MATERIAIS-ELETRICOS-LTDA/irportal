// ============================================
// CONFIGURAÇÃO
// ============================================
const API_URL = window.location.origin + '/api';

let vendas       = [];
let sessionToken = null;
let currentUser  = null;
let currentMonth = new Date();
let calendarYear = new Date().getFullYear();

const PERFIL_VENDEDOR_MAP = {
    'ISAQUE':         'ISAQUE',
    'ISAQUE-VENDAS':  'ISAQUE',
    'MIGUEL':         'MIGUEL',
    'MIGUEL-VENDAS2': 'MIGUEL',
    'MIGUEL-VENDAS':  'MIGUEL',
};
const ADMINS = ['ROBERTO', 'ROSEMEIRE'];

const MESES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
               'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

// ─── INICIALIZAÇÃO ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get('sessionToken');
    if (fromUrl) {
        sessionToken = fromUrl;
        sessionStorage.setItem('vendasSession', fromUrl);
    } else {
        sessionToken = sessionStorage.getItem('vendasSession');
    }

    if (!sessionToken) {
        document.body.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                height:100vh;background:var(--bg-secondary);color:var(--text-primary);text-align:center;padding:2rem;">
                <h1>NÃO AUTORIZADO</h1><p>Acesse pelo portal.</p>
            </div>`;
        return;
    }

    await resolverUsuario();
    configurarFiltroVendedor();
    updateMonthDisplay();

    // Carrega dados imediatamente (rápido)
    await loadVendas();

    // Sincroniza fontes em background (silencioso)
    sincronizarDados({ silencioso: true }).then(loadVendas);

    setInterval(loadVendas, 20000);
    setInterval(() => sincronizarDados({ silencioso: true }).then(loadVendas), 300000);
});

// ─── USUÁRIO / PERFIL ──────────────────────────────────────────────────────
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
function getVendedorFixo() {
    return PERFIL_VENDEDOR_MAP[getUserKey()] || null;
}
function configurarFiltroVendedor() {
    const sel  = document.getElementById('filterVendedor');
    const fixo = getVendedorFixo();
    if (!sel || !fixo) return;
    sel.value    = fixo;
    sel.disabled = true;
    sel.style.cssText = 'opacity:.7;cursor:not-allowed;';
}

// ─── SINCRONIZAÇÃO ──────────────────────────────────────────────────────────
async function sincronizarDados({ silencioso = false } = {}) {
    try {
        const r = await fetch(`${API_URL}/vendas/sincronizar`, {
            method:  'POST',
            headers: { 'X-Session-Token': sessionToken },
        });
        const d = await r.json();
        if (d.success) {
            console.log('📊 Sync OK:', d.message);
            if (!silencioso) showToast('Dados sincronizados', 'success');
        } else {
            console.warn('⚠️ Sync falhou:', d.error || d.message);
            if (!silencioso) showToast('Erro ao sincronizar', 'error');
        }
        return d.success;
    } catch (e) {
        console.error('Erro sync:', e);
        if (!silencioso) showToast('Erro ao sincronizar', 'error');
        return false;
    }
}

// ─── CARGA DE DADOS ─────────────────────────────────────────────────────────
async function loadVendas() {
    try {
        const fixo = getVendedorFixo();
        const qs   = fixo ? `&vendedor=${encodeURIComponent(fixo)}` : '';
        const r    = await fetch(`${API_URL}/vendas?_t=${Date.now()}${qs}`, {
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' },
        });
        if (!r.ok) throw new Error(r.status);
        const data = await r.json();
        vendas = Array.isArray(data) ? data : [];
        updateDashboard();
        filterVendas();
    } catch (e) {
        console.error('Erro loadVendas:', e);
    }
}

window.syncData = async function () {
    const btn = document.querySelector('button[onclick="syncData()"]');
    const svg = btn?.querySelector('svg');
    if (svg) svg.style.animation = 'spin 1s linear infinite';
    const ok = await sincronizarDados({ silencioso: false });
    if (ok) await loadVendas();
    if (svg) svg.style.animation = '';
};

// ─── NAVEGAÇÃO DE MÊS ──────────────────────────────────────────────────────
function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${MESES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard();
    filterVendas();
}
window.changeMonth = d => {
    currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + d, 1);
    updateMonthDisplay();
};
window.selectMonth = idx => {
    currentMonth = new Date(calendarYear, idx, 1);
    updateMonthDisplay();
    toggleCalendar();
};
window.toggleCalendar = function () {
    const m = document.getElementById('calendarModal');
    if (!m) return;
    if (m.classList.contains('show')) { m.classList.remove('show'); return; }
    calendarYear = currentMonth.getFullYear();
    renderCalendarWidget();
    m.classList.add('show');
};
window.changeCalendarYear = d => { calendarYear += d; renderCalendarWidget(); };
function renderCalendarWidget() {
    const y   = document.getElementById('calendarYear');
    const box = document.getElementById('calendarMonths');
    if (!y || !box) return;
    y.textContent = calendarYear;
    box.innerHTML = MESES.map((n, i) => {
        const ativo = calendarYear === currentMonth.getFullYear() && i === currentMonth.getMonth();
        return `<div class="calendar-month${ativo ? ' current' : ''}" onclick="selectMonth(${i})">${n}</div>`;
    }).join('');
}

// ─── STATUS ─────────────────────────────────────────────────────────────────
function resolverStatus(v) {
    const sp = (v.status_pagamento || '').toUpperCase().trim();
    const sf = (v.status_frete     || '').toUpperCase().trim();
    const tn = (v.tipo_nf          || '').toUpperCase().trim();

    if (sp === 'PAGO') return { label: 'PAGO', cls: 'st-pago' };

    if (/parcela/i.test(sp)) {
        const m     = parseMeta(v.observacoes);
        const label = m ? `PARCELA ${m.ultima_num}/${m.total}` : sp;
        return { label, cls: 'st-parcela' };
    }

    if (tn.includes('SIMPLES REMESSA')     || sf.includes('SIMPLES REMESSA'))
        return { label: 'SIMPLES REMESSA',    cls: 'st-remessa' };
    if (tn.includes('REMESSA DE AMOSTRA')  || sf.includes('REMESSA DE AMOSTRA'))
        return { label: 'REMESSA DE AMOSTRA', cls: 'st-remessa' };

    if (sf === 'ENTREGUE')
        return { label: 'ENTREGUE', cls: 'st-entregue' };

    return { label: sf || 'EM TRÂNSITO', cls: 'st-transito' };
}

function parseMeta(obs) {
    if (!obs) return null;
    try {
        const p = typeof obs === 'string' ? JSON.parse(obs) : obs;
        if (p && p.total) return p;
    } catch (_) {}
    return null;
}

// ─── DASHBOARD ──────────────────────────────────────────────────────────────
function updateDashboard() {
    const mes = getVendasMes();
    let pago = 0, aReceber = 0, entregue = 0, faturado = 0;

    for (const v of mes) {
        const sp  = (v.status_pagamento || '').toUpperCase();
        const sf  = (v.status_frete     || '').toUpperCase();
        const vnf = parseFloat(v.valor_nf || 0);

        faturado += vnf;

        if (sp === 'PAGO') {
            pago += vnf;
        } else if (/parcela/i.test(sp)) {
            pago += parseFloat(v.valor_pago || 0);
        } else if (sf === 'ENTREGUE') {
            aReceber += vnf;
        }

        if (sf === 'ENTREGUE') entregue++;
    }

    setEl('totalPago',     fmtMoeda(pago));
    setEl('totalAReceber', fmtMoeda(aReceber));
    setEl('totalEntregue', entregue);
    setEl('totalFaturado', fmtMoeda(faturado));
}
function setEl(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }
function getVendasMes() {
    return vendas.filter(v => {
        const ds = v.data_emissao || v.data_vencimento;
        if (!ds) return false;
        const d = new Date(ds + 'T00:00:00');
        return d.getMonth()    === currentMonth.getMonth() &&
               d.getFullYear() === currentMonth.getFullYear();
    });
}

// ─── FILTROS ────────────────────────────────────────────────────────────────
window.filterVendas = function () {
    const busca  = (document.getElementById('search')?.value        || '').toLowerCase();
    const vend   =  document.getElementById('filterVendedor')?.value || '';
    const stFil  =  document.getElementById('filterStatus')?.value  || '';

    let lista = getVendasMes();

    const fixo = getVendedorFixo();
    if (fixo) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === fixo);
    } else if (vend) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === vend.toUpperCase());
    }

    if (stFil) {
        lista = lista.filter(v => {
            const { label } = resolverStatus(v);
            if (stFil === 'PAGO')               return label === 'PAGO';
            if (stFil === 'PARCELA')            return label.startsWith('PARCELA');
            if (stFil === 'ENTREGUE')           return label === 'ENTREGUE';
            if (stFil === 'EM TRÂNSITO')        return label === 'EM TRÂNSITO' || label === 'AGUARDANDO COLETA';
            if (stFil === 'SIMPLES REMESSA')    return label === 'SIMPLES REMESSA';
            if (stFil === 'REMESSA DE AMOSTRA') return label === 'REMESSA DE AMOSTRA';
            return true;
        });
    }

    if (busca) {
        lista = lista.filter(v =>
            [v.numero_nf, v.nome_orgao, v.vendedor, v.transportadora, v.banco]
                .some(x => x && x.toLowerCase().includes(busca))
        );
    }

    lista.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderVendas(lista);
};

// ─── TABELA ─────────────────────────────────────────────────────────────────
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

        let rowStyle = '';
        if (cls === 'st-pago')     rowStyle = 'background:rgba(34,197,94,0.28);border-left:4px solid #15803d;';
        if (cls === 'st-parcela')  rowStyle = 'background:rgba(34,197,94,0.18);border-left:4px solid #16a34a;';
        if (cls === 'st-entregue') rowStyle = 'background:rgba(59,130,246,0.28);border-left:4px solid #1d4ed8;';

        let vpTxt = '—';
        if (sp === 'PAGO') {
            vpTxt = fmtMoeda(v.valor_nf);
        } else if (/parcela/i.test(sp)) {
            const m = parseMeta(v.observacoes);
            vpTxt = fmtMoeda(m?.ultima_valor ?? v.valor_pago ?? 0);
        }

        return `
        <tr style="cursor:pointer;${rowStyle}" onclick="handleViewClick('${v.id}')">
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

// ─── MODAL ──────────────────────────────────────────────────────────────────
window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return;

    document.getElementById('modalNumeroNF').textContent = v.numero_nf || '—';

    const { label, cls } = resolverStatus(v);
    const meta = parseMeta(v.observacoes);

    let parcelasHtml = '';
    if (meta) {
        parcelasHtml = `
        <tr><td colspan="2" style="padding-top:.5rem;">
            <div style="background:rgba(34,197,94,0.10);border:1px solid rgba(34,197,94,0.30);
                        border-radius:8px;padding:.75rem 1rem;">
                <p style="margin:0 0 .35rem;font-weight:700;color:#16a34a;font-size:.95rem;">Parcelas</p>
                <p style="margin:.2rem 0;"><strong>Pagas:</strong> ${meta.ultima_num} de ${meta.total}</p>
                <p style="margin:.2rem 0;"><strong>Valor da última parcela:</strong> ${fmtMoeda(meta.ultima_valor)}</p>
                <p style="margin:.2rem 0;"><strong>Total pago até agora:</strong> ${fmtMoeda(v.valor_pago)}</p>
            </div>
        </td></tr>`;
    }

    const valorPagoHtml = (!meta && parseFloat(v.valor_pago) > 0)
        ? `<tr><td><strong>Valor Pago</strong></td><td>${fmtMoeda(v.valor_pago)}</td></tr>`
        : '';

    document.getElementById('modalBody').innerHTML = `
        <table style="width:100%;border-collapse:collapse;">
            <colgroup><col style="width:42%"><col style="width:58%"></colgroup>
            <tbody>
                <tr><td colspan="2" style="padding:.5rem 0 .3rem;font-weight:700;color:var(--primary);
                    font-size:1rem;border-bottom:2px solid var(--border-color);">Nota Fiscal</td></tr>
                <tr><td><strong>Órgão</strong></td><td>${v.nome_orgao || '—'}</td></tr>
                <tr><td><strong>Vendedor</strong></td><td>${v.vendedor || '—'}</td></tr>
                <tr><td><strong>Tipo NF</strong></td><td>${v.tipo_nf || '—'}</td></tr>
                <tr><td><strong>Data Emissão</strong></td><td>${fmtData(v.data_emissao)}</td></tr>
                <tr><td><strong>Valor NF</strong></td><td>${fmtMoeda(v.valor_nf)}</td></tr>
                ${v.documento    ? `<tr><td><strong>Documento</strong></td><td>${v.documento}</td></tr>` : ''}
                ${v.contato_orgao? `<tr><td><strong>Contato</strong></td><td>${v.contato_orgao}</td></tr>` : ''}
                <tr><td><strong>Status</strong></td><td><span class="badge ${cls}">${label}</span></td></tr>

                <tr><td colspan="2" style="padding:.8rem 0 .3rem;font-weight:700;color:var(--primary);
                    font-size:1rem;border-bottom:2px solid var(--border-color);">Frete</td></tr>
                <tr><td><strong>Transportadora</strong></td><td>${v.transportadora || '—'}</td></tr>
                <tr><td><strong>Valor Frete</strong></td><td>${fmtMoeda(v.valor_frete)}</td></tr>
                <tr><td><strong>Data Coleta</strong></td><td>${fmtData(v.data_coleta)}</td></tr>
                <tr><td><strong>Cidade Destino</strong></td><td>${v.cidade_destino || '—'}</td></tr>
                <tr><td><strong>Previsão Entrega</strong></td><td>${fmtData(v.previsao_entrega)}</td></tr>

                <tr><td colspan="2" style="padding:.8rem 0 .3rem;font-weight:700;color:var(--primary);
                    font-size:1rem;border-bottom:2px solid var(--border-color);">Pagamento</td></tr>
                <tr><td><strong>Banco</strong></td><td>${v.banco || '—'}</td></tr>
                <tr><td><strong>Vencimento</strong></td><td>${fmtData(v.data_vencimento)}</td></tr>
                <tr><td><strong>Data Pagamento</strong></td><td>${fmtData(v.data_pagamento)}</td></tr>
                ${valorPagoHtml}
                ${parcelasHtml}
            </tbody>
        </table>`;

    document.getElementById('infoModal').style.display = 'flex';
};

window.closeInfoModal = () => { document.getElementById('infoModal').style.display = 'none'; };

// ─── PDF: RELATÓRIO DE COMISSÃO ──────────────────────────────────────────────
window.gerarPDF = function () {
    const { jsPDF } = window.jspdf;
    const fixo     = getVendedorFixo();
    const selVend  = document.getElementById('filterVendedor')?.value || '';
    const vendedor = fixo || selVend;

    if (!vendedor) { showToast('Selecione um vendedor', 'error'); return; }

    const pagas = vendas.filter(v => {
        if ((v.vendedor || '').toUpperCase() !== vendedor.toUpperCase()) return false;
        const sp = (v.status_pagamento || '').toUpperCase();
        if (sp !== 'PAGO' && !/parcela/i.test(sp)) return false;
        const dp = v.data_pagamento || v.data_emissao;
        if (!dp) return false;
        const d = new Date(dp + 'T00:00:00');
        return d.getMonth()    === currentMonth.getMonth() &&
               d.getFullYear() === currentMonth.getFullYear();
    });

    if (!pagas.length) { showToast('Nenhum pagamento neste mês', 'error'); return; }

    const totalRec = pagas.reduce((s, v) => {
        const sp = (v.status_pagamento || '').toUpperCase();
        return s + (/parcela/i.test(sp) ? parseFloat(v.valor_pago || 0) : parseFloat(v.valor_nf || 0));
    }, 0);
    const comissao = totalRec * 0.01;

    const doc    = new jsPDF();
    const mesTxt = `${MESES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    const nomeV  = vendedor.charAt(0) + vendedor.slice(1).toLowerCase();

    doc.setFontSize(18); doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE COMISSÃO', 105, 20, { align: 'center' });
    doc.setFontSize(12); doc.setFont(undefined, 'normal');
    doc.text(`Vendedor: ${nomeV}`,                          105, 30, { align: 'center' });
    doc.text(`Período: ${mesTxt}`,                          105, 37, { align: 'center' });
    doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`, 105, 44, { align: 'center' });

    doc.autoTable({
        startY: 52,
        head:  [['NF', 'Órgão', 'Emissão', 'Data Pagto', 'Valor NF', 'Valor Recebido']],
        body:   pagas.map(v => {
            const sp = (v.status_pagamento || '').toUpperCase();
            const vr = /parcela/i.test(sp) ? parseFloat(v.valor_pago || 0) : parseFloat(v.valor_nf || 0);
            return [
                v.numero_nf  || '—',
                v.nome_orgao || '—',
                fmtData(v.data_emissao),
                fmtData(v.data_pagamento),
                `R$ ${parseFloat(v.valor_nf || 0).toFixed(2)}`,
                `R$ ${vr.toFixed(2)}`,
            ];
        }),
        theme:        'grid',
        headStyles:   { fillColor: [100,100,100], textColor: [255,255,255], fontStyle: 'bold', halign: 'center' },
        styles:       { fontSize: 9, cellPadding: 3 },
        columnStyles: { 0:{halign:'center'}, 2:{halign:'center'}, 3:{halign:'center'}, 4:{halign:'right'}, 5:{halign:'right'} },
    });

    const fY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12); doc.setFont(undefined, 'bold');
    doc.text(`TOTAL RECEBIDO: R$ ${totalRec.toFixed(2)}`,  14, fY);
    doc.text(`COMISSÃO (1%):  R$ ${comissao.toFixed(2)}`,  14, fY + 8);

    doc.save(`comissao_${vendedor}_${mesTxt.replace(' ', '_')}.pdf`);
    showToast('Relatório gerado!', 'success');
};

// ─── UTILITÁRIOS ─────────────────────────────────────────────────────────────
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
        padding:.85rem 1.5rem;border-radius:10px;font-weight:600;font-size:.9rem;
        background:${cores[type] || cores.info};color:#fff;min-width:220px;
        box-shadow:0 4px 16px rgba(0,0,0,.28);animation:slideInBottom .3s ease;`;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOutBottom .3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 3200);
}
