// ============================================
// TRANSPORTADORAS - script.js
// ============================================
const PORTAL_URL = window.location.origin;
const API_URL = `${window.location.origin}/api`;
let transportadoras = [];
let editingId = null;
let sessionToken = null;
let currentUser = null;
let currentTab = 0;
const tabs = ['tab-geral', 'tab-atendimento'];
let pendingDeleteId = null;
const REGIOES_LISTA = ['NORTE', 'NORDESTE', 'SUDESTE', 'SUL', 'CENTRO-OESTE'];
const ESTADOS_LISTA = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

document.addEventListener('DOMContentLoaded', () => { verificarAutenticacao(); });

async function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) { sessionToken = tokenFromUrl; sessionStorage.setItem('transpSession', tokenFromUrl); window.history.replaceState({}, document.title, window.location.pathname); }
    else { sessionToken = sessionStorage.getItem('transpSession'); }
    if (!sessionToken) { mostrarTelaAcessoNegado(); return; }
    try {
        const verifyRes = await fetch(`${PORTAL_URL}/api/verify-session`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionToken }) });
        if (verifyRes.ok) {
            const sessionData = await verifyRes.json();
            if (sessionData.valid && sessionData.session) { currentUser = sessionData.session; sessionStorage.setItem('transpUserData', JSON.stringify(currentUser)); }
            else { mostrarTelaAcessoNegado('Sua sessão expirou'); return; }
        }
    } catch (e) { try { const userData = sessionStorage.getItem('transpUserData'); if (userData) currentUser = JSON.parse(userData); } catch (e2) {} }
    inicializarApp();
}
function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') { document.body.innerHTML = `<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;"><h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1><p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p><a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">Ir para o Portal</a></div>`; }
function inicializarApp() { loadTransportadoras(); setInterval(() => loadTransportadoras(), 30000); }
function showMessage(message, type = 'success') { const div = document.createElement('div'); div.className = `floating-message ${type}`; div.textContent = message; document.body.appendChild(div); setTimeout(() => { div.style.animation = 'slideOutBottom 0.3s ease forwards'; setTimeout(() => div.remove(), 300); }, 2000); }

async function loadTransportadoras() {
    try {
        const response = await fetch(`${API_URL}/transportadoras`, { headers: { 'X-Session-Token': sessionToken }, cache: 'no-cache' });
        if (response.status === 401) { sessionStorage.removeItem('transpSession'); mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU'); return; }
        if (!response.ok) return;
        transportadoras = await response.json();
        renderTable();
    } catch (e) {}
}
function filterTransportadoras() { renderTable(); }
function renderTable() {
    const container = document.getElementById('transportadorasContainer');
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    let filtered = transportadoras;
    if (search) { filtered = transportadoras.filter(t => (t.nome||'').toLowerCase().includes(search) || (t.representante||'').toLowerCase().includes(search) || (t.email||'').toLowerCase().includes(search) || (t.regioes||[]).join(' ').toLowerCase().includes(search) || (t.estados||[]).join(' ').toLowerCase().includes(search)); }
    if (filtered.length === 0) { container.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:2rem;">Nenhuma transportadora encontrada</td></tr>`; return; }
    container.innerHTML = filtered.map(t => `<tr><td><strong>${escapeHtml(t.nome)}</strong></td><td>${escapeHtml(t.representante||'-')}</td><td>${escapeHtml((t.telefones||[]).join(', ')||'-')}</td><td>${escapeHtml((t.celulares||[]).join(', ')||'-')}</td><td>${escapeHtml(t.email)}</td><td class="actions-cell"><div class="actions"><button onclick="editTransportadora('${t.id}')" class="action-btn edit" style="background:#6B7280;">Editar</button><button onclick="deleteTransportadora('${t.id}', '${escapeHtml(t.nome).replace(/'/g, "\\'")}')" class="action-btn delete" style="background:#EF4444;">Excluir</button></div></td></tr>`).join('');
}
function escapeHtml(str) { if (!str) return ''; return str.replace(/[&<>]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;'})[m]); }

// Navegação
function switchTab(tabId) { const index = tabs.indexOf(tabId); if (index!==-1) currentTab = index; document.querySelectorAll('#formModal .tab-btn').forEach(btn=>btn.classList.remove('active')); document.querySelectorAll('#formModal .tab-content').forEach(c=>c.classList.remove('active')); document.querySelectorAll('#formModal .tab-btn')[currentTab]?.classList.add('active'); document.querySelectorAll('#formModal .tab-content')[currentTab]?.classList.add('active'); updateNavButtons(); }
function nextTab() { if (currentTab < tabs.length-1) switchTab(tabs[currentTab+1]); }
function previousTab() { if (currentTab > 0) switchTab(tabs[currentTab-1]); }
function updateNavButtons() { const btnPrev = document.getElementById('btnPrevious'); const btnNext = document.getElementById('btnNext'); const btnSave = document.getElementById('btnSave'); if (btnPrev) btnPrev.style.display = currentTab===0?'none':'inline-flex'; if (btnNext) btnNext.style.display = currentTab===tabs.length-1?'none':'inline-flex'; if (btnSave) btnSave.style.display = 'inline-flex'; }

// Formulário
function openFormModal() { editingId = null; document.getElementById('formTitle').textContent = 'Nova Transportadora'; resetForm(); currentTab=0; switchTab('tab-geral'); updateNavButtons(); document.getElementById('formModal').classList.add('show'); }
function closeFormModal(showCancelMessage=false) { const modal = document.getElementById('formModal'); if (modal) { if (showCancelMessage) { const msg = editingId?'Atualização cancelada':'Registro cancelado'; showMessage(msg,'error'); } modal.classList.remove('show'); resetForm(); } }
function resetForm() { document.querySelectorAll('#formModal input:not([type="hidden"])').forEach(el=>el.value=''); renderRegioesSelectors([]); renderEstadosSelectors([]); }
function renderRegioesSelectors(selected) { const container = document.getElementById('regioesContainer'); if (!container) return; container.innerHTML = ''; REGIOES_LISTA.forEach(reg => { const btn = document.createElement('button'); btn.type='button'; btn.textContent=reg; btn.className='chip-selector'; if (selected.includes(reg)) btn.classList.add('selected'); btn.onclick = () => btn.classList.toggle('selected'); container.appendChild(btn); }); }
function renderEstadosSelectors(selected) { const container = document.getElementById('estadosContainer'); if (!container) return; container.innerHTML = ''; ESTADOS_LISTA.forEach(uf => { const btn = document.createElement('button'); btn.type='button'; btn.textContent=uf; btn.className='chip-selector'; if (selected.includes(uf)) btn.classList.add('selected'); btn.onclick = () => btn.classList.toggle('selected'); container.appendChild(btn); }); }
function getSelectedRegioes() { return Array.from(document.querySelectorAll('#regioesContainer .chip-selector.selected')).map(btn=>btn.textContent); }
function getSelectedEstados() { return Array.from(document.querySelectorAll('#estadosContainer .chip-selector.selected')).map(btn=>btn.textContent); }
function editTransportadora(id) { const t = transportadoras.find(x=>x.id===id); if (!t) return; editingId = id; document.getElementById('formTitle').textContent = `Editar: ${t.nome}`; document.getElementById('nome').value = t.nome||''; document.getElementById('representante').value = t.representante||''; document.getElementById('email').value = t.email||''; document.getElementById('telefones').value = (t.telefones||[]).join(', '); document.getElementById('celulares').value = (t.celulares||[]).join(', '); renderRegioesSelectors(t.regioes||[]); renderEstadosSelectors(t.estados||[]); currentTab=0; switchTab('tab-geral'); updateNavButtons(); document.getElementById('formModal').classList.add('show'); }
function parseArray(str) { if (!str||!str.trim()) return []; return str.split(',').map(s=>s.trim().toUpperCase()).filter(Boolean); }
async function saveTransportadora() { const nome = document.getElementById('nome').value.trim(); const email = document.getElementById('email').value.trim(); if (!nome||!email) { showMessage('Nome e e-mail são obrigatórios!','error'); return; } const payload = { nome: nome.toUpperCase(), representante: document.getElementById('representante').value.trim().toUpperCase(), email: email.toLowerCase(), telefones: parseArray(document.getElementById('telefones').value), celulares: parseArray(document.getElementById('celulares').value), regioes: getSelectedRegioes(), estados: getSelectedEstados() }; try { const url = editingId ? `${API_URL}/transportadoras/${editingId}` : `${API_URL}/transportadoras`; const method = editingId?'PUT':'POST'; const response = await fetch(url, { method, headers: { 'Content-Type':'application/json', 'X-Session-Token': sessionToken }, body: JSON.stringify(payload) }); if (!response.ok) throw new Error('Erro ao salvar'); await loadTransportadoras(); closeFormModal(false); const msg = editingId?`${payload.nome} atualizada`:`${payload.nome} registrada`; showMessage(msg,'success'); } catch (e) { showMessage('Erro ao salvar transportadora!','error'); } }

// Exclusão personalizada
function deleteTransportadora(id, nome) { pendingDeleteId = id; document.getElementById('deleteModalMessage').textContent = `Tem certeza que deseja excluir a transportadora "${nome}"?`; document.getElementById('deleteModal').classList.add('show'); const confirmBtn = document.getElementById('confirmDeleteBtn'); confirmBtn.className = 'danger'; const cancelBtn = document.querySelector('#deleteModal .modal-actions-no-border button:last-child'); if (cancelBtn) cancelBtn.className = 'success'; const newBtn = confirmBtn.cloneNode(true); confirmBtn.parentNode.replaceChild(newBtn, confirmBtn); newBtn.onclick = confirmDelete; }
function closeDeleteModal() { document.getElementById('deleteModal').classList.remove('show'); pendingDeleteId = null; }
async function confirmDelete() { if (!pendingDeleteId) return; try { const response = await fetch(`${API_URL}/transportadoras/${pendingDeleteId}`, { method:'DELETE', headers: { 'X-Session-Token': sessionToken } }); if (!response.ok) throw new Error('Erro ao excluir'); await loadTransportadoras(); const nome = transportadoras.find(t=>t.id===pendingDeleteId)?.nome||'Transportadora'; showMessage(`${nome} excluída`,'error'); closeDeleteModal(); } catch (e) { showMessage('Erro ao excluir transportadora!','error'); closeDeleteModal(); } }
