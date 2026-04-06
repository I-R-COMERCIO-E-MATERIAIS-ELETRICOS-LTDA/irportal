// ============================================
// CALENDÁRIO
// ============================================
let calendarYear = new Date().getFullYear();

window.toggleCalendar = function() {
    const modal = document.getElementById('calendarModal');
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentMonth.getFullYear();
        updateCalendarView();
        modal.classList.add('show');
    }
};

window.changeCalendarYear = function(direction) {
    calendarYear += direction;
    updateCalendarView();
};

function updateCalendarView() {
    document.getElementById('calendarYear').textContent = calendarYear;
    
    const monthsContainer = document.getElementById('calendarMonths');
    const currentDate = new Date();
    
    monthsContainer.innerHTML = meses.map((mes, index) => {
        const isCurrent = index === currentMonth.getMonth() && calendarYear === currentMonth.getFullYear();
        return `
            <div class="calendar-month ${isCurrent ? 'current' : ''}" onclick="selectMonth(${index})">
                ${mes}
            </div>
        `;
    }).join('');
}

window.selectMonth = function(monthIndex) {
    currentMonth = new Date(calendarYear, monthIndex, 1);
    updateDisplay();
    toggleCalendar();
};

// Fechar calendário ao clicar fora
document.addEventListener('click', (e) => {
    const calendarModal = document.getElementById('calendarModal');
    const calendarBtn = document.querySelector('.calendar-btn');
    
    if (calendarModal && calendarModal.classList.contains('show')) {
        if (!calendarModal.contains(e.target) && !calendarBtn.contains(e.target)) {
            toggleCalendar();
        }
    }
});
