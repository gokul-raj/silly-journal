// Likes and comments for journal pages ("entry") and gym posts ("gym").
import { sb, el, nameOf, chipClass, timeAgo, friendlyError, toast, HEART } from './sb.js';

const T = {
  entry: { likes: 'entry_likes', comments: 'entry_comments', commentLikes: 'entry_comment_likes', key: 'entry_id' },
  gym: { likes: 'gym_likes', comments: 'gym_comments', commentLikes: 'gym_comment_likes', key: 'post_id' }
};

// What the database supports (replies and comment likes arrive with comment-threads.sql).
const features = { threads: true, commentLikes: true };

export async function loadReactions(kind, ids) {
  const t = T[kind];
  const likes = new Map(ids.map((id) => [id, []]));
  const comments = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return { likes, comments };
  const base = `id, ${t.key}, user_id, body, created_at`;
  const [l, c0] = await Promise.all([
    sb.from(t.likes).select(`${t.key}, user_id`).in(t.key, ids),
    sb.from(t.comments).select(base + ', parent_id').in(t.key, ids).order('created_at')
  ]);
  let c = c0;
  if (c.error) { // replies not set up yet: load plain comments
    features.threads = false;
    c = await sb.from(t.comments).select(base).in(t.key, ids).order('created_at');
  }
  if (l.error) throw l.error;
  if (c.error) throw c.error;
  for (const r of l.data) likes.get(r[t.key]).push(r.user_id);
  const cids = c.data.map((r) => r.id);
  const clikes = new Map(cids.map((id) => [id, []]));
  if (cids.length) {
    const cl = await sb.from(t.commentLikes).select('comment_id, user_id').in('comment_id', cids);
    if (cl.error) features.commentLikes = false;
    else for (const r of cl.data) (clikes.get(r.comment_id) || []).push(r.user_id);
  }
  for (const r of c.data) { r.likers = clikes.get(r.id) || []; comments.get(r[t.key]).push(r); }
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

// A small heart for a comment: shows the count, tap to like / unlike.
function commentLike(kind, c, meId) {
  const t = T[kind];
  let list = [...(c.likers || [])];
  const label = el('span', {});
  const btn = el('button', { type: 'button', class: 'c-like', html: HEART });
  btn.append(label);
  const paint = () => {
    const mine = list.includes(meId);
    btn.setAttribute('aria-pressed', String(mine));
    label.textContent = list.length ? String(list.length) : '';
    const others = list.filter((u) => u !== meId).map(nameOf);
    btn.title = list.length ? 'Liked by ' + [...(mine ? ['you'] : []), ...others].join(' & ') : 'Like this comment';
    btn.setAttribute('aria-label', (mine ? 'Unlike' : 'Like') + ' comment' + (list.length ? `, ${list.length} like${list.length === 1 ? '' : 's'}` : ''));
  };
  paint();
  btn.addEventListener('click', async () => {
    const liked = list.includes(meId);
    list = liked ? list.filter((u) => u !== meId) : [...list, meId];
    paint();
    btn.disabled = true;
    const { error } = liked
      ? await sb.from(t.commentLikes).delete().eq('comment_id', c.id).eq('user_id', meId)
      : await sb.from(t.commentLikes).insert({ comment_id: c.id });
    btn.disabled = false;
    if (error) { list = liked ? [...list, meId] : list.filter((u) => u !== meId); paint(); toast(friendlyError(error)); }
    c.likers = list;
  });
  return btn;
}

function commentRow(kind, c, meId, onReply) {
  const actions = el('div', { class: 'c-actions' },
    el('span', { class: 'small muted', style: 'font-size:12px' }, timeAgo(c.created_at)),
    features.commentLikes ? commentLike(kind, c, meId) : null,
    onReply ? el('button', { type: 'button', class: 'c-reply', onclick: onReply }, 'Reply') : null);
  return el('div', { class: 'comment', 'data-id': c.id },
    el('span', { class: chipClass(c.user_id) + ' who' }, nameOf(c.user_id)),
    el('div', { style: 'display:flex;flex-direction:column;gap:2px;min-width:0;flex:1' },
      el('span', { style: 'font-family:var(--serif);font-size:17px;overflow-wrap:anywhere' }, c.body),
      actions));
}

function commentForm(placeholder, id, onSend, { small = false } = {}) {
  const input = el('input', { class: 'input', id, placeholder, maxlength: '2000', autocomplete: 'off' });
  const form = el('form', { class: 'comment-form' + (small ? ' reply-form' : '') },
    el('label', { for: id, class: 'sr-only' }, placeholder), input,
    el('button', { class: 'btn', type: 'submit' }, small ? 'Reply' : 'Send'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = input.value.trim();
    if (!body) return;
    input.disabled = true;
    const ok = await onSend(body);
    input.disabled = false;
    if (ok) input.value = '';
    input.focus();
  });
  return { form, input };
}

// Comments with one level of replies. onCount(n) lets the caller update counters.
export function commentThread(kind, id, rows, { onCount, inputId, meId } = {}) {
  const t = T[kind];
  let count = rows.length;
  const tops = rows.filter((r) => !r.parent_id);
  const repliesOf = (pid) => rows.filter((r) => r.parent_id === pid);
  const list = el('div', { class: 'c-list' });

  async function send(body, parentId) {
    const row = { [t.key]: id, body };
    if (parentId) row.parent_id = parentId;
    const { data, error } = await sb.from(t.comments).insert(row).select().single();
    if (error) { toast(friendlyError(error)); return null; }
    data.likers = [];
    rows.push(data);
    count += 1;
    if (onCount) onCount(count);
    return data;
  }

  function threadNode(top) {
    const replies = el('div', { class: 'c-replies' });
    let replyBox = null;
    const openReply = (toName) => {
      if (!replyBox) {
        replyBox = commentForm('Reply to ' + nameOf(top.user_id) + '…', 'r-' + top.id, async (body) => {
          const d = await send(body, top.id);
          if (d) { replies.insertBefore(commentRow(kind, d, meId, () => openReply(nameOf(d.user_id))), replyBox.form); replies.hidden = false; }
          return !!d;
        }, { small: true });
        replies.append(replyBox.form);
      }
      replies.hidden = false;
      if (toName && toName !== nameOf(meId) && !replyBox.input.value) replyBox.input.value = '@' + toName + ' ';
      replyBox.input.focus();
    };
    const reply = features.threads ? () => openReply() : null;
    for (const r of repliesOf(top.id)) replies.append(commentRow(kind, r, meId, features.threads ? () => openReply(nameOf(r.user_id)) : null));
    replies.hidden = !replies.children.length;
    return el('div', { class: 'c-thread' }, commentRow(kind, top, meId, reply), replies);
  }

  for (const top of tops) list.append(threadNode(top));
  const main = commentForm('Add a comment…', inputId || 'c-' + id, async (body) => {
    const d = await send(body, null);
    if (d) list.append(threadNode(d));
    return !!d;
  });
  return el('div', { class: 'comments' }, list, main.form);
}
