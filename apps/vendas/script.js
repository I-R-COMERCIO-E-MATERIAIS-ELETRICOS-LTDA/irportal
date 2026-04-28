const API_URL = window.location.origin + '/api';

let vendas        = [];
let sessionToken  = null;
let currentUser   = null;   // { username, name, is_admin }
let currentMonth  = new Date();

// Vendedores fixos por perfil (username em maiúsculo)
const PERFIL_VENDEDOR = {
    'MIGUEL':    'MIGUEL',
    'ISAQUE':    'ISAQUE',
};
// Admins: visualizam tudo e podem filtrar livremente
const ADMINS = ['ROBERTO', 'ROSEMEIRE'];

const mesesNomes = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// ─── INICIALIZAÇÃO ─────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const urlParams   = new URLSearchParams(window.location.search);
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
                        height:100vh;background:var(--bg-primary);color:var(--text-primary);text-align:center;padding:2rem;">
                <h1>NÃO AUTORIZADO</h1><p>Sem token de sessão.</p>
            </div>`;
        return;
    }

    await resolverUsuario();
    await inicializarApp();
});

// Descobre o usuário atual via verify-session
async function resolverUsuario() {
    try {
        const r = await fetch(`${window.location.origin}/api/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        if (r.ok) {
            const d = await r.json();
            if (d.valid && d.session) currentUser = d.session;
        }
    } catch (_) {}
}

// Retorna o username em maiúsculo (para comparar com perfis)
function getUserKey() {
    return (currentUser?.username || currentUser?.name || '').toUpperCase();
}

// Retorna o vendedor fixo para o usuário logado (null = admin, vê tudo)
function getVendedorFixo() {
    const key = getUserKey();
    return PERFIL_VENDEDOR[key] || null;
}

function isAdmin() {
    const key = getUserKey();
    return ADMINS.includes(key) || currentUser?.is_admin;
}

async function inicializarApp() {
    configurarFiltroVendedor();
    updateMonthDisplay();

    await sincronizarDados();
    await loadVendas();

    setInterval(loadVendas,      15000);   // atualiza tabela a cada 15s
    setInterval(sincronizarDados, 300000); // sincroniza fontes a cada 5min
}

// Bloqueia o select de vendedor para perfis não-admin
function configurarFiltroVendedor() {
    const sel = document.getElementById('filterVendedor');
    if (!sel) return;

    const vendedorFixo = getVendedorFixo();
    if (vendedorFixo) {
        // Força opção do vendedor e desabilita o select
        sel.value    = vendedorFixo;
        sel.disabled = true;
        // Garante que a opção existe
        if (!sel.querySelector(`option[value="${vendedorFixo}"]`)) {
            const opt = document.createElement('option');
            opt.value = vendedorFixo;
            opt.textContent = vendedorFixo.charAt(0) + vendedorFixo.slice(1).toLowerCase();
            sel.appendChild(opt);
            sel.value = vendedorFixo;
        }
    }
}

// ─── SINCRONIZAÇÃO ──────────────────────────────────────────────────────────────
async function sincronizarDados() {
    try {
        const r = await fetch(`${API_URL}/vendas/sincronizar`, {
            method: 'POST',
            headers: { 'X-Session-Token': sessionToken }
        });
        const d = await r.json();
        if (d.success) console.log('📊 Sincronizado:', d.message);
        else           console.warn('⚠️ Sync:', d.error);
    } catch (e) { console.error('Erro sync:', e); }
}

async function loadVendas() {
    try {
        // Passa vendedor fixo na query se não for admin
        const vendedorFixo = getVendedorFixo();
        const qs = vendedorFixo ? `&vendedor=${encodeURIComponent(vendedorFixo)}` : '';

        const r = await fetch(`${API_URL}/vendas?_t=${Date.now()}${qs}`, {
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' }
        });
        if (r.ok) {
            vendas = await r.json();
            if (!Array.isArray(vendas)) vendas = [];
            console.log(`✅ ${vendas.length} vendas carregadas`);
            updateDashboard();
            filterVendas();
        }
    } catch (e) { console.error('Erro loadVendas:', e); }
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
    if (el) el.textContent = `${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard();
    filterVendas();
}
window.changeMonth = d => { currentMonth.setMonth(currentMonth.getMonth() + d); updateMonthDisplay(); };
window.selectMonth = idx => {
    currentMonth = new Date(currentMonth.getFullYear(), idx, 1);
    updateMonthDisplay();
    if (window.toggleCalendar) window.toggleCalendar();
};

// ─── HELPERS DE STATUS ─────────────────────────────────────────────────────────
/**
 * Retorna o status de EXIBIÇÃO de uma venda:
 *   PAGO            → verde
 *   Nº PARCELA x/y  → verde (parcial)
 *   ENTREGUE        → azul  (= mercadoria recebida, ainda não paga)
 *   EM TRÂNSITO     → laranja
 *   SIMPLES REMESSA / REMESSA DE AMOSTRA → cinza
 */
function resolverStatusExibicao(v) {
    const stPagto = (v.status_pagamento || '').toUpperCase();
    const stFrete = (v.status_frete     || '').toUpperCase();
    const tipoNF  = (v.tipo_nf          || '').toUpperCase();

    // 1. PAGO total
    if (stPagto === 'PAGO') return { label: 'PAGO', classe: 'st-pago' };

    // 2. Parcelado (status_pagamento contém "PARCELA" ou há metadados de parcelas)
    if (/parcela/i.test(stPagto)) {
        const meta = parseMeta(v.observacoes);
        if (meta) {
            return {
                label:  `PARCELA ${meta.ultima_num}/${meta.total}`,
                classe: 'st-parcela'
            };
        }
        return { label: stPagto, classe: 'st-parcela' };
    }

    // 3. Tipos de NF especiais (sem cobrança de frete/pgto normal)
    if (tipoNF === 'SIMPLES REMESSA')    return { label: 'SIMPLES REMESSA',    classe: 'st-remessa' };
    if (tipoNF === 'REMESSA DE AMOSTRA') return { label: 'REMESSA DE AMOSTRA', classe: 'st-remessa' };
    if (stFrete === 'SIMPLES REMESSA')   return { label: 'SIMPLES REMESSA',    classe: 'st-remessa' };
    if (stFrete === 'REMESSA DE AMOSTRA')return { label: 'REMESSA DE AMOSTRA', classe: 'st-remessa' };

    // 4. Entregue (mercadoria chegou, pagamento pendente → trata como A RECEBER)
    if (stFrete === 'ENTREGUE') return { label: 'ENTREGUE', classe: 'st-entregue' };

    // 5. Em trânsito / aguardando coleta
    return { label: stFrete || 'EM TRÂNSITO', classe: 'st-transito' };
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

    // PAGO = status_pagamento PAGO ou PARCELA (qualquer variação)
    const totalPago = mes
        .filter(v => {
            const st = (v.status_pagamento || '').toUpperCase();
            return st === 'PAGO' || /parcela/i.test(st);
        })
        .reduce((s, v) => {
            // Para parcelas, usa valor_pago; para PAGO total, usa valor_nf
            const st = (v.status_pagamento || '').toUpperCase();
            if (/parcela/i.test(st)) return s + parseFloat(v.valor_pago || 0);
            return s + parseFloat(v.valor_nf || 0);
        }, 0);

    // A RECEBER = mercadorias ENTREGUES (não pagas)
    // Regra: status_frete ENTREGUE e status_pagamento NÃO é PAGO/PARCELA
    const totalAReceber = mes
        .filter(v => {
            const stFrete = (v.status_frete     || '').toUpperCase();
            const stPagto = (v.status_pagamento || '').toUpperCase();
            return stFrete === 'ENTREGUE' && stPagto !== 'PAGO' && !/parcela/i.test(stPagto);
        })
        .reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    const totalEntregue = mes.filter(v => (v.status_frete || '').toUpperCase() === 'ENTREGUE').length;

    const totalFaturado = mes.reduce((s, v) => s + parseFloat(v.valor_nf || 0), 0);

    const fmt = n => `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
    document.getElementById('totalPago').textContent     = fmt(totalPago);
    document.getElementById('totalAReceber').textContent = fmt(totalAReceber);
    document.getElementById('totalEntregue').textContent = totalEntregue;
    document.getElementById('totalFaturado').textContent = fmt(totalFaturado);
}

// Vendas do mês corrente (por data_emissao; fallback: data_vencimento)
function getVendasMes() {
    return vendas.filter(v => {
        const dataStr = v.data_emissao || v.data_vencimento;
        if (!dataStr) return false;
        const d = new Date(dataStr + 'T00:00:00');
        return d.getMonth() === currentMonth.getMonth() &&
               d.getFullYear() === currentMonth.getFullYear();
    });
}

// ─── FILTROS E TABELA ──────────────────────────────────────────────────────────
window.filterVendas = function () {
    const s    = (document.getElementById('search')?.value || '').toLowerCase();
    const vend = document.getElementById('filterVendedor')?.value || '';
    const st   = document.getElementById('filterStatus')?.value  || '';

    let lista = getVendasMes();

    // Vendedor fixo (já vem filtrado da API, mas garante no front)
    const vendedorFixo = getVendedorFixo();
    if (vendedorFixo) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === vendedorFixo);
    } else if (vend) {
        lista = lista.filter(v => (v.vendedor || '').toUpperCase() === vend.toUpperCase());
    }

    // Filtro de status
    if (st) {
        lista = lista.filter(v => {
            const { label } = resolverStatusExibicao(v);
            if (st === 'PAGO')              return label === 'PAGO';
            if (st === 'ENTREGUE')          return label === 'ENTREGUE';
            if (st === 'EM TRÂNSITO')       return label === 'EM TRÂNSITO';
            if (st === 'SIMPLES REMESSA')   return label === 'SIMPLES REMESSA';
            if (st === 'REMESSA DE AMOSTRA')return label === 'REMESSA DE AMOSTRA';
            if (st === 'PARCELA')           return label.startsWith('PARCELA');
            return true;
        });
    }

    // Pesquisa textual
    if (s) {
        lista = lista.filter(v =>
            [v.numero_nf, v.nome_orgao, v.vendedor, v.transportadora, v.banco]
                .some(x => x && x.toLowerCase().includes(s))
        );
    }

    lista.sort((a, b) => (parseInt(a.numero_nf) || 0) - (parseInt(b.numero_nf) || 0));
    renderVendas(lista);
};

function renderVendas(lista) {
    const c = document.getElementById('vendasContainer');
    if (!c) return;
    if (!lista.length) {
        c.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-secondary);">Nenhuma venda encontrada</div>';
        return;
    }

    const rows = lista.map(v => {
        const { label, classe } = resolverStatusExibicao(v);

        // Cor da linha
        let rowStyle = '';
        if (classe === 'st-pago')     rowStyle = 'background:rgba(34,197,94,0.12);';
        if (classe === 'st-entregue') rowStyle = 'background:rgba(59,130,246,0.12);';

        // Valor pago: para parcelas usa valor_pago; para PAGO usa valor_nf; demais vazio
        let valorPagoTxt = '—';
        const stPagto = (v.status_pagamento || '').toUpperCase();
        if (stPagto === 'PAGO') {
            valorPagoTxt = fmtMoeda(v.valor_nf);
        } else if (/parcela/i.test(stPagto)) {
            // Última parcela paga
            const meta = parseMeta(v.observacoes);
            const vp   = meta?.ultima_valor || v.valor_pago;
            valorPagoTxt = vp ? fmtMoeda(vp) : fmtMoeda(v.valor_pago);
        }

        return `
        <tr style="cursor:pointer;${rowStyle}" onclick="handleViewClick('${v.id}')">
            <td><strong>${v.numero_nf || '—'}</strong></td>
            <td style="max-width:220px;word-wrap:break-word;white-space:normal;">${v.nome_orgao || '—'}</td>
            <td>${v.vendedor || '—'}</td>
            <td><strong>${fmtMoeda(v.valor_nf)}</strong></td>
            <td>${valorPagoTxt}</td>
            <td><span class="badge ${classe}">${label}</span></td>
        </tr>`;
    }).join('');

    c.innerHTML = `
        <div style="overflow-x:auto;">
            <table>
                <thead>
                    <tr>
                        <th>NF</th>
                        <th>Órgão</th>
                        <th>Vendedor</th>
                        <th>Valor NF</th>
                        <th>Valor Pago</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>`;
}

// ─── MODAL DE DETALHES ─────────────────────────────────────────────────────────
window.handleViewClick = function (id) {
    const v = vendas.find(x => String(x.id) === String(id));
    if (!v) return;

    const stPagto = (v.status_pagamento || '').toUpperCase();
    const isPago  = stPagto === 'PAGO' || /parcela/i.test(stPagto);

    document.getElementById('modalNumeroNF').textContent = v.numero_nf || '—';

    let html = '';

    if (!isPago) {
        // ── Modal: dados do CONTROLE DE FRETE ──────────────────────────────
        html = `
        <div class="info-section">
            <h4>📦 Informações da NF</h4>
            <p><strong>Órgão:</strong> ${v.nome_orgao || '—'}</p>
            <p><strong>Vendedor:</strong> ${v.vendedor || '—'}</p>
            <p><strong>Tipo NF:</strong> ${v.tipo_nf || '—'}</p>
            <p><strong>Data Emissão:</strong> ${fmtData(v.data_emissao)}</p>
            <p><strong>Valor NF:</strong> ${fmtMoeda(v.valor_nf)}</p>
        </div>
        <div class="info-section">
            <h4>🚚 Controle de Frete</h4>
            <p><strong>Transportadora:</strong> ${v.transportadora || '—'}</p>
            <p><strong>Valor Frete:</strong> ${fmtMoeda(v.valor_frete)}</p>
            <p><strong>Data Coleta:</strong> ${fmtData(v.data_coleta)}</p>
            <p><strong>Cidade Destino:</strong> ${v.cidade_destino || '—'}</p>
            <p><strong>Previsão Entrega:</strong> ${fmtData(v.previsao_entrega)}</p>
            <p><strong>Status:</strong> ${badgeStatus(v)}</p>
        </div>`;
    } else {
        // ── Modal: dados de CONTAS A RECEBER ───────────────────────────────
        const meta = parseMeta(v.observacoes);

        let parcelasHtml = '';
        if (meta) {
            parcelasHtml = `
            <p><strong>Parcelas:</strong> ${meta.ultima_num} de ${meta.total} pagas</p>
            <p><strong>Última Parcela:</strong> ${fmtMoeda(meta.ultima_valor)}</p>
            <p><strong>Total Pago:</strong> ${fmtMoeda(v.valor_pago)}</p>`;
        } else {
            parcelasHtml = `<p><strong>Valor Pago:</strong> ${fmtMoeda(v.valor_pago || v.valor_nf)}</p>`;
        }

        html = `
        <div class="info-section">
            <h4>📦 Informações da NF</h4>
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
            <p><strong>Status:</strong> ${badgeStatus(v)}</p>
            ${parcelasHtml}
        </div>`;
    }

    document.getElementById('modalBody').innerHTML = html;
    document.getElementById('infoModal').style.display = 'flex';
};

window.closeInfoModal = () => { document.getElementById('infoModal').style.display = 'none'; };

function badgeStatus(v) {
    const { label, classe } = resolverStatusExibicao(v);
    return `<span class="badge ${classe}">${label}</span>`;
}

// ─── GERAÇÃO DE PDF ────────────────────────────────────────────────────────────
window.gerarPDF = function () {
    const { jsPDF } = window.jspdf;
    const doc  = new jsPDF();
    const mes  = getVendasMes();
    const vend = getVendedorFixo();

    let titulo = `Vendas — ${mesesNomes[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    if (vend) titulo += ` — ${vend.charAt(0) + vend.slice(1).toLowerCase()}`;

    doc.setFontSize(13);
    doc.text(titulo, 14, 15);

    doc.autoTable({
        startY: 22,
        head: [['NF','Órgão','Vendedor','Valor NF','Valor Pago','Status']],
        body: mes.map(v => {
            const { label } = resolverStatusExibicao(v);
            const stPagto   = (v.status_pagamento || '').toUpperCase();
            let vp = '—';
            if (stPagto === 'PAGO')         vp = `R$ ${parseFloat(v.valor_nf  || 0).toFixed(2)}`;
            else if (/parcela/i.test(stPagto)) {
                const meta = parseMeta(v.observacoes);
                vp = `R$ ${parseFloat(meta?.ultima_valor || v.valor_pago || 0).toFixed(2)}`;
            }
            return [v.numero_nf || '—', v.nome_orgao || '—', v.vendedor || '—',
                    `R$ ${parseFloat(v.valor_nf || 0).toFixed(2)}`, vp, label];
        }),
        styles:      { fontSize: 8 },
        headStyles:  { fillColor: [107,114,128] },
    });

    doc.save(`vendas_${mesesNomes[currentMonth.getMonth()]}_${currentMonth.getFullYear()}.pdf`);
};

// ─── UTILITÁRIOS ───────────────────────────────────────────────────────────────
function fmtMoeda(v) {
    const n = parseFloat(v || 0);
    return `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`;
}
function fmtData(d) {
    if (!d) return '—';
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR');
}

function showToast(msg, type = 'info') {
    const cores = { error: '#EF4444', success: '#22C55E', info: '#3B82F6' };
    const div   = document.createElement('div');
    div.textContent = msg;
    div.style.cssText = `
        position:fixed;bottom:1.5rem;right:1.5rem;z-index:99999;
        padding:.75rem 1.25rem;border-radius:8px;font-weight:600;font-size:.875rem;
        background:${cores[type] || cores.info};color:#fff;
        box-shadow:0 4px 12px rgba(0,0,0,.2);animation:fadeIn .3s ease;`;
    document.body.appendChild(div);
    setTimeout(() => div.remove(), 3200);
}
