// ============================================
// PAINEL — script.js
// ============================================

const API = '';   // mesmo servidor

const MESES_NOMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];

// ─── AUTH ─────────────────────────────────────────────────────────────────────
let sessionToken = null;
let currentUser  = null;

async function verificarSessao() {
    sessionToken = localStorage.getItem('sessionToken') || sessionStorage.getItem('sessionToken');
    if (!sessionToken) return redirecionarLogin();

    try {
        const r = await fetch('/api/portal/verify-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        const d = await r.json();
        if (!d.valid) return redirecionarLogin();
        currentUser = d.session;
    } catch {
        return redirecionarLogin();
    }
}

function redirecionarLogin() {
    window.location.href = '/portal?redirect=/painel';
}

// ─── API HELPER ────────────────────────────────────────────────────────────────
async function apiFetch(path) {
    const r = await fetch(`/api/painel/${path}`, {
        headers: { 'X-Session-Token': sessionToken }
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
}

// ─── FORMAT ───────────────────────────────────────────────────────────────────
function fmt(v) {
    return 'R$ ' + (parseFloat(v) || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtShort(v) {
    v = parseFloat(v) || 0;
    if (v >= 1_000_000) return 'R$ ' + (v/1_000_000).toFixed(1) + 'M';
    if (v >= 1_000) return 'R$ ' + (v/1_000).toFixed(1) + 'K';
    return fmt(v);
}

// ─── BADGE ────────────────────────────────────────────────────────────────────
// invertido: true → vermelho quando sobe (custos)
function badge(atual, anterior, invertido = false) {
    if (!anterior || anterior === 0) return '<span class="badge-neutral">—</span>';
    const diff = atual - anterior;
    const pct = ((Math.abs(diff) / anterior) * 100).toFixed(1);
    if (diff === 0) return '<span class="badge-neutral">= 0%</span>';
    const sobe = diff > 0;
    const positivo = invertido ? !sobe : sobe;
    const cls = positivo ? 'badge-up' : 'badge-down';
    const arrow = sobe ? '▲' : '▼';
    return `<span class="${cls}">${arrow} ${pct}%</span>`;
}

// ─── MONTHS TABLE ─────────────────────────────────────────────────────────────
function montarTabelaMeses(mesesAtual, mesesAnt, anoAtual, anoAnt, invertido = false, extras = []) {
    const hoje = new Date();
    const mesHoje = hoje.getFullYear() === anoAtual ? hoje.getMonth() : 11;

    let rows = '';
    for (let i = 0; i <= mesHoje; i++) {
        const va = mesesAtual[i];
        const vb = mesesAnt[i];
        const prev = i > 0 ? mesesAtual[i-1] : null;
        const extraHTML = extras[i] ? extras[i] : '';
        rows += `
        <tr>
            <td class="month-name">${MESES_NOMES[i]}</td>
            <td class="val-cell">${va > 0 ? fmtShort(va) : '<span style="color:var(--text-sub)">—</span>'}</td>
            <td>${badge(va, prev, invertido)}</td>
            <td class="val-cell" style="color:var(--text-sub);font-size:11px">${vb > 0 ? fmtShort(vb) : '—'}</td>
            ${extraHTML ? `<td>${extraHTML}</td>` : ''}
        </tr>`;
    }

    return `
    <table class="months-table">
        <thead>
            <tr>
                <th>Mês</th>
                <th>${anoAtual}</th>
                <th>vs Anterior</th>
                <th>${anoAnt}</th>
                ${extras.length ? '<th></th>' : ''}
            </tr>
        </thead>
        <tbody>${rows}</tbody>
    </table>`;
}

// ─── CARD WRAPPER ─────────────────────────────────────────────────────────────
function cardHTML(title, totalAtual, totalAnt, bodyHTML, extraFooter = '') {
    return `
    <div class="card">
        <div class="card-header">
            <div>
                <div class="card-title">${title}</div>
                <div class="card-total">${fmtShort(totalAtual)}</div>
                <div class="card-total-label">Total do ano</div>
            </div>
        </div>
        ${bodyHTML}
        <div class="annual-compare">
            <div class="compare-item">
                <div class="compare-label">Ano atual</div>
                <div class="compare-value">${fmt(totalAtual)}</div>
            </div>
            <div class="compare-item">
                <div class="compare-label">Ano anterior</div>
                <div class="compare-value" style="color:var(--text-sub)">${fmt(totalAnt)}</div>
            </div>
            <div class="compare-item">
                <div class="compare-label">Variação</div>
                <div class="compare-value">${badge(totalAtual, totalAnt)}</div>
            </div>
        </div>
        ${extraFooter}
    </div>`;
}

// ─── ENTREGAS CARD ────────────────────────────────────────────────────────────
function entregasCard(entregas, vendedor = null) {
    const lista = vendedor
        ? entregas.filter(e => (e.vendedor || '').toUpperCase() === vendedor.toUpperCase())
        : entregas;

    let rows = lista.length === 0
        ? '<div class="no-entregas">Nenhuma entrega confirmada hoje</div>'
        : lista.map(e => `
            <div class="entrega-row">
                <span class="entrega-nf">NF ${e.numero_nf || '—'}</span>
                <span class="entrega-orgao">${e.nome_orgao || '—'}</span>
                <span class="entrega-valor">${fmt(e.valor_nf)}</span>
            </div>`).join('');

    return `
    <div class="card">
        <div class="entregas-header">
            <span class="entregas-dot"></span>
            Entregas Confirmadas Hoje
        </div>
        ${rows}
    </div>`;
}

// ─── RENDER SECTION FATURAMENTO ───────────────────────────────────────────────
async function renderFaturamento(container, filtroVendedor = null) {
    const anoSel = document.getElementById('anoSel').value;
    const params = `faturamento?ano=${anoSel}${filtroVendedor ? '&vendedor='+filtroVendedor : ''}`;
    const d = await apiFetch(params);
    const corpo = montarTabelaMeses(d.mesesAtual, d.mesesAnt, d.anoAtual, d.anoAnterior);
    container.innerHTML = cardHTML('Faturamento', d.totalAtual, d.totalAnt, corpo);
}

// ─── RENDER SECTION FRETE ─────────────────────────────────────────────────────
async function renderFrete(container, entContainer, filtroVendedor = null) {
    const anoSel = document.getElementById('anoSel').value;
    const params = `frete?ano=${anoSel}${filtroVendedor ? '&vendedor='+filtroVendedor : ''}`;
    const d = await apiFetch(params);
    const corpo = montarTabelaMeses(d.mesesAtual, d.mesesAnt, d.anoAtual, d.anoAnterior, true);
    container.innerHTML = cardHTML('Controle de Frete', d.totalAtual, d.totalAnt, corpo);
    entContainer.innerHTML = entregasCard(d.entregasHoje, filtroVendedor);
}

// ─── RENDER SECTION VENDAS ────────────────────────────────────────────────────
async function renderVendas(container, filtroVendedor = null) {
    const anoSel = document.getElementById('anoSel').value;
    const params = `vendas?ano=${anoSel}${filtroVendedor ? '&vendedor='+filtroVendedor : ''}`;
    const d = await apiFetch(params);
    const corpo = montarTabelaMeses(d.mesesAtual, d.mesesAnt, d.anoAtual, d.anoAnterior);
    const aRecBox = `<div class="areceber-box"><span class="areceber-label">💰 A Receber (Vendas)</span><span class="areceber-value">${fmt(d.totalAReceber)}</span></div>`;
    container.innerHTML = cardHTML('Vendas Pagas', d.totalAtual, d.totalAnt, corpo) ;
    // inject areceber box before annual compare
    const c = container.querySelector('.card');
    const footer = c.querySelector('.annual-compare');
    footer.insertAdjacentHTML('beforebegin', aRecBox);
}

// ─── RENDER SECTION VENDAS POR VENDEDOR (Rosemeire/Roberto) ──────────────────
async function renderVendasPorVendedor(container) {
    const anoSel = document.getElementById('anoSel').value;
    const d = await apiFetch(`vendas?ano=${anoSel}`);

    const vendedores = ['ISAQUE', 'MIGUEL', 'ROBERTO'];
    const tabs = vendedores.map((v, i) =>
        `<button class="vend-tab${i===0?' active':''}" onclick="switchVendTab(this,'${v}')">${v.charAt(0)+v.slice(1).toLowerCase()}</button>`
    ).join('');

    const panels = vendedores.map((v, i) => {
        const vd = d.porVendedor[v] || { meses: Array(12).fill(0), total: 0 };
        const comissoesMes = vd.comissoes || Array(12).fill(0);
        const extras = vd.meses.map((_, idx) =>
            comissoesMes[idx] > 0 ? `<span class="comissao-val">Com: ${fmtShort(comissoesMes[idx])}</span>` : ''
        );
        const corpo = montarTabelaMeses(vd.meses, Array(12).fill(0), d.anoAtual, d.anoAnterior, false, extras);
        return `<div class="vend-tab-panel${i===0?' active':''}" data-vend="${v}">${corpo}</div>`;
    }).join('');

    const totalGeral = vendedores.reduce((acc, v) => acc + (d.porVendedor[v]?.total || 0), 0);

    container.innerHTML = `
    <div class="card">
        <div class="card-header">
            <div>
                <div class="card-title">Vendas por Vendedor</div>
                <div class="card-total">${fmtShort(totalGeral)}</div>
                <div class="card-total-label">Total geral do ano</div>
            </div>
        </div>
        <div class="vend-tabs">${tabs}</div>
        ${panels}
        <div class="annual-compare">
            ${vendedores.map(v => {
                const vd = d.porVendedor[v] || { total: 0 };
                return `<div class="compare-item"><div class="compare-label">${v.charAt(0)+v.slice(1).toLowerCase()}</div><div class="compare-value">${fmtShort(vd.total)}</div></div>`;
            }).join('')}
        </div>
    </div>`;
}

window.switchVendTab = function(btn, vend) {
    const card = btn.closest('.card');
    card.querySelectorAll('.vend-tab').forEach(t => t.classList.remove('active'));
    card.querySelectorAll('.vend-tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    card.querySelector(`.vend-tab-panel[data-vend="${vend}"]`).classList.add('active');
};

// ─── RENDER SECTION RECEBER ───────────────────────────────────────────────────
async function renderReceber(container) {
    const anoSel = document.getElementById('anoSel').value;
    const d = await apiFetch(`receber?ano=${anoSel}`);
    const corpo = montarTabelaMeses(d.mesesAtual, d.mesesAnt, d.anoAtual, d.anoAnterior);
    const aRecBox = `<div class="areceber-box"><span class="areceber-label">💰 A Receber (Liquidação)</span><span class="areceber-value">${fmt(d.totalAReceber)}</span></div>`;
    container.innerHTML = cardHTML('Liquidação (Contas a Receber)', d.totalAtual, d.totalAnt, corpo);
    const c = container.querySelector('.card');
    c.querySelector('.annual-compare').insertAdjacentHTML('beforebegin', aRecBox);
}

// ─── RENDER SECTION PAGAR ─────────────────────────────────────────────────────
async function renderPagar(container) {
    const anoSel = document.getElementById('anoSel').value;
    const d = await apiFetch(`pagar?ano=${anoSel}`);
    const corpo = montarTabelaMeses(d.mesesAtual, d.mesesAnt, d.anoAtual, d.anoAnterior, true);
    container.innerHTML = cardHTML('Pagamentos (Contas a Pagar)', d.totalAtual, d.totalAnt, corpo);
}

// ─── RENDER SECTION LUCRO ─────────────────────────────────────────────────────
async function renderLucro(container) {
    const anoSel = document.getElementById('anoSel').value;
    const d = await apiFetch(`lucro?ano=${anoSel}`);
    const corpo = montarTabelaMeses(d.mesesAtual, d.mesesAnt, d.anoAtual, d.anoAnterior);
    container.innerHTML = cardHTML('Lucro Real', d.totalAtual, d.totalAnt, corpo);
}

// ─── RENDER SECTION ESTOQUE ───────────────────────────────────────────────────
async function renderEstoque(container) {
    const d = await apiFetch('estoque');
    const grupos = Object.entries(d.porGrupo).sort((a,b) => b[1]-a[1]);
    const rows = grupos.map(([g,v]) => `
        <div class="estoque-row">
            <span class="estoque-grupo">${g}</span>
            <span class="estoque-valor">${fmt(v)}</span>
        </div>`).join('');
    container.innerHTML = `
    <div class="card">
        <div class="card-header">
            <div>
                <div class="card-title">Estoque</div>
                <div class="card-total">${fmtShort(d.totalGeral)}</div>
                <div class="card-total-label">Valor total em estoque</div>
            </div>
        </div>
        <div class="estoque-grid">${rows}</div>
        <div class="estoque-total-row">
            <span class="estoque-total-label">TOTAL GERAL</span>
            <span class="estoque-total-value">${fmt(d.totalGeral)}</span>
        </div>
    </div>`;
}

// ─── SECTION BUILDER HELPER ───────────────────────────────────────────────────
function section(icon, title, id) {
    return `
    <div class="painel-section">
        <div class="section-title">
            <span class="section-title-icon">${icon}</span>
            ${title}
        </div>
        <div class="cards-row" id="${id}">
            <div class="card" style="padding:24px;color:var(--text-sub);font-size:13px">Carregando...</div>
        </div>
    </div>`;
}

// ─── RENDER PAINEL POR USUÁRIO ────────────────────────────────────────────────
async function renderPainel() {
    const nome = (currentUser.name || '').trim();
    const nomeUpper = nome.toUpperCase();
    const isAdmin = currentUser.isAdmin;
    const sector = (currentUser.sector || '').toUpperCase();
    const body = document.getElementById('painelBody');

    // Detecta perfil
    const isIsaque    = nomeUpper.includes('ISAQUE');
    const isMiguel    = nomeUpper.includes('MIGUEL');
    const isRoberto   = nomeUpper.includes('ROBERTO') && isAdmin;
    const isRosemeire = nomeUpper.includes('ROSEMEIRE') && isAdmin;
    const isFinanceiro = (!isRoberto && !isRosemeire) && (sector === 'FINANCEIRO' || sector === 'FINANC');

    // ── ISAQUE ────────────────────────────────────────────────────────────────
    if (isIsaque) {
        body.innerHTML =
            section('📄','Faturamento','s-fat') +
            section('🚚','Mercadorias (Frete)','s-frete') +
            section('','','s-ent') +
            section('💼','Vendas','s-vend');

        await Promise.all([
            renderFaturamento(document.getElementById('s-fat'), 'Isaque'),
            renderFrete(document.getElementById('s-frete'), document.getElementById('s-ent'), 'Isaque'),
            renderVendas(document.getElementById('s-vend'), 'ISAQUE')
        ]);
    }

    // ── MIGUEL ────────────────────────────────────────────────────────────────
    else if (isMiguel) {
        body.innerHTML =
            section('📄','Faturamento','s-fat') +
            section('🚚','Mercadorias (Frete)','s-frete') +
            section('','','s-ent') +
            section('💼','Vendas','s-vend');

        await Promise.all([
            renderFaturamento(document.getElementById('s-fat'), 'Miguel'),
            renderFrete(document.getElementById('s-frete'), document.getElementById('s-ent'), 'Miguel'),
            renderVendas(document.getElementById('s-vend'), 'MIGUEL')
        ]);
    }

    // ── ROBERTO (admin) ───────────────────────────────────────────────────────
    else if (isRoberto) {
        body.innerHTML =
            section('📈','Lucro Real','s-lucro') +
            section('📄','Faturamento (Geral)','s-fat') +
            section('🚚','Mercadorias (Frete - Geral)','s-frete') +
            section('','','s-ent') +
            section('💼','Vendas (Geral)','s-vend') +
            section('📦','Estoque','s-est');

        await Promise.all([
            renderLucro(document.getElementById('s-lucro')),
            renderFaturamento(document.getElementById('s-fat')),
            renderFrete(document.getElementById('s-frete'), document.getElementById('s-ent')),
            renderVendas(document.getElementById('s-vend')),
            renderEstoque(document.getElementById('s-est'))
        ]);
    }

    // ── ROSEMEIRE (admin) ─────────────────────────────────────────────────────
    else if (isRosemeire) {
        body.innerHTML =
            section('📄','Faturamento (Geral)','s-fat') +
            section('💰','Liquidação (Contas a Receber)','s-rec') +
            section('💳','Pagamentos (Contas a Pagar)','s-pag') +
            section('💼','Vendas por Vendedor','s-vend') +
            section('📈','Lucro Real','s-lucro');

        await Promise.all([
            renderFaturamento(document.getElementById('s-fat')),
            renderReceber(document.getElementById('s-rec')),
            renderPagar(document.getElementById('s-pag')),
            renderVendasPorVendedor(document.getElementById('s-vend')),
            renderLucro(document.getElementById('s-lucro'))
        ]);
    }

    // ── FINANCEIRO ────────────────────────────────────────────────────────────
    else if (isFinanceiro) {
        body.innerHTML =
            section('📄','Faturamento (Geral)','s-fat') +
            section('💰','Liquidação (Contas a Receber)','s-rec') +
            section('💳','Pagamentos (Contas a Pagar)','s-pag');

        await Promise.all([
            renderFaturamento(document.getElementById('s-fat')),
            renderReceber(document.getElementById('s-rec')),
            renderPagar(document.getElementById('s-pag'))
        ]);
    }

    // ── FALLBACK ──────────────────────────────────────────────────────────────
    else {
        body.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-sub)">
            <div style="font-size:40px;margin-bottom:16px">👋</div>
            <div style="font-size:16px;font-weight:600;color:var(--text)">Bem-vindo, ${nome}!</div>
            <div style="margin-top:8px;font-size:13px">Seu perfil ainda não possui um painel personalizado.</div>
        </div>`;
    }
}

// ─── ANO SELECTOR ─────────────────────────────────────────────────────────────
function buildAnoSelector() {
    const sel = document.getElementById('anoSel');
    const atual = new Date().getFullYear();
    for (let a = atual; a >= atual - 4; a--) {
        const opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        if (a === atual) opt.selected = true;
        sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
        document.getElementById('painelBody').innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-sub)">Carregando...</div>';
        renderPainel();
    });
}

// ─── INIT ─────────────────────────────────────────────────────────────────────
async function init() {
    await verificarSessao();

    // Preenche nome do usuário
    document.getElementById('userName').textContent = currentUser.name || currentUser.username;

    buildAnoSelector();

    // Esconde loading
    const loading = document.getElementById('loadingOverlay');

    try {
        await renderPainel();
    } catch (err) {
        console.error('Erro ao carregar painel:', err);
    }

    loading.classList.add('fade-out');
    setTimeout(() => loading.remove(), 350);
}

document.addEventListener('DOMContentLoaded', init);
