// ============================================================
// VENDAS — script.js
// ============================================================
const API_URL = window.location.origin + '/api';

let vendas        = [];
let allVendas     = [];
let isOnline      = false;
let sessionToken  = null;
let editingId     = null;
let currentMonth  = new Date();
let currentFetchController = null;

const MESES = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// ── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

async function verificarAutenticacao() {
    const urlParams    = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('irModuleSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('irModuleSession');
    }

    if (!sessionToken) return;
    inicializarApp();
}

function inicializarApp() {
    updateMonthDisplay();
    loadVendas();
    setInterval(() => { if (isOnline) loadVendas(); }, 30000);
}

// ── CONEXÃO ───────────────────────────────────────────────────
function updateConnectionStatus() {
    const el = document.getElementById('connectionStatus');
    if (!el) return;
    el.className = isOnline ? 'connection-status online' : 'connection-status offline';
}

function getHeaders() {
    const h = { 'Content-Type': 'application/json', 'Accept': 'application/json' };
    if (sessionToken) h['X-Session-Token'] = sessionToken;
    return h;
}

// ── NAVEGAÇÃO DE MESES ─────────────────────────────────────────
function changeMonth(direction) {
    if (currentFetchController) currentFetchController.abort();
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    allVendas = [];
    vendas    = [];
    updateMonthDisplay();
    renderTable();
    loadVendas();
}

function updateMonthDisplay() {
    const el = document.getElementById('currentMonth');
    if (el) el.textContent = `${MESES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
}

// ── CARREGAR DADOS ─────────────────────────────────────────────
async function loadVendas() {
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();

    const mes = currentMonth.getMonth();
    const ano = currentMonth.getFullYear();

    try {
        const res = await fetch(
            `${API_URL}/vendas?mes=${mes}&ano=${ano}`,
            { headers: getHeaders(), signal: currentFetchController.signal, cache: 'no-cache' }
        );

        if (res.status === 401) {
            sessionToken = null;
            sessionStorage.removeItem('irModuleSession');
            return;
        }
        if (!res.ok) {
            isOnline = false;
            updateConnectionStatus();
            setTimeout(() => loadVendas(), 5000);
            return;
        }

        const data = await res.json();

        // Verifica se ainda estamos no mesmo mês
        if (mes !== currentMonth.getMonth() || ano !== currentMonth.getFullYear()) return;

        allVendas = Array.isArray(data) ? data : [];
        isOnline  = true;
        updateConnectionStatus();
        populateVendedorFilter();
        filterVendas();
        currentFetchController = null;

    } catch (e) {
        if (e.name === 'AbortError') return;
        isOnline = false;
        updateConnectionStatus();
        setTimeout(() => loadVendas(), 5000);
    }
}

// ── FILTROS ────────────────────────────────────────────────────
function populateVendedorFilter() {
    const sel     = document.getElementById('filterVendedor');
    const current = sel.value;
    const vendors = [...new Set(allVendas.map(v => v.vendedor).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">Todos os vendedores</option>';
    vendors.forEach(vnd => {
        const opt = document.createElement('option');
        opt.value = vnd; opt.textContent = vnd;
        sel.appendChild(opt);
    });
    sel.value = current;
}

function filterVendas() {
    const term     = (document.getElementById('search')?.value || '').toLowerCase();
    const vendedor = document.getElementById('filterVendedor')?.value || '';

    vendas = allVendas.filter(v => {
        const matchTerm     = !term ||
            (v.nf      || '').toLowerCase().includes(term) ||
            (v.cliente || '').toLowerCase().includes(term) ||
            (v.vendedor|| '').toLowerCase().includes(term) ||
            (v.codigo  || '').toLowerCase().includes(term);
        const matchVendedor = !vendedor || (v.vendedor || '') === vendedor;
        return matchTerm && matchVendedor;
    });

    updateStats();
    renderTable();
}

// ── STATS ──────────────────────────────────────────────────────
function updateStats() {
    const total   = vendas.reduce((acc, v) => acc + (parseFloat(v.valor_total) || 0), 0);
    const qtd     = vendas.length;
    const ticket  = qtd > 0 ? total / qtd : 0;

    document.getElementById('statTotal').textContent  = formatMoeda(total);
    document.getElementById('statQtd').textContent    = qtd;
    document.getElementById('statTicket').textContent = formatMoeda(ticket);
}

// ── RENDERIZAR TABELA ──────────────────────────────────────────
function renderTable() {
    const tbody = document.getElementById('vendasContainer');
    if (!tbody) return;

    if (vendas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7">
            <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
                    <polyline points="17 6 23 6 23 12"/>
                </svg>
                <p>${isOnline ? 'Nenhuma venda encontrada neste mês.' : 'Sem conexão com o servidor.'}</p>
            </div>
        </td></tr>`;
        return;
    }

    // Ordena por data decrescente, depois NF
    const sorted = [...vendas].sort((a, b) => {
        const da = a.data_emissao || '';
        const db = b.data_emissao || '';
        if (db !== da) return db.localeCompare(da);
        return (a.nf || '').localeCompare(b.nf || '');
    });

    tbody.innerHTML = sorted.map(v => `
        <tr onclick="openFormModal('${v.id}')">
            <td><strong>${escHtml(v.nf || '-')}</strong></td>
            <td>${v.data_emissao ? formatDate(v.data_emissao) : '-'}</td>
            <td>${escHtml(v.cliente || '-')}</td>
            <td>${escHtml(v.vendedor || '-')}</td>
            <td style="font-weight:700; color:#22C55E;">${formatMoeda(v.valor_total)}</td>
            <td>${v.frete ? formatMoeda(v.frete) : '-'}</td>
            <td>
                <div class="actions-cell">
                    <button class="action-btn edit"   onclick="event.stopPropagation();openFormModal('${v.id}')">Editar</button>
                    <button class="action-btn delete" onclick="event.stopPropagation();promptDelete('${v.id}')">Excluir</button>
                </div>
            </td>
        </tr>
    `).join('');
}

// ── MODAL FORM ─────────────────────────────────────────────────
function openFormModal(id = null) {
    editingId = id || null;
    document.getElementById('modalTitle').textContent   = id ? 'Editar Venda' : 'Nova Venda';
    document.getElementById('btnDelete').style.display  = id ? 'block' : 'none';

    if (id) {
        const v = allVendas.find(x => String(x.id) === String(id));
        if (v) {
            document.getElementById('editId').value             = v.id;
            document.getElementById('inputNF').value            = v.nf || '';
            document.getElementById('inputData').value          = v.data_emissao || '';
            document.getElementById('inputCliente').value       = v.cliente || '';
            document.getElementById('inputVendedor').value      = v.vendedor || '';
            document.getElementById('inputCodigo').value        = v.codigo || '';
            document.getElementById('inputValorTotal').value    = v.valor_total || '';
            document.getElementById('inputFrete').value         = v.frete || '';
            document.getElementById('inputObservacoes').value   = v.observacoes || '';
        }
    } else {
        clearForm();
        // Default: data de hoje
        document.getElementById('inputData').value = new Date().toISOString().split('T')[0];
    }

    document.getElementById('formModal').classList.add('show');
    document.getElementById('inputNF').focus();
}

function closeFormModal() {
    document.getElementById('formModal').classList.remove('show');
    clearForm();
    editingId = null;
}

function clearForm() {
    ['editId','inputNF','inputData','inputCliente','inputVendedor',
     'inputCodigo','inputValorTotal','inputFrete','inputObservacoes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
}

async function saveVenda() {
    const nf = (document.getElementById('inputNF').value || '').trim();
    if (!nf) { showMessage('Número da NF é obrigatório.', 'error'); return; }

    const payload = {
        nf:           nf.toUpperCase(),
        data_emissao: document.getElementById('inputData').value || null,
        cliente:      (document.getElementById('inputCliente').value || '').trim().toUpperCase(),
        vendedor:     (document.getElementById('inputVendedor').value || '').trim().toUpperCase(),
        codigo:       (document.getElementById('inputCodigo').value || '').trim().toUpperCase(),
        valor_total:  parseFloat(document.getElementById('inputValorTotal').value) || 0,
        frete:        parseFloat(document.getElementById('inputFrete').value) || 0,
        observacoes:  (document.getElementById('inputObservacoes').value || '').trim()
    };

    const btnSave = document.getElementById('btnSave');
    btnSave.disabled    = true;
    btnSave.textContent = 'Salvando...';

    try {
        const url    = editingId ? `${API_URL}/vendas/${editingId}` : `${API_URL}/vendas`;
        const method = editingId ? 'PUT' : 'POST';

        const res = await fetch(url, { method, headers: getHeaders(), body: JSON.stringify(payload) });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.error || 'Erro ao salvar');
        }

        showMessage(editingId ? 'Venda atualizada!' : 'Venda registrada!', 'success');
        closeFormModal();
        await loadVendas();
    } catch (e) {
        showMessage('Erro: ' + e.message, 'error');
    } finally {
        btnSave.disabled    = false;
        btnSave.textContent = 'Salvar';
    }
}

function promptDelete(id) {
    editingId = id;
    deleteVenda();
}

async function deleteVenda() {
    if (!editingId) return;
    if (!confirm('Deseja excluir esta venda?')) return;

    try {
        const res = await fetch(`${API_URL}/vendas/${editingId}`, {
            method: 'DELETE', headers: getHeaders()
        });
        if (!res.ok) throw new Error('Erro ao excluir');
        showMessage('Venda excluída.', 'success');
        closeFormModal();
        await loadVendas();
    } catch (e) {
        showMessage('Erro: ' + e.message, 'error');
    } finally {
        editingId = null;
    }
}

// ── HELPERS ───────────────────────────────────────────────────
function formatMoeda(valor) {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valor || 0);
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('pt-BR');
}

function escHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showMessage(message, type = 'success') {
    const div = document.createElement('div');
    div.className   = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 2500);
}

// Fechar modal ao clicar fora / ESC
document.addEventListener('click',   e => { if (e.target.id === 'formModal') closeFormModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeFormModal(); });
