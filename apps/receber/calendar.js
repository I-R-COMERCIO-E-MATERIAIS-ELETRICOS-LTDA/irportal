let calendarYear = new Date().getFullYear();
const mesesNomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;
    if (modal.classList.contains('show')) modal.classList.remove('show');
    else { renderCalendarMonths(); modal.classList.add('show'); }
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
    todosDiv.className = 'calendar-month todos';
    if (isAllMonthsActive) todosDiv.classList.add('current');
    todosDiv.textContent = 'Todos';
    todosDiv.onclick = () => selectAllMonths();
    container.appendChild(todosDiv);
    mesesNomes.forEach((mes, index) => {
        const monthDiv = document.createElement('div');
        monthDiv.className = 'calendar-month';
        monthDiv.textContent = mes;
        if (!isAllMonthsActive && calendarYear === new Date().getFullYear() && index === new Date().getMonth()) monthDiv.classList.add('current');
        monthDiv.onclick = () => selectMonth(index);
        container.appendChild(monthDiv);
    });
}
function selectMonth(monthIndex) {
    if (typeof currentMonth !== 'undefined' && typeof currentYear !== 'undefined') {
        if (typeof showAllMonths !== 'undefined' && showAllMonths) { showAllMonths = false; }
        currentMonth = monthIndex; currentYear = calendarYear;
        if (typeof updateMonthDisplay === 'function') updateMonthDisplay();
        if (typeof filterContas === 'function') filterContas();
    }
    toggleCalendar();
}
function selectAllMonths() {
    if (typeof showAllMonths !== 'undefined' && typeof currentYear !== 'undefined') {
        if (!showAllMonths || currentYear !== calendarYear) { showAllMonths = true; currentYear = calendarYear; if (typeof updateMonthDisplay === 'function') updateMonthDisplay(); if (typeof filterContas === 'function') filterContas(); }
    }
    toggleCalendar();
}
document.addEventListener('click', function(e) { const modal = document.getElementById('calendarModal'); if (modal && e.target === modal) toggleCalendar(); });
