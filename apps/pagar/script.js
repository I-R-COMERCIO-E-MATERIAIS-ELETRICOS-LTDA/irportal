// ============================================
// CONFIGURAÇÃO
// ============================================
const API_URL = window.location.origin + '/api';

let contas = [];
let isOnline = false;
let sessionToken = null;
let currentMonth = new Date();

let formType = 'simple';
let currentGrupoId = null;
let parcelasDoGrupo = [];
let observacoesArray = [];
let tentativasReconexao = 0;
const MAX_TENTATIVAS = 3;

const meses = [
    'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
    'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

// ============================================
// CALENDÁRIO (integrado)
// ============================================
window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    if (modal.style.display === 'flex') modal.style.display = 'none';
    else { renderCalendarMonths(); modal.style.display = 'flex'; }
};
function renderCalendarMonths() {
    const year = currentMonth.getFullYear();
    document.getElementById('calendarYear').textContent = year;
    const container = document.getElementById('calendarMonths');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 12; i++) {
        const div = document.createElement('div');
        div.className = 'calendar-month';
        if (i === currentMonth.getMonth() && year === currentMonth.getFullYear()) div.classList.add('current');
        div.textContent = meses[i];
        div.onclick = () => { currentMonth.setMonth(i); currentMonth.setFullYear(year); updateDisplay(); window.toggleCalendar(); };
        container.appendChild(div);
    }
}
window.changeCalendarYear = function(delta) {
    currentMonth.setFullYear(currentMonth.getFullYear() + delta);
    renderCalendarMonths();
};

// ============================================
// AUTENTICAÇÃO (SESSION TOKEN)
// ============================================
function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');
    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('contasPagarSession', tokenFromUrl);
        sessionStorage.setItem('contasPagarSessionTime', Date.now().toString());
        window.history.replaceState({}, document.title, window.location.pathname);
        console.log('✅ Token recebido da URL');
    } else {
        sessionToken = sessionStorage.getItem('contasPagarSession');
        const sessionTime = sessionStorage.getItem('contasPagarSessionTime');
        if (sessionTime && sessionToken) {
            const hoursElapsed = (Date.now() - parseInt(sessionTime)) / (1000 * 60 * 60);
            if (hoursElapsed > 24) {
                console.log('⏰ Sessão expirada (>24h)');
                sessionToken = null;
            } else {
                console.log(`✅ Sessão válida (${hoursElapsed.toFixed(1)}h)`);
            }
        }
    }
    if (!sessionToken) {
        console.log('⚠️ Sem token - Modo offline apenas com cache');
        showMessage('Sessão não encontrada. Acesse via link autorizado.', 'warning');
    }
    inicializarApp();
}

function tratarErroAutenticacao(response) {
    if (response && response.status === 401) {
        console.log('❌ Token inválido ou sessão expirada (401)');
        tentativasReconexao++;
        if (tentativasReconexao < MAX_TENTATIVAS) {
            console.log(`🔄 Tentativa ${tentativasReconexao} de ${MAX_TENTATIVAS} - aguardando 2s...`);
            setTimeout(() => checkServerStatus(), 2000);
            return true;
        } else {
            console.log('❌ Máximo de tentativas - Modo offline');
            isOnline = false;
            showMessage('Sessão expirada. Recarregue a página com um token válido.', 'error');
            return true;
        }
    }
    return false;
}

function checkServerStatus() {
    if (!sessionToken) {
        isOnline = false;
        return Promise.resolve(false);
    }
    return fetch(`${API_URL}/contas`, {
        headers: { 'X-Session-Token': sessionToken }
    })
    .then(response => {
        if (tratarErroAutenticacao(response)) {
            isOnline = false;
            return false;
        }
        isOnline = response.ok;
        if (isOnline) tentativasReconexao = 0;
        return isOnline;
    })
    .catch(() => { isOnline = false; return false; });
}

// ============================================
// NAVEGAÇÃO POR MESES
// ============================================
function updateDisplay() {
    const display = document.getElementById('currentMonth');
    if (display) display.textContent = `${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    updateDashboard();
    filterContas();
}
window.changeMonth = function(direction) {
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    updateDisplay();
};

// ============================================
// CARREGAMENTO DE DADOS (COM TOKEN)
// ============================================
async function loadContas() {
    if (!sessionToken) return;
    try {
        const response = await fetch(`${API_URL}/contas`, {
            headers: { 'X-Session-Token': sessionToken, 'Accept': 'application/json' }
        });
        if (tratarErroAutenticacao(response)) return;
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        contas = data;
        localStorage.setItem('contas_backup', JSON.stringify(contas));
        updateAllFilters();
        updateDashboard();
        filterContas();
        console.log(`✅ ${contas.length} contas carregadas`);
    } catch (err) {
        console.error('Erro ao carregar:', err);
        const backup = localStorage.getItem('contas_backup');
        if (backup) {
            contas = JSON.parse(backup);
            updateAllFilters();
            updateDashboard();
            filterContas();
            showMessage('Modo offline - últimos dados carregados', 'warning');
        }
    }
}

async function loadParcelasDoGrupo(grupoId) {
    if (!sessionToken || !grupoId) return [];
    try {
        const response = await fetch(`${API_URL}/contas/grupo/${grupoId}`, {
            headers: { 'X-Session-Token': sessionToken }
        });
        if (!response.ok) return [];
        return await response.json();
    } catch (e) { return []; }
}

function startPolling() {
    loadContas();
    setInterval(() => {
        if (isOnline) loadContas();
    }, 15000);
}

// ============================================
// DASHBOARD E VENCIDOS
// ============================================
function updateDashboard() {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const contasDoMes = contas.filter(c => {
        const dv = new Date(c.data_vencimento+'T00:00:00');
        return dv.getMonth()===currentMonth.getMonth() && dv.getFullYear()===currentMonth.getFullYear();
    });
    const valorPago = contasDoMes.filter(c=>c.status==='PAGO').reduce((s,c)=>s+parseFloat(c.valor||0),0);
    const vencidas = contasDoMes.filter(c=>c.status!=='PAGO' && new Date(c.data_vencimento+'T00:00:00')<=hoje);
    const total = contasDoMes.reduce((s,c)=>s+parseFloat(c.valor||0),0);
    document.getElementById('statPagos').innerHTML = `R$ ${valorPago.toFixed(2).replace('.',',')}`;
    document.getElementById('statVencido').innerText = vencidas.length;
    document.getElementById('statPendente').innerHTML = `R$ ${(total-valorPago).toFixed(2).replace('.',',')}`;
    document.getElementById('statValorTotal').innerHTML = `R$ ${total.toFixed(2).replace('.',',')}`;
    const card = document.getElementById('cardVencido');
    const badge = document.getElementById('pulseBadge');
    if(vencidas.length>0) { card.classList.add('has-alert'); if(badge) badge.style.display='flex'; }
    else { card.classList.remove('has-alert'); if(badge) badge.style.display='none'; }
}

window.showVencidoModal = function() {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const contasDoMes = contas.filter(c=>{
        const dv = new Date(c.data_vencimento+'T00:00:00');
        return dv.getMonth()===currentMonth.getMonth() && dv.getFullYear()===currentMonth.getFullYear();
    });
    const vencidas = contasDoMes.filter(c=>c.status!=='PAGO' && new Date(c.data_vencimento+'T00:00:00')<=hoje).sort((a,b)=>new Date(a.data_vencimento)-new Date(b.data_vencimento));
    const body = document.getElementById('vencidoModalBody');
    if(vencidas.length===0) body.innerHTML = '<div style="text-align:center;padding:2rem;">Nenhuma conta vencida</div>';
    else {
        body.innerHTML = `<table style="width:100%"><thead><tr><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Dias</th></tr></thead><tbody>${vencidas.map(c=>{
            const dias = Math.floor((hoje - new Date(c.data_vencimento+'T00:00:00'))/(86400000));
            return `<td>${c.descricao}</td><td>${formatDate(c.data_vencimento)}</td><td>R$ ${parseFloat(c.valor).toFixed(2)}</td><td>${dias}</td></tr>`;
        }).join('')}</tbody></tr>`;
    }
    document.getElementById('vencidoModal').style.display = 'flex';
};
window.closeVencidoModal = () => { document.getElementById('vencidoModal').style.display = 'none'; };

// ============================================
// PDF
// ============================================
window.gerarPDF = function() {
    const dados = getDadosFiltrados();
    if(!dados.length) { showMessage('Nada para exportar','warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.text(`Contas a Pagar - ${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 14, 20);
    doc.autoTable({
        startY: 30,
        head: [['Descrição','Parcela','Valor','Vencimento','Banco','Data Pagamento']],
        body: dados.map(c=>[
            c.descricao,
            c.parcela_numero && c.parcela_total ? `${c.parcela_numero}/${c.parcela_total}` : '-',
            `R$ ${parseFloat(c.valor).toFixed(2)}`,
            formatDate(c.data_vencimento),
            c.banco||'-',
            c.data_pagamento ? formatDate(c.data_pagamento) : '-'
        ]),
        theme: 'striped'
    });
    doc.save(`contas_${currentMonth.getFullYear()}_${currentMonth.getMonth()+1}.pdf`);
    showMessage('PDF gerado','success');
};

function getDadosFiltrados() {
    const search = (document.getElementById('search')?.value||'').toLowerCase();
    const banco = document.getElementById('filterBanco')?.value||'';
    const status = document.getElementById('filterStatus')?.value||'';
    const pagamento = document.getElementById('filterPagamento')?.value||'';
    let lista = contas.filter(c=>{
        const dv = new Date(c.data_vencimento+'T00:00:00');
        return dv.getMonth()===currentMonth.getMonth() && dv.getFullYear()===currentMonth.getFullYear();
    });
    if(banco) lista = lista.filter(c=>c.banco===banco);
    if(pagamento) lista = lista.filter(c=>c.forma_pagamento===pagamento);
    if(status) {
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        lista = lista.filter(c=>{
            if(status==='PAGO') return c.status==='PAGO';
            if(status==='VENCIDO') return c.status!=='PAGO' && new Date(c.data_vencimento+'T00:00:00')<=hoje;
            if(status==='PENDENTE') return c.status!=='PAGO' && new Date(c.data_vencimento+'T00:00:00')>hoje;
            return true;
        });
    }
    if(search) lista = lista.filter(c=>c.descricao.toLowerCase().includes(search));
    return lista.sort((a,b)=>new Date(a.data_vencimento)-new Date(b.data_vencimento));
}

window.sincronizarDados = async () => { showMessage('Sincronizando...','info'); await loadContas(); showMessage('Sincronizado','success'); };

// ============================================
// FILTROS
// ============================================
function updateAllFilters() {
    const bancos = [...new Set(contas.map(c=>c.banco).filter(Boolean))];
    const selBanco = document.getElementById('filterBanco');
    if(selBanco) {
        let old = selBanco.value;
        selBanco.innerHTML = '<option value="">Todos os Bancos</option>'+bancos.map(b=>`<option value="${b}">${b}</option>`).join('');
        selBanco.value = old;
    }
    const formas = [...new Set(contas.map(c=>c.forma_pagamento).filter(Boolean))];
    const selForma = document.getElementById('filterPagamento');
    if(selForma) {
        let old = selForma.value;
        selForma.innerHTML = '<option value="">Todas Formas</option>'+formas.map(f=>`<option value="${f}">${f}</option>`).join('');
        selForma.value = old;
    }
}
function filterContas() {
    const lista = getDadosFiltrados();
    renderContas(lista);
}
function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if(!container) return;
    if(lista.length===0) { container.innerHTML = '<div style="text-align:center;padding:2rem;">Nenhuma conta neste período</div>'; return; }
    const html = `<table><thead><tr><th style="width:60px;">✓</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Parcela</th><th>Banco</th><th>Data Pagamento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${
        lista.map(c=>{
            const parc = c.parcela_numero ? `${c.parcela_numero}/${c.parcela_total}` : '-';
            const statusBadge = `<span class="badge ${c.status==='PAGO'?'pago':c.status==='VENCIDO'?'vencido':'pendente'}">${c.status==='PAGO'?'Pago':c.status==='VENCIDO'?'Vencido':'Pendente'}</span>`;
            return `<tr data-conta-id="${c.id}" class="${c.status==='PAGO'?'row-pago':''}">
                <td style="text-align:center;"><button class="check-btn ${c.status==='PAGO'?'checked':''}" data-action="toggle" data-id="${c.id}" onclick="event.stopPropagation()"></button></td>
                <td>${c.descricao}</td>
                <td><strong>R$ ${parseFloat(c.valor).toFixed(2)}</strong></td>
                <td>${formatDate(c.data_vencimento)}</td>
                <td style="text-align:center;">${parc}</td>
                <td>${c.banco||'-'}</td>
                <td>${c.data_pagamento?formatDate(c.data_pagamento):'-'}</td>
                <td>${statusBadge}</td>
                <td class="actions-cell"><button class="action-btn edit" data-action="edit" data-id="${c.id}" onclick="event.stopPropagation()">Editar</button><button class="action-btn delete" data-action="delete" data-id="${c.id}" onclick="event.stopPropagation()">Excluir</button></td>
            </tr>`;
        }).join('')
    }</tbody></table>`;
    container.innerHTML = html;
}

// ============================================
// FORMULÁRIO E CRUD (com token)
// ============================================
window.showFormModal = async function(editingId=null) {
    const isEditing = editingId && editingId!=='null';
    let conta = null;
    if(isEditing) {
        conta = contas.find(c=>String(c.id)===String(editingId));
        if(!conta) { showMessage('Conta não encontrada','error'); return; }
        if(conta.grupo_id) { currentGrupoId = conta.grupo_id; parcelasDoGrupo = await loadParcelasDoGrupo(conta.grupo_id); }
        else { currentGrupoId = null; parcelasDoGrupo = [conta]; }
        try { observacoesArray = conta.observacoes ? JSON.parse(conta.observacoes) : []; } catch(e){ observacoesArray = []; }
    } else {
        currentGrupoId = null; parcelasDoGrupo = []; observacoesArray = [];
    }
    formType = isEditing ? 'edit' : 'simple';
    const temParcelas = isEditing && conta?.grupo_id && parcelasDoGrupo.length>1;
    const modalHTML = `
        <div class="modal-overlay" id="formModal">
            <div class="modal-content modal-large">
                <button class="modal-close-x" onclick="window.closeFormModal()">✕</button>
                <div class="modal-header"><h3>${isEditing ? 'Editar Conta' : 'Nova Conta'}</h3></div>
                ${!isEditing ? `<div class="form-type-selector"><button type="button" class="form-type-btn active" onclick="window.selectFormType('simple')">Simples</button><button type="button" class="form-type-btn" onclick="window.selectFormType('parcelado')">Parcelado</button></div>` : ''}
                <form id="contaForm" onsubmit="window.handleFormSubmit(event, ${isEditing})">
                    <input type="hidden" id="observacoesData" value='${JSON.stringify(observacoesArray)}'>
                    ${isEditing ? `<input type="hidden" id="editId" value="${editingId}"><input type="hidden" id="grupoId" value="${currentGrupoId||''}">` : ''}
                    <div class="tabs-container">
                        <div class="tabs-nav">
                            ${isEditing && temParcelas ? `<button type="button" class="tab-btn active" onclick="window.switchFormTab(0)">Dados Gerais</button>${parcelasDoGrupo.map((p,idx)=>`<button type="button" class="tab-btn" onclick="window.switchFormTab(${idx+1})">${p.parcela_numero}ª Parcela</button>`).join('')}<button type="button" class="tab-btn" onclick="window.switchFormTab(${parcelasDoGrupo.length+1})">Observações</button>` : `<button type="button" class="tab-btn active" onclick="window.switchFormTab(0)">Dados</button><button type="button" class="tab-btn" onclick="window.switchFormTab(1)">Pagamento</button><button type="button" class="tab-btn" onclick="window.switchFormTab(2)">Observações</button>`}
                        </div>
                        ${isEditing && temParcelas ? renderEditFormComParcelas(conta) : renderEditFormSimples(conta, isEditing)}
                    </div>
                    <div class="modal-actions"><button type="submit" class="save">${isEditing ? 'Atualizar' : 'Salvar'}</button><button type="button" class="secondary" onclick="window.closeFormModal()">Cancelar</button></div>
                </form>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
    setTimeout(()=>document.getElementById('formModal').classList.add('show'),10);
    setTimeout(()=>applyUppercaseFields(),100);
};

function renderEditFormSimples(conta, isEditing) {
    const obsHTML = observacoesArray.length ? observacoesArray.map((o,i)=>`<div class="observacao-item"><div class="observacao-header"><span>${new Date(o.timestamp).toLocaleString('pt-BR')}</span><button type="button" onclick="window.removerObservacao(${i})">✕</button></div><p>${o.texto}</p></div>`).join('') : '<p>Nenhuma observação</p>';
    return `
        <div class="tab-content active" id="tab-dados">
            <div class="form-row"><div class="form-group"><label>Documento</label><input type="text" id="documento" value="${conta?.documento||''}"></div><div class="form-group"><label>Descrição *</label><input type="text" id="descricao" value="${conta?.descricao||''}" required></div></div>
            <div id="formSimple" ${formType==='parcelado'?'style="display:none"':''}>
                <div class="form-row"><div class="form-group"><label>Valor (R$) *</label><input type="number" id="valor" step="0.01" value="${conta?.valor||''}" required></div>
                <div class="form-group"><label>Vencimento *</label><input type="date" id="data_vencimento" value="${conta?.data_vencimento||''}" required></div></div>
            </div>
            <div id="formParcelado" ${formType!=='parcelado'?'style="display:none"':''}>
                <div class="form-row"><div class="form-group"><label>Nº Parcelas</label><input type="number" id="numParcelas" min="2" onchange="window.generateParcelas()"></div>
                <div class="form-group"><label>Valor Total</label><input type="number" id="valorTotal" step="0.01" onchange="window.generateParcelas()"></div>
                <div class="form-group"><label>Data Início</label><input type="date" id="dataInicio" onchange="window.generateParcelas()"></div></div>
                <div id="parcelasContainer"></div>
            </div>
        </div>
        <div class="tab-content" id="tab-pagamento">
            <div class="form-row"><div class="form-group"><label>Forma Pagamento *</label><select id="forma_pagamento" required>${['','PIX','BOLETO','CARTAO','DINHEIRO','TRANSFERENCIA'].map(opt=>`<option value="${opt}" ${conta?.forma_pagamento===opt?'selected':''}>${opt||'Selecione'}</option>`).join('')}</select></div>
            <div class="form-group"><label>Banco *</label><select id="banco" required>${['','BANCO DO BRASIL','BRADESCO','SICOOB'].map(opt=>`<option value="${opt}" ${conta?.banco===opt?'selected':''}>${opt||'Selecione'}</option>`).join('')}</select></div>
            <div class="form-group"><label>Data Pagamento</label><input type="date" id="data_pagamento" value="${conta?.data_pagamento||''}"></div></div>
        </div>
        <div class="tab-content" id="tab-observacoes">
            <div class="observacoes-container"><div class="observacoes-list" id="observacoesList">${obsHTML}</div>
            <textarea id="novaObservacao" rows="2" placeholder="Nova observação"></textarea><button type="button" onclick="window.adicionarObservacao()">Adicionar</button></div>
        </div>
    `;
}

function renderEditFormComParcelas(conta) {
    const obsHTML = observacoesArray.length ? observacoesArray.map((o,i)=>`<div class="observacao-item"><div class="observacao-header"><span>${new Date(o.timestamp).toLocaleString('pt-BR')}</span><button type="button" onclick="window.removerObservacao(${i})">✕</button></div><p>${o.texto}</p></div>`).join('') : '<p>Nenhuma observação</p>';
    return `
        <div class="tab-content active" id="tab-dados-gerais">
            <div class="form-row"><div class="form-group"><label>Documento</label><input type="text" id="documento" value="${conta?.documento||''}"></div>
            <div class="form-group"><label>Descrição *</label><input type="text" id="descricao" value="${conta?.descricao||''}" required></div></div>
        </div>
        ${parcelasDoGrupo.map((p,idx)=>`
            <div class="tab-content" id="tab-parcela-${idx}">
                <div class="form-row"><div class="form-group"><label>Forma Pagamento</label><select id="parcela_forma_pagamento_${p.id}" class="parcela-field" data-parcela-id="${p.id}" required>${['','PIX','BOLETO','CARTAO','DINHEIRO','TRANSFERENCIA'].map(opt=>`<option value="${opt}" ${p.forma_pagamento===opt?'selected':''}>${opt||'Selecione'}</option>`).join('')}</select></div>
                <div class="form-group"><label>Banco</label><select id="parcela_banco_${p.id}" class="parcela-field" data-parcela-id="${p.id}" required>${['','BANCO DO BRASIL','BRADESCO','SICOOB'].map(opt=>`<option value="${opt}" ${p.banco===opt?'selected':''}>${opt||'Selecione'}</option>`).join('')}</select></div></div>
                <div class="form-row"><div class="form-group"><label>Vencimento</label><input type="date" id="parcela_vencimento_${p.id}" class="parcela-field" value="${p.data_vencimento}" required></div>
                <div class="form-group"><label>Valor</label><input type="number" step="0.01" id="parcela_valor_${p.id}" class="parcela-field" value="${p.valor}" required></div>
                <div class="form-group"><label>Data Pagamento</label><input type="date" id="parcela_pagamento_${p.id}" class="parcela-field" value="${p.data_pagamento||''}"></div></div>
            </div>
        `).join('')}
        <div class="tab-content" id="tab-observacoes-final">
            <div class="observacoes-container"><div class="observacoes-list" id="observacoesList">${obsHTML}</div>
            <textarea id="novaObservacao" rows="2" placeholder="Nova observação"></textarea><button type="button" onclick="window.adicionarObservacao()">Adicionar</button></div>
        </div>
    `;
}

window.switchFormTab = function(idx) {
    document.querySelectorAll('#formModal .tab-btn').forEach((btn,i)=>btn.classList.toggle('active',i===idx));
    document.querySelectorAll('#formModal .tab-content').forEach((c,i)=>c.classList.toggle('active',i===idx));
};
window.adicionarObservacao = function() {
    const txt = document.getElementById('novaObservacao')?.value.trim();
    if(!txt) return;
    const field = document.getElementById('observacoesData');
    let obs = JSON.parse(field.value||'[]');
    obs.push({ texto: txt, timestamp: new Date().toISOString() });
    field.value = JSON.stringify(obs);
    document.getElementById('novaObservacao').value = '';
    atualizarListaObservacoes();
};
window.removerObservacao = function(idx) {
    const field = document.getElementById('observacoesData');
    let obs = JSON.parse(field.value||'[]');
    obs.splice(idx,1);
    field.value = JSON.stringify(obs);
    atualizarListaObservacoes();
};
function atualizarListaObservacoes() {
    const container = document.getElementById('observacoesList');
    if(!container) return;
    const obs = JSON.parse(document.getElementById('observacoesData')?.value||'[]');
    if(obs.length===0) container.innerHTML = '<p>Nenhuma observação</p>';
    else container.innerHTML = obs.map((o,i)=>`<div class="observacao-item"><div class="observacao-header"><span>${new Date(o.timestamp).toLocaleString('pt-BR')}</span><button type="button" onclick="window.removerObservacao(${i})">✕</button></div><p>${o.texto}</p></div>`).join('');
}
window.selectFormType = function(type) {
    formType = type;
    document.querySelectorAll('.form-type-btn').forEach(btn=>btn.classList.remove('active'));
    event.target.classList.add('active');
    document.getElementById('formSimple').style.display = type==='simple'?'block':'none';
    document.getElementById('formParcelado').style.display = type==='parcelado'?'block':'none';
};
window.generateParcelas = function() {
    const num = parseInt(document.getElementById('numParcelas')?.value);
    const total = parseFloat(document.getElementById('valorTotal')?.value);
    const inicio = document.getElementById('dataInicio')?.value;
    const container = document.getElementById('parcelasContainer');
    if(!num||!total||!inicio||num<2) { container.innerHTML=''; return; }
    const valorParc = total/num;
    let html = '<div class="parcelas-preview"><h4>Parcelas:</h4>';
    for(let i=0;i<num;i++) {
        const dt = new Date(inicio+'T00:00:00');
        dt.setMonth(dt.getMonth()+i);
        html += `<div class="parcela-item"><span>${i+1}ª</span><span>${dt.toLocaleDateString('pt-BR')}</span><span>R$ ${valorParc.toFixed(2)}</span></div>`;
    }
    html += '</div>';
    container.innerHTML = html;
};
window.handleFormSubmit = function(e, isEditing) {
    e.preventDefault();
    if(isEditing) handleEditSubmit();
    else handleCreateSubmit();
};
async function handleCreateSubmit() {
    if(formType==='parcelado') await salvarParcelado();
    else await salvarSimples();
}
async function salvarSimples() {
    if(!sessionToken && isOnline) { showMessage('Sessão expirada','error'); return; }
    const desc = document.getElementById('descricao')?.value.trim();
    const val = document.getElementById('valor')?.value;
    const venc = document.getElementById('data_vencimento')?.value;
    const forma = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    if(!desc||!val||!venc||!forma||!banco) { showMessage('Preencha todos os campos','error'); return; }
    const data = {
        documento: document.getElementById('documento')?.value.trim()||null,
        descricao: desc,
        valor: parseFloat(val),
        data_vencimento: venc,
        forma_pagamento: forma,
        banco: banco,
        data_pagamento: document.getElementById('data_pagamento')?.value||null,
        observacoes: document.getElementById('observacoesData')?.value||'[]',
        status: document.getElementById('data_pagamento')?.value ? 'PAGO' : 'PENDENTE'
    };
    try {
        const resp = await fetch(`${API_URL}/contas`, {
            method:'POST',
            headers:{'Content-Type':'application/json','X-Session-Token':sessionToken},
            body:JSON.stringify(data)
        });
        if(resp.status===401) { tratarErroAutenticacao(resp); return; }
        if(!resp.ok) throw new Error();
        const saved = await resp.json();
        contas.push(saved);
        localStorage.setItem('contas_backup', JSON.stringify(contas));
        updateAllFilters(); updateDashboard(); filterContas();
        window.closeFormModal();
        showMessage('Conta salva','success');
    } catch(e) { showMessage('Erro ao salvar','error'); }
}
async function salvarParcelado() {
    if(!sessionToken && isOnline) { showMessage('Sessão expirada','error'); return; }
    const desc = document.getElementById('descricao')?.value.trim();
    const num = parseInt(document.getElementById('numParcelas')?.value);
    const total = parseFloat(document.getElementById('valorTotal')?.value);
    const inicio = document.getElementById('dataInicio')?.value;
    const forma = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    if(!desc||!num||!total||!inicio||!forma||!banco) { showMessage('Preencha todos','error'); return; }
    const valorParc = total/num;
    const grupoId = generateUUID();
    let ok=0;
    for(let i=0;i<num;i++) {
        const dt = new Date(inicio+'T00:00:00');
        dt.setMonth(dt.getMonth()+i);
        const parc = {
            documento: document.getElementById('documento')?.value.trim()||null,
            descricao: desc,
            valor: valorParc,
            data_vencimento: dt.toISOString().split('T')[0],
            forma_pagamento: forma,
            banco: banco,
            data_pagamento: null,
            observacoes: document.getElementById('observacoesData')?.value||'[]',
            status: 'PENDENTE',
            parcela_numero: i+1,
            parcela_total: num,
            grupo_id: grupoId
        };
        try {
            const resp = await fetch(`${API_URL}/contas`, {
                method:'POST',
                headers:{'Content-Type':'application/json','X-Session-Token':sessionToken},
                body:JSON.stringify(parc)
            });
            if(resp.status===401) { tratarErroAutenticacao(resp); return; }
            if(resp.ok) { ok++; const saved=await resp.json(); contas.push(saved); }
        } catch(e) {}
    }
    localStorage.setItem('contas_backup', JSON.stringify(contas));
    updateAllFilters(); updateDashboard(); filterContas();
    window.closeFormModal();
    showMessage(`${ok}/${num} parcelas salvas`,'success');
}
async function handleEditSubmit() {
    const editId = document.getElementById('editId')?.value;
    const temParcelas = parcelasDoGrupo.length>1;
    if(temParcelas) await editarParcelas();
    else await editarSimples(editId);
}
async function editarSimples(id) {
    if(!sessionToken && isOnline) { showMessage('Sessão expirada','error'); return; }
    const desc = document.getElementById('descricao')?.value.trim();
    const val = document.getElementById('valor')?.value;
    const venc = document.getElementById('data_vencimento')?.value;
    const forma = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    if(!desc||!val||!venc||!forma||!banco) { showMessage('Preencha todos','error'); return; }
    const data = {
        documento: document.getElementById('documento')?.value.trim()||null,
        descricao: desc,
        valor: parseFloat(val),
        data_vencimento: venc,
        forma_pagamento: forma,
        banco: banco,
        data_pagamento: document.getElementById('data_pagamento')?.value||null,
        observacoes: document.getElementById('observacoesData')?.value||'[]',
        status: document.getElementById('data_pagamento')?.value ? 'PAGO' : 'PENDENTE'
    };
    try {
        const resp = await fetch(`${API_URL}/contas/${id}`, {
            method:'PUT',
            headers:{'Content-Type':'application/json','X-Session-Token':sessionToken},
            body:JSON.stringify(data)
        });
        if(resp.status===401) { tratarErroAutenticacao(resp); return; }
        if(!resp.ok) throw new Error();
        const updated = await resp.json();
        const idx = contas.findIndex(c=>String(c.id)===String(id));
        if(idx!==-1) contas[idx]=updated;
        localStorage.setItem('contas_backup', JSON.stringify(contas));
        updateAllFilters(); updateDashboard(); filterContas();
        window.closeFormModal();
        showMessage('Atualizado','success');
    } catch(e) { showMessage('Erro ao atualizar','error'); }
}
async function editarParcelas() {
    if(!sessionToken && isOnline) { showMessage('Sessão expirada','error'); return; }
    const desc = document.getElementById('descricao')?.value.trim();
    const doc = document.getElementById('documento')?.value.trim()||null;
    const obs = document.getElementById('observacoesData')?.value||'[]';
    if(!desc) { showMessage('Descrição obrigatória','error'); return; }
    let erros=0;
    for(const p of parcelasDoGrupo) {
        const venc = document.getElementById(`parcela_vencimento_${p.id}`)?.value;
        const val = document.getElementById(`parcela_valor_${p.id}`)?.value;
        const forma = document.getElementById(`parcela_forma_pagamento_${p.id}`)?.value;
        const banco = document.getElementById(`parcela_banco_${p.id}`)?.value;
        const pag = document.getElementById(`parcela_pagamento_${p.id}`)?.value;
        if(!venc||!val||!forma||!banco) continue;
        const data = {
            documento: doc, descricao: desc, observacoes: obs,
            valor: parseFloat(val), data_vencimento: venc,
            forma_pagamento: forma, banco: banco,
            data_pagamento: pag||null,
            status: pag ? 'PAGO' : 'PENDENTE',
            parcela_numero: p.parcela_numero, parcela_total: parcelasDoGrupo.length
        };
        try {
            const resp = await fetch(`${API_URL}/contas/${p.id}`, {
                method:'PUT',
                headers:{'Content-Type':'application/json','X-Session-Token':sessionToken},
                body:JSON.stringify(data)
            });
            if(resp.status===401) { tratarErroAutenticacao(resp); return; }
            if(resp.ok) { const upd = await resp.json(); const idx = contas.findIndex(c=>String(c.id)===String(p.id)); if(idx!==-1) contas[idx]=upd; }
            else erros++;
        } catch(e) { erros++; }
    }
    localStorage.setItem('contas_backup', JSON.stringify(contas));
    updateAllFilters(); updateDashboard(); filterContas();
    window.closeFormModal();
    showMessage(erros===0?'Parcelas atualizadas':`${erros} erro(s)`,'success');
}
window.closeFormModal = function() {
    const modal = document.getElementById('formModal');
    if(modal) { modal.classList.remove('show'); setTimeout(()=>modal.remove(),200); }
};
function applyUppercaseFields() {
    ['documento','descricao'].forEach(id=>{
        const el = document.getElementById(id);
        if(el) el.addEventListener('input', e=>{ e.target.value = e.target.value.toUpperCase(); });
    });
}

// ============================================
// TOGGLE, DELETE, VIEW
// ============================================
window.togglePago = async function(id) {
    const conta = contas.find(c=>String(c.id)===String(id));
    if(!conta) return;
    const novo = conta.status==='PAGO' ? 'PENDENTE' : 'PAGO';
    const novaData = novo==='PAGO' ? new Date().toISOString().split('T')[0] : null;
    const old = { status: conta.status, data: conta.data_pagamento };
    conta.status = novo;
    conta.data_pagamento = novaData;
    updateDashboard(); filterContas();
    if(sessionToken && isOnline) {
        try {
            const resp = await fetch(`${API_URL}/contas/${id}`, {
                method:'PATCH',
                headers:{'Content-Type':'application/json','X-Session-Token':sessionToken},
                body:JSON.stringify({ status: novo, data_pagamento: novaData })
            });
            if(resp.status===401) { tratarErroAutenticacao(resp); throw new Error('401'); }
            if(!resp.ok) throw new Error();
            const updated = await resp.json();
            const idx = contas.findIndex(c=>String(c.id)===String(id));
            if(idx!==-1) contas[idx]=updated;
            localStorage.setItem('contas_backup', JSON.stringify(contas));
            showMessage(`Conta ${novo==='PAGO'?'paga':'pendente'}`,'success');
        } catch(e) {
            conta.status = old.status; conta.data_pagamento = old.data;
            updateDashboard(); filterContas();
            showMessage('Erro ao alternar','error');
        }
    } else {
        showMessage('Offline - status não sincronizado','warning');
    }
};
window.deleteConta = async function(id) {
    if(!confirm('Excluir esta conta?')) return;
    const idx = contas.findIndex(c=>String(c.id)===String(id));
    if(idx===-1) return;
    const excluida = contas[idx];
    contas.splice(idx,1);
    updateAllFilters(); updateDashboard(); filterContas();
    if(sessionToken && isOnline) {
        try {
            const resp = await fetch(`${API_URL}/contas/${id}`, { method:'DELETE', headers:{'X-Session-Token':sessionToken} });
            if(resp.status===401) { tratarErroAutenticacao(resp); throw new Error('401'); }
            if(!resp.ok) throw new Error();
            localStorage.setItem('contas_backup', JSON.stringify(contas));
            showMessage('Excluída','error');
        } catch(e) {
            contas.push(excluida);
            updateAllFilters(); updateDashboard(); filterContas();
            showMessage('Erro ao excluir','error');
        }
    } else {
        localStorage.setItem('contas_backup', JSON.stringify(contas));
        showMessage('Excluída localmente','warning');
    }
};
window.viewConta = function(id) {
    const c = contas.find(c=>String(c.id)===String(id));
    if(!c) return;
    const parcelaInfo = c.parcela_numero ? `<div><strong>Parcela:</strong> ${c.parcela_numero}/${c.parcela_total}</div>` : '';
    let obsHtml = '';
    try {
        const arr = JSON.parse(c.observacoes||'[]');
        if(arr.length) obsHtml = `<div><strong>Obs.:</strong><br>${arr.map(o=>`<small>${new Date(o.timestamp).toLocaleString('pt-BR')}</small><br>${o.texto}<br>`).join('')}</div>`;
    } catch(e){ obsHtml = `<div><strong>Obs.:</strong> ${c.observacoes}</div>`; }
    const modal = `<div class="modal-overlay" id="viewModal"><div class="modal-content modal-view"><button class="modal-close-x" onclick="window.closeViewModal()">✕</button><h3>Detalhes</h3><div><div><strong>Descrição:</strong> ${c.descricao}</div>${parcelaInfo}<div><strong>Valor:</strong> R$ ${parseFloat(c.valor).toFixed(2)}</div><div><strong>Vencimento:</strong> ${formatDate(c.data_vencimento)}</div><div><strong>Forma:</strong> ${c.forma_pagamento}</div><div><strong>Banco:</strong> ${c.banco}</div><div><strong>Status:</strong> ${c.status}</div>${obsHtml}</div><div class="modal-actions"><button class="secondary" onclick="window.closeViewModal()">Fechar</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modal);
    document.getElementById('viewModal').style.display = 'flex';
};
window.closeViewModal = () => { document.getElementById('viewModal')?.remove(); };
window.editConta = (id) => window.showFormModal(id);

// ============================================
// UTILITÁRIOS E INICIALIZAÇÃO
// ============================================
function formatDate(ds) { if(!ds) return '-'; return new Date(ds+'T00:00:00').toLocaleDateString('pt-BR'); }
function showMessage(msg, type) {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(()=>{ div.style.animation='slideOutBottom 0.3s forwards'; setTimeout(()=>div.remove(),300); },3000);
}
function generateUUID() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{ const r=Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8); return v.toString(16); }); }

function inicializarApp() {
    updateDisplay();
    checkServerStatus().then(() => {
        if (sessionToken && isOnline) startPolling();
        else loadContas(); // tenta mesmo offline (cache)
    });
}

document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if(btn) {
            e.stopPropagation();
            const act = btn.dataset.action;
            const id = btn.dataset.id;
            if(act==='view') window.viewConta(id);
            else if(act==='edit') window.editConta(id);
            else if(act==='delete') window.deleteConta(id);
            else if(act==='toggle') window.togglePago(id);
            else if(act==='new-conta') window.showFormModal(null);
            return;
        }
        const row = e.target.closest('tr[data-conta-id]');
        if(row && !e.target.closest('.action-btn') && !e.target.closest('.check-btn')) {
            window.viewConta(row.dataset.contaId);
        }
    });
    verificarAutenticacao();
});
