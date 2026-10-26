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
    'A gym post needs a photo and the workout we did.',
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
function setKind(k) {
  kind = k;
  document.querySelectorAll('#kind button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.k === k)));
  $('gym-fields').hidden = k !== 'gym';
  $('q-photo-row').hidden = k !== 'question';
  $('text').placeholder = k === 'gym' ? 'How did it go?' : 'Ask something, e.g. legs or back tomorrow?';
  $('text').rows = k === 'gym' ? 2 : 3;
  $('counts-line').textContent = k === 'gym' ? 'Counts toward this week’s streak' : 'Questions don’t count toward the streak';
  $('counts-line').style.color = k === 'gym' ? '#0F6B4F' : 'var(--muted)';
  $('post-btn').textContent = k === 'gym' ? 'Post' : 'Ask';
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
addRow(); addRow();
$('add-row').addEventListener('click', () => addRow());

$('gym-photo').addEventListener('change', (e) => {
  gymPhoto = e.target.files[0] || null;
  const pick = $('pick');
  pick.querySelector('img') && pick.querySelector('img').remove();
  if (gymPhoto) pick.append(el('img', { src: URL.createObjectURL(gymPhoto), alt: 'Selected gym photo' }));
});
$('q-photo').addEventListener('change', (e) => { qPhoto = e.target.files[0] || null; $('q-photo-name').textContent = qPhoto ? qPhoto.name : ''; });

$('post-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('form-msg');
  msg.hidden = true;
  const body = $('text').value.trim();
  const workouts = [...$('rows').children].map((r) => Object.fromEntries([...r.querySelectorAll('[data-f]')].map((i) => [i.dataset.f, i.value.trim()]))).filter((w) => w.name);
  if (kind === 'gym' && !gymPhoto) { msg.textContent = 'Add a gym photo — it’s what makes the post count.'; msg.hidden = false; return; }
  if (kind === 'question' && !body) { msg.textContent = 'Type your question first.'; msg.hidden = false; return; }
  const btn = $('post-btn');
  btn.disabled = true;
  btn.textContent = 'Posting…';
  try {
    const file = kind === 'gym' ? gymPhoto : qPhoto;
    const photo_path = file ? await uploadFile('gym', ctx.me.id, await shrinkImage(file)) : null;
    const { error } = await sb.from('gym_posts').insert({ kind, body, photo_path, workouts: kind === 'gym' ? workouts : [] });
    if (error) throw error;
    e.target.reset();
    gymPhoto = qPhoto = null;
    $('pick').querySelector('img') && $('pick').querySelector('img').remove();
    $('q-photo-name').textContent = '';
    $('rows').replaceChildren(); addRow(); addRow();
    offset = 0; $('feed').replaceChildren();
    await Promise.all([loadFeed(), refreshStreak()]);
    toast(kind === 'gym' ? 'Posted! That counts toward the streak.' : 'Question posted.');
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
async function postCard(p, likers, cmts) {
  const isGym = p.kind === 'gym';
  const count = el('span', { class: 'muted' }, commentCountText(cmts.length));
  const card = el('article', { class: 'post' },
    el('div', { class: 'row small muted', style: 'padding:18px 24px 0' },
      el('span', { class: chipClass(p.author) }, nameOf(p.author)),
      el('span', { title: fmtDate(p.created_at, { dateStyle: 'full' }) }, timeAgo(p.created_at)),
      el('span', { class: 'chip ' + (isGym ? 'chip-gym' : 'chip-q') }, isGym ? 'Gym post · counts' : 'Question')),
    p.photo_path ? el('div', { class: 'row', style: 'padding:16px 24px 0;align-items:flex-start;gap:20px' },
      el('img', { class: 'gym-photo', src: await signedUrl('gym', p.photo_path), alt: isGym ? `${nameOf(p.author)}’s gym photo` : 'Photo', loading: 'lazy' }),
      isGym && p.workouts.length ? el('div', { style: 'flex:1 1 240px;min-width:0;display:flex;flex-direction:column;gap:6px' },
        el('span', { style: 'font-weight:600' }, 'Workout'),
        el('ul', { class: 'workouts' }, p.workouts.map((w) => el('li', {}, el('span', {}, w.name),
          el('span', { class: 'muted' }, [w.sets && w.reps ? `${w.sets} × ${w.reps}` : (w.sets ? w.sets + ' sets' : w.reps ? w.reps + ' reps' : ''), w.weight].filter(Boolean).join(' · ')))))) : null) : null,
    p.body ? el('p', { style: 'margin:0;padding:14px 24px 0;font-family:var(--serif);font-size:18px;white-space:pre-wrap' }, p.body) : null,
    el('div', { class: 'react-bar', style: 'margin-top:10px' }, likeButton('gym', p.id, likers, ctx.me.id), count,
      p.author === ctx.me.id ? el('button', { type: 'button', class: 'btn btn-ghost', style: 'margin-left:auto;color:var(--err);font-size:14px', onclick: async () => {
        if (!confirm('Delete this post?')) return;
        const { error } = await sb.from('gym_posts').delete().eq('id', p.id);
        if (error) return toast(friendlyError(error));
        card.remove(); refreshStreak();
      } }, 'Delete') : null),
    commentThread('gym', p.id, cmts, { onCount: (n) => { count.textContent = commentCountText(n); } }));
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
