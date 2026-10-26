// Likes and comments for journal pages ("entry") and gym posts ("gym").
import { sb, el, nameOf, chipClass, timeAgo, friendlyError, toast, HEART } from './sb.js';

const T = {
  entry: { likes: 'entry_likes', comments: 'entry_comments', key: 'entry_id' },
  gym: { likes: 'gym_likes', comments: 'gym_comments', key: 'post_id' }
};

export async function loadReactions(kind, ids) {
  const t = T[kind];
  const likes = new Map(ids.map((id) => [id, []]));
  const comments = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return { likes, comments };
  const [l, c] = await Promise.all([
    sb.from(t.likes).select(`${t.key}, user_id`).in(t.key, ids),
    sb.from(t.comments).select(`id, ${t.key}, user_id, body, created_at`).in(t.key, ids).order('created_at')
  ]);
  if (l.error) throw l.error;
  if (c.error) throw c.error;
  for (const r of l.data) likes.get(r[t.key]).push(r.user_id);
  for (const r of c.data) comments.get(r[t.key]).push(r);
  return { likes, comments };
}

function likeText(likers, meId) {
  if (!likers.length) return 'Like';
  const mine = likers.includes(meId);
  const others = likers.filter((u) => u !== meId).map(nameOf);
  if (mine && others.length) return 'You & ' + others.join(', ');
  if (mine) return 'Liked';
  return 'Liked by ' + others.join(', ');
}

export function likeButton(kind, id, likers, meId) {
  const t = T[kind];
  let list = [...likers];
  const label = el('span', {}, likeText(list, meId));
  const btn = el('button', { type: 'button', class: 'like-btn', 'aria-pressed': String(list.includes(meId)), html: HEART });
  btn.append(label);
  btn.addEventListener('click', async () => {
    const liked = list.includes(meId);
    btn.disabled = true;
    const q = liked
      ? sb.from(t.likes).delete().eq(t.key, id).eq('user_id', meId)
      : sb.from(t.likes).insert({ [t.key]: id });
    const { error } = await q;
    btn.disabled = false;
    if (error) return toast(friendlyError(error));
    list = liked ? list.filter((u) => u !== meId) : [...list, meId];
    btn.setAttribute('aria-pressed', String(!liked));
    label.textContent = likeText(list, meId);
  });
  return btn;
}

export function commentCountText(n) {
  return n === 0 ? 'Comment' : n === 1 ? '1 comment' : n + ' comments';
}

function commentRow(c) {
  return el('div', { class: 'comment' },
    el('span', { class: chipClass(c.user_id) + ' who' }, nameOf(c.user_id)),
    el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0' },
      el('span', { style: 'font-family:var(--serif);font-size:17px;overflow-wrap:anywhere' }, c.body),
      el('span', { class: 'small muted', style: 'font-size:12px' }, timeAgo(c.created_at))));
}

// Full thread with a comment box. onCount(n) lets the caller update counters.
export function commentThread(kind, id, rows, { onCount, inputId } = {}) {
  const t = T[kind];
  let count = rows.length;
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:12px' }, rows.map(commentRow));
  const fid = inputId || 'c-' + id;
  const input = el('input', { class: 'input', id: fid, placeholder: 'Add a comment…', maxlength: '2000', autocomplete: 'off' });
  const form = el('form', { class: 'comment-form' },
    el('label', { for: fid, class: 'sr-only' }, 'Add a comment'), input,
    el('button', { class: 'btn', type: 'submit' }, 'Send'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    const { data, error } = await sb.from(t.comments).insert({ [t.key]: id, body }).select().single();
    input.disabled = false;
    if (error) return toast(friendlyError(error));
    input.value = '';
    input.focus();
    list.append(commentRow(data));
    count += 1;
    if (onCount) onCount(count);
  });
  return el('div', { class: 'comments' }, list, form);
}
