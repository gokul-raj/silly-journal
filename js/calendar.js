// Memories: a wall calendar of journal pages, gym streak milestones and anniversaries.
import { sb, requireUser, nameOf, chipClass, signedUrl, el, toast, friendlyError } from './sb.js';
import { mountLayout } from './layout.js';
import { excerpt, firstPhotoPath } from './notebook.js';
import { streakMilestones, milestoneLabel } from './streak.js';
import { TOGETHER } from './config.js';

const ctx = await requireUser();
mountLayout(ctx, 'calendar.html');
const members = ctx.profiles.map((p) => p.id);
const $ = (id) => document.getElementById(id);

const ICON = {
  entry: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 19l3.5-1L19 7.5 16.5 5 6 15.5z"/></svg>',
  gym: '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 22c-4 0-7-2.8-7-6.6 0-3.2 2.2-5.2 3.6-7.2.4 1.6 1.3 2.6 2.2 3C10.4 7.6 12 4.4 14.8 2c-.3 3.2 1 5.2 2.4 7 1.2 1.5 1.8 3.2 1.8 5 0 4.4-3 8-7 8z"/></svg>',
  us: '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0112 7.3a4.2 4.2 0 017.5 2.5C19.5 15.4 12 20 12 20z"/></svg>'
};
const MARK_CLASS = { entry: 'm-entry', gym: 'm-gym', us: 'm-us' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Dates are shown in the viewer's own time zone.
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = keyOf(new Date());

// ───────── Gather memories ─────────
const byDay = new Map(); // key -> [event]
const add = (k, ev) => { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(ev); };

async function loadAll() {
  const [en, gp, gg] = await Promise.all([
    sb.from('entries').select('id, author, title, body_html, stickers, created_at').order('created_at'),
    sb.from('gym_posts').select('author, created_at').eq('kind', 'gym'),
    sb.from('gym_goals').select('goal, effective_from, created_at')
  ]);
  if (en.error) throw en.error;
  for (const e of en.data || []) {
    add(keyOf(new Date(e.created_at)), { type: 'entry', at: e.created_at, id: e.id, title: e.title || 'Untitled page', author: e.author, text: excerpt(e.body_html, 120), photo: firstPhotoPath(e.body_html, e.stickers) });
  }
  if (!gp.error && !gg.error) {
    for (const m of streakMilestones(gp.data || [], gg.data || [], members)) {
      add(keyOf(new Date(m.at)), { type: 'gym', at: m.at, title: milestoneLabel(m.weeks, m.restart), text: m.weeks === 1 ? 'We both hit the weekly gym goal.' : `${m.weeks} weeks in a row of both of us hitting the gym goal.` });
    }
  }
  // Anniversaries, through next year.
  const [ty, tm, td] = TOGETHER.split('-').map(Number);
  for (let y = ty; y <= new Date().getFullYear() + 1; y++) {
    const n = y - ty;
    add(`${y}-${pad(tm)}-${pad(td)}`, { type: 'us', at: `${y}-${pad(tm)}-${pad(td)}T00:00:00`, title: n === 0 ? 'The day we got together' : `${n} year${n === 1 ? '' : 's'} together`, text: n === 0 ? 'Where it all started.' : 'Happy anniversary!' });
  }
  for (const list of byDay.values()) list.sort((a, b) => (a.type === 'us' ? -1 : b.type === 'us' ? 1 : a.at < b.at ? -1 : 1));
}

// ───────── Calendar sheets ─────────
const params = new URLSearchParams(location.search);
let selected = /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : todayKey;
let view = fromKey(selected); view.setDate(1);
let sheet = null;
let busy = false;

function buildSheet(month) {
  const y = month.getFullYear(), m = month.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(y, m, 1 - first.getDay());
  const prev = el('button', { type: 'button', 'aria-label': 'Previous month', onclick: () => go(-1) }, '‹');
  const next = el('button', { type: 'button', 'aria-label': 'Next month', onclick: () => go(1) }, '›');
  const today = el('button', { type: 'button', class: 'today-btn', onclick: () => jumpTo(todayKey) }, 'Today');
  const head = el('div', { class: 'cal-head' },
    el('h2', { class: 'month', style: 'margin:0' }, MONTHS[m]), el('span', { class: 'year' }, String(y)),
    el('div', { class: 'nav' }, prev, today, next));
  const dow = el('div', { class: 'dow', 'aria-hidden': 'true' }, ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => el('span', {}, d)));
  const grid = el('div', { class: 'grid', role: 'group', 'aria-label': `${MONTHS[m]} ${y}` });
  let pages = 0, milestones = 0;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = keyOf(d);
    const evs = byDay.get(k) || [];
    const inMonth = d.getMonth() === m;
    if (inMonth) { pages += evs.filter((e) => e.type === 'entry').length; milestones += evs.filter((e) => e.type === 'gym').length; }
    const types = [...new Set(evs.map((e) => e.type))];
    const label = `${MONTHS[d.getMonth()]} ${d.getDate()}` + (evs.length ? `, ${evs.length} ${evs.length === 1 ? 'memory' : 'memories'}` : '');
    const cell = el('button', { type: 'button', class: 'day' + (inMonth ? '' : ' out') + (k === todayKey ? ' today' : ''), 'data-k': k, 'aria-pressed': String(k === selected), 'aria-label': label },
      el('span', { class: 'n' }, String(d.getDate())),
      types.length ? el('span', { class: 'marks', 'aria-hidden': 'true' }, types.map((t) => el('span', { class: 'mark ' + MARK_CLASS[t], html: ICON[t] }))) : null);
    const pic = inMonth && evs.find((e) => e.photo);
    if (pic) {
      const img = el('img', { class: 'thumb', alt: '', loading: 'lazy' });
      cell.prepend(img);
      signedUrl('journal', pic.photo).then((u) => { img.src = u; });
    }
    cell.addEventListener('click', () => { if (inMonth) select(k); else jumpTo(k); });
    grid.append(cell);
  }
  const bits = [];
  if (pages) bits.push(`${pages} journal page${pages === 1 ? '' : 's'}`);
  if (milestones) bits.push(`${milestones} gym milestone${milestones === 1 ? '' : 's'}`);
  const s = el('div', { class: 'sheet' }, head, dow, grid,
    el('p', { class: 'summary' }, bits.length ? bits.join(' · ') + ' this month' : 'Nothing here yet this month.'));
  return s;
}

function mount() {
  sheet = buildSheet(view);
  $('pages').replaceChildren(sheet);
}

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

// Flip forward: the current sheet lifts up over the rings. Flip back: the earlier sheet drops down.
async function go(dir, then) {
  if (busy) return;
  const nextView = new Date(view.getFullYear(), view.getMonth() + dir, 1);
  const old = sheet;
  const neu = buildSheet(nextView);
  view = nextView;
  if (reduced || !old || !old.animate) {
    sheet = neu; $('pages').replaceChildren(neu); if (then) then(); return;
  }
  busy = true;
  const box = $('pages');
  box.style.height = old.offsetHeight + 'px';
  const shade = [{ filter: 'brightness(1)' }, { filter: 'brightness(.85)' }];
  if (dir > 0) {
    box.prepend(neu);
    old.classList.add('flip');
    await old.animate([
      { transform: 'rotateX(0deg)', boxShadow: '0 10px 28px rgba(18,20,23,.08)' },
      { transform: 'rotateX(60deg)', boxShadow: '0 30px 40px rgba(18,20,23,.18)', offset: 0.5 },
      { transform: 'rotateX(100deg)', opacity: 0 }
    ], { duration: 650, easing: 'cubic-bezier(.4,.1,.3,1)' }).finished;
    old.remove();
  } else {
    neu.classList.add('flip');
    box.append(neu);
    old.animate(shade, { duration: 600, fill: 'forwards' });
    await neu.animate([
      { transform: 'rotateX(100deg)', opacity: 0 },
      { transform: 'rotateX(50deg)', opacity: 1, offset: 0.45 },
      { transform: 'rotateX(0deg)' }
    ], { duration: 650, easing: 'cubic-bezier(.3,.2,.2,1)' }).finished;
    old.remove();
    neu.classList.remove('flip');
  }
  box.style.height = '';
  sheet = neu;
  busy = false;
  if (then) then();
}

function jumpTo(k) {
  const d = fromKey(k);
  const diff = (d.getFullYear() - view.getFullYear()) * 12 + (d.getMonth() - view.getMonth());
  if (diff === 0) return select(k);
  if (Math.abs(diff) === 1) return go(diff, () => select(k));
  view = new Date(d.getFullYear(), d.getMonth() + (diff > 0 ? -1 : 1), 1);
  go(diff > 0 ? 1 : -1, () => select(k));
}

// ───────── Day panel ─────────
function select(k) {
  selected = k;
  sheet.querySelectorAll('.day').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.k === k)));
  history.replaceState(null, '', '?d=' + k);
  const d = fromKey(k);
  $('day-title').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  const evs = byDay.get(k) || [];
  $('day-sub').textContent = String(d.getFullYear()) + (k === todayKey ? ' · today' : '') + (evs.length ? ` · ${evs.length} ${evs.length === 1 ? 'memory' : 'memories'}` : '');
  if (!evs.length) {
    $('events').replaceChildren(el('p', { class: 'muted', style: 'margin:12px 0 0;font-family:var(--serif);font-size:17px' }, k === todayKey ? 'Nothing yet today. ' : k > todayKey ? 'This day hasn’t happened yet.' : 'No memories saved on this day.',
      k === todayKey ? el('a', { href: 'write.html' }, 'Write today’s page') : null));
    return;
  }
  $('events').replaceChildren(...evs.map((e) => {
    if (e.type === 'entry') {
      const pic = e.photo ? el('img', { class: 'pic', alt: '' }) : null;
      if (pic) signedUrl('journal', e.photo).then((u) => { pic.src = u; });
      const time = new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return el('a', { class: 'ev', href: 'entry.html?id=' + e.id },
        pic || el('span', { class: 'icon m-entry', html: ICON.entry }),
        el('div', { style: 'min-width:0' },
          el('h3', {}, e.title),
          el('div', { class: 'row', style: 'gap:8px;margin-top:4px' }, el('span', { class: chipClass(e.author) }, nameOf(e.author)), el('span', { class: 'small muted' }, time)),
          e.text ? el('p', {}, e.text) : null));
    }
    return el('div', { class: 'ev' },
      el('span', { class: 'icon ' + MARK_CLASS[e.type], html: ICON[e.type] }),
      el('div', { style: 'min-width:0' }, el('h3', {}, e.title), el('p', {}, e.text)));
  }));
}

// Swipe left/right on phones; arrow keys on the keyboard when not typing.
let touch = null;
$('pages').addEventListener('touchstart', (e) => { touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
$('pages').addEventListener('touchend', (e) => {
  if (!touch) return;
  const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
});
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, [contenteditable]')) return;
  if (e.key === 'PageDown') { e.preventDefault(); go(1); }
  if (e.key === 'PageUp') { e.preventDefault(); go(-1); }
});

$('legend').append(
  el('span', {}, el('span', { class: 'mark m-entry', html: ICON.entry }), 'Journal page'),
  el('span', {}, el('span', { class: 'mark m-gym', html: ICON.gym }), 'Gym streak milestone'),
  el('span', {}, el('span', { class: 'mark m-us', html: ICON.us }), 'Our anniversary'));

try {
  await loadAll();
} catch (e) {
  toast(friendlyError(e));
}
mount();
select(selected);
