// ============================================
// CALENDAR.JS - VENDAS
// ============================================

let calendarYear = new Date().getFullYear();

const mesesCalendario = [
    'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
];

window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (!modal) return;

    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentMonth.getFullYear();
        renderCalendar();
        modal.classList.add('show');
    }
};

window.changeCalendarYear = function(direction) {
    calendarYear += direction;
    document.getElementById('calendarYear').textContent = calendarYear;
    renderCalendar();
};

function renderCalendar() {
    const yearElement = document.getElementById('calendarYear');
    const monthsContainer = document.getElementById('calendarMonths');

    if (!yearElement || !monthsContainer) return;

    yearElement.textContent = calendarYear;
    monthsContainer.innerHTML = '';

    mesesCalendario.forEach((nome, index) => {
        const monthButton = document.createElement('div');
        monthButton.className = 'calendar-month';
        monthButton.textContent = nome;

        if (calendarYear === currentMonth.getFullYear() && index === currentMonth.getMonth()) {
            monthButton.classList.add('current');
        }

        monthButton.onclick = () => selectMonth(index);
        monthsContainer.appendChild(monthButton);
    });
}

function selectMonth(monthIndex) {
    if (typeof currentMonth !== 'undefined') {
        currentMonth = new Date(calendarYear, monthIndex, 1);
    }

    if (typeof updateDisplay === 'function') {
        updateDisplay();
    }

    if (typeof loadVendas === 'function') {
        loadVendas();
    }

    window.toggleCalendar();
}

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('calendarModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    }
});
