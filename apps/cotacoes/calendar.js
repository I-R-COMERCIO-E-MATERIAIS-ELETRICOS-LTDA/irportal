// calendar.js - Sistema de calendário para seleção de mês

let calendarYear = new Date().getFullYear();

function toggleCalendar() {
    const modal = document.getElementById('calendarModal');
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentMonth.getFullYear();
        updateCalendarDisplay();
        modal.classList.add('show');
    }
}

function changeCalendarYear(direction) {
    calendarYear += direction;
    updateCalendarDisplay();
}

function updateCalendarDisplay() {
    const yearElement = document.getElementById('calendarYear');
    if (yearElement) {
        yearElement.textContent = calendarYear;
    }
    
    const monthsContainer = document.getElementById('calendarMonths');
    if (!monthsContainer) return;
    
    const months = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    
    const currentMonthIndex = currentMonth.getMonth();
    const currentYear = currentMonth.getFullYear();
    
    monthsContainer.innerHTML = months.map((month, index) => {
        const isCurrent = (index === currentMonthIndex && calendarYear === currentYear);
        return `
            <div class="calendar-month ${isCurrent ? 'current' : ''}" 
                 onclick="selectMonth(${index})">
                ${month}
            </div>
        `;
    }).join('');
}

function selectMonth(monthIndex) {
    currentMonth = new Date(calendarYear, monthIndex, 1);
    updateDisplay();
    toggleCalendar();
}

// Fechar modal ao clicar fora
document.addEventListener('click', (e) => {
    const modal = document.getElementById('calendarModal');
    const calendarBtn = document.querySelector('.calendar-btn');
    
    if (modal && modal.classList.contains('show')) {
        if (!e.target.closest('.calendar-content') && !e.target.closest('.calendar-btn')) {
            modal.classList.remove('show');
        }
    }
});
