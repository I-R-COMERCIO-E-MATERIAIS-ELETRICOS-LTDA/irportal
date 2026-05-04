// ============================================
// CONFIGURAÇÃO
// ============================================
const API_URL = window.location.origin + '/api';

let contas = [];
let isOnline = true;
let currentMonth = new Date();

let formType = 'simple';
let numParcelas = 0;
let currentGrupoId = null;
let parcelasDoGrupo = [];
let observacoesArray = [];

const meses = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// ============================================
// FUNÇÕES DE CALENDÁRIO (antes ausentes)
// ============================================
window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    if (modal.style.display === 'flex') {
        modal.style.display = 'none';
    } else {
        renderCalendarMonths();
        modal.style.display = 'flex';
    }
};

function renderCalendarMonths() {
    const year = currentMonth.getFullYear();
    document.getElementById('calendarYear').textContent = year;
    const container = document.getElementById('calendarMonths');
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 12; i++) {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'calendar-month';
        if (i === currentMonth.getMonth() && year === currentMonth.getFullYear()) {
            monthDiv.classList.add('current');
        }
        monthDiv.textContent = meses[i];
        monthDiv.onclick = () => {
            currentMonth.setMonth(i);
            currentMonth.setFullYear(year);
            updateDisplay();
            window.toggleCalendar();
        };
        container.appendChild(monthDiv);
    }
}

window.changeCalendarYear = function(delta) {
    const newYear = currentMonth.getFullYear() + delta;
    currentMonth.setFullYear(newYear);
    renderCalendarMonths();
};

// ============================================
// NAVEGAÇÃO POR MESES
// ============================================
function updateDisplay() {
    const display = document.getElementById('currentMonth');
    if (display) {
        display.textContent = `${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
    }
    updateDashboard();
    filterContas();
}

window.changeMonth = function(direction) {
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    updateDisplay();
};

window.previousMonth = function() { window.changeMonth(-1); };
window.nextMonth = function() { window.changeMonth(1); };

// ============================================
// INICIALIZAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (btn) {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            e.stopPropagation();
            switch(action) {
                case 'view': window.viewConta(id); break;
                case 'edit': window.editConta(id); break;
                case 'delete': window.deleteConta(id); break;
                case 'toggle': window.togglePago(id); break;
                case 'new-conta': window.showFormModal(null); break;
                default: console.warn('Ação desconhecida:', action);
            }
            return;
        }
        const row = e.target.closest('tr[data-conta-id]');
        if (row && !e.target.closest('.action-btn') && !e.target.closest('.check-btn')) {
            const contaId = row.dataset.contaId;
            if (contaId) window.viewConta(contaId);
        }
    });
    updateDisplay();
    loadContas();
    startPolling();
});

function startPolling() {
    setInterval(() => {
        if (isOnline) loadContas();
    }, 10000);
}

// ============================================
// CARREGAMENTO DE DADOS
// ============================================
async function loadContas() {
    try {
        const response = await fetch(`${API_URL}/contas`, {
            method: 'GET',
            headers: { 'Accept': 'application/json' }
        });
        if (!response.ok) throw new Error('Erro ao carregar');
        const data = await response.json();
        contas = data;
        updateAllFilters();
        updateDashboard();
        filterContas();
    } catch (error) {
        console.error('Erro ao carregar contas:', error);
        isOnline = false;
    }
}

async function loadParcelasDoGrupo(grupoId) {
    if (!grupoId) return [];
    try {
        const response = await fetch(`${API_URL}/contas/grupo/${grupoId}`);
        if (!response.ok) return [];
        const data = await response.json();
        return data || [];
    } catch (error) {
        console.error('Erro ao carregar parcelas do grupo:', error);
        return [];
    }
}

// ============================================
// DASHBOARD
// ============================================
function updateDashboard() {
    const hoje = new Date();
    hoje.setHours(0,0,0,0);
    const contasDoMes = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    const valorPago = contasDoMes.filter(c => c.status === 'PAGO').reduce((sum,c) => sum + parseFloat(c.valor||0),0);
    const contasVencidas = contasDoMes.filter(c => {
        if (c.status === 'PAGO') return false;
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        dataVenc.setHours(0,0,0,0);
        return dataVenc <= hoje;
    });
    const qtdVencido = contasVencidas.length;
    const valorTotal = contasDoMes.reduce((sum,c) => sum + parseFloat(c.valor||0),0);
    const valorPendente = valorTotal - valorPago;
    document.getElementById('statPagos').textContent = `R$ ${valorPago.toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
    document.getElementById('statVencido').textContent = qtdVencido;
    document.getElementById('statPendente').textContent = `R$ ${valorPendente.toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
    document.getElementById('statValorTotal').textContent = `R$ ${valorTotal.toLocaleString('pt-BR',{minimumFractionDigits:2})}`;
    const cardVencido = document.getElementById('cardVencido');
    const pulseBadge = document.getElementById('pulseBadge');
    if (qtdVencido > 0) {
        cardVencido.classList.add('has-alert');
        if(pulseBadge) pulseBadge.style.display = 'flex';
    } else {
        cardVencido.classList.remove('has-alert');
        if(pulseBadge) pulseBadge.style.display = 'none';
    }
}

// ============================================
// MODAL DE VENCIDOS
// ============================================
window.showVencidoModal = function() {
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const contasDoMes = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    const contasVencidas = contasDoMes.filter(c => {
        if (c.status === 'PAGO') return false;
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        dataVenc.setHours(0,0,0,0);
        return dataVenc <= hoje;
    });
    contasVencidas.sort((a,b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
    const modal = document.getElementById('vencidoModal');
    const body = document.getElementById('vencidoModalBody');
    if (contasVencidas.length === 0) {
        body.innerHTML = `<div style="text-align:center;padding:3rem;"><p>Nenhuma conta vencida</p></div>`;
    } else {
        body.innerHTML = `<table style="width:100%"><thead><tr><th>Descrição</th><th>Vencimento</th><th>Valor</th><th>Dias</th></tr></thead><tbody>${contasVencidas.map(c => {
            const dias = Math.floor((hoje - new Date(c.data_vencimento+'T00:00:00')) / (86400000));
            return `<td>${c.descricao}</td><td>${formatDate(c.data_vencimento)}</td><td>R$ ${parseFloat(c.valor).toFixed(2)}</td><td>${dias}</td></tr>`;
        }).join('')}</tbody></table>`;
    }
    modal.style.display = 'flex';
};
window.closeVencidoModal = function() {
    const modal = document.getElementById('vencidoModal');
    if(modal) modal.style.display = 'none';
};

// ============================================
// PDF
// ============================================
window.gerarPDF = function() {
    const filtrados = getDadosFiltrados();
    if(!filtrados.length) { showMessage('Não há dados para o PDF','warning'); return; }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    doc.text('RELATÓRIO DE CONTAS A PAGAR', 14, 20);
    doc.text(`Período: ${meses[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`, 14, 28);
    const tableData = filtrados.map(c => [
        c.descricao,
        c.parcela_numero && c.parcela_total ? `${c.parcela_numero}/${c.parcela_total}` : '-',
        `R$ ${parseFloat(c.valor).toFixed(2)}`,
        formatDate(c.data_vencimento),
        c.banco || '-',
        c.data_pagamento ? formatDate(c.data_pagamento) : '-'
    ]);
    doc.autoTable({
        startY: 40,
        head: [['Descrição','Parcela','Valor','Vencimento','Banco','Data Pagamento']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [100,100,100] }
    });
    doc.save(`contas_pagar_${meses[currentMonth.getMonth()]}_${currentMonth.getFullYear()}.pdf`);
    showMessage('PDF gerado','success');
};

function getDadosFiltrados() {
    const search = (document.getElementById('search')?.value || '').toLowerCase();
    const banco = document.getElementById('filterBanco')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';
    const pagamento = document.getElementById('filterPagamento')?.value || '';
    let filtered = contas.filter(c => {
        const dataVenc = new Date(c.data_vencimento + 'T00:00:00');
        return dataVenc.getMonth() === currentMonth.getMonth() && dataVenc.getFullYear() === currentMonth.getFullYear();
    });
    if(banco) filtered = filtered.filter(c => c.banco === banco);
    if(pagamento) filtered = filtered.filter(c => c.forma_pagamento === pagamento);
    if(status) {
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        filtered = filtered.filter(c => {
            if(status === 'PAGO') return c.status === 'PAGO';
            if(status === 'VENCIDO') return c.status !== 'PAGO' && new Date(c.data_vencimento+'T00:00:00') <= hoje;
            if(status === 'PENDENTE') return c.status !== 'PAGO' && new Date(c.data_vencimento+'T00:00:00') > hoje;
            return true;
        });
    }
    if(search) {
        filtered = filtered.filter(c => 
            c.descricao.toLowerCase().includes(search) ||
            (c.banco || '').toLowerCase().includes(search) ||
            (c.forma_pagamento || '').toLowerCase().includes(search)
        );
    }
    filtered.sort((a,b) => new Date(a.data_vencimento) - new Date(b.data_vencimento));
    return filtered;
}

window.sincronizarDados = async function() {
    showMessage('Sincronizando...','info');
    await loadContas();
    showMessage('Dados atualizados','success');
};

// ============================================
// FORMULÁRIO (versão simplificada, sem filas complexas)
// ============================================
window.showFormModal = async function(editingId = null) {
    const isEditing = editingId && editingId !== 'null';
    let conta = null;
    if(isEditing) {
        conta = contas.find(c => String(c.id) === String(editingId));
        if(!conta) { showMessage('Conta não encontrada','error'); return; }
        if(conta.grupo_id) {
            currentGrupoId = conta.grupo_id;
            parcelasDoGrupo = await loadParcelasDoGrupo(conta.grupo_id);
        } else { currentGrupoId = null; parcelasDoGrupo = [conta]; }
        if(conta.observacoes) {
            try { observacoesArray = JSON.parse(conta.observacoes); } catch(e) { observacoesArray = []; }
        } else { observacoesArray = []; }
    } else {
        currentGrupoId = null; parcelasDoGrupo = []; observacoesArray = [];
    }
    formType = isEditing ? 'edit' : 'simple';
    numParcelas = 0;
    const temParcelas = isEditing && conta?.grupo_id && parcelasDoGrupo.length > 1;
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
    const modal = document.getElementById('formModal');
    setTimeout(() => modal.classList.add('show'), 10);
    setTimeout(() => applyUppercaseFields(), 100);
};

function renderEditFormSimples(conta, isEditing) {
    const obsHTML = observacoesArray.length ? observacoesArray.map((obs,idx)=>`<div class="observacao-item"><div class="observacao-header"><span>${new Date(obs.timestamp).toLocaleString('pt-BR')}</span><button type="button" onclick="window.removerObservacao(${idx})">✕</button></div><p>${obs.texto}</p></div>`).join('') : '<p>Nenhuma observação</p>';
    return `
        <div class="tab-content active" id="tab-dados">
            <div class="form-grid-compact">
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
        </div>
        <div class="tab-content" id="tab-pagamento">
            <div class="form-row"><div class="form-group"><label>Forma de Pagamento *</label><select id="forma_pagamento" required><option value="">Selecione</option>${['PIX','BOLETO','CARTAO','DINHEIRO','TRANSFERENCIA'].map(opt=>`<option value="${opt}" ${conta?.forma_pagamento===opt?'selected':''}>${opt}</option>`).join('')}</select></div>
            <div class="form-group"><label>Banco *</label><select id="banco" required><option value="">Selecione</option>${['BANCO DO BRASIL','BRADESCO','SICOOB'].map(opt=>`<option value="${opt}" ${conta?.banco===opt?'selected':''}>${opt}</option>`).join('')}</select></div>
            <div class="form-group"><label>Data Pagamento</label><input type="date" id="data_pagamento" value="${conta?.data_pagamento||''}"></div></div>
        </div>
        <div class="tab-content" id="tab-observacoes">
            <div class="observacoes-container"><div class="observacoes-list" id="observacoesList">${obsHTML}</div>
            <div class="nova-observacao"><textarea id="novaObservacao" rows="2" placeholder="Nova observação"></textarea><button type="button" onclick="window.adicionarObservacao()">Adicionar</button></div></div>
        </div>
    `;
}

function renderEditFormComParcelas(conta) {
    const obsHTML = observacoesArray.length ? observacoesArray.map((obs,idx)=>`<div class="observacao-item"><div class="observacao-header"><span>${new Date(obs.timestamp).toLocaleString('pt-BR')}</span><button type="button" onclick="window.removerObservacao(${idx})">✕</button></div><p>${obs.texto}</p></div>`).join('') : '<p>Nenhuma observação</p>';
    return `
        <div class="tab-content active" id="tab-dados-gerais">
            <div class="form-row"><div class="form-group"><label>Documento</label><input type="text" id="documento" value="${conta?.documento||''}"></div>
            <div class="form-group"><label>Descrição *</label><input type="text" id="descricao" value="${conta?.descricao||''}" required></div></div>
        </div>
        ${parcelasDoGrupo.map((p,idx)=>`
            <div class="tab-content" id="tab-parcela-${idx}">
                <div class="form-row"><div class="form-group"><label>Forma Pagamento</label><select id="parcela_forma_pagamento_${p.id}" class="parcela-field" data-parcela-id="${p.id}" required><option value="">Selecione</option>${['PIX','BOLETO','CARTAO','DINHEIRO','TRANSFERENCIA'].map(opt=>`<option value="${opt}" ${p.forma_pagamento===opt?'selected':''}>${opt}</option>`).join('')}</select></div>
                <div class="form-group"><label>Banco</label><select id="parcela_banco_${p.id}" class="parcela-field" data-parcela-id="${p.id}" required><option value="">Selecione</option>${['BANCO DO BRASIL','BRADESCO','SICOOB'].map(opt=>`<option value="${opt}" ${p.banco===opt?'selected':''}>${opt}</option>`).join('')}</select></div></div>
                <div class="form-row"><div class="form-group"><label>Vencimento</label><input type="date" id="parcela_vencimento_${p.id}" class="parcela-field" value="${p.data_vencimento}" required></div>
                <div class="form-group"><label>Valor</label><input type="number" step="0.01" id="parcela_valor_${p.id}" class="parcela-field" value="${p.valor}" required></div>
                <div class="form-group"><label>Data Pagamento</label><input type="date" id="parcela_pagamento_${p.id}" class="parcela-field" value="${p.data_pagamento||''}"></div></div>
            </div>
        `).join('')}
        <div class="tab-content" id="tab-observacoes-final">
            <div class="observacoes-container"><div class="observacoes-list" id="observacoesList">${obsHTML}</div>
            <div class="nova-observacao"><textarea id="novaObservacao" rows="2" placeholder="Nova observação"></textarea><button type="button" onclick="window.adicionarObservacao()">Adicionar</button></div></div>
        </div>
    `;
}

window.switchFormTab = function(index) {
    document.querySelectorAll('#formModal .tab-btn').forEach((btn,i)=>btn.classList.toggle('active',i===index));
    document.querySelectorAll('#formModal .tab-content').forEach((content,i)=>content.classList.toggle('active',i===index));
};
window.adicionarObservacao = function() {
    const texto = document.getElementById('novaObservacao')?.value.trim();
    if(!texto) return;
    const obsField = document.getElementById('observacoesData');
    let obs = JSON.parse(obsField.value || '[]');
    obs.push({ texto, timestamp: new Date().toISOString() });
    obsField.value = JSON.stringify(obs);
    document.getElementById('novaObservacao').value = '';
    atualizarListaObservacoes();
};
window.removerObservacao = function(index) {
    const obsField = document.getElementById('observacoesData');
    let obs = JSON.parse(obsField.value || '[]');
    obs.splice(index,1);
    obsField.value = JSON.stringify(obs);
    atualizarListaObservacoes();
};
function atualizarListaObservacoes() {
    const container = document.getElementById('observacoesList');
    if(!container) return;
    const obs = JSON.parse(document.getElementById('observacoesData')?.value || '[]');
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
    if(!num || !total || !inicio || num<2) { container.innerHTML=''; return; }
    const valorParcela = (total/num).toFixed(2);
    let html = '<div class="parcelas-preview"><h4>Parcelas:</h4>';
    for(let i=0;i<num;i++) {
        const data = new Date(inicio+'T00:00:00');
        data.setMonth(data.getMonth()+i);
        html += `<div class="parcela-item"><span>${i+1}ª Parcela</span><span>${data.toLocaleDateString('pt-BR')}</span><span>R$ ${parseFloat(valorParcela).toFixed(2)}</span></div>`;
    }
    html += '</div>';
    container.innerHTML = html;
};
window.handleFormSubmit = function(event, isEditing) {
    event.preventDefault();
    if(isEditing) handleEditSubmit(event);
    else handleCreateSubmit(event);
};
async function handleCreateSubmit(event) {
    if(formType === 'parcelado') await salvarContaParcelada();
    else await salvarContaSimples();
}
async function salvarContaSimples() {
    const descricao = document.getElementById('descricao')?.value.trim();
    const valor = document.getElementById('valor')?.value;
    const venc = document.getElementById('data_vencimento')?.value;
    const forma = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    if(!descricao||!valor||!venc||!forma||!banco) { showMessage('Preencha todos os campos','error'); return; }
    const data = {
        documento: document.getElementById('documento')?.value.trim() || null,
        descricao, valor: parseFloat(valor), data_vencimento: venc, forma_pagamento: forma, banco,
        data_pagamento: document.getElementById('data_pagamento')?.value || null,
        observacoes: document.getElementById('observacoesData')?.value || '[]',
        status: document.getElementById('data_pagamento')?.value ? 'PAGO' : 'PENDENTE'
    };
    try {
        const response = await fetch(`${API_URL}/contas`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
        if(!response.ok) throw new Error('Erro ao salvar');
        const saved = await response.json();
        contas.push(saved);
        updateAllFilters(); updateDashboard(); filterContas();
        window.closeFormModal();
        showMessage('Conta salva','success');
    } catch(err) { showMessage('Erro: '+err.message,'error'); }
}
async function salvarContaParcelada() {
    const descricao = document.getElementById('descricao')?.value.trim();
    const num = parseInt(document.getElementById('numParcelas')?.value);
    const total = parseFloat(document.getElementById('valorTotal')?.value);
    const inicio = document.getElementById('dataInicio')?.value;
    const forma = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    if(!descricao||!num||!total||!inicio||!forma||!banco) { showMessage('Preencha todos os campos','error'); return; }
    const valorParcela = total/num;
    const grupoId = generateUUID();
    let sucessos = 0;
    for(let i=0;i<num;i++) {
        const dataVenc = new Date(inicio+'T00:00:00');
        dataVenc.setMonth(dataVenc.getMonth()+i);
        const parcela = {
            documento: document.getElementById('documento')?.value.trim()||null,
            descricao, valor: valorParcela, data_vencimento: dataVenc.toISOString().split('T')[0],
            forma_pagamento: forma, banco, data_pagamento: null,
            observacoes: document.getElementById('observacoesData')?.value||'[]',
            status: 'PENDENTE', parcela_numero: i+1, parcela_total: num, grupo_id: grupoId
        };
        try {
            const response = await fetch(`${API_URL}/contas`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(parcela) });
            if(response.ok) { sucessos++; const saved=await response.json(); contas.push(saved); }
        } catch(e) { console.error(e); }
    }
    updateAllFilters(); updateDashboard(); filterContas();
    window.closeFormModal();
    showMessage(`${sucessos}/${num} parcelas salvas`,'success');
}
async function handleEditSubmit(event) {
    const editId = document.getElementById('editId')?.value;
    const temParcelas = parcelasDoGrupo.length > 1;
    if(temParcelas) await handleEditSubmitParcelas();
    else await editarContaSimples(editId);
}
async function editarContaSimples(id) {
    const descricao = document.getElementById('descricao')?.value.trim();
    const valor = document.getElementById('valor')?.value;
    const venc = document.getElementById('data_vencimento')?.value;
    const forma = document.getElementById('forma_pagamento')?.value;
    const banco = document.getElementById('banco')?.value;
    if(!descricao||!valor||!venc||!forma||!banco) { showMessage('Preencha todos os campos','error'); return; }
    const data = {
        documento: document.getElementById('documento')?.value.trim()||null,
        descricao, valor: parseFloat(valor), data_vencimento: venc, forma_pagamento: forma, banco,
        data_pagamento: document.getElementById('data_pagamento')?.value||null,
        observacoes: document.getElementById('observacoesData')?.value||'[]',
        status: document.getElementById('data_pagamento')?.value ? 'PAGO' : 'PENDENTE'
    };
    try {
        const response = await fetch(`${API_URL}/contas/${id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
        if(!response.ok) throw new Error('Erro ao atualizar');
        const updated = await response.json();
        const index = contas.findIndex(c=>String(c.id)===String(id));
        if(index!==-1) contas[index]=updated;
        updateAllFilters(); updateDashboard(); filterContas();
        window.closeFormModal();
        showMessage('Atualizado','success');
    } catch(err) { showMessage('Erro: '+err.message,'error'); }
}
async function handleEditSubmitParcelas() {
    const grupoId = currentGrupoId;
    if(!grupoId) return;
    const descricao = document.getElementById('descricao')?.value.trim();
    const documento = document.getElementById('documento')?.value.trim()||null;
    const observacoes = document.getElementById('observacoesData')?.value||'[]';
    if(!descricao) { showMessage('Descrição obrigatória','error'); return; }
    let erros = 0;
    for(const parcela of parcelasDoGrupo) {
        const vencInput = document.getElementById(`parcela_vencimento_${parcela.id}`);
        const valorInput = document.getElementById(`parcela_valor_${parcela.id}`);
        const formaInput = document.getElementById(`parcela_forma_pagamento_${parcela.id}`);
        const bancoInput = document.getElementById(`parcela_banco_${parcela.id}`);
        const pagInput = document.getElementById(`parcela_pagamento_${parcela.id}`);
        if(!vencInput||!valorInput||!formaInput||!bancoInput) continue;
        const data = {
            documento, descricao, observacoes,
            valor: parseFloat(valorInput.value),
            data_vencimento: vencInput.value,
            forma_pagamento: formaInput.value,
            banco: bancoInput.value,
            data_pagamento: pagInput?.value||null,
            status: pagInput?.value ? 'PAGO' : 'PENDENTE',
            parcela_numero: parcela.parcela_numero,
            parcela_total: parcelasDoGrupo.length
        };
        try {
            const response = await fetch(`${API_URL}/contas/${parcela.id}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data) });
            if(response.ok) {
                const updated = await response.json();
                const idx = contas.findIndex(c=>String(c.id)===String(parcela.id));
                if(idx!==-1) contas[idx]=updated;
            } else erros++;
        } catch(e) { erros++; }
    }
    updateAllFilters(); updateDashboard(); filterContas();
    window.closeFormModal();
    showMessage(erros===0?'Parcelas atualizadas':`${erros} erro(s)`,`${erros===0?'success':'warning'}`);
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
// TOGGLE PAGO
// ============================================
window.togglePago = async function(id) {
    const conta = contas.find(c => String(c.id)===String(id));
    if(!conta) return;
    const novoStatus = conta.status === 'PAGO' ? 'PENDENTE' : 'PAGO';
    const novaData = novoStatus === 'PAGO' ? new Date().toISOString().split('T')[0] : null;
    const old = { status: conta.status, data: conta.data_pagamento };
    conta.status = novoStatus;
    conta.data_pagamento = novaData;
    updateDashboard(); filterContas();
    try {
        const response = await fetch(`${API_URL}/contas/${id}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ status: novoStatus, data_pagamento: novaData }) });
        if(!response.ok) throw new Error();
        const updated = await response.json();
        const index = contas.findIndex(c=>String(c.id)===String(id));
        if(index!==-1) contas[index]=updated;
        showMessage(`Conta ${novoStatus==='PAGO'?'paga':'pendente'}!`,'success');
    } catch(e) {
        conta.status = old.status; conta.data_pagamento = old.data;
        updateDashboard(); filterContas();
        showMessage('Erro ao alterar status','error');
    }
};

// ============================================
// EDIÇÃO E EXCLUSÃO
// ============================================
window.editConta = function(id) { window.showFormModal(id); };
window.deleteConta = async function(id) {
    if(!confirm('Excluir esta conta?')) return;
    const index = contas.findIndex(c=>String(c.id)===String(id));
    if(index===-1) return;
    const excluida = contas[index];
    contas.splice(index,1);
    updateAllFilters(); updateDashboard(); filterContas();
    try {
        const response = await fetch(`${API_URL}/contas/${id}`, { method:'DELETE' });
        if(!response.ok) throw new Error();
        showMessage('Excluída','error');
    } catch(e) {
        contas.push(excluida);
        updateAllFilters(); updateDashboard(); filterContas();
        showMessage('Erro ao excluir','error');
    }
};

// ============================================
// VISUALIZAÇÃO
// ============================================
window.viewConta = function(id) {
    const conta = contas.find(c=>String(c.id)===String(id));
    if(!conta) return;
    const parcelaInfo = conta.parcela_numero && conta.parcela_total ? `<div><strong>Parcela:</strong> ${conta.parcela_numero}/${conta.parcela_total}</div>` : '';
    let obsHtml = '';
    if(conta.observacoes) {
        try {
            const obsArr = JSON.parse(conta.observacoes);
            if(obsArr.length) obsHtml = `<div><strong>Observações:</strong><br>${obsArr.map(o=>`<small>${new Date(o.timestamp).toLocaleString('pt-BR')}</small><br>${o.texto}<br>`).join('')}</div>`;
        } catch(e) { obsHtml = `<div><strong>Observações:</strong> ${conta.observacoes}</div>`; }
    }
    const modal = `<div class="modal-overlay" id="viewModal"><div class="modal-content modal-view"><button class="modal-close-x" onclick="window.closeViewModal()">✕</button><h3>Detalhes</h3><div><div><strong>Descrição:</strong> ${conta.descricao}</div>${parcelaInfo}<div><strong>Valor:</strong> R$ ${parseFloat(conta.valor).toFixed(2)}</div><div><strong>Vencimento:</strong> ${formatDate(conta.data_vencimento)}</div><div><strong>Forma:</strong> ${conta.forma_pagamento}</div><div><strong>Banco:</strong> ${conta.banco}</div><div><strong>Status:</strong> ${conta.status}</div>${obsHtml}</div><div class="modal-actions"><button class="secondary" onclick="window.closeViewModal()">Fechar</button></div></div></div>`;
    document.body.insertAdjacentHTML('beforeend', modal);
    document.getElementById('viewModal').style.display='flex';
};
window.closeViewModal = function() {
    const modal = document.getElementById('viewModal');
    if(modal) modal.remove();
};

// ============================================
// FILTROS E RENDERIZAÇÃO
// ============================================
function updateAllFilters() {
    const bancos = [...new Set(contas.map(c=>c.banco).filter(Boolean))];
    const selectBanco = document.getElementById('filterBanco');
    if(selectBanco) {
        const val = selectBanco.value;
        selectBanco.innerHTML = '<option value="">Todos os Bancos</option>' + bancos.map(b=>`<option value="${b}">${b}</option>`).join('');
        selectBanco.value = val;
    }
    const formas = [...new Set(contas.map(c=>c.forma_pagamento).filter(Boolean))];
    const selectForma = document.getElementById('filterPagamento');
    if(selectForma) {
        const val = selectForma.value;
        selectForma.innerHTML = '<option value="">Todas Formas</option>' + formas.map(f=>`<option value="${f}">${f}</option>`).join('');
        selectForma.value = val;
    }
}
function filterContas() {
    const search = (document.getElementById('search')?.value||'').toLowerCase();
    const banco = document.getElementById('filterBanco')?.value||'';
    const status = document.getElementById('filterStatus')?.value||'';
    const pagamento = document.getElementById('filterPagamento')?.value||'';
    let filtered = contas.filter(c=>{
        const dv = new Date(c.data_vencimento+'T00:00:00');
        return dv.getMonth()===currentMonth.getMonth() && dv.getFullYear()===currentMonth.getFullYear();
    });
    if(banco) filtered = filtered.filter(c=>c.banco===banco);
    if(pagamento) filtered = filtered.filter(c=>c.forma_pagamento===pagamento);
    if(status) {
        const hoje = new Date(); hoje.setHours(0,0,0,0);
        filtered = filtered.filter(c=>{
            if(status==='PAGO') return c.status==='PAGO';
            if(status==='VENCIDO') return c.status!=='PAGO' && new Date(c.data_vencimento+'T00:00:00')<=hoje;
            if(status==='PENDENTE') return c.status!=='PAGO' && new Date(c.data_vencimento+'T00:00:00')>hoje;
            return true;
        });
    }
    if(search) filtered = filtered.filter(c=>c.descricao.toLowerCase().includes(search));
    filtered.sort((a,b)=>new Date(a.data_vencimento)-new Date(b.data_vencimento));
    renderContas(filtered);
}
function renderContas(lista) {
    const container = document.getElementById('contasContainer');
    if(!container) return;
    if(!lista.length) { container.innerHTML='<div style="text-align:center;padding:2rem;">Nenhuma conta</div>'; return; }
    const html = `<table><thead><tr><th style="width:60px;">✓</th><th>Descrição</th><th>Valor</th><th>Vencimento</th><th>Parcela</th><th>Banco</th><th>Data Pagamento</th><th>Status</th><th>Ações</th></tr></thead><tbody>${lista.map(c=>{
        const parcela = c.parcela_numero && c.parcela_total ? `${c.parcela_numero}/${c.parcela_total}` : '-';
        const statusBadge = `<span class="badge ${c.status==='PAGO'?'pago':c.status==='VENCIDO'?'vencido':'pendente'}">${c.status==='PAGO'?'Pago':c.status==='VENCIDO'?'Vencido':'Pendente'}</span>`;
        return `<tr data-conta-id="${c.id}" class="${c.status==='PAGO'?'row-pago':''}">
            <td style="text-align:center;"><button class="check-btn ${c.status==='PAGO'?'checked':''}" data-action="toggle" data-id="${c.id}" onclick="event.stopPropagation()"></button></td>
            <td>${c.descricao}</td>
            <td><strong>R$ ${parseFloat(c.valor).toFixed(2)}</strong></td>
            <td>${formatDate(c.data_vencimento)}</td>
            <td style="text-align:center;">${parcela}</td>
            <td>${c.banco||'-'}</td>
            <td>${c.data_pagamento?formatDate(c.data_pagamento):'-'}</td>
            <td>${statusBadge}</td>
            <td class="actions-cell"><button class="action-btn edit" data-action="edit" data-id="${c.id}" onclick="event.stopPropagation()">Editar</button><button class="action-btn delete" data-action="delete" data-id="${c.id}" onclick="event.stopPropagation()">Excluir</button></td>
        </tr>`;
    }).join('')}</tbody></table>`;
    container.innerHTML = html;
}

// ============================================
// UTILITÁRIOS
// ============================================
function formatDate(dateString) { if(!dateString) return '-'; return new Date(dateString+'T00:00:00').toLocaleDateString('pt-BR'); }
function showMessage(msg, type) {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = msg;
    document.body.appendChild(div);
    setTimeout(()=>{ div.style.animation='slideOutBottom 0.3s forwards'; setTimeout(()=>div.remove(),300); },3000);
}
function generateUUID() { return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{ const r=Math.random()*16|0, v=c==='x'?r:(r&0x3|0x8); return v.toString(16); }); }
