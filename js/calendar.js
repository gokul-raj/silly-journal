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
  gympost: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M7 7v10M17 7v10M4 9.5v5M20 9.5v5M7 12h10"/></svg>',
  gym: '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 22c-4 0-7-2.8-7-6.6 0-3.2 2.2-5.2 3.6-7.2.4 1.6 1.3 2.6 2.2 3C10.4 7.6 12 4.4 14.8 2c-.3 3.2 1 5.2 2.4 7 1.2 1.5 1.8 3.2 1.8 5 0 4.4-3 8-7 8z"/></svg>',
  us: '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0112 7.3a4.2 4.2 0 017.5 2.5C19.5 15.4 12 20 12 20z"/></svg>',
  bday: '<svg viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M12 2.5c1.2 1.3 1.6 2.3 1.2 3.1-.3.6-.8.9-1.2.9s-.9-.3-1.2-.9c-.4-.8 0-1.8 1.2-3.1z"/><rect x="11.1" y="7" width="1.8" height="3.5"/><path d="M5 11.5h14a1 1 0 011 1V15c-1.2 0-1.8.8-2.7.8S15.7 15 14.7 15s-1.6.8-2.7.8-1.7-.8-2.7-.8-1.6.8-2.6.8S5.2 15 4 15v-2.5a1 1 0 011-1z"/><path d="M4 16.6c.9.3 1.6.9 2.6.9s1.7-.8 2.7-.8 1.6.8 2.7.8 1.7-.8 2.7-.8 1.6.8 2.6.8 1.7-.6 2.7-.9V21H4z"/></svg>'
};
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>';
const MARK_CLASS = { entry: 'm-entry', gympost: 'm-gympost', gym: 'm-gym', us: 'm-us', bday: 'm-bday' };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Dates are shown in the viewer's own time zone.
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const todayKey = keyOf(new Date());

// ───────── Gather memories ─────────
const byDay = new Map(); // key -> [event]
const highlights = new Map(); // key -> { entry_id, set_by }
let highlightsReady = false;  // false if the highlights table isn't set up yet
const add = (k, ev) => { if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(ev); };
let birthdays = []; // [{ user_id, month, day }]
const [ty, tm, td] = TOGETHER.split('-').map(Number);
const TYPE_ORDER = { us: 0, bday: 1 };

// Everything on a day: saved memories plus the yearly ones (anniversary, birthdays).
function eventsOf(k) {
  const [y, m, d] = k.split('-').map(Number);
  const list = [...(byDay.get(k) || [])];
  if (m === tm && d === td && y >= ty) {
    const n = y - ty;
    list.push({ type: 'us', at: k + 'T00:00:00', title: n === 0 ? 'The day we got together' : `${n} year${n === 1 ? '' : 's'} together`, text: n === 0 ? 'Where it all started.' : 'Happy anniversary!' });
  }
  for (const b of birthdays) {
    if (b.month === m && b.day === d) {
      const mine = b.user_id === ctx.me.id;
      list.push({ type: 'bday', at: k + 'T00:00:01', title: `${nameOf(b.user_id)}’s birthday`, text: mine ? 'Happy birthday to you!' : `Happy birthday, ${nameOf(b.user_id)}!` });
    }
  }
  return list.sort((a, b) => (TYPE_ORDER[a.type] ?? 9) - (TYPE_ORDER[b.type] ?? 9) || (a.at < b.at ? -1 : 1));
}

async function loadAll() {
  const [en, gp, gg, hl, bd] = await Promise.all([
    sb.from('entries').select('id, author, title, body_html, stickers, created_at').order('created_at'),
    sb.from('gym_posts').select('id, author, kind, body, photo_path, workouts, created_at'),
    sb.from('gym_goals').select('goal, effective_from, created_at'),
    sb.from('day_highlights').select('day, entry_id, set_by'),
    sb.from('birthdays').select('user_id, month, day')
  ]);
  if (!bd.error) birthdays = bd.data || [];
  if (!hl.error) {
    highlightsReady = true;
    for (const h of hl.data || []) highlights.set(h.day, h);
  }
  if (en.error) throw en.error;
  for (const e of en.data || []) {
    add(keyOf(new Date(e.created_at)), { type: 'entry', at: e.created_at, id: e.id, title: e.title || 'Untitled page', author: e.author, text: excerpt(e.body_html, 120), photo: firstPhotoPath(e.body_html, e.stickers) });
  }
  for (const g of gp.data || []) {
    add(keyOf(new Date(g.created_at)), { type: 'gympost', at: g.created_at, id: g.id, author: g.author, kind: g.kind, photo: g.photo_path,
      title: g.kind === 'gym' ? 'Gym post' : 'Gym question', text: gymSummary(g) });
  }
  if (!gp.error && !gg.error) {
    for (const m of streakMilestones((gp.data || []).filter((g) => g.kind === 'gym'), gg.data || [], members)) {
      add(keyOf(new Date(m.at)), { type: 'gym', at: m.at, title: milestoneLabel(m.weeks, m.restart), text: m.weeks === 1 ? 'We both hit the weekly gym goal.' : `${m.weeks} weeks in a row of both of us hitting the gym goal.` });
    }
  }
}

// "Squat 3 × 5 · Run 20 min — leg day!" (short, for the day list)
function gymSummary(g) {
  const parts = (g.workouts || []).map((w) => (w.type === 'cardio'
    ? [w.name, w.minutes ? w.minutes + ' min' : '', w.distance].filter(Boolean).join(' ')
    : [w.name, w.sets && w.reps ? `${w.sets} × ${w.reps}` : '', w.weight].filter(Boolean).join(' ')));
  const work = parts.slice(0, 3).join(' · ') + (parts.length > 3 ? ' …' : '');
  const note = excerptText(g.body || '', 90);
  return [work, note].filter(Boolean).join(' — ');
}
const excerptText = (t, n) => { t = t.replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

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
  let pages = 0, gymPosts = 0, milestones = 0;
  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const k = keyOf(d);
    const evs = eventsOf(k);
    const inMonth = d.getMonth() === m;
    if (inMonth) { pages += evs.filter((e) => e.type === 'entry').length; gymPosts += evs.filter((e) => e.type === 'gympost').length; milestones += evs.filter((e) => e.type === 'gym').length; }
    const types = [...new Set(evs.map((e) => e.type))].filter((t) => t !== 'gympost'); // gym posts: listed when you tap the day, no mark
    const label = `${MONTHS[d.getMonth()]} ${d.getDate()}` + (evs.length ? `, ${evs.length} ${evs.length === 1 ? 'memory' : 'memories'}` : '');
    const cell = el('button', { type: 'button', class: 'day' + (inMonth ? '' : ' out') + (k === todayKey ? ' today' : ''), 'data-k': k, 'aria-pressed': String(k === selected), 'aria-label': label },
      el('span', { class: 'n' }, String(d.getDate())),
      types.length ? el('span', { class: 'marks', 'aria-hidden': 'true' }, types.map((t) => el('span', { class: 'mark ' + MARK_CLASS[t], html: ICON[t] }))) : null);
    if (inMonth) paintThumb(cell, k);
    cell.addEventListener('click', () => { if (inMonth) select(k); else jumpTo(k); });
    grid.append(cell);
  }
  const bits = [];
  if (pages) bits.push(`${pages} journal page${pages === 1 ? '' : 's'}`);
  if (gymPosts) bits.push(`${gymPosts} gym post${gymPosts === 1 ? '' : 's'}`);
  if (milestones) bits.push(`${milestones} gym milestone${milestones === 1 ? '' : 's'}`);
  const s = el('div', { class: 'sheet' }, head, dow, grid,
    el('p', { class: 'summary' }, bits.length ? bits.join(' · ') + ' this month' : 'Nothing here yet this month.'));
  return s;
}

// The day's picture: the highlighted page if one was chosen, otherwise the first page with a photo.
function featured(k) {
  const evs = eventsOf(k).filter((e) => e.type === 'entry');
  const h = highlights.get(k);
  const chosen = h && evs.find((e) => e.id === h.entry_id);
  return chosen || evs.find((e) => e.photo) || null;
}
function paintThumb(cell, k) {
  cell.querySelectorAll('.thumb, .thumb-title').forEach((n) => n.remove());
  const f = featured(k);
  if (!f) return;
  const starred = highlights.has(k) && highlights.get(k).entry_id === f.id;
  cell.classList.toggle('starred', starred);
  if (f.photo) {
    const img = el('img', { class: 'thumb', alt: '', loading: 'lazy' });
    cell.prepend(img);
    signedUrl('journal', f.photo).then((u) => { img.src = u; });
  } else {
    cell.prepend(el('span', { class: 'thumb-title', 'aria-hidden': 'true' }, f.title));
  }
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
  const evs = eventsOf(k);
  $('day-sub').textContent = String(d.getFullYear()) + (k === todayKey ? ' · today' : '') + (evs.length ? ` · ${evs.length} ${evs.length === 1 ? 'memory' : 'memories'}` : '');
  if (!evs.length) {
    $('events').replaceChildren(el('p', { class: 'muted', style: 'margin:12px 0 0;font-family:var(--serif);font-size:17px' }, k === todayKey ? 'Nothing yet today. ' : k > todayKey ? 'This day hasn’t happened yet.' : 'No memories saved on this day.',
      k === todayKey ? el('a', { href: 'write.html' }, 'Write today’s page') : null));
    return;
  }
  const entries = evs.filter((e) => e.type === 'entry');
  const h = highlights.get(k);
  const chosenId = h && entries.some((e) => e.id === h.entry_id) ? h.entry_id : null;
  const ordered = chosenId ? [...evs].sort((a, b) => (a.id === chosenId ? -1 : b.id === chosenId ? 1 : 0)) : evs;
  $('events').replaceChildren(...ordered.map((e) => {
    if (e.type === 'entry') {
      const pic = e.photo ? el('img', { class: 'pic', alt: '' }) : null;
      if (pic) signedUrl('journal', e.photo).then((u) => { pic.src = u; });
      const time = new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      const link = el('a', { class: 'ev', href: 'entry.html?id=' + e.id },
        pic || el('span', { class: 'icon m-entry', html: ICON.entry }),
        el('div', { style: 'min-width:0' },
          el('h3', {}, e.title),
          el('div', { class: 'row', style: 'gap:8px;margin-top:4px' }, el('span', { class: chipClass(e.author) }, nameOf(e.author)), el('span', { class: 'small muted' }, time)),
          e.text ? el('p', {}, e.text) : null));
      const on = e.id === chosenId;
      const star = el('button', { type: 'button', class: 'star-btn', 'aria-pressed': String(on),
        title: on ? 'This is the day’s picture. Tap to unpick it.' : 'Make this the day’s picture on the calendar',
        html: STAR + `<span>${on ? 'Highlighted' : 'Highlight'}</span>` });
      star.addEventListener('click', () => setHighlight(k, on ? null : e.id));
      const who = on && h ? el('span', { class: 'star-by' }, `Picked by ${h.set_by === ctx.me.id ? 'you' : nameOf(h.set_by)}`) : null;
      return el('div', { class: 'ev-row' + (on ? ' on' : '') }, link,
        entries.length && highlightsReady ? el('div', { class: 'star-col' }, star, who) : null);
    }
    if (e.type === 'gympost') {
      const pic = e.photo ? el('img', { class: 'pic', alt: '' }) : null;
      if (pic) signedUrl('gym', e.photo).then((u) => { pic.src = u; });
      const time = new Date(e.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
      return el('a', { class: 'ev', href: 'fitness.html#post-' + e.id },
        pic || el('span', { class: 'icon m-gympost', html: ICON.gympost }),
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

// Pick (or unpick) the page that stands for a day. Either of us can change it.
async function setHighlight(k, entryId) {
  const prev = highlights.get(k);
  if (entryId) highlights.set(k, { day: k, entry_id: entryId, set_by: ctx.me.id });
  else highlights.delete(k);
  refreshDay(k);
  const { error } = entryId
    ? await sb.from('day_highlights').upsert({ day: k, entry_id: entryId, set_by: ctx.me.id, updated_at: new Date().toISOString() }, { onConflict: 'day' })
    : await sb.from('day_highlights').delete().eq('day', k);
  if (error) {
    if (prev) highlights.set(k, prev); else highlights.delete(k);
    refreshDay(k);
    toast(friendlyError(error));
    return;
  }
  toast(entryId ? 'That’s the day’s picture now.' : 'Back to the first photo of the day.');
}
function refreshDay(k) {
  const cell = sheet.querySelector(`.day[data-k="${k}"]`);
  if (cell) paintThumb(cell, k);
  if (selected === k) select(k);
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
  el('span', {}, el('span', { class: 'mark m-us', html: ICON.us }), 'Our anniversary'),
  el('span', {}, el('span', { class: 'mark m-bday', html: ICON.bday }), 'Birthday'));

try {
  await loadAll();
} catch (e) {
  toast(friendlyError(e));
}
mount();
select(selected);
