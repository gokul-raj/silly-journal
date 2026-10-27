import { sb, requireUser, nameOf, chipClass, signedUrl, el, fmtDate, toast, friendlyError } from './sb.js';
import { mountLayout, coupleNames, LOGO } from './layout.js';
import { excerpt, firstPhotoPath } from './notebook.js';
import { loadReactions, likeButton, commentThread, commentCountText } from './reactions.js';
import { computeStreak } from './streak.js';
import { LOCATIONS } from './config.js';
import { TREES, STAGES, stageFor, wateringSummary, seasonFor, look, getWeather, LEAFY, BARE, FILTERS } from './treelogic.js';

const ctx = await requireUser();
mountLayout(ctx, 'home.html');
$byline();
function $byline() {
  const b = document.getElementById('byline');
  b.innerHTML = LOGO;
  b.append(document.createTextNode('by ' + coupleNames(ctx)));
}
const members = ctx.profiles.map((p) => p.id);
const $ = (id) => document.getElementById(id);

// ───────── Feed ─────────
const PAGE = 15;
let offset = 0;
const LOCK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>';
const PEN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20l4-1L19 8l-3-3L5 16z"/></svg>';
const BUBBLE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z"/></svg>';

async function loadFeed() {
  const { data: rows, error } = await sb.from('entries')
    .select('id, author, title, place, body_html, stickers, access, created_at')
    .order('created_at', { ascending: false }).range(offset, offset + PAGE - 1);
  if (error) { toast(friendlyError(error)); return; }
  offset += rows.length;
  $('more').hidden = rows.length < PAGE;
  if (!rows.length && offset === 0) {
    $('feed').append(el('p', { class: 'card empty' }, 'No pages yet. Open today’s page to write the first one.'));
    return;
  }
  const { likes, comments } = await loadReactions('entry', rows.map((r) => r.id));
  for (const e of rows) $('feed').append(await card(e, likes.get(e.id), comments.get(e.id)));
}

async function card(e, likers, cmts) {
  const photo = firstPhotoPath(e.body_html, e.stickers);
  const href = 'entry.html?id=' + e.id;
  const shared = e.access === 'both';
  const last = cmts[cmts.length - 1];
  const c = el('article', { class: 'entry-card' },
    photo ? el('a', { href, tabindex: '-1', 'aria-hidden': 'true' }, el('img', { class: 'photo', src: await signedUrl('journal', photo), alt: '', loading: 'lazy' })) : null,
    el('div', { class: 'paper', style: 'padding-top:16px' },
      el('div', { class: 'meta' },
        el('span', {}, fmtDate(e.created_at)),
        el('span', { class: chipClass(e.author) }, nameOf(e.author)),
        e.place ? el('span', {}, e.place) : null),
      el('h2', {}, el('a', { href }, e.title || 'Untitled page')),
      el('p', { style: 'margin:0;color:var(--soft)' }, excerpt(e.body_html) || ' ')),
    el('div', { class: 'react-bar' },
      likeButton('entry', e.id, likers, ctx.me.id),
      el('button', { type: 'button', class: 'like-btn comment-toggle', 'aria-expanded': 'false', 'aria-controls': 'cm-' + e.id, html: BUBBLE + '<span></span>' }),
      el('span', { class: 'chip access ' + (shared ? 'chip-ok' : 'chip-lock'), html: (shared ? PEN : LOCK) + '<span></span>' }),
      last ? el('p', { class: 'last-comment' }, el('strong', { style: 'color:var(--ink)' }, nameOf(last.user_id) + ' '), last.body) : null));
  // Comments open right here in the card, with the box ready to type in.
  const toggle = c.querySelector('.comment-toggle');
  const countLabel = toggle.querySelector('span');
  countLabel.textContent = commentCountText(cmts.length);
  const preview = c.querySelector('.last-comment');
  let thread = null;
  toggle.addEventListener('click', () => {
    if (!thread) {
      thread = commentThread('entry', e.id, cmts, { onCount: (n) => { countLabel.textContent = commentCountText(n); } });
      thread.id = 'cm-' + e.id;
      thread.style.borderTop = '1px solid var(--line)';
      thread.style.background = '#fff';
      c.append(thread);
    }
    const open = thread.hidden || toggle.getAttribute('aria-expanded') === 'false';
    thread.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (preview) preview.hidden = open;
    if (open) thread.querySelector('input').focus();
  });
  c.querySelector('.access span').textContent = shared ? 'Both can edit' : 'Read-only · ' + nameOf(e.author) + ' edits';
  return c;
}

$('more').addEventListener('click', loadFeed);
await loadFeed();

// Counts in the hero
Promise.all([
  sb.from('entries').select('id', { count: 'exact', head: true }),
  sb.from('gym_posts').select('id', { count: 'exact', head: true }).eq('kind', 'gym')
]).then(([a, b]) => {
  $('counts').textContent = `${a.count || 0} pages · ${b.count || 0} gym days`;
});

// ───────── Fitness summary ─────────
(async () => {
  const [{ data: posts }, { data: goals }] = await Promise.all([
    sb.from('gym_posts').select('author, created_at').eq('kind', 'gym'),
    sb.from('gym_goals').select('goal, effective_from, created_at')
  ]);
  const s = computeStreak(posts || [], goals || [], members);
  const box = $('fit-body');
  box.className = '';
  box.replaceChildren(
    el('div', { class: 'row', style: 'gap:10px' },
      el('span', { style: 'font-weight:700;font-size:26px;line-height:1' }, String(s.streak)),
      el('span', { class: 'muted' }, 'week streak' + (s.best > s.streak ? ` · best ${s.best}` : ''))),
    ...members.map((id) => el('div', { class: 'row small', style: 'gap:10px' },
      el('span', { style: 'width:56px;font-weight:600' }, nameOf(id)),
      el('span', { class: 'boxes', 'aria-hidden': 'true' }, Array.from({ length: s.goal }, (_, i) => el('span', { class: i < s.thisCounts[id] ? 'on' : '' }))),
      el('span', { class: 'muted' }, `${Math.min(s.thisCounts[id], s.goal)} of ${s.goal}`))),
    el('p', { class: 'small muted', style: 'margin:0' }, `This week · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`));
})().catch((e) => { $('fit-body').textContent = friendlyError(e); });

// ───────── Tree summary (one per place) ─────────
(async () => {
  const [{ data: trees, error }, { data: waterings }, { data: basket }] = await Promise.all([
    sb.from('trees').select('*'),
    sb.from('waterings').select('user_id, location, day'),
    sb.from('basket').select('location')
  ]);
  if (error) throw error;
  const box = $('tree-body');
  box.className = '';
  box.style.cssText = 'display:flex;flex-direction:column;gap:16px';
  const rows = await Promise.all(Object.keys(LOCATIONS).map(async (where) => {
    const loc = LOCATIONS[where];
    const tree = (trees || []).find((t) => t.location === where);
    const link = 'tree.html?loc=' + where;
    if (!tree || !tree.kind) {
      return el('div', { class: 'row', style: 'gap:12px' },
        el('span', { style: 'font-weight:600;font-size:15px' }, loc.short),
        el('span', { class: 'muted small' }, 'Nothing planted yet.'),
        el('a', { class: 'small', href: link, style: 'font-weight:600' }, 'Plant one'));
    }
    const ws = wateringSummary((waterings || []).filter((w) => w.location === where), loc.tz);
    const stage = stageFor(ws.wateredDays);
    let weather = null;
    try { weather = await getWeather(where); } catch (e) {}
    const season = seasonFor(where, weather);
    const lk = look(tree.kind, where, season, stage, weather);
    const sp = (lk.bare ? BARE : LEAFY)[stage];
    const scale = Math.min(1, 90 / (sp.w), 92 / sp.h);
    const w = Math.round(sp.w * scale), h = Math.round(sp.h * scale);
    const picked = (basket || []).filter((b) => b.location === where).length;
    const mini = el('a', { class: 'mini-tree', href: link, 'aria-hidden': 'true', tabindex: '-1', style: 'background:' + lk.sky },
      el('div', { style: `position:absolute;left:0;right:0;top:96px;height:12px;background:#7A5E3E;border-top:3px solid ${lk.ground}` }),
      el('img', { class: 'pixel', src: sp.src, alt: '', style: `position:absolute;left:${(96 - w) / 2}px;top:${100 - h}px;width:${w}px;height:${h}px;filter:${FILTERS[lk.mode]}` }));
    const watered = members.map((id) => el('span', { class: 'chip ' + (ws.todayBy.has(id) ? 'chip-ok' : 'chip-lock') }, ws.todayBy.has(id) ? `${nameOf(id)} watered` : `${nameOf(id)} hasn’t yet`));
    return el('div', { class: 'row', style: 'gap:16px;flex-wrap:nowrap;align-items:flex-start' }, mini,
      el('div', { style: 'display:flex;flex-direction:column;gap:4px;min-width:0', class: 'small' },
        el('a', { href: link, style: 'font-weight:600;font-size:15px;text-decoration:none' }, `${TREES[tree.kind].label} tree · ${loc.short}`),
        el('span', { class: 'muted' }, `${STAGES[stage]} · ${season[0].toUpperCase() + season.slice(1)}${weather ? ` · ${weather.temp}°F` : ''}`),
        el('span', { class: 'muted' }, `Basket: ${picked} picked`),
        el('div', { class: 'row', style: 'gap:6px;margin-top:2px' }, watered)));
  }));
  box.replaceChildren(...rows);
})().catch((e) => { $('tree-body').textContent = /trees|schema cache/i.test(e.message || '') ? 'Run supabase/two-trees.sql in Supabase to finish the two-trees update.' : friendlyError(e); });

// ───────── On this day ─────────
(async () => {
  const now = new Date();
  const { data } = await sb.from('entries').select('id, title, created_at').lt('created_at', new Date(now.getFullYear(), 0, 1).toISOString()).order('created_at', { ascending: false }).limit(400);
  const hit = (data || []).find((e) => { const d = new Date(e.created_at); return d.getMonth() === now.getMonth() && d.getDate() === now.getDate(); });
  if (!hit) return;
  $('otd').hidden = false;
  $('otd-body').append(
    el('p', { style: 'margin:0;font-family:var(--serif)' }, `${new Date(hit.created_at).getFullYear()}: ${hit.title || 'A page'}`),
    el('a', { href: 'entry.html?id=' + hit.id, class: 'small' }, 'Read it again'));
})();
