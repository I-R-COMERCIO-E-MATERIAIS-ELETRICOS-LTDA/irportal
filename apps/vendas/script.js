// ============================================
// VENDAS — script.js  (versão corrigida)
// ============================================
const API_URL = window.location.origin + '/api';

let vendas        = [];
let sessionToken  = null;
let currentUser   = null;
let currentMonth  = new Date().getMonth();
let currentYear   = new Date().getFullYear();
let calendarYear  = new Date().getFullYear();

// Mapeamento login → vendedor do banco
const PERFIL_VENDEDOR_MAP = {
    'ISAQUE':         'ISAQUE',
    'ISAQUE-VENDAS':  'ISAQUE',
    'MIGUEL':         'MIGUEL',
    'MIGUEL-VENDAS2': 'MIGUEL',
    'MIGUEL-VENDAS':  'MIGUEL',
};
const ADMINS = ['ROBERTO', 'ROSEMEIRE'];

const MESES = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// ─── INICIALIZAÇÃO ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    // Recupera token de sessão
    const params   = new URLSearchParams(window.location.search);
    const fromUrl  = params.get('sessionToken');
    if (fromUrl) {
        sessionToken = fromUrl;
        sessionStorage.setItem('vendasSession', fromUrl);
        // Limpa da URL sem recarregar
        window.history.replaceState({}, document.title, window.location.pathname);
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

    // Resolve usuário e configura UI imediatamente (sem aguardar dados)
    await resolverUsuario();
    configurarFiltroVendedor();
    updateMonthDisplay();

    // Carrega dados já sincronizados (rápido)
    await loadVendas();

    // Sincroniza fontes em background
    sincronizarFontes({ silencioso: true }).then(loadVendas);

    // Atualiza tabela a cada 20 s; sincroniza fontes a cada 5 min
    setInterval(loadVendas, 20_000);
    setInterval(() => sincronizarFontes({ silencioso: true }).then(loadVendas), 300_000);
});

// ─── USUÁRIO / PERFIL ─────────────────────────────────────────────────────────
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
/** Retorna o vendedor fixo quando o perfil logado é um vendedor (não-admin). */
function getVendedorFixo() {
    return PERFIL_VENDEDOR_MAP[getUserKey()] || null;
}
function isAdmin() {
    const k = getUserKey();
    return ADMINS.includes(k) || (!getVendedorFixo() && k !== '');
}
function configurarFiltroVendedor() {
    const sel  = document.getElementById('filterVendedor');
    const fixo = getVendedorFixo();
    if (!sel) return;
    if (fixo) {
        sel.value    = fixo;
        sel.disabled = true;
        sel.style.cssText = 'opacity:.7;cursor:not-allowed;';
    }
}

// ─── SINCRONIZAÇÃO DE FONTES (controle_frete + contas_receber → vendas) ──────
async function sincronizarFontes({ silencioso = false } = {}) {
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

// Botão manual de sync
window.syncData = async function () {
    const btn = document.querySelector('button[onclick="syncData()"]');
    const svg = btn?.querySelector('svg');
    if (svg) svg.style.animation = 'spin 1s linear infinite';
    const ok = await sincronizarFontes({ silencioso: false });
    if (ok) await loadVendas();
    if (svg) svg.style.animation = '';
};

// ─── CARREGAMENTO DE DADOS ────────────────────────────────────────────────────
async function loadVendas() {
    try {
        // Sempre filtra por vendedor no servidor quando perfil é vendedor (isolamento)
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
        atualizarConexao(true);
    } catch (e) {
        console.error('Erro loadVendas:', e);
        atualizarConexao(false);
    }
}

function atualizarConexao(ok) {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    el.classList.toggle('online',  ok);
    el.classList.toggle('offline', !ok);
}

// ─── NAVEGAÇÃO DE MÊS ─────────────────────────────────────────────────────────
function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${MESES[currentMonth]} ${currentYear}`;
    updateDashboard();
    filterVendas();
}

window.changeMonth = function (d) {
    let m = currentMonth + d;
    let y = currentYear;
    if (m > 11) { m = 0;  y++; }
    if (m < 0)  { m = 11; y--; }
    currentMonth = m;
    currentYear  = y;
    updateMonthDisplay();
};

window.selectMonth = function (idx) {
    currentMonth = idx;
    currentYear  = calendarYear;
    updateMonthDisplay();
    toggleCalendar();
};

window.toggleCalendar = function () {
    const m = document.getElementById('calendarModal');
    if (!m) return;
    if (m.classList.contains('show')) { m.classList.remove('show'); return; }
    calendarYear = currentYear;
    renderCalendarWidget();
    m.classList.add('show');
};

window.changeCalendarYear = function (d) {
    calendarYear += d;
    renderCalendarWidget();
};

function renderCalendarWidget() {
    const yEl  = document.getElementById('calendarYear');
    const box  = document.getElementById('calendarMonths');
    if (!yEl || !box) return;
    yEl.textContent = calendarYear;
    box.innerHTML = MESES.map((n, i) => {
        const ativo = (calendarYear === currentYear && i === currentMonth);
        return `<div class="calendar-month${ativo ? ' current' : ''}" onclick="selectMonth(${i})">${n}</div>`;
    }).join('');
}

// ─── STATUS ───────────────────────────────────────────────────────────────────
/**
 * Determina o status visual de uma venda seguindo a precedência:
 * 1. PAGO             → verde escuro
 * 2. Contém "PARCELA" → verde (parcial)
 * 3. tipo_nf / status_frete = SIMPLES REMESSA / REMESSA DE AMOSTRA → cinza
 * 4. status_frete = ENTREGUE  → azul
 * 5. demais                   → laranja (em trânsito / aguardando)
 */
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

    if (tn.includes('SIMPLES REMESSA')    || sf.includes('SIMPLES REMESSA'))
        return { label: 'SIMPLES REMESSA',    cls: 'st-remessa' };
    if (tn.includes('REMESSA DE AMOSTRA') || sf.includes('REMESSA DE AMOSTRA'))
        return { label: 'REMESSA DE AMOSTRA', cls: 'st-remessa' };

    if (sf === 'ENTREGUE')
        return { label: 'ENTREGUE', cls: 'st-entregue' };

    return { label: sf || 'EM TRÂNSITO', cls: 'st-transito' };
}

/**
 * Extrai metadados de parcelas do campo observacoes.
 * Suporta os formatos gravados por contas_receber:
 *   { notas: [...], parcelas: [{ numero, valor, data }] }
 *   { parcelas: [...] }
 *   Array direto de parcelas
 */
function parseParcelas(obs) {
    if (!obs) return [];
    try {
        const p = typeof obs === 'string' ? JSON.parse(obs) : obs;
        if (Array.isArray(p?.parcelas) && p.parcelas.length > 0) return p.parcelas;
        if (Array.isArray(p) && p.length > 0 && p[0]?.valor !== undefined) return p;
    } catch (_) {}
    return [];
}

/**
 * Retorna metadados resumidos de parcelas { total, ultima_num, ultima_valor }
 * para exibição rápida no badge/modal.
 */
function parseMeta(obs) {
    const parcelas = parseParcelas(obs);
    if (!parcelas.length) return null;
    const ultima = parcelas.reduce((prev, curr) => {
        const nP = parseInt(prev.numero || prev.num || 0);
        const nC = parseInt(curr.numero || curr.num || 0);
        return nC >= nP ? curr : prev;
    });
    return {
        total:        parcelas.length,
        ultima_num:   parseInt(ultima.numero || ultima.num || parcelas.length),
        ultima_valor: parseFloat(ultima.valor || ultima.valor_parcela || 0),
    };
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
function updateDashboard() {
    const mes = getVendasMes();
    let pago = 0, aReceber = 0, entregue = 0, faturado = 0;

    for (const v of mes) {
        const sp  = (v.status_pagamento || '').toUpperCase();
        const sf  = (v.status_frete     || '').toUpperCase();
        const tn  = (v.tipo_nf          || '').toUpperCase();
        const vnf = parseFloat(v.valor_nf || 0);

        // Remessas e devoluções não entram no faturado/pago
        if (tn === 'SIMPLES REMESSA' || tn === 'REMESSA DE AMOSTRA' || tn === 'DEVOLUÇÃO') continue;

        faturado += vnf;

        if (sp === 'PAGO') {
            pago += vnf;
        } else if (/parcela/i.test(sp)) {
            // Soma todas as parcelas pagas
            const parcelas = parseParcelas(v.observacoes);
            if (parcelas.length > 0) {
                pago += parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
            } else {
                pago += parseFloat(v.valor_pago || 0);
            }
        } else if (sf === 'ENTREGUE') {
            aReceber += vnf;  // entregue mas ainda não pago
        }

        if (sf === 'ENTREGUE') entregue++;
    }

    setEl('totalPago',     fmtMoeda(pago));
    setEl('totalAReceber', fmtMoeda(aReceber));
    setEl('totalEntregue', entregue);
    setEl('totalFaturado', fmtMoeda(faturado));
}

function setEl(id, v) { const e = document.getElementById(id); if (e) e.textContent = v; }

/** Retorna registros do mês/ano selecionado (por data_emissao ou data_vencimento). */
function getVendasMes() {
    return vendas.filter(v => {
        const ds = v.data_emissao || v.data_vencimento;
        if (!ds) return false;
        const d = new Date(ds + 'T00:00:00');
        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    });
}

// ─── FILTROS ──────────────────────────────────────────────────────────────────
window.filterVendas = function () {
    const busca = (document.getElementById('search')?.value        || '').toLowerCase();
    const vend  =  document.getElementById('filterVendedor')?.value || '';
    const stFil =  document.getElementById('filterStatus')?.value  || '';

    let lista = getVendasMes();

    // ── Isolamento por vendedor ──────────────────────────────────────────────
    // Vendedores só veem os próprios registros; admins podem filtrar livremente.
    const fixo = getVendedorFixo();
    if (fixo) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === fixo);
    } else if (vend) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === vend.toUpperCase());
    }

    // ── Filtro de status ─────────────────────────────────────────────────────
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

    // ── Pesquisa textual ─────────────────────────────────────────────────────
    if (busca) {
        lista = lista.filter(v =>
            [v.numero_nf, v.nome_orgao, v.vendedor, v.transportadora, v.banco]
                .some(x => x && x.toLowerCase().includes(busca))
        );
    }

    lista.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderVendas(lista);
};

// ─── TABELA ───────────────────────────────────────────────────────────────────
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
        if (cls === 'st-pago')     bg = 'background:rgba(34,197,94,0.28);border-left:3px solid #16a34a;';
        if (cls === 'st-parcela')  bg = 'background:rgba(34,197,94,0.18);border-left:3px solid #4ade80;';
        if (cls === 'st-entregue') bg = 'background:rgba(59,130,246,0.22);border-left:3px solid #3B82F6;';

        // Valor pago na coluna
        let vpTxt = '—';
        if (sp === 'PAGO') {
            vpTxt = fmtMoeda(v.valor_nf);
        } else if (/parcela/i.test(sp)) {
            const parcelas = parseParcelas(v.observacoes);
            if (parcelas.length > 0) {
                const total = parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
                vpTxt = fmtMoeda(total);
            } else {
                vpTxt = fmtMoeda(v.valor_pago || 0);
            }
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

// ─── MODAL DE DETALHES ────────────────────────────────────────────────────────
window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return;

    document.getElementById('modalNumeroNF').textContent = v.numero_nf || '—';

    const { label, cls } = resolverStatus(v);
    const parcelas = parseParcelas(v.observacoes);

    // ── Bloco de parcelas ────────────────────────────────────────────────────
    let parcelasHtml = '';
    if (parcelas.length > 0) {
        const totalPago = parcelas.reduce((s, p) => s + parseFloat(p.valor || 0), 0);
        const linhas = parcelas.map((p, i) => {
            const num   = p.numero || p.num || `${i + 1}ª Parcela`;
            const val   = parseFloat(p.valor || p.valor_parcela || 0);
            const data  = p.data || p.data_pagamento || null;
            return `<tr>
                <td style="padding:.3rem .5rem;">${num}</td>
                <td style="padding:.3rem .5rem;">${fmtMoeda(val)}</td>
                <td style="padding:.3rem .5rem;">${fmtData(data)}</td>
            </tr>`;
        }).join('');

        parcelasHtml = `
        <tr><td colspan="2" style="padding-top:.6rem;">
            <div style="background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);
                        border-radius:8px;padding:.8rem 1rem;">
                <p style="margin:0 0 .5rem;font-weight:700;color:#16a34a;font-size:.95rem;">
                    Pagamento Parcelado
                </p>
                <table style="width:100%;border-collapse:collapse;font-size:.88rem;">
                    <thead>
                        <tr style="color:var(--text-secondary);">
                            <th style="text-align:left;padding:.2rem .5rem;">Parcela</th>
                            <th style="text-align:left;padding:.2rem .5rem;">Valor</th>
                            <th style="text-align:left;padding:.2rem .5rem;">Data Pagamento</th>
                        </tr>
                    </thead>
                    <tbody>${linhas}</tbody>
                </table>
                <p style="margin:.6rem 0 0;font-weight:700;color:var(--text-primary);">
                    Total pago: ${fmtMoeda(totalPago)}
                </p>
            </div>
        </td></tr>`;
    }

    // ── Valor pago simples (sem parcelas) ────────────────────────────────────
    const valorPagoHtml = (!parcelas.length && parseFloat(v.valor_pago) > 0)
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
                ${v.documento     ? `<tr><td><strong>Documento</strong></td><td>${v.documento}</td></tr>` : ''}
                ${v.contato_orgao ? `<tr><td><strong>Contato</strong></td><td>${v.contato_orgao}</td></tr>` : ''}
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

window.closeInfoModal = () => {
    document.getElementById('infoModal').style.display = 'none';
};

// ─── PDF: RELATÓRIO DE COMISSÃO ───────────────────────────────────────────────
/**
 * Gera relatório das NFs PAGAS (ou com parcelas) no mês selecionado,
 * filtrando por data_pagamento (e por data de cada parcela no caso parcelado).
 * Exibe: NF, Órgão, Data Emissão, Data Pagamento, Valor NF, Valor Recebido.
 * Totais: total recebido + comissão de 1%.
 */
window.gerarPDF = function () {
    const { jsPDF } = window.jspdf;
    const fixo    = getVendedorFixo();
    const selVend = document.getElementById('filterVendedor')?.value || '';
    const vendedor = fixo || selVend;

    if (!vendedor) { showToast('Selecione um vendedor para gerar o relatório', 'error'); return; }

    // ── Monta lista de registros pagos no mês ────────────────────────────────
    // Cada elemento: { numero_nf, nome_orgao, data_emissao, data_pagamento, valor_nf, valor_recebido }
    const linhas = [];

    for (const v of vendas) {
        if ((v.vendedor || '').toUpperCase() !== vendedor.toUpperCase()) continue;
        const sp = (v.status_pagamento || '').toUpperCase();

        if (sp === 'PAGO') {
            // Data de referência: data_pagamento
            const dp = v.data_pagamento || v.data_emissao;
            if (!dp) continue;
            const d = new Date(dp + 'T00:00:00');
            if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) continue;
            linhas.push({
                numero_nf:      v.numero_nf  || '—',
                nome_orgao:     v.nome_orgao || '—',
                data_emissao:   fmtData(v.data_emissao),
                data_pagamento: fmtData(dp),
                valor_nf:       parseFloat(v.valor_nf || 0),
                valor_recebido: parseFloat(v.valor_nf || 0),
            });
        } else if (/parcela/i.test(sp)) {
            // Para parcelados: cada parcela com data no mês é uma linha própria
            const parcelas = parseParcelas(v.observacoes);
            if (parcelas.length > 0) {
                for (const p of parcelas) {
                    const dp = p.data || p.data_pagamento;
                    if (!dp) continue;
                    const d = new Date(dp + 'T00:00:00');
                    if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) continue;
                    const num = p.numero || p.num || '';
                    linhas.push({
                        numero_nf:      `${v.numero_nf || '—'} (${num})`,
                        nome_orgao:     v.nome_orgao || '—',
                        data_emissao:   fmtData(v.data_emissao),
                        data_pagamento: fmtData(dp),
                        valor_nf:       parseFloat(v.valor_nf || 0),
                        valor_recebido: parseFloat(p.valor || p.valor_parcela || 0),
                    });
                }
            } else {
                // Sem detalhes de parcela: usa valor_pago e data_pagamento
                const dp = v.data_pagamento;
                if (!dp) continue;
                const d = new Date(dp + 'T00:00:00');
                if (d.getMonth() !== currentMonth || d.getFullYear() !== currentYear) continue;
                linhas.push({
                    numero_nf:      v.numero_nf  || '—',
                    nome_orgao:     v.nome_orgao || '—',
                    data_emissao:   fmtData(v.data_emissao),
                    data_pagamento: fmtData(dp),
                    valor_nf:       parseFloat(v.valor_nf || 0),
                    valor_recebido: parseFloat(v.valor_pago || 0),
                });
            }
        }
    }

    if (!linhas.length) { showToast('Nenhum pagamento neste mês para ' + vendedor, 'error'); return; }

    const totalRec = linhas.reduce((s, l) => s + l.valor_recebido, 0);
    const comissao = totalRec * 0.01;

    const doc    = new jsPDF();
    const mesTxt = `${MESES[currentMonth]} ${currentYear}`;
    const nomeV  = vendedor.charAt(0).toUpperCase() + vendedor.slice(1).toLowerCase();

    // ── Cabeçalho ────────────────────────────────────────────────────────────
    doc.setFontSize(18); doc.setFont(undefined, 'bold');
    doc.text('RELATÓRIO DE COMISSÃO', 105, 20, { align: 'center' });
    doc.setFontSize(12); doc.setFont(undefined, 'normal');
    doc.text(`Vendedor: ${nomeV}`,                                   105, 30, { align: 'center' });
    doc.text(`Período: ${mesTxt}`,                                   105, 37, { align: 'center' });
    doc.text(`Emitido em: ${new Date().toLocaleString('pt-BR')}`,    105, 44, { align: 'center' });

    // ── Tabela ───────────────────────────────────────────────────────────────
    doc.autoTable({
        startY: 52,
        head: [['NF', 'Órgão', 'Emissão', 'Dt. Pagamento', 'Valor NF', 'Valor Recebido']],
        body: linhas.map(l => [
            l.numero_nf,
            l.nome_orgao,
            l.data_emissao,
            l.data_pagamento,
            `R$ ${l.valor_nf.toFixed(2)}`,
            `R$ ${l.valor_recebido.toFixed(2)}`,
        ]),
        theme:        'grid',
        headStyles:   { fillColor: [40, 100, 60], textColor: [255,255,255], fontStyle: 'bold', halign: 'center' },
        styles:       { fontSize: 9, cellPadding: 3 },
        columnStyles: {
            0: { halign: 'center' },
            2: { halign: 'center' },
            3: { halign: 'center' },
            4: { halign: 'right'  },
            5: { halign: 'right'  },
        },
    });

    // ── Totais ───────────────────────────────────────────────────────────────
    const fY = doc.lastAutoTable.finalY + 10;
    doc.setFontSize(12); doc.setFont(undefined, 'bold');
    doc.text(`TOTAL RECEBIDO: R$ ${totalRec.toFixed(2)}`,   14, fY);
    doc.text(`COMISSÃO (1%):  R$ ${comissao.toFixed(2)}`,   14, fY + 8);

    doc.save(`comissao_${vendedor}_${mesTxt.replace(' ', '_')}.pdf`);
    showToast('Relatório de comissão gerado!', 'success');
};

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────
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
