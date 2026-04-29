// ============================================
// CALENDAR.JS - MODAL DE CALENDÁRIO (VENDAS)
// ============================================

let calendarYear = new Date().getFullYear();

const mesesNomes = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentYear;
        document.getElementById('calendarYear').textContent = calendarYear;
        renderCalendarMonths();
        modal.classList.add('show');
    }
};

window.changeCalendarYear = function(direction) {
    calendarYear += direction;
    document.getElementById('calendarYear').textContent = calendarYear;
    renderCalendarMonths();
};

function renderCalendarMonths() {
    const container = document.getElementById('calendarMonths');
    if (!container) return;
    container.innerHTML = '';

    const isAllMonthsActive = typeof showAllMonths !== 'undefined' && showAllMonths && currentYear === calendarYear;

    const todosDiv = document.createElement('div');
    todosDiv.className = 'calendar-month todos' + (isAllMonthsActive ? ' current' : '');
    todosDiv.textContent = 'Todos';
    todosDiv.onclick = () => selectAllMonths();
    container.appendChild(todosDiv);

    mesesNomes.forEach((nome, idx) => {
        const div = document.createElement('div');
        const isCurrentMonth = !showAllMonths && idx === currentMonth && calendarYear === currentYear;
        div.className = 'calendar-month' + (isCurrentMonth ? ' current' : '');
        div.textContent = nome;
        div.onclick = () => selectCalendarMonth(idx, calendarYear);
        container.appendChild(div);
    });
}

function selectCalendarMonth(month, year) {
    showAllMonths = false;
    currentMonth = month;
    currentYear = year;
    updateMonthDisplay();
    toggleCalendar();
}

function selectAllMonths() {
    currentYear = calendarYear;
    showAllMonths = true;
    updateMonthDisplay();
    toggleCalendar();
}
