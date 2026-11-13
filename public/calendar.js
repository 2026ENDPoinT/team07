import { authRequest } from '/js/auth/api.js';
import { createCalendarClient } from '/js/calendar-api.js';
import { MIN_CALENDAR_YEAR, MAX_CALENDAR_YEAR, calendarMonth, dateKey, monthCells, moveMonth, sortedEvents, eventRange, eventOccursOn, eventOverlapsMonth, eventPeriod } from '/js/calendar-model.js';

const $ = selector => document.querySelector(selector);
let selected = dateKey();
let month = selected.slice(0, 7);
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
const labelDate = key => `${Number(key.slice(0, 4))}년 ${Number(key.slice(5, 7))}월 ${Number(key.slice(8, 10))}일`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function controls() {
  $('#add-event').disabled = busy || !state || stale;
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

function render() {
  const events = state?.events ?? [];
  const today = dateKey();
  const [year, number] = month.split('-').map(Number);
  $('#month-title').setAttribute('aria-label', `${year}년 ${number}월`);
  $('#calendar-year').value = String(year);
  $('#calendar-month').value = String(number);
  $('#previous-month').disabled = month === calendarMonth(MIN_CALENDAR_YEAR, 1);
  $('#next-month').disabled = month === calendarMonth(MAX_CALENDAR_YEAR, 12);
  $('#month-count').textContent = state ? `${year}년 ${number}월 일정 ${events.filter(event => eventOverlapsMonth(event, month)).length}개` : '일정을 불러와 주세요.';
  const ordered = sortedEvents(events);
  $('#calendar-days').replaceChildren(...monthCells(month).map(key => {
    if (!key) return element('span', 'calendar-day');
    const dayEvents = ordered.filter(event => eventOccursOn(event, key));
    const button = element('button', `calendar-day${key.startsWith(month) ? '' : ' outside-month'}`);
    button.type = 'button';
    button.dataset.date = key;
    button.setAttribute('aria-pressed', String(key === selected));
    button.setAttribute('aria-label', `${labelDate(key)}${key === today ? ', 오늘' : ''}, 일정 ${dayEvents.length}개`);
    if (key === today) button.setAttribute('aria-current', 'date');
    button.append(element('span', 'day-number', String(Number(key.slice(8)))));
    for (const event of dayEvents.slice(0, 2)) button.append(element('span', 'day-event', event.title));
    if (dayEvents.length > 2) button.append(element('span', 'day-more', `+${dayEvents.length - 2}개`));
    button.addEventListener('click', () => {
      selected = key;
      month = key.slice(0, 7);
      render();
      // 렌더링으로 교체한 날짜 버튼에 키보드 초점을 유지합니다.
      document.querySelector(`[data-date="${key}"]`)?.focus({ preventScroll: true });
    });
    return button;
  }));
  $('#selected-date').textContent = labelDate(selected);
  const dayEvents = sortedEvents(events, selected);
  $('#day-count').textContent = state ? `${dayEvents.length}개의 일정` : '일정을 불러오는 중입니다.';
  $('#event-list').replaceChildren(...(dayEvents.length ? dayEvents.map(event => {
    const item = element('li', 'event-card');
    item.append(element('span', 'event-time', eventPeriod(event)), element('h3', '', event.title));
    if (event.notes) item.append(element('p', 'event-notes', event.notes));
    const actions = element('div', 'form-actions');
    for (const [action, label, className] of [['edit', '수정', 'secondary-button'], ['delete', '삭제', 'delete-button']]) {
      const button = element('button', className, label);
      button.type = 'button';
      button.dataset.eventAction = action;
      button.setAttribute('aria-label', `${event.title} ${label}`);
      button.addEventListener('click', () => {
        if (action === 'edit') openEditor(event);
        else {
          deletingId = event.id;
          $('#delete-description').textContent = `“${event.title}” 일정을 삭제합니다.`;
          $('#delete-message').textContent = '';
          deleteDialog.showModal();
        }
      });
      actions.append(button);
    }
    item.append(actions);
    return item;
  }) : [element('li', 'event-empty', state ? '등록된 일정이 없습니다. ‘+ 일정 추가’로 새로운 일정을 기록하세요.' : '새로고침 버튼으로 일정을 불러올 수 있습니다.')]));
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
  const item = { id: editingId ?? crypto.randomUUID(), title, date, time, endDate, endTime, notes: $('#event-notes').value };
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

for (const [selector, delta] of [['#previous-month', -1], ['#next-month', 1]]) {
  $(selector).addEventListener('click', () => showMonth(moveMonth(month, delta)));
}
$('#today').addEventListener('click', () => { selected = dateKey(); month = selected.slice(0, 7); render(); });
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
