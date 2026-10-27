import { sb, requireUser, nameOf, chipClass, signedUrl, uploadFile, shrinkImage, el, fmtDate, timeAgo, toast, friendlyError } from './sb.js';
import { mountLayout } from './layout.js';
import { loadReactions, likeButton, commentThread, commentCountText } from './reactions.js';
import { computeStreak, goalFor, nextMonday } from './streak.js';

const ctx = await requireUser();
mountLayout(ctx, 'fitness.html');
const members = ctx.profiles.map((p) => p.id);
const $ = (id) => document.getElementById(id);

// ───────── Streak panel ─────────
let goals = [];
async function refreshStreak() {
  const [{ data: posts, error: e1 }, { data: g, error: e2 }] = await Promise.all([
    sb.from('gym_posts').select('author, created_at').eq('kind', 'gym'),
    sb.from('gym_goals').select('goal, effective_from, created_at')
  ]);
  if (e1 || e2) return toast(friendlyError(e1 || e2));
  goals = g;
  const s = computeStreak(posts, goals, members);
  $('streak-n').textContent = s.streak;
  $('streak-sub').textContent = 'week streak' + (s.best > 0 ? ` · best ${s.best}` : '');
  $('days-left').textContent = `Mon – Sun · ${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left`;
  $('people').replaceChildren(...members.map((id) => el('div', { class: 'row', style: 'gap:14px' },
    el('span', { style: 'width:64px;font-weight:600' }, nameOf(id)),
    el('span', { class: 'slots', 'aria-hidden': 'true' }, Array.from({ length: s.goal }, (_, i) => el('span', { class: i < s.thisCounts[id] ? 'on' : '' }))),
    el('span', { class: 'small muted' }, `${Math.min(s.thisCounts[id], s.goal)} of ${s.goal}${s.thisCounts[id] > s.goal ? ` (+${s.thisCounts[id] - s.goal})` : ''}`))));
  $('rule-line').textContent = `Only gym posts with a photo count. The streak breaks if either of us posts fewer than ${s.goal} in a week.`;
  const upcoming = goalFor(nextMonday(), goals);
  $('goal-n').textContent = upcoming;
  $('goal-note').textContent = upcoming !== s.goal
    ? `Changes to ${upcoming} next Monday. This week stays at ${s.goal}.`
    : 'gym posts per person. A change starts next Monday, so it can’t break this week’s streak.';
  $('rules').replaceChildren(...[
    `We each post ${s.goal} gym post${s.goal === 1 ? '' : 's'} a week, Monday to Sunday.`,
    'A gym post needs a photo and the workout we did: weights, cardio or both.',
    'If we both hit the goal, the streak goes up by one week.',
    'If either of us misses, it resets to zero.',
    'Questions, likes and comments are just for fun and don’t count.'
  ].map((t) => el('li', {}, t)));
}
async function setGoal(delta) {
  const cur = goalFor(nextMonday(), goals);
  const goal = Math.max(1, Math.min(7, cur + delta));
  if (goal === cur) return;
  const { error } = await sb.from('gym_goals').insert({ goal, effective_from: nextMonday() });
  if (error) return toast(friendlyError(error));
  await refreshStreak();
}
$('dec').addEventListener('click', () => setGoal(-1));
$('inc').addEventListener('click', () => setGoal(1));

// ───────── Composer ─────────
let kind = 'gym';
let gymPhoto = null, qPhoto = null;
let editing = null;   // the post being edited, if any
let mode = 'weights'; // weights | cardio | both
function setKind(k) {
  kind = k;
  document.querySelectorAll('#kind button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  $('gym-fields').hidden = k !== 'gym';
  $('q-photo-row').hidden = k !== 'question';
  $('text').placeholder = k === 'gym' ? 'How did it go?' : 'Ask something, e.g. legs or back tomorrow?';
  $('text').rows = k === 'gym' ? 2 : 3;
  $('counts-line').textContent = k === 'gym' ? 'Counts toward this week’s streak' : 'Questions don’t count toward the streak';
  $('counts-line').style.color = k === 'gym' ? '#0F6B4F' : 'var(--muted)';
  $('post-btn').textContent = editing ? 'Save changes' : k === 'gym' ? 'Post' : 'Ask';
  $('form-msg').hidden = true;
}
document.querySelectorAll('#kind button').forEach((b) => b.addEventListener('click', () => setKind(b.dataset.k)));

function addRow(v = {}) {
  const i = $('rows').children.length + 1;
  const mk = (name, label, extra = {}) => el('input', { class: 'input', 'aria-label': `${label} ${i}`, 'data-f': name, value: v[name] || '', ...extra });
  const row = el('div', { class: 'grid4' },
    mk('name', 'Exercise', { placeholder: i === 1 ? 'e.g. Squat' : '' }),
    mk('sets', 'Sets', { inputmode: 'numeric' }), mk('reps', 'Reps', { inputmode: 'numeric' }), mk('weight', 'Weight'),
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove exercise ' + i, onclick: () => { row.remove(); } }, '×'));
  $('rows').append(row);
}
function addCardio(v = {}) {
  const i = $('cardio-rows').children.length + 1;
  const mk = (name, label, extra = {}) => el('input', { class: 'input', 'aria-label': `${label} ${i}`, 'data-f': name, value: v[name] || '', ...extra });
  const row = el('div', { class: 'grid3' },
    mk('name', 'Cardio', { placeholder: i === 1 ? 'e.g. Run, Bike, Stairs' : '' }),
    mk('minutes', 'Minutes', { inputmode: 'numeric' }), mk('distance', 'Distance', { placeholder: i === 1 ? 'e.g. 3 mi' : '' }),
    el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Remove cardio ' + i, onclick: () => { row.remove(); } }, '×'));
  $('cardio-rows').append(row);
}
function setMode(m) {
  mode = m;
  document.querySelectorAll('#mode button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === m)));
  $('weights-block').hidden = m === 'cardio';
  $('cardio-block').hidden = m === 'weights';
}
function resetRows(weights = [], cardio = []) {
  $('rows').replaceChildren(); $('cardio-rows').replaceChildren();
  weights.forEach((w) => addRow(w)); cardio.forEach((c) => addCardio(c));
  while ($('rows').children.length < 2) addRow();
  while ($('cardio-rows').children.length < 1) addCardio();
}
const readRows = (box) => [...box.children].map((r) => Object.fromEntries([...r.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value.trim()]))).filter((w) => w.name);
function collectWorkouts() {
  const weights = mode === 'cardio' ? [] : readRows($('rows'));
  const cardio = mode === 'weights' ? [] : readRows($('cardio-rows')).map((c) => ({ type: 'cardio', ...c }));
  return [...weights, ...cardio];
}
resetRows();
setMode('weights');
document.querySelectorAll('#mode button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.m)));
$('add-row').addEventListener('click', () => addRow());
$('add-cardio').addEventListener('click', () => addCardio());

function showPick(url, alt) {
  const pick = $('pick');
  pick.querySelector('img') && pick.querySelector('img').remove();
  if (url) pick.append(el('img', { src: url, alt }));
}

// Editing reuses the form at the top. The post keeps its date, so the streak doesn't move.
async function startEdit(p) {
  editing = p;
  gymPhoto = qPhoto = null;
  $('post-form').reset();
  setKind(p.kind);
  document.querySelectorAll('#kind button').forEach((b) => { b.disabled = true; });
  $('text').value = p.body || '';
  const ws = (p.workouts || []).filter((w) => w.type !== 'cardio');
  const cs = (p.workouts || []).filter((w) => w.type === 'cardio');
  resetRows(ws, cs);
  setMode(ws.length && cs.length ? 'both' : cs.length ? 'cardio' : 'weights');
  showPick(p.kind === 'gym' && p.photo_path ? await signedUrl('gym', p.photo_path) : null, 'Current gym photo');
  $('q-photo-name').textContent = p.kind === 'question' && p.photo_path ? 'Keeping the current photo' : '';
  $('edit-banner').textContent = `Editing your ${p.kind === 'gym' ? 'gym post' : 'question'} from ${fmtDate(p.created_at, { weekday: 'short', month: 'short', day: 'numeric' })}. Tap the photo to replace it.`;
  $('edit-banner').hidden = false;
  $('cancel-edit').hidden = false;
  setKind(p.kind);
  $('post-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('text').focus({ preventScroll: true });
}
function stopEdit() {
  editing = null;
  gymPhoto = qPhoto = null;
  $('post-form').reset();
  document.querySelectorAll('#kind button').forEach((b) => { b.disabled = false; });
  resetRows(); setMode('weights');
  showPick(null);
  $('q-photo-name').textContent = '';
  $('edit-banner').hidden = true;
  $('cancel-edit').hidden = true;
  setKind(kind);
}
$('cancel-edit').addEventListener('click', stopEdit);

$('gym-photo').addEventListener('change', (e) => {
  gymPhoto = e.target.files[0] || null;
  if (gymPhoto) showPick(URL.createObjectURL(gymPhoto), 'Selected gym photo');
});
$('q-photo').addEventListener('change', (e) => { qPhoto = e.target.files[0] || null; $('q-photo-name').textContent = qPhoto ? qPhoto.name : ''; });

$('post-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('form-msg');
  msg.hidden = true;
  const body = $('text').value.trim();
  const workouts = collectWorkouts();
  if (kind === 'gym' && !gymPhoto && !(editing && editing.photo_path)) { msg.textContent = 'Add a gym photo — it’s what makes the post count.'; msg.hidden = false; return; }
  if (kind === 'question' && !body) { msg.textContent = 'Type your question first.'; msg.hidden = false; return; }
  const btn = $('post-btn');
  btn.disabled = true;
  const wasEditing = !!editing;
  btn.textContent = wasEditing ? 'Saving…' : 'Posting…';
  try {
    const file = kind === 'gym' ? gymPhoto : qPhoto;
    const photo_path = file ? await uploadFile('gym', ctx.me.id, await shrinkImage(file)) : (editing ? editing.photo_path : null);
    const row = { body, photo_path, workouts: kind === 'gym' ? workouts : [] };
    const { error } = wasEditing
      ? await sb.from('gym_posts').update(row).eq('id', editing.id)
      : await sb.from('gym_posts').insert({ kind, ...row });
    if (error) throw error;
    stopEdit();
    offset = 0; $('feed').replaceChildren();
    await Promise.all([loadFeed(), refreshStreak()]);
    toast(wasEditing ? 'Changes saved.' : kind === 'gym' ? 'Posted! That counts toward the streak.' : 'Question posted.');
  } catch (ex) {
    msg.textContent = friendlyError(ex); msg.hidden = false;
  } finally {
    btn.disabled = false;
    setKind(kind);
  }
});

// ───────── Feed ─────────
const PAGE = 15;
let offset = 0;
let filter = 'all';
async function loadFeed() {
  let q = sb.from('gym_posts').select('*').order('created_at', { ascending: false }).range(offset, offset + PAGE - 1);
  if (filter !== 'all') q = q.eq('kind', filter);
  const { data: rows, error } = await q;
  if (error) return toast(friendlyError(error));
  offset += rows.length;
  $('more').hidden = rows.length < PAGE;
  if (!rows.length && offset === 0) {
    $('feed').append(el('p', { class: 'card empty' }, filter === 'question' ? 'No questions yet.' : 'No posts yet. Your first gym photo starts the streak.'));
    return;
  }
  const { likes, comments } = await loadReactions('gym', rows.map((r) => r.id));
  for (const p of rows) $('feed').append(await postCard(p, likes.get(p.id), comments.get(p.id)));
}
function workoutList(all) {
  const weights = all.filter((w) => w.type !== 'cardio');
  const cardio = all.filter((w) => w.type === 'cardio');
  const list = (items, fmt) => el('ul', { class: 'workouts' }, items.map((w) => el('li', {}, el('span', {}, w.name), el('span', { class: 'muted' }, fmt(w)))));
  const wFmt = (w) => [w.sets && w.reps ? `${w.sets} × ${w.reps}` : (w.sets ? w.sets + ' sets' : w.reps ? w.reps + ' reps' : ''), w.weight].filter(Boolean).join(' · ');
  const cFmt = (c) => [c.minutes ? c.minutes + ' min' : '', c.distance].filter(Boolean).join(' · ');
  return el('div', { style: 'flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:6px' },
    weights.length ? el('span', { style: 'font-weight:600' }, cardio.length ? 'Weights' : 'Workout') : null,
    weights.length ? list(weights, wFmt) : null,
    cardio.length ? el('span', { style: 'font-weight:600;margin-top:' + (weights.length ? '8px' : '0') }, 'Cardio') : null,
    cardio.length ? list(cardio, cFmt) : null);
}
async function postCard(p, likers, cmts) {
  const isGym = p.kind === 'gym';
  const count = el('span', { class: 'muted' }, commentCountText(cmts.length));
  const card = el('article', { class: 'post', id: 'post-' + p.id },
    el('div', { class: 'row small muted', style: 'padding:18px 24px 0' },
      el('span', { class: chipClass(p.author) }, nameOf(p.author)),
      el('span', { title: fmtDate(p.created_at, { dateStyle: 'full' }) }, timeAgo(p.created_at)),
      el('span', { class: 'chip ' + (isGym ? 'chip-gym' : 'chip-q') }, isGym ? 'Gym post · counts' : 'Question')),
    p.photo_path ? el('div', { class: 'row', style: 'padding:16px 24px 0;align-items:flex-start;gap:20px' },
      el('img', { class: 'gym-photo', src: await signedUrl('gym', p.photo_path), alt: isGym ? `${nameOf(p.author)}’s gym photo` : 'Photo', loading: 'lazy' }),
      isGym && p.workouts.length ? workoutList(p.workouts) : null) : null,
    p.body ? el('p', { style: 'margin:0;padding:14px 24px 0;font-family:var(--serif);font-size:18px;white-space:pre-wrap' }, p.body) : null,
    el('div', { class: 'react-bar', style: 'margin-top:10px' }, likeButton('gym', p.id, likers, ctx.me.id), count,
      p.author === ctx.me.id ? el('button', { type: 'button', class: 'btn btn-ghost', style: 'margin-left:auto;font-size:14px', onclick: () => startEdit(p) }, 'Edit') : null,
      p.author === ctx.me.id ? el('button', { type: 'button', class: 'btn btn-ghost', style: 'color:var(--err);font-size:14px', onclick: async () => {
        if (!confirm('Delete this post?')) return;
        const { error } = await sb.from('gym_posts').delete().eq('id', p.id);
        if (error) return toast(friendlyError(error));
        if (editing && editing.id === p.id) stopEdit();
        card.remove(); refreshStreak();
      } }, 'Delete') : null),
    commentThread('gym', p.id, cmts, { meId: ctx.me.id, onCount: (n) => { count.textContent = commentCountText(n); } }));
  return card;
}
document.querySelectorAll('#filter button').forEach((b) => b.addEventListener('click', () => {
  filter = b.dataset.f;
  document.querySelectorAll('#filter button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  offset = 0; $('feed').replaceChildren(); loadFeed();
}));
$('more').addEventListener('click', loadFeed);

setKind('gym');
await Promise.all([refreshStreak(), loadFeed()]);
// Opened from a notification: jump to that post.
if (location.hash.startsWith('#post-')) {
  const target = document.getElementById(location.hash.slice(1));
  if (target) { target.scrollIntoView({ block: 'start' }); target.classList.add('flash'); }
}
