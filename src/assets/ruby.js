const TOGETHER_START = new Date('2026-01-25T21:36:00+08:00').getTime();
const DEFAULT_NEXT_MEET = new Date('2026-12-11T00:00:00+08:00').getTime();
const MEET_KEY = 'luckyrong_meet_date';

const $ = (id) => document.getElementById(id);

function pad(value) {
  return String(Math.max(0, Math.floor(value))).padStart(2, '0');
}

function formatHms(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${pad(seconds / 3600)}:${pad((seconds % 3600) / 60)}:${pad(seconds % 60)}`;
}

function formatClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.hour}:${values.minute}:${values.second}`;
}

function storedMeetDate() {
  const saved = Number(localStorage.getItem(MEET_KEY));
  return Number.isFinite(saved) && saved > 0 ? saved : DEFAULT_NEXT_MEET;
}

function tick() {
  const now = new Date();
  const nowMs = now.getTime();
  const togetherSeconds = Math.max(0, Math.floor((nowMs - TOGETHER_START) / 1000));
  const nextSeconds = Math.floor((storedMeetDate() - nowMs) / 1000);

  $('nz-time').textContent = formatClock(now, 'Pacific/Auckland');
  $('cn-time').textContent = formatClock(now, 'Asia/Shanghai');
  $('nz-time').dateTime = now.toISOString();
  $('cn-time').dateTime = now.toISOString();
  $('together-days').textContent = Math.floor(togetherSeconds / 86400);
  $('together-hms').textContent = formatHms(togetherSeconds % 86400);

  if (nextSeconds > 0) {
    $('next-days').textContent = Math.floor(nextSeconds / 86400);
    $('next-hms').textContent = formatHms(nextSeconds % 86400);
  } else {
    $('next-days').textContent = '0';
    $('next-hms').textContent = '今天';
  }
}

function addOptions(select, values) {
  values.forEach(([value, label]) => select.add(new Option(label, value)));
}

const dialog = $('meet-dialog');
const meetForm = $('meet-form');
const meetYear = $('meet-year');
const meetMonth = $('meet-month');
const meetDay = $('meet-day');
const meetHour = $('meet-hour');
const meetMinute = $('meet-minute');

addOptions(meetYear, Array.from({ length: 5 }, (_, index) => {
  const year = new Date().getFullYear() + index;
  return [year, year];
}));
addOptions(meetMonth, Array.from({ length: 12 }, (_, index) => [index + 1, `${index + 1}月`]));
addOptions(meetDay, Array.from({ length: 31 }, (_, index) => [index + 1, `${index + 1}日`]));
addOptions(meetHour, Array.from({ length: 24 }, (_, index) => [index, `${pad(index)}时`]));
addOptions(meetMinute, Array.from({ length: 60 }, (_, index) => [index, `${pad(index)}分`]));

$('meet-counter').addEventListener('click', () => {
  const date = new Date(storedMeetDate());
  meetYear.value = date.getFullYear();
  meetMonth.value = date.getMonth() + 1;
  meetDay.value = date.getDate();
  meetHour.value = date.getHours();
  meetMinute.value = date.getMinutes();
  dialog.showModal();
});

meetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const date = new Date(
    Number(meetYear.value),
    Number(meetMonth.value) - 1,
    Number(meetDay.value),
    Number(meetHour.value),
    Number(meetMinute.value),
  );
  localStorage.setItem(MEET_KEY, String(date.getTime()));
  dialog.close();
  tick();
});

$('meet-cancel').addEventListener('click', () => dialog.close());

$('wish-list').addEventListener('click', (event) => {
  const item = event.target.closest('.wish-item');
  if (!item) return;
  const done = item.getAttribute('aria-pressed') === 'true';
  item.setAttribute('aria-pressed', String(!done));
  item.classList.toggle('done', !done);
});

function initToggle(buttonId, bodyId) {
  const button = $(buttonId);
  const body = $(bodyId);

  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    button.classList.toggle('open', !open);
    body.classList.toggle('open', !open);
  });
}

tick();
setInterval(tick, 1000);
initToggle('timeline-toggle', 'timeline-body');
