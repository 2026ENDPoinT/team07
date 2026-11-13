import { authRequest } from '/js/auth/api.js';
import { createCalendarClient } from '/js/calendar-api.js';
import {
  MIN_CALENDAR_YEAR, MAX_CALENDAR_YEAR, calendarMonth, dateKey, monthCells,
  moveMonth, sortedEvents, eventRange, eventOccursOn, eventOverlapsMonth,
  eventPeriod, ddayLabel, shiftCalendarDate, weekDates
} from '/js/calendar-model.js';

const $ = selector => document.querySelector(selector);
let selected = dateKey();
let month = selected.slice(0, 7);
let view = new URLSearchParams(window.location.search).get('view');
if (!['month', 'week', 'list'].includes(view)) view = 'month';
let state = null;
let client;
let busy = false;
let stale = false;
let editingId = null;
let deletingId = null;
const dialog = $('#event-dialog');
const deleteDialog = $('#delete-dialog');
const form = $('#event-form');
const message = $('#calendar-message');
const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];
const labelDate = key => `${Number(key.slice(0,4))}년 ${Number(key.slice(5,7))}월 ${Number(key.slice(8,10))}일`;
const labelShortDate = key => `${Number(key.slice(5,7))}.${String(Number(key.slice(8,10))).padStart(2,'0')}`;
const weekday = key => {
  const [year, number, day] = key.split('-').map(Number);
  const date = new Date(0); date.setUTCFullYear(year, number - 1, day);
  return date.getUTCDay();
};
const timeToMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function controls() {
  $('#add-event').disabled = busy || !state || stale;
  $('#add-event-on-day').disabled = busy || !state || stale;
  $('#reload-calendar').disabled = busy;
  $('#reload-in-dialog').disabled = busy;
  $('#save-event').disabled = busy || stale;
  $('#event-fields').disabled = busy;
  $('#cancel-event').disabled = busy;
  $('#confirm-delete').disabled = busy || stale;
  $('#cancel-delete').disabled = busy;
  $('#logout-button').disabled = busy;
  $('#reload-in-dialog').hidden = !stale;
  $('#calendar-content').setAttribute('aria-busy', String(busy));
  for (const button of document.querySelectorAll('[data-event-action]')) button.disabled = busy || stale;
}

function selectDay(key, focus = false) {
  if (!key) return;
  selected = key;
  month = key.slice(0, 7);
  render();
  if (focus) $('#selected-day-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function selectDateButton(key, dayEvents, mini = false) {
  const button = element('button', mini ? 'mini-day' : `calendar-day${key.startsWith(month) ? '' : ' outside-month'}`);
  button.type = 'button';
  button.dataset.date = key;
  button.setAttribute('aria-label', `${labelDate(key)}${key === dateKey() ? ', 오늘' : ''}, 일정 ${dayEvents.length}개`);
  button.setAttribute('aria-pressed', String(key === selected));
  if (key === dateKey()) button.setAttribute('aria-current', 'date');
  if (mini) {
    button.textContent = String(Number(key.slice(8)));
    if (dayEvents.length) button.classList.add('has-events');
  } else {
    button.append(element('span', 'day-number', String(Number(key.slice(8)))));
    for (const event of dayEvents.slice(0, 2)) {
      const label = ddayLabel(event);
      const chip = element('span', `day-event${label ? ' day-event-dday' : ''}`, `${label ? `${label} · ` : ''}${event.title}`);
      chip.title = chip.textContent;
      button.append(chip);
    }
    if (dayEvents.length > 2) button.append(element('span', 'day-more', `+${dayEvents.length - 2}개`));
  }
  button.addEventListener('click', () => {
    selectDay(key);
    document.querySelector(`${mini ? '#mini-calendar-days' : '#calendar-days'} [data-date="${key}"]`)?.focus({ preventScroll: true });
  });
  return button;
}

function renderMonth(ordered) {
  const cells = monthCells(month);
  $('#calendar-days').replaceChildren(...cells.map(key => key
    ? selectDateButton(key, ordered.filter(event => eventOccursOn(event, key)))
    : element('span', 'calendar-day')));
}

function renderMiniCalendar(ordered) {
  const current = monthCells(month);
  $('#mini-month-title').textContent = `${Number(month.slice(0,4))}년 ${Number(month.slice(5,7))}월`;
  $('#mini-month-count').textContent = `${ordered.filter(event => eventOverlapsMonth(event, month)).length}개`;
  $('#mini-calendar-days').replaceChildren(...current.map(key => key
    ? selectDateButton(key, ordered.filter(event => eventOccursOn(event, key)), true)
    : element('span', 'mini-day mini-day-empty')));
  for (const button of $('#mini-calendar-days').children) {
    if (button.dataset.date && !button.dataset.date.startsWith(month)) button.classList.add('outside-month');
  }
}

function openDelete(event) {
  deletingId = event.id;
  $('#delete-description').textContent = `“${event.title}” 일정을 삭제합니다.`;
  $('#delete-message').textContent = '';
  deleteDialog.showModal();
}

function eventActionButtons(event) {
  const actions = element('div', 'form-actions event-actions');
  for (const [action, label, className] of [['edit', '수정', 'secondary-button'], ['delete', '삭제', 'delete-button']]) {
    const button = element('button', className, label);
    button.type = 'button';
    button.dataset.eventAction = action;
    button.setAttribute('aria-label', `${event.title} ${label}`);
    button.addEventListener('click', () => action === 'edit' ? openEditor(event) : openDelete(event));
    actions.append(button);
  }
  return actions;
}

function renderDay(events, today) {
  $('#selected-date').textContent = `${labelDate(selected)} (${weekdayNames[weekday(selected)]})`;
  const dayEvents = sortedEvents(events, selected);
  $('#day-count').textContent = state ? `${dayEvents.length}개의 일정` : '일정을 불러오는 중입니다.';
  $('#event-list').replaceChildren(...(dayEvents.length ? dayEvents.map(event => {
    const item = element('li', 'event-card');
    const info = element('div', 'event-card-info');
    info.append(element('span', 'event-time', eventPeriod(event)), element('h3', '', event.title));
    const label = ddayLabel(event, today);
    if (label) info.append(element('span', 'dday-badge', label));
    if (event.notes) info.append(element('p', 'event-notes', event.notes));
    item.append(info, eventActionButtons(event));
    return item;
  }) : [element('li', 'event-empty', state ? '선택한 날짜에 일정이 없습니다. ‘+ 이날 일정’으로 등록해 보세요.' : '새로고침 버튼으로 일정을 불러올 수 있습니다.') ]));
}

function calendarWeekLabel(keys) {
  const first = keys.find(Boolean), last = keys.filter(Boolean).at(-1);
  if (!first || !last) return '주간 일정';
  return first.slice(0,4) === last.slice(0,4)
    ? `${Number(first.slice(0,4))}년 ${Number(first.slice(5,7))}월 ${Number(first.slice(8))}일 – ${Number(last.slice(5,7))}월 ${Number(last.slice(8))}일`
    : `${labelDate(first)} – ${labelDate(last)}`;
}

function renderWeek(ordered) {
  const days = weekDates(selected);
  $('#week-period-label').textContent = calendarWeekLabel(days);
  $('#week-day-picker').replaceChildren(...days.map(day => {
    if (!day) return element('span', 'week-picker-blank');
    const button = element('button', 'week-picker-day');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(day === selected));
    button.setAttribute('aria-label', `${labelDate(day)} ${weekdayNames[weekday(day)]}요일`);
    if (day === dateKey()) button.classList.add('is-today');
    button.append(element('span', 'week-picker-weekday', weekdayNames[weekday(day)]), element('strong', '', String(Number(day.slice(8)))));
    button.addEventListener('click', () => selectDay(day));
    return button;
  }));

  const dayEvents = days.map(day => day ? ordered.filter(event => eventOccursOn(event, day)) : []);
  // The visible hour range expands to accommodate early/late meetings.
  const timed = dayEvents.flatMap((items, index) => items.filter(event =>
    event.time && eventRange(event).date === eventRange(event).endDate && days[index] === event.date));
  const minHour = timed.length ? Math.min(8, ...timed.map(event => Math.floor(timeToMinutes(event.time) / 60))) : 8;
  const maxHour = timed.length ? Math.max(19, ...timed.map(event => Math.ceil(timeToMinutes(eventRange(event).endTime) / 60))) : 19;
  const firstHour = Math.max(0, minHour), lastHour = Math.min(24, Math.max(maxHour, firstHour + 1));
  const pixelsPerHour = 60;
  const height = (lastHour - firstHour) * pixelsPerHour;
  const board = $('#week-board');
  board.replaceChildren();
  const allDay = element('div', 'week-all-day');
  allDay.append(element('span', 'week-all-day-label', '종일 · 여러 날'));
  const timeGrid = element('div', 'week-grid');
  const axis = element('div', 'week-hour-axis');
  axis.style.height = `${height}px`;
  for (let hour = firstHour; hour <= lastHour; hour++) {
    const label = element('span', 'week-hour-label', `${String(hour).padStart(2,'0')}:00`);
    label.style.top = `${(hour - firstHour) * pixelsPerHour}px`;
    axis.append(label);
  }
  timeGrid.append(axis);
  for (let index = 0; index < days.length; index++) {
    const day = days[index];
    const allDayCell = element('div', `week-all-day-cell${day === selected ? ' week-selected' : ''}`);
    const column = element('div', `week-day-column${day === selected ? ' week-selected' : ''}`);
    column.style.height = `${height}px`;
    column.style.setProperty('--week-hour-height', `${pixelsPerHour}px`);
    column.style.setProperty('--week-hours', String(lastHour - firstHour));
    if (day) {
      for (const event of dayEvents[index]) {
        const span = eventRange(event);
        if (event.time && span.date === span.endDate) continue;
        const button = element('button', 'week-all-day-event', event.title);
        button.type = 'button';
        button.title = `${event.title} · ${eventPeriod(event)}`;
        button.addEventListener('click', () => selectDay(day, true));
        allDayCell.append(button);
      }
      const timedToday = dayEvents[index].filter(event => event.time && eventRange(event).date === eventRange(event).endDate);
      const placements = timedToday.map(event => ({
        event,
        start: timeToMinutes(event.time),
        end: Math.max(timeToMinutes(event.time) + 15, timeToMinutes(eventRange(event).endTime))
      })).sort((a, b) => a.start - b.start || a.end - b.end);
      // Resolve overlapping events into separate lanes instead of covering one another.
      let group = [];
      const flush = () => {
        if (!group.length) return;
        const ends = [];
        for (const entry of group) {
          let lane = ends.findIndex(value => value <= entry.start);
          if (lane === -1) lane = ends.length;
          ends[lane] = entry.end;
          entry.lane = lane;
        }
        const lanes = ends.length;
        for (const entry of group) {
          const button = element('button', 'week-time-event');
          button.type = 'button';
          const minutes = Math.max(0, entry.start - firstHour * 60);
          button.style.top = `${minutes / 60 * pixelsPerHour}px`;
          button.style.height = `${Math.max(34, (entry.end - entry.start) / 60 * pixelsPerHour)}px`;
          button.style.left = `${entry.lane / lanes * 100}%`;
          button.style.width = `${100 / lanes}%`;
          button.title = `${entry.event.title} · ${eventPeriod(entry.event)}`;
          button.append(element('strong', '', entry.event.title), element('span', '', entry.event.time));
          button.addEventListener('click', () => selectDay(day, true));
          column.append(button);
        }
        group = [];
      };
      let currentEnd = -1;
      for (const entry of placements) {
        if (group.length && entry.start >= currentEnd) { flush(); currentEnd = -1; }
        group.push(entry); currentEnd = Math.max(currentEnd, entry.end);
      }
      flush();
    }
    allDay.append(allDayCell);
    timeGrid.append(column);
  }
  board.append(allDay, timeGrid);
}

function renderFullList(ordered) {
  const list = $('#all-event-list');
  const today = dateKey();
  $('#calendar-total-count').textContent = `${ordered.length}개의 일정`;
  if (!ordered.length) {
    list.replaceChildren(element('p', 'event-empty list-empty', '등록된 일정이 없습니다. ‘+ 일정 추가’ 버튼으로 첫 일정을 등록해 보세요.'));
    return;
  }
  // Full list includes past and future data. A single multi-day event appears once, at its start date.
  const grouped = new Map();
  for (const event of ordered) {
    const group = grouped.get(event.date) ?? [];
    group.push(event);
    grouped.set(event.date, group);
  }
  const nodes = [];
  for (const [date, events] of grouped) {
    const section = element('section', 'all-events-group');
    const heading = element('div', 'all-event-date');
    heading.append(element('strong', '', labelShortDate(date)), element('span', '', `${weekdayNames[weekday(date)]}요일`));
    if (date === today) heading.append(element('span', 'list-today-pill', '오늘'));
    const rows = element('div', 'all-event-group-rows');
    section.append(heading, rows);
    for (const event of events) {
      const item = element('div', 'all-event-row');
      const info = element('div', 'all-event-info');
      const title = element('strong', '', event.title);
      const time = element('span', '', eventPeriod(event));
      info.append(title, time);
      if (event.notes) info.append(element('p', 'all-event-notes', event.notes));
      const label = ddayLabel(event, today);
      if (label) info.append(element('span', 'dday-badge', label));
      const actions = eventActionButtons(event);
      item.append(info, actions);
      rows.append(item);
    }
    nodes.push(section);
  }
  list.replaceChildren(...nodes);
}

function render() {
  const events = state?.events ?? [];
  const ordered = sortedEvents(events);
  const today = dateKey();
  const [year, number] = month.split('-').map(Number);
  $('#month-title').setAttribute('aria-label', `${year}년 ${number}월`);
  $('#calendar-year').value = String(year);
  $('#calendar-month').value = String(number);
  const prev = view === 'week' ? shiftCalendarDate(selected, -7) : moveMonth(month, -1);
  const next = view === 'week' ? shiftCalendarDate(selected, 7) : moveMonth(month, 1);
  $('#previous-month').disabled = !prev || (view !== 'week' && prev === month);
  $('#next-month').disabled = !next || (view !== 'week' && next === month);
  $('#month-count').textContent = state ? `${year}년 ${number}월 일정 ${events.filter(event => eventOverlapsMonth(event, month)).length}개` : '일정을 불러와 주세요.';
  for (const mode of ['month', 'week', 'list']) {
    $(`#view-${mode}`).setAttribute('aria-pressed', String(view === mode));
    $(`#calendar-${mode}-view`).hidden = view !== mode;
  }
  $('#month-title').hidden = view !== 'month';
  $('#week-period-label').hidden = view !== 'week';
  $('#list-period-label').hidden = view !== 'list';
  $('.calendar-period-actions').hidden = view === 'list';
  $('#calendar-view-hint').textContent = view === 'month'
    ? '날짜를 선택하면 아래에서 일정의 상세 내용을 확인할 수 있습니다.'
    : view === 'week'
      ? '시간표의 일정을 누르면 아래에서 상세 내용을 확인하고 수정할 수 있습니다.'
      : '과거·현재·미래의 모든 저장된 일정을 날짜순으로 표시합니다.';
  renderMiniCalendar(ordered);
  if (view === 'month') renderMonth(ordered);
  if (view === 'week') renderWeek(ordered);
  if (view === 'list') renderFullList(ordered);
  renderDay(events, today);
  controls();
}

function openEditor(event) {
  if (!state || busy || stale) return;
  editingId = event?.id ?? null;
  form.reset();
  $('#event-dialog-title').textContent = event ? '일정 수정' : '일정 추가';
  $('#event-title').value = event?.title ?? '';
  $('#event-date').value = event?.date ?? selected;
  $('#event-time').value = event?.time ?? '';
  $('#event-end-date').value = event ? eventRange(event).endDate : selected;
  $('#event-end-time').value = event ? eventRange(event).endTime : '';
  updateRangeConstraints();
  $('#event-notes').value = event?.notes ?? '';
  $('#event-dday').checked = event?.isDday === true;
  $('#event-message').textContent = '';
  controls();
  dialog.showModal();
  $('#event-title').focus();
}

function handleError(error, target) {
  if (error.status === 401) window.location.replace('/login.html');
  if (error.status === 403) {
    state = null;
    stale = true;
    if (dialog.open) dialog.close();
    if (deleteDialog.open) deleteDialog.close();
    message.textContent = error.message;
    render();
  } else {
    if (error.status === 409) stale = true;
    target.textContent = error.message;
  }
}

async function load() {
  if (busy) return;
  busy = true;
  controls();
  try {
    // 새로고침할 때도 현재 세션을 확인해 계정 전환 후의 오래된 화면을 차단합니다.
    const { user } = await authRequest('me');
    if (!client) client = createCalendarClient(user.id);
    $('#user-name').textContent = `${user.name}님`;
    state = await client.load();
    stale = false;
    message.textContent = '일정을 불러왔습니다.';
    if (dialog.open) $('#event-message').textContent = '최신 일정을 불러왔습니다. 입력 내용을 확인하고 다시 저장해 주세요.';
  } catch (error) {
    handleError(error, dialog.open ? $('#event-message') : message);
  } finally {
    busy = false;
    render();
  }
}

async function save(events) {
  // 성공한 응답을 받은 뒤에만 화면의 저장 상태를 교체합니다.
  state = await client.save({ events, revision: state.revision });
  stale = false;
}

form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || stale || !state || !form.reportValidity()) return;
  const title = $('#event-title').value.trim();
  if (!title) { $('#event-message').textContent = '일정 제목을 입력해 주세요.'; $('#event-title').focus(); return; }
  if (editingId && !state.events.some(item => item.id === editingId)) {
    $('#event-message').textContent = '다른 화면에서 이 일정이 삭제되었습니다. 취소한 뒤 새 일정으로 추가해 주세요.';
    return;
  }
  const date = $('#event-date').value;
  const time = $('#event-time').value;
  const endDate = $('#event-end-date').value;
  const endTime = $('#event-end-time').value;
  if (Boolean(time) !== Boolean(endTime)) {
    $('#event-message').textContent = '시작 시간과 종료 시간을 모두 입력하거나, 종일 일정은 두 시간을 모두 비워 주세요.';
    return;
  }
  if (endDate < date || (endDate === date && endTime < time)) {
    $('#event-message').textContent = '종료 시점은 시작 시점보다 빠를 수 없습니다.';
    return;
  }
  const item = { id: editingId ?? crypto.randomUUID(), title, date, time, endDate, endTime, notes: $('#event-notes').value, isDday: $('#event-dday').checked };
  const events = editingId ? state.events.map(old => old.id === editingId ? item : old) : [...state.events, item];
  busy = true;
  controls();
  $('#event-message').textContent = '저장하는 중입니다.';
  try {
    await save(events);
    selected = item.date;
    month = selected.slice(0, 7);
    dialog.close();
    message.textContent = '일정을 저장했습니다.';
  } catch (error) { handleError(error, $('#event-message')); }
  finally { busy = false; render(); }
});

$('#confirm-delete').addEventListener('click', async () => {
  if (busy || stale || !state) return;
  busy = true;
  controls();
  try {
    await save(state.events.filter(event => event.id !== deletingId));
    deleteDialog.close();
    message.textContent = '일정을 삭제했습니다.';
  } catch (error) {
    handleError(error, $('#delete-message'));
    if (stale && deleteDialog.open) {
      deleteDialog.close();
      message.textContent = `${error.message} 새로고침 버튼을 눌러 주세요.`;
    }
  } finally { busy = false; render(); }
});

$('#add-event').addEventListener('click', () => openEditor());
function updateRangeConstraints() {
  $('#event-end-date').min = $('#event-date').value || '0001-01-01';
}
$('#event-date').addEventListener('change', () => {
  // 시작 날짜를 앞으로 옮기면 종료 날짜도 유효한 범위로 따라갑니다.
  if ($('#event-end-date').value < $('#event-date').value) $('#event-end-date').value = $('#event-date').value;
  updateRangeConstraints();
});
$('#cancel-event').addEventListener('click', () => dialog.close());
$('#cancel-delete').addEventListener('click', () => deleteDialog.close());
for (const modal of [dialog, deleteDialog]) modal.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
for (const selector of ['#reload-calendar', '#reload-in-dialog']) $(selector).addEventListener('click', load);
// 옵션은 최초 한 번만 생성합니다. 조회할 달을 바꿔도 저장 API를 호출하지 않습니다.
function setupPeriodPicker() {
  const yearOptions = document.createDocumentFragment();
  for (let year = MIN_CALENDAR_YEAR; year <= MAX_CALENDAR_YEAR; year++) {
    const option = element('option', '', `${year}년`);
    option.value = String(year);
    yearOptions.append(option);
  }
  $('#calendar-year').replaceChildren(yearOptions);
  $('#calendar-month').replaceChildren(...Array.from({ length: 12 }, (_, index) => {
    const option = element('option', '', `${index + 1}월`);
    option.value = String(index + 1);
    return option;
  }));
  for (const selector of ['#calendar-year', '#calendar-month']) $(selector).addEventListener('change', () => {
    showMonth(calendarMonth(Number($('#calendar-year').value), Number($('#calendar-month').value)));
  });
}

function showMonth(nextMonth) {
  if (!nextMonth) return;
  month = nextMonth;
  selected = `${month}-01`;
  render();
}
function setView(mode) {
  view = mode;
  // Keep the selected date when switching modes; do not send anything to the DB.
  const url = new URL(window.location.href);
  if (mode === 'month') url.searchParams.delete('view');
  else url.searchParams.set('view', mode);
  window.history.replaceState(null, '', url);
  render();
}
for (const mode of ['month', 'week', 'list']) {
  $(`#view-${mode}`).addEventListener('click', () => setView(mode));
}
for (const [selector, delta] of [['#previous-month', -1], ['#next-month', 1]]) {
  $(selector).addEventListener('click', () => {
    if (view === 'week') {
      const next = shiftCalendarDate(selected, delta * 7);
      if (next) selectDay(next);
    } else showMonth(moveMonth(month, delta));
  });
}
$('#add-event-on-day').addEventListener('click', () => openEditor());
$('#today').addEventListener('click', () => selectDay(dateKey()));
$('#logout-button').addEventListener('click', async () => {
  busy = true;
  controls();
  try { await authRequest('logout', {}); window.location.replace('/login.html'); }
  catch (error) { message.textContent = error.message; }
  finally { busy = false; controls(); }
});

setupPeriodPicker();
render();
load();
