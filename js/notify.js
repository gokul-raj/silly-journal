// The bell in the header: what the other person has been up to, with read / unread.
// Notifications are built from their journal pages, comments, gym posts and tree waterings.
import { sb, el, nameOf, chipClass, initial, timeAgo } from './sb.js';
import { LOCATIONS } from './config.js';

const WINDOW_DAYS = 30;
const MAX = 40;
const BELL = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 004 0"/></svg>';
const CHECK = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const short = (t, n = 90) => { t = (t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t; };

export function mountNotifications(ctx, slot) {
  const me = ctx.me.id;
  const partner = ctx.partner && ctx.partner.id;
  if (!partner) return;

  let items = [];
  let clearedAt = null;
  let reads = new Set();
  let ready = false; // false until the read-state tables answer

  const badge = el('span', { class: 'notif-badge', hidden: true });
  const btn = el('button', { type: 'button', class: 'notif-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'aria-controls': 'notif-panel', html: BELL });
  btn.append(badge);
  const list = el('div', { class: 'notif-list', role: 'list' });
  const markAll = el('button', { type: 'button', class: 'notif-link' }, 'Mark all as read');
  const panel = el('div', { class: 'notif-panel', id: 'notif-panel', role: 'region', 'aria-label': 'Notifications', hidden: true },
    el('div', { class: 'notif-head' }, el('span', { class: 'notif-title' }, 'Notifications'), markAll),
    list);
  const wrap = el('div', { class: 'notif' }, btn, panel);
  slot.prepend(wrap);

  const isUnread = (it) => ready && it.at > clearedAt && !reads.has(it.key);

  function paint() {
    const n = items.filter(isUnread).length;
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    btn.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
    markAll.disabled = n === 0;
    if (panel.hidden) return;
    if (!items.length) {
      list.replaceChildren(el('p', { class: 'notif-empty' }, `Nothing new from ${nameOf(partner)} in the last ${WINDOW_DAYS} days.`));
      return;
    }
    list.replaceChildren(...items.map((it) => {
      const unread = isUnread(it);
      const open = el('a', { class: 'notif-item' + (unread ? ' unread' : ''), href: it.href, role: 'listitem' },
        el('span', { class: 'avatar' + (chipClass(it.who).includes('chip-b') ? ' b' : '') }, initial(it.who)),
        el('span', { class: 'notif-body' },
          el('span', { class: 'notif-text' }, el('strong', {}, nameOf(it.who)), ' ' + it.text),
          it.quote ? el('span', { class: 'notif-quote' }, '“' + it.quote + '”') : null,
          el('span', { class: 'notif-time' }, timeAgo(it.at))));
      open.addEventListener('click', async (e) => {
        if (!isUnread(it)) return;
        e.preventDefault(); // save the read first, then go
        await markRead(it);
        location.href = it.href;
      });
      const row = el('div', { class: 'notif-row' + (unread ? ' unread' : '') }, open);
      if (unread) {
        const done = el('button', { type: 'button', class: 'notif-mark', title: 'Mark as read', 'aria-label': 'Mark as read: ' + nameOf(it.who) + ' ' + it.text, html: CHECK });
        done.addEventListener('click', () => markRead(it));
        row.append(done);
      }
      return row;
    }));
  }

  async function markRead(it) {
    if (!isUnread(it)) return;
    reads.add(it.key);
    paint();
    await sb.from('notif_reads').insert({ key: it.key }); // a duplicate just means it was already read
  }

  markAll.addEventListener('click', async () => {
    const newest = items.reduce((m, it) => (it.at > m ? it.at : m), clearedAt || '');
    clearedAt = new Date(Math.max(Date.now(), Date.parse(newest) + 1)).toISOString();
    paint();
    await sb.from('notif_state').update({ cleared_at: clearedAt }).eq('user_id', me);
  });

  function setOpen(open) {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
    if (open) { paint(); refresh(); }
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(panel.hidden); });
  // composedPath still includes the bell's dropdown even if the clicked row was just redrawn.
  document.addEventListener('click', (e) => { if (!panel.hidden && !e.composedPath().includes(wrap)) setOpen(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { setOpen(false); btn.focus(); } });

  async function loadReadState() {
    const [st, rd] = await Promise.all([
      sb.from('notif_state').select('cleared_at').eq('user_id', me).maybeSingle(),
      sb.from('notif_reads').select('key')
    ]);
    if (st.error || rd.error) return false; // tables not set up yet: show items, but no badge
    if (!st.data) {
      // First time: anything from the last 3 days starts out unread.
      clearedAt = new Date(Date.now() - 3 * 864e5).toISOString();
      await sb.from('notif_state').insert({ cleared_at: clearedAt });
    } else {
      clearedAt = st.data.cleared_at;
    }
    reads = new Set((rd.data || []).map((r) => r.key));
    return true;
  }

  async function loadItems() {
    const since = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString();
    const recent = (t, cols, who = 'user_id') => sb.from(t).select(cols).eq(who, partner).gte('created_at', since).order('created_at', { ascending: false }).limit(MAX);
    const [en, ec, gp, gc, wa] = await Promise.all([
      recent('entries', 'id, title, created_at', 'author'),
      recent('entry_comments', 'id, entry_id, body, created_at'),
      recent('gym_posts', 'id, kind, body, created_at', 'author'),
      recent('gym_comments', 'id, post_id, body, created_at'),
      recent('waterings', 'location, day, created_at')
    ]);
    const out = [];
    for (const e of en.data || []) out.push({ key: 'entry:' + e.id, at: e.created_at, who: partner, text: 'wrote a journal page: ' + (e.title || 'Untitled page'), href: 'entry.html?id=' + e.id });

    // Comment targets: page titles and whose gym post it was.
    const entryIds = [...new Set((ec.data || []).map((c) => c.entry_id))];
    const postIds = [...new Set((gc.data || []).map((c) => c.post_id))];
    const [titles, posts] = await Promise.all([
      entryIds.length ? sb.from('entries').select('id, title, author').in('id', entryIds) : { data: [] },
      postIds.length ? sb.from('gym_posts').select('id, author, kind').in('id', postIds) : { data: [] }
    ]);
    const entryById = new Map((titles.data || []).map((e) => [e.id, e]));
    const postById = new Map((posts.data || []).map((p) => [p.id, p]));
    for (const c of ec.data || []) {
      const e = entryById.get(c.entry_id);
      const whose = e && e.author === me ? 'your page' : 'the page';
      out.push({ key: 'ec:' + c.id, at: c.created_at, who: partner, text: `commented on ${whose} ${e ? '“' + short(e.title || 'Untitled page', 40) + '”' : ''}`.trim(), quote: short(c.body), href: 'entry.html?id=' + c.entry_id + '#comments' });
    }
    for (const p of gp.data || []) {
      out.push({ key: 'gym:' + p.id, at: p.created_at, who: partner, text: p.kind === 'gym' ? 'posted a gym post' : 'asked a question in Silly Fitness', quote: short(p.body), href: 'fitness.html#post-' + p.id });
    }
    for (const c of gc.data || []) {
      const p = postById.get(c.post_id);
      const what = p ? (p.kind === 'gym' ? 'gym post' : 'question') : 'post';
      const whose = p && p.author === me ? 'your' : p && p.author === partner ? 'their' : 'a';
      out.push({ key: 'gc:' + c.id, at: c.created_at, who: partner, text: `commented on ${whose} ${what}`, quote: short(c.body), href: 'fitness.html#post-' + c.post_id });
    }
    for (const w of wa.data || []) {
      const loc = LOCATIONS[w.location];
      out.push({ key: `water:${w.location || ''}:${w.day}`, at: w.created_at, who: partner, text: `watered the ${loc ? loc.short + ' ' : ''}tree`, href: 'tree.html' + (loc ? '?loc=' + w.location : '') });
    }
    out.sort((a, b) => (a.at < b.at ? 1 : -1));
    return out.slice(0, MAX);
  }

  let loading = null;
  async function refresh() {
    if (loading) return loading;
    loading = (async () => {
      try {
        const [ok, list2] = await Promise.all([loadReadState(), loadItems()]);
        ready = ok;
        items = list2;
        paint();
      } catch (e) { /* keep the last list; try again later */ }
      loading = null;
    })();
    return loading;
  }

  refresh();
  setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refresh(); });
}
