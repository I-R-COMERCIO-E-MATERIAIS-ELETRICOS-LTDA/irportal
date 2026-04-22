// ============================================
// CALENDAR.JS - MODAL DE CALENDÁRIO
// ============================================

let calendarYear = new Date().getFullYear();

const mesesNomes = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

// Função para abrir/fechar modal de calendário
window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        renderCalendarMonths();
        modal.classList.add('show');
    }
};

// Função para mudar o ano no calendário
window.changeCalendarYear = function(direction) {
    calendarYear += direction;
    document.getElementById('calendarYear').textContent = calendarYear;
    renderCalendarMonths();
};

// Função para renderizar os meses do calendário (incluindo opção "Todos")
function renderCalendarMonths() {
    const container = document.getElementById('calendarMonths');
    if (!container) return;
    
    container.innerHTML = '';
    
    // Verifica se o modo "Todos os Meses" está ativo para o ano atual
    const isAllMonthsActive = typeof showAllMonths !== 'undefined' && showAllMonths && currentYear === calendarYear;
    
    // Adiciona a opção "Todos" antes dos meses
    const todosDiv = document.createElement('div');
    todosDiv.className = 'calendar-month todos';
    if (isAllMonthsActive) {
        todosDiv.classList.add('current'); // destaca se estiver ativo para este ano
    }
    todosDiv.textContent = 'Todos';
    todosDiv.onclick = () => selectAllMonths();
    container.appendChild(todosDiv);
    
    // Adiciona os meses
    mesesNomes.forEach((mes, index) => {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'calendar-month';
        monthDiv.textContent = mes;
        
        // Marcar mês atual se for o ano corrente e o mês for o atual e não estiver no modo "Todos"
        if (!isAllMonthsActive && calendarYear === new Date().getFullYear() && index === new Date().getMonth()) {
            monthDiv.classList.add('current');
        }
        
        // Ao clicar, seleciona o mês e fecha o modal
        monthDiv.onclick = () => selectMonth(index);
        
        container.appendChild(monthDiv);
    });
}

// Função para selecionar um mês
function selectMonth(monthIndex) {
    // Verifica se as variáveis globais existem
    if (typeof currentMonth !== 'undefined' && typeof currentYear !== 'undefined') {
        // Desativa o modo "Todos"
        if (typeof showAllMonths !== 'undefined' && showAllMonths) {
            if (typeof toggleAllMonths === 'function') {
                toggleAllMonths(); // Isso desativará o modo
            } else {
                showAllMonths = false;
            }
        }
        
        currentMonth = monthIndex;
        currentYear = calendarYear;
        
        // Atualiza a interface se as funções existirem
        if (typeof updateMonthDisplay === 'function') {
            updateMonthDisplay();
        }
        if (typeof filterContas === 'function') {
            filterContas();
        }
    }
    
    // Fecha o modal
    toggleCalendar();
}

// Função para selecionar "Todos os Meses"
function selectAllMonths() {
    if (typeof showAllMonths !== 'undefined' && typeof currentYear !== 'undefined') {
        // Ativa o modo "Todos" para o ano selecionado no calendário
        if (!showAllMonths || currentYear !== calendarYear) {
            // Se não está ativo ou está ativo para outro ano, ativamos para este ano
            showAllMonths = true;
            currentYear = calendarYear;
            // Não alteramos currentMonth, mas podemos definir como null ou ignorado
            if (typeof updateMonthDisplay === 'function') {
                updateMonthDisplay();
            }
            if (typeof filterContas === 'function') {
                filterContas();
            }
        } else {
            // Se já está ativo para este ano, podemos desativar? Ou manter? Por enquanto, mantém ativo.
            // Se quiser toggle, poderia fazer showAllMonths = false, mas acho melhor manter.
        }
    }
    
    // Fecha o modal
    toggleCalendar();
}

// Fechar modal ao clicar fora dele
document.addEventListener('click', function(e) {
    const modal = document.getElementById('calendarModal');
    if (modal && e.target === modal) {
        toggleCalendar();
    }
});
