let calendarYear = new Date().getFullYear();
const mesesCal = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
window.toggleCalendar = function() {
    const m = document.getElementById('calendarModal');
    if (!m) return;
    if (m.classList.contains('show')) m.classList.remove('show');
    else { calendarYear = currentMonth.getFullYear(); renderCalendar(); m.classList.add('show'); }
};
window.changeCalendarYear = d => { calendarYear += d; document.getElementById('calendarYear').textContent = calendarYear; renderCalendar(); };
function renderCalendar() {
    const y = document.getElementById('calendarYear'), mc = document.getElementById('calendarMonths');
    if (!y || !mc) return;
    y.textContent = calendarYear; mc.innerHTML = '';
    mesesCal.forEach((n,i) => {
        const b = document.createElement('div'); b.className = 'calendar-month'; b.textContent = n;
        if (calendarYear === currentMonth.getFullYear() && i === currentMonth.getMonth()) b.classList.add('current');
        b.onclick = () => { currentMonth = new Date(calendarYear, i, 1); window.updateDisplay?.(); window.toggleCalendar(); };
        mc.appendChild(b);
    });
}
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('calendarModal')?.addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.classList.remove('show'); });
});
