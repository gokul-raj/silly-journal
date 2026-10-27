import { sb, requireUser, nameOf, chipClass, signedUrl, el, fmtDate, toast, friendlyError } from './sb.js';
import { mountLayout } from './layout.js';
import { fitPage, cleanHtml, hydrateImages, stickerNode, readLayout } from './notebook.js';
import { loadReactions, likeButton, commentThread, commentCountText } from './reactions.js';

const ctx = await requireUser();
mountLayout(ctx, 'home.html');

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id');
const { data: e, error } = await sb.from('entries').select('*').eq('id', id || '00000000-0000-0000-0000-000000000000').maybeSingle();
if (error || !e) {
  document.querySelector('main').replaceChildren(el('p', { class: 'empty' }, 'That page couldn’t be found. ', el('a', { href: 'home.html' }, 'Back to the journal')));
  throw new Error('not found');
}
document.title = 'Silly Journal — ' + (e.title || 'A page');

const page = $('page');
page.className = 'nb-page paper-' + e.paper;
const lay = readLayout(e.stickers);
page.style.minHeight = lay.h + 'px';

$('meta').append(
  el('span', {}, fmtDate(e.created_at, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) + (e.place ? ' · ' + e.place : '')),
  el('span', { class: chipClass(e.author) }, nameOf(e.author)));
$('title').textContent = e.title;
$('body').innerHTML = cleanHtml(e.body_html);
$('body').querySelectorAll('input[type="checkbox"]').forEach((i) => { i.disabled = true; });
await hydrateImages($('body'));

if (e.drawing_path) {
  const img = $('drawing');
  img.src = await signedUrl('journal', e.drawing_path);
  img.style.height = lay.h + 'px';
  img.hidden = false;
}
for (const s of lay.stickers) $('sticker-layer').append(await stickerNode(s));
fitPage($('frame'), page)();

// Edit rights
const canEdit = e.author === ctx.me.id || e.access === 'both';
const actions = $('actions');
if (canEdit) {
  actions.append(el('a', { class: 'btn', href: 'write.html?id=' + e.id }, e.access === 'both' ? 'Edit page · both can edit' : 'Edit page'));
} else {
  actions.append(el('span', { class: 'chip chip-lock', style: 'min-height:44px;padding:0 14px;font-size:15px' }, `Read-only · only ${nameOf(e.author)} can edit`));
}
if (e.author === ctx.me.id) {
  const del = el('button', { class: 'btn btn-ghost', type: 'button', style: 'color:var(--err)' }, 'Delete');
  del.addEventListener('click', async () => {
    if (!confirm('Delete this page for both of you? This can’t be undone.')) return;
    const { error: err } = await sb.from('entries').delete().eq('id', e.id);
    if (err) return toast(friendlyError(err));
    location.replace('home.html');
  });
  actions.append(del);
}

// Likes and comments
const { likes, comments } = await loadReactions('entry', [e.id]);
const count = el('span', { class: 'muted', style: 'margin-left:auto' }, commentCountText(comments.get(e.id).length));
$('reactions').append(
  el('div', { class: 'react-bar', style: 'border-top:0' }, likeButton('entry', e.id, likes.get(e.id), ctx.me.id), count),
  commentThread('entry', e.id, comments.get(e.id), { meId: ctx.me.id, onCount: (n) => { count.textContent = commentCountText(n); } }));
if (location.hash === '#comments') $('reactions').scrollIntoView();
