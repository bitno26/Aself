// ===== Constants (all amounts are minutes) =====
const TOTAL_MIN = 21 * 60;       // monthly total
const DIAL_FULL_AT = 7 * 60;     // "available hours" dial: its number counts down from 7h, its ring completes at 7h used
const PURPLE_AT = 14 * 60;       // remaining-hours dial: purple below 14h; from 14h down its label switches to the "with deduction" wording
const DAY_START = 7 * 60 + 30;   // a late entry always starts at 07:30 ...
const DAY_END = 14 * 60 + 30;    // ... and must end by 14:30
const KEY = 'delay-log-v1';
const MAX_FP = 5;                // forgotten-fingerprint requests allowed
const MAX_ABS = 31;              // longest absence (working days) accepted in one record
const KINDS = ['حضور', 'انصراف'];   // movement types
const DAYS_OFF = [5, 6];         // Friday, Saturday
const ROW = 40;                  // time-wheel row height in px (matches the CSS)
const SWIPE_RATIO = 0.45;        // share of a row's width to swipe before it is deleted
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const icon = body => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">${body}</svg>`;
const CAL_ICON = icon('<rect x="3.5" y="5" width="17" height="15.5" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4"/>');
const CLOCK_ICON = icon('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>');
const CHEVRON_ICON = icon('<path d="M6 9l6 6 6-6"/>');

// ===== State =====
let entries = [];                // [{type: 'delay' | 'early', date: 'yyyy/mm/dd', minutes, start: 'HH:MM', end: 'HH:MM'} | {type: 'fp', date, kind, minutes: 0} | {type: 'abs', date, end, days, minutes: 0}]
let resetTimer = null;
let calTarget = null, viewY = 0, viewM = 0;   // date popup
let clockTarget = null;                       // time popup
let drag = null, removing = false;            // row swipe

// ===== Helpers =====
const $ = id => document.getElementById(id);
const pad = n => String(n).padStart(2, '0');
const hhmm = min => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const fmtDate = d => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const okDate = d => /^\d{4}\/\d{2}\/\d{2}$/.test(d);
const okTime = t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
// Hindi / Persian digits -> 0-9
const toLatin = s => String(s)
    .replace(/[\u0660-\u0669]/g, c => c.charCodeAt(0) - 0x0660)
    .replace(/[\u06F0-\u06F9]/g, c => c.charCodeAt(0) - 0x06F0);
const sumMinutes = () => entries.reduce((s, e) => s + e.minutes, 0);
const isDayOff = d => {
    const [y, m, day] = d.split('/').map(Number);
    return DAYS_OFF.includes(new Date(y, m - 1, day).getDay());
};
const hasAbsence = date => entries.some(e => e.type === 'abs' && e.date <= date && e.end >= date);
// Last day of an absence of n working days that starts on `start` (days off are skipped)
const absenceEnd = (start, n) => {
    const [y, m, day] = start.split('/').map(Number);
    const d = new Date(y, m - 1, day);
    for (let counted = 1; counted < n;) {
        d.setDate(d.getDate() + 1);
        if (!DAYS_OFF.includes(d.getDay())) counted++;
    }
    return fmtDate(d);
};

// Times are stored as 24h "HH:MM"; the dial is a plain 12-hour clock without AM/PM letters.
// Working-day convention: dial hours 7-11 are morning, 12 is noon, 1-6 are afternoon.
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const to24 = h => (h >= 7 ? h : h + 12);   // dial hour (1-12) -> 24h hour
const fmt12 = min => `${pad(Math.floor(min / 60) % 12 || 12)}:${pad(min % 60)}`;
const readTime = id => {
    const v = $(id).dataset.min;
    return v === undefined ? null : Number(v);
};
const clearField = id => {
    const el = $(id);
    el.value = '';
    delete el.dataset.min;
    el.parentElement.classList.remove('filled');
};

// ===== Rendering =====
// Clears the calculator fields and results (used on startup and after any deletion)
function clearTimeCalc() {
    ['calc-late-in', 'calc-early-in'].forEach(clearField);
    if ($('calc-late-out')) $('calc-late-out').innerText = '00:00';
    if ($('calc-early-out')) $('calc-early-out').innerText = '00:00';
}

function updateTimeCalc() {
    const earlyEnd = 14 * 60 + 30;

    if ($('calc-late-out')) $('calc-late-out').innerText = '00:00';
    if ($('calc-early-out')) $('calc-early-out').innerText = '00:00';

    const lateIn = readTime('calc-late-in');
    if (lateIn !== null) {
        const diff = lateIn - DAY_START;
        if (diff >= 0) {
            if ($('calc-late-out')) $('calc-late-out').innerText = hhmm(diff);
        }
    }

    const earlyIn = readTime('calc-early-in');
    if (earlyIn !== null) {
        const diff = earlyEnd - earlyIn;
        if (diff >= 0) {
            if ($('calc-early-out')) $('calc-early-out').innerText = hhmm(diff);
        }
    }
}

function render() {
    const used = sumMinutes();
    const left = Math.max(0, TOTAL_MIN - used);
    const avail = Math.max(0, DIAL_FULL_AT - used);

    const card = $('timer-card'), dcard = $('delay-card');
    $('main-hours').innerText = hhmm(left);
    $('total-label').innerText = left <= PURPLE_AT ? 'ساعات متاحة بحسم' : 'إجمالي الساعات';
    card.dataset.state = left < PURPLE_AT ? 'purple' : 'green';
    card.style.setProperty('--pct', (left / TOTAL_MIN) * 100);
    $('stat-delay').innerText = hhmm(avail);
    dcard.dataset.state = avail > 0 ? 'green' : 'red';   // red = no available time left
    dcard.style.setProperty('--pct', Math.min(100, (used / DIAL_FULL_AT) * 100));

    // Entries can be added in any order. Both tables draw on one shared pool, so everything is ordered by
    // date and time: colors follow that chronological order (green while available hours remained before
    // the entry - the entry that exhausts them is green too - purple afterwards) and each table lists newest first.
    const key = e => `${e.date} ${e.start || '00:00'} ${e.end || '00:00'}`;
    const sorted = entries.map((e, i) => ({ e, i })).sort((a, b) => (key(a.e) < key(b.e) ? -1 : key(a.e) > key(b.e) ? 1 : 0));
    let before = 0;   // total consumed before each entry
    const rows = { delay: [], early: [], fp: [], abs: [] };
    sorted.forEach(({ e, i }) => {
        if (e.type === 'fp') {   // forgotten fingerprint: logged only, never counted
            rows.fp.push(`<div class="row" data-i="${i}"><div class="row-bg">حذف</div><div class="row-in two"><span>${e.date}</span><span>${e.kind}</span></div></div>`);
            return;
        }
        if (e.type === 'abs') {   // absence: logged only, never counted
            const when = e.days > 1
                ? `<span class="rng"><span dir="ltr">${e.date}</span> إلى <span dir="ltr">${e.end}</span></span>`
                : `<span>${e.date}</span>`;
            rows.abs.push(`<div class="row" data-i="${i}"><div class="row-bg">حذف</div><div class="row-in abs">${when}<span>${e.days}</span></div></div>`);
            return;
        }
        const lvl = before < DIAL_FULL_AT ? 'green' : 'purple';
        before += e.minutes;
        const range = e.start && e.end
            ? `<span class="rng"><span dir="ltr">${fmt12(toMin(e.start))}</span> - <span dir="ltr">${fmt12(toMin(e.end))}</span></span>`
            : '<span>-</span>';
        rows[e.type].push(`<div class="row lvl-${lvl}" data-i="${i}"><div class="row-bg">حذف</div><div class="row-in"><span>${e.date}</span>${range}<span>${hhmm(e.minutes)}</span></div></div>`);
    });
    ['delay', 'early', 'fp', 'abs'].forEach(t => {
        $(`${t}-body`).innerHTML = rows[t].reverse().join('');   // newest first
        $(`${t}-empty`).hidden = rows[t].length > 0;
        $(`${t}-hint`).hidden = rows[t].length === 0;
    });
}

function showError(msg) {
    const errDiv = $('error-log');
    errDiv.innerText = msg;
    setTimeout(() => errDiv.innerText = "", 3000);
}

// ===== Persistence (localStorage: stays on this device / browser) =====
const snapshotState = () => ({ log: entries, month: Number($('month-sel').value) });

// Older saves used dd/mm/yyyy; dates are now yyyy/mm/dd
const normDate = d => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

function applyState(s) {
    const log = Array.isArray(s && s.log) ? s.log : [];
    const valid = e => {
        if (!e || !okDate(e.date)) return false;
        if (e.type === 'fp') return KINDS.includes(e.kind);
        if (e.type === 'abs') return okDate(e.end) && e.end >= e.date && Number.isInteger(e.days) && e.days > 0;
        return Number.isInteger(e.minutes) && e.minutes > 0;
    };
    entries = log
        .map(e => e && Object.assign({}, e, { date: normDate(e.date) }))
        .filter(valid)
        .map(e => {
            if (e.type === 'fp') return { type: 'fp', date: e.date, kind: e.kind, minutes: 0 };
            if (e.type === 'abs') return { type: 'abs', date: e.date, end: e.end, days: e.days, minutes: 0 };
            return {
                type: e.type === 'early' ? 'early' : 'delay',
                date: e.date,
                minutes: e.minutes,
                start: okTime(e.start) ? e.start : '',
                end: okTime(e.end) ? e.end : ''
            };
        });
    const mo = s && s.month;
    $('month-sel').value = Number.isInteger(mo) && mo >= 0 && mo <= 11 ? mo : new Date().getMonth();
}

function saveLocal() {
    try { localStorage.setItem(KEY, JSON.stringify(snapshotState())); return true; }
    catch (e) { return false; }
}

function save() {
    if (!saveLocal()) showError("تعذّر حفظ البيانات في هذا المتصفح");
}

// ===== Actions =====
function addEntry(entry) {
    const before = sumMinutes();
    if (TOTAL_MIN - before - entry.minutes < 0) {
        showError("خطأ: الساعات المتبقية لا تكفي");
        return false;
    }
    entries.push(entry);
    render();
    save();
    // The entry that uses up the available hours (7h) triggers a notice that stays until the OK button is pressed
    if (before < DIAL_FULL_AT && before + entry.minutes >= DIAL_FULL_AT) $('notice-overlay').hidden = false;
    return true;
}

function addLate() {
    const b = readTime('d-time');
    const date = $('d-date').value || fmtDate(new Date());   // no date chosen -> today

    if (b === null) return showError("يرجى إدخال وقت صحيح");
    if (b < DAY_START || b > DAY_END) return showError("الوقت المسموح من 7:30 صباحاً حتى 2:30 مساءً");
    if (b === DAY_START) return showError("وقت الدخول يجب أن يكون بعد 7:30 صباحاً");
    if (isDayOff(date)) return showError("التاريخ يوافق يوم إجازة");
    if (hasAbsence(date)) return showError("لا يمكن إضافة سجل لوجود سجل غياب في نفس اليوم");
    if (entries.some(e => e.type === 'delay' && e.date === date)) return showError("لا يمكن إضافة دخول متأخر مرتين في يوم واحد");
    if (addEntry({ type: 'delay', date, minutes: b - DAY_START, start: hhmm(DAY_START), end: hhmm(b) })) {
        ['d-time', 'd-date'].forEach(clearField);   // inputs are empty again once the row is in the table
    }
}

// Early departure: from 07:30 onwards, duration = end - start.
function addEarly() {
    const a = readTime('e-from'), b = readTime('e-to');
    const date = $('e-date').value || fmtDate(new Date());   // no date chosen -> today

    if (a === null || b === null) return showError("يرجى إدخال وقت صحيح");
    if (a < DAY_START) return showError("الوقت المسموح يبدأ من الساعة 7:30 صباحاً");
    if (b <= a) return showError("وقت النهاية يجب أن يكون بعد وقت البداية");
    if (isDayOff(date)) return showError("التاريخ يوافق يوم إجازة");
    if (hasAbsence(date)) return showError("لا يمكن إضافة سجل لوجود سجل غياب في نفس اليوم");
    if (entries.some(e => e.type === 'early' && e.date === date)) return showError("لا يمكن إضافة خروج مبكر مرتين في يوم واحد");
    if (addEntry({ type: 'early', date, minutes: b - a, start: hhmm(a), end: hhmm(b) })) {
        ['e-from', 'e-to', 'e-date'].forEach(clearField);
    }
}

// Forgotten fingerprint: only logged in its own table, never touches the time dials
function addFp() {
    const kind = $('f-kind').value;
    const date = $('f-date').value || fmtDate(new Date());   // no date chosen -> today

    if (!kind) return showError("يرجى اختيار نوع الحركة");
    if (entries.filter(e => e.type === 'fp').length >= MAX_FP) return showError("لا يمكن تقديم أكثر من 5 طلبات في الشهر");
    if (isDayOff(date)) return showError("التاريخ يوافق يوم إجازة");
    if (hasAbsence(date)) return showError("لا يمكن إضافة سجل لوجود سجل غياب في نفس اليوم");
    if (kind === 'حضور' && entries.some(e => e.type === 'delay' && e.date === date)) return showError("لا يمكن تسجيل نسيان بصمة حضور لوجود سجل حضور متأخر");
    if (kind === 'انصراف' && entries.some(e => e.type === 'early' && e.date === date)) return showError("لا يمكن تسجيل نسيان بصمة انصراف لوجود سجل خروج مبكر");
    if (entries.some(e => e.type === 'fp' && e.date === date && e.kind === kind)) return showError("لا يمكن إضافة نفس نوع الحركة مرتين في يوم واحد");
    entries.push({ type: 'fp', date, kind, minutes: 0 });
    render();
    save();
    ['f-kind', 'f-date'].forEach(clearField);
}

// Absence: n working days from the chosen date; logged only, never touches the time dials
function addAbs() {
    const days = Number(toLatin($('a-days').value));
    const date = $('a-date').value || fmtDate(new Date());   // no date chosen -> today

    if (!Number.isInteger(days) || days < 1 || days > MAX_ABS) return showError("عدد الأيام غير صحيح");
    if (isDayOff(date)) return showError("التاريخ يوافق يوم إجازة");
    const end = absenceEnd(date, days);
    const clash = entries.some(e => (e.type === 'abs' ? e.date <= end && e.end >= date : e.date >= date && e.date <= end));
    if (clash) return showError("لا يمكن تسجيل غياب لوجود سجل سابق في نفس اليوم");
    entries.push({ type: 'abs', date, end, days, minutes: 0 });
    render();
    save();
    ['a-days', 'a-date'].forEach(clearField);
}

// Two-tap confirmation (window.confirm is unreliable in embedded views)
function disarmReset() {
    const btn = $('btn-reset');
    clearTimeout(resetTimer);
    resetTimer = null;
    btn.innerText = btn.dataset.label;
    btn.classList.remove('armed');
}

function resetAll() {
    const btn = $('btn-reset');
    if (resetTimer === null) {
        btn.dataset.label = btn.innerText;
        btn.innerText = 'اضغط مرة أخرى لتأكيد الحذف';
        btn.classList.add('armed');
        resetTimer = setTimeout(disarmReset, 3000);
        return;
    }
    disarmReset();
    entries = [];
    ['d-time', 'd-date', 'e-from', 'e-to', 'e-date', 'f-kind', 'f-date', 'a-days', 'a-date'].forEach(clearField);
    clearTimeCalc();
    $('month-sel').value = new Date().getMonth();
    render();
    save();
}

// ===== Row swipe: right to left deletes =====
function onSwipeStart(e) {
    const row = e.target.closest('.row');
    if (!row || drag || removing || e.button !== 0) return;
    const inner = row.querySelector('.row-in');
    inner.style.transition = 'none';
    drag = { row, inner, x0: e.clientX, id: e.pointerId, dx: 0 };
    try { row.setPointerCapture(e.pointerId); } catch (err) {}
}

function onSwipeMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = Math.min(0, e.clientX - drag.x0);   // leftwards only
    drag.inner.style.transform = `translateX(${drag.dx}px)`;
    drag.row.classList.toggle('ready', -drag.dx >= drag.row.offsetWidth * SWIPE_RATIO);
}

function onSwipeEnd(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { row, inner, dx } = drag;
    drag = null;
    inner.style.transition = '';
    if (e.type === 'pointerup' && -dx >= row.offsetWidth * SWIPE_RATIO) {
        removing = true;
        inner.style.transform = 'translateX(-105%)';
        setTimeout(() => {
            entries.splice(+row.dataset.i, 1);
            removing = false;
            render();
            clearTimeCalc();
            save();
        }, 180);
    } else {
        inner.style.transform = '';
        row.classList.remove('ready');
    }
}

// ===== Calendar popup =====
function renderCal() {
    $('cal-title').innerText = `${MONTHS[viewM]} ${viewY}`;
    const offset = new Date(viewY, viewM, 1).getDay();       // Sunday-first
    const count = new Date(viewY, viewM + 1, 0).getDate();
    const today = fmtDate(new Date());
    let html = '<i></i>'.repeat(offset);
    for (let d = 1; d <= count; d++) {
        const v = `${viewY}/${pad(viewM + 1)}/${pad(d)}`;
        html += `<button type="button" class="day${v === calTarget.value ? ' sel' : ''}${v === today ? ' today' : ''}" data-v="${v}">${d}</button>`;
    }
    $('cal-days').innerHTML = html;
}

function openCal(input) {
    calTarget = input;
    const m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(input.value);
    const base = m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date();
    viewY = base.getFullYear();
    viewM = base.getMonth();
    renderCal();
    $('cal-overlay').hidden = false;
}

function closeCal() { $('cal-overlay').hidden = true; }

function pickDate(v) {
    calTarget.value = v;
    calTarget.parentElement.classList.toggle('filled', !!v);
    closeCal();
}

function shiftMonth(step) {
    viewM += step;
    if (viewM < 0) { viewM = 11; viewY--; }
    if (viewM > 11) { viewM = 0; viewY++; }
    renderCal();
}

// ===== Time wheel popup (12-hour dial: hours 1-12, minutes 00-59) =====
const wheelH = $('w-h'), wheelM = $('w-m');

function fillWheel(el, items) {
    el.innerHTML = '<div class="sp"></div>' + items.map(t => `<div class="wi">${t}</div>`).join('') + '<div class="sp"></div>';
}

const wheelIndex = (el, max) => Math.max(0, Math.min(max, Math.round(el.scrollTop / ROW)));

// Rows fade and shrink with distance from the centre; the big readout follows the wheels
function paintWheel(el) {
    const pos = el.scrollTop / ROW;
    el.querySelectorAll('.wi').forEach((it, i) => {
        const d = Math.min(Math.abs(i - pos), 3);
        it.style.opacity = 1 - d * 0.3;
        it.style.transform = `scale(${1 - d * 0.1})`;
    });
}

function paintClock() {
    paintWheel(wheelH);
    paintWheel(wheelM);
    $('clock-live').innerText = `${pad(wheelIndex(wheelH, 11) + 1)}:${pad(wheelIndex(wheelM, 59))}`;
}

function openClock(input) {
    clockTarget = input;
    const label = document.querySelector(`label[for="${input.id}"]`);
    $('clock-title').innerText = label ? label.innerText : (input.dataset.title || '');
    const min = input.dataset.min === undefined ? DAY_START : Number(input.dataset.min);   // empty -> 07:30
    $('clock-overlay').hidden = false;
    wheelH.scrollTop = ((Math.floor(min / 60) % 12 || 12) - 1) * ROW;
    wheelM.scrollTop = (min % 60) * ROW;
    paintClock();
}

function closeClock() { $('clock-overlay').hidden = true; }

function confirmClock() {
    const min = to24(wheelIndex(wheelH, 11) + 1) * 60 + wheelIndex(wheelM, 59);
    clockTarget.dataset.min = min;
    clockTarget.value = fmt12(min);
    clockTarget.parentElement.classList.add('filled');
    updateTimeCalc();
    closeClock();
}

// ===== Init =====
document.querySelectorAll('.date-field:not(.typed)').forEach(f =>
    f.insertAdjacentHTML('beforeend', f.querySelector('.time-input') ? CLOCK_ICON : f.querySelector('select') ? CHEVRON_ICON : CAL_ICON));

document.querySelectorAll('.date-input, .time-input').forEach(el => {
    const open = () => (el.classList.contains('time-input') ? openClock(el) : openCal(el));
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
});

// Time calculator fields: same wheel popup, smaller fields
document.querySelectorAll('.time-calc-input-wrap').forEach(w => w.insertAdjacentHTML('afterbegin', CLOCK_ICON));
document.querySelectorAll('.time-calc-input').forEach(el => {
    const open = () => openClock(el);
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
});

$('month-sel').innerHTML = MONTHS.map((m, i) => `<option value="${i}">${m}</option>`).join('');
$('month-sel').value = new Date().getMonth();
$('month-sel').addEventListener('change', save);

fillWheel(wheelH, Array.from({ length: 12 }, (_, i) => i + 1));
fillWheel(wheelM, Array.from({ length: 60 }, (_, i) => pad(i)));
[wheelH, wheelM].forEach(w => w.addEventListener('scroll', () => requestAnimationFrame(paintClock)));

$('btn-add').addEventListener('click', addLate);
$('btn-early').addEventListener('click', addEarly);
$('btn-fp').addEventListener('click', addFp);
document.querySelectorAll('.date-field select').forEach(sel =>
    sel.addEventListener('change', () => sel.parentElement.classList.toggle('filled', !!sel.value)));
$('btn-abs').addEventListener('click', addAbs);
$('a-days').addEventListener('input', e => {   // days are typed: digits only, caption moves up once there is a value
    e.target.value = toLatin(e.target.value).replace(/\D/g, '');
    e.target.parentElement.classList.toggle('filled', !!e.target.value);
});
$('btn-reset').addEventListener('click', resetAll);
$('notice-ok').addEventListener('click', () => { $('notice-overlay').hidden = true; });
$('cal-prev').addEventListener('click', () => shiftMonth(-1));
$('cal-next').addEventListener('click', () => shiftMonth(1));
$('cal-today').addEventListener('click', () => pickDate(fmtDate(new Date())));
$('cal-clear').addEventListener('click', () => pickDate(''));
$('cal-days').addEventListener('click', e => {
    const b = e.target.closest('.day');
    if (b) pickDate(b.dataset.v);
});
$('clock-ok').addEventListener('click', confirmClock);
$('clock-clear').addEventListener('click', () => { clearField(clockTarget.id); updateTimeCalc(); closeClock(); });
$('cal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeCal(); });
$('clock-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeClock(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeCal(); closeClock(); } });

const app = document.querySelector('.app');   // swipe covers both tables
app.addEventListener('pointerdown', onSwipeStart);
app.addEventListener('pointermove', onSwipeMove);
app.addEventListener('pointerup', onSwipeEnd);
app.addEventListener('pointercancel', onSwipeEnd);

try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved) applyState(saved);
} catch (e) {}
clearTimeCalc();
render();

// ===== PWA: keep saved entries from being cleaned up automatically, and work offline =====
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then(reg => reg.update())
        .catch(() => {}));
}
