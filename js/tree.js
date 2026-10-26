import { sb, requireUser, nameOf, el, toast, friendlyError } from './sb.js';
import { mountLayout } from './layout.js';
import { LOCATIONS } from './config.js';
import { TREES, STAGES, LEAFY, BARE, SPOTS, FILTERS, stageFor, daysToNextStage, wateringSummary, seasonFor, look, getWeather, dateLabel } from './treelogic.js';
import { dayKey } from './streak.js';

const ctx = await requireUser();
mountLayout(ctx, 'tree.html');
const members = ctx.profiles.map((p) => p.id);
const $ = (id) => document.getElementById(id);

// One tree in each place. `where` is the one on screen (remembered per browser).
let where = 'ithaca';
try { if (LOCATIONS[localStorage.getItem('sj-tree-loc')]) where = localStorage.getItem('sj-tree-loc'); } catch (e) {}
const params = new URLSearchParams(location.search);
if (LOCATIONS[params.get('loc')]) where = params.get('loc');

let trees = {}, allWaterings = [], allBasket = [], weather = null;
let tree, waterings = [], basket = [];
let previewSeason = null, previewStage = null, pendingKind = null;

async function load() {
  const [t, w, b] = await Promise.all([
    sb.from('trees').select('*'),
    sb.from('waterings').select('user_id, location, day'),
    sb.from('basket').select('id, user_id, location, fruit, day, spot, created_at').order('created_at')
  ]);
  if (t.error) {
    if (/trees|schema cache/i.test(t.error.message)) throw new Error('The two-trees update hasn’t been added to the database yet. Run supabase/two-trees.sql in the Supabase SQL Editor.');
    throw t.error;
  }
  trees = Object.fromEntries((t.data || []).map((r) => [r.location, r]));
  allWaterings = w.data || []; allBasket = b.data || [];
  select(where);
}

function select(l) {
  where = l;
  try { localStorage.setItem('sj-tree-loc', l); } catch (e) {}
  tree = trees[l] || { location: l, kind: null };
  waterings = allWaterings.filter((x) => x.location === l);
  basket = allBasket.filter((x) => x.location === l);
}

async function loadWeather() {
  weather = null;
  $('wx').textContent = LOCATIONS[tree.location].label + ' · ' + dateLabel(LOCATIONS[tree.location].tz);
  try {
    weather = await getWeather(tree.location);
    $('wx').textContent += ` · ${weather.temp}°F`;
  } catch (e) {
    $('wx').textContent += ' · weather unavailable';
  }
}

const loc = () => LOCATIONS[tree.location];
const today = () => dayKey(new Date(), loc().tz);

function render() {
  const planted = !!tree.kind;
  const kind = tree.kind || pendingKind || 'apple';
  const ws = wateringSummary(waterings, loc().tz);
  const realStage = planted ? stageFor(ws.wateredDays) : 0;
  const stage = previewStage ?? realStage;
  const autoSeason = seasonFor(tree.location, weather);
  const season = previewSeason || autoSeason;
  const lk = look(kind, tree.location, season, stage, weather);
  const live = planted && previewStage == null && previewSeason == null;

  // Location
  document.querySelectorAll('#locs button').forEach((b) => {
    const t = trees[b.dataset.l];
    b.setAttribute('aria-pressed', String(b.dataset.l === tree.location));
    b.textContent = t && t.kind ? `${LOCATIONS[b.dataset.l].short} · ${TREES[t.kind].label}` : LOCATIONS[b.dataset.l].label;
  });

  // Season buttons
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  $('seasons').replaceChildren(...[['', 'Today · ' + cap(autoSeason)], ['spring', 'Spring'], ['summer', 'Summer'], ['fall', 'Fall'], ['winter', 'Winter']].map(([v, label]) => {
    const on = (previewSeason || '') === v;
    return el('button', { type: 'button', class: 'pill', 'aria-pressed': String(on), onclick: () => { previewSeason = v || null; render(); } }, label);
  }));

  // Stage
  const W = 480, H = 460, GROUND = 404, SINK = 32;
  const st = $('stage');
  st.style.background = lk.sky;
  const sp = (lk.bare ? BARE : LEAFY)[stage];
  const tw = sp.w * sp.s, th = sp.h * sp.s;
  const box = el('div', { class: 'sway' + (ws.drooping && live ? ' droopy' : ''), style: `left:${Math.round((W - tw) / 2)}px;top:${GROUND + SINK - th}px;width:${tw}px;height:${th}px` },
    el('img', { class: 'pixel', src: sp.src, alt: `Our ${lk.tree.label.toLowerCase()} tree, ${STAGES[stage].toLowerCase()}, ${season}`, style: `display:block;width:100%;height:100%;filter:${FILTERS[lk.mode]}` }));

  const s = sp.s;
  if (lk.blossoms) {
    for (const [x, y] of SPOTS.concat([[30, 30], [52, 14], [70, 34], [44, 46], [18, 40], [66, 44]])) {
      box.append(el('div', { 'aria-hidden': 'true', style: `position:absolute;left:${x * s - 3}px;top:${y * s - 3}px;width:6px;height:6px;background:${lk.tree.blossom};box-shadow:0 0 0 2px rgba(255,255,255,.35)` }));
    }
  }
  const todaysPicks = new Set(basket.filter((p) => p.day === today()).map((p) => p.spot));
  const fruitSrc = 'assets/fruits/' + kind + '.png';
  const fw = lk.tree.w * lk.tree.scale, fh = lk.tree.h * lk.tree.scale;
  const fruitBtn = (spot, cx, cy, extraStyle, bob, i) => {
    const b = el('button', { type: 'button', class: 'fruit-btn', 'aria-label': live ? `Pick a ${kind}` : `A ${kind} (preview)`, disabled: !live, style: `left:${cx - 22}px;top:${cy - 22}px;position:absolute` },
      el('img', { class: 'pixel' + (bob ? ' bob' : ''), src: fruitSrc, alt: '', style: `display:block;width:${fw}px;height:${fh}px;animation-delay:-${(i * 0.17).toFixed(2)}s;${extraStyle}` }));
    b.addEventListener('click', () => pick(spot, kind));
    return b;
  };
  const fallen = [];
  if (lk.fruiting) {
    const spots = kind === 'jackfruit' ? SPOTS.slice(3, 7) : SPOTS;
    spots.forEach(([x, y], i) => { if (!todaysPicks.has(i)) box.append(fruitBtn(i, x * s, y * s, '', true, i)); });
    [[-130, 80], [-74, -15], [86, 20], [140, -70]].forEach(([dx, rot], i) => {
      if (!todaysPicks.has(100 + i)) fallen.push(fruitBtn(100 + i, W / 2 + dx, GROUND + 16 + (i % 2) * 8, `transform:rotate(${rot}deg)`, false, i));
    });
  }

  // Ground, grass and leaves
  const DARK = { '#9CC07A': '#6E9A4C', '#8E8A4A': '#68642F', '#F5F5F2': '#D5D9DD', '#A5C48A': '#7A9E60' };
  const tuft = DARK[lk.ground] || '#6E9A4C';
  const rootW = Math.max(24, Math.round(tw * (stage >= 4 && !lk.bare ? 0.58 : 0.5)));
  const leafSet = lk.mode === 'fall' ? ['brown', 'red', 'gold'] : lk.mode === 'fallmild' ? ['lime', 'gold', 'green'] : lk.mode === 'summer' ? ['green'] : [];
  const nFall = stage < 3 ? 0 : (lk.mode === 'fall' ? 8 : lk.mode === 'fallmild' ? 4 : lk.mode === 'summer' ? 2 : 0);
  const nGround = lk.mode === 'fall' ? 7 : lk.mode === 'fallmild' ? 3 : 0;
  const leaves = [];
  for (let i = 0; i < nGround; i++) {
    leaves.push(el('img', { class: 'pixel', src: `assets/leaves/${leafSet[(i + 1) % leafSet.length]}.png`, alt: '', 'aria-hidden': 'true', style: `left:${40 + ((i * 61) % 390)}px;top:${GROUND + 6 + (i % 3) * 8}px;width:25px;height:26px;transform:rotate(${(i * 67) % 360}deg) scaleY(.6)` }));
  }
  for (let i = 0; i < nFall; i++) {
    const x = Math.round(W / 2 - tw * 0.38 + ((i * 53) % Math.max(1, Math.round(tw * 0.76))));
    const y = Math.round(GROUND + SINK - th + th * 0.25 + ((i * 29) % Math.max(1, Math.round(th * 0.3))));
    leaves.push(el('img', { class: 'pixel leaf-fall', src: `assets/leaves/${leafSet[i % leafSet.length]}.png`, alt: '', 'aria-hidden': 'true', style: `left:${x}px;top:${y}px;width:25px;height:26px;--dx:${i % 2 ? 26 : -22}px;--dy:${GROUND + 12 - y}px;--t:${(6 + (i % 4) * 1.3).toFixed(1)}s;animation-delay:-${(i * 1.7).toFixed(1)}s` }));
  }
  st.replaceChildren(
    el('img', { class: 'pixel', src: lk.hills, alt: '', 'aria-hidden': 'true', style: `left:0;top:${GROUND - 240}px;width:480px;height:240px` }),
    el('div', { 'aria-hidden': 'true', style: `left:0;right:0;top:${GROUND}px;height:${H - GROUND}px;background:#7A5E3E;border-top:10px solid ${lk.ground};box-shadow:inset 0 4px 0 rgba(0,0,0,.12)` }),
    ...leaves.filter((n) => !n.classList.contains('leaf-fall')),
    el('div', { 'aria-hidden': 'true', style: `left:${Math.round(W / 2 - rootW / 2 - 14)}px;top:${GROUND + SINK - 10}px;width:${rootW + 28}px;height:14px;background:${tuft};box-shadow:8px 6px 0 -2px ${tuft},-8px 6px 0 -2px ${tuft}` }),
    box,
    el('div', { 'aria-hidden': 'true', style: `left:${Math.round(W / 2 - rootW / 2 - 10)}px;top:${GROUND + SINK - 4}px;width:${rootW + 20}px;height:8px;background-image:repeating-linear-gradient(90deg,${tuft} 0 4px,transparent 4px 10px),linear-gradient(${lk.ground},${lk.ground});background-size:auto 6px,auto 4px;background-position:0 0,0 4px;background-repeat:repeat-x` }),
    ...leaves.filter((n) => n.classList.contains('leaf-fall')),
    ...fallen);

  // Caption
  $('t-title').textContent = planted ? `Our ${kind} tree in ${loc().short}` : (pendingKind ? `A ${kind} tree for ${loc().short}, if we plant it` : `Pick a tree to plant in ${loc().short}`);
  $('plant-title').textContent = `Our ${loc().short} tree`;
  let note = previewStage != null && previewStage !== realStage ? `Preview: ${STAGES[stage].toLowerCase()}. ` : '';
  if (stage < 5) note += ['Just planted. ', 'A tiny sprout! ', 'A little sapling. ', 'A young tree. ', 'Nearly grown. '][stage];
  note += lk.note;
  if (ws.drooping && live) note = 'It’s thirsty and drooping — water it today! ' + note;
  if (!live && planted && lk.fruiting) note += ' (Switch back to today to pick.)';
  $('t-note').textContent = note;

  // Plant picker
  $('opts').replaceChildren(...Object.entries(TREES).map(([id, t]) => el('button', {
    type: 'button', 'aria-pressed': String(id === kind), disabled: planted,
    onclick: () => { pendingKind = id; render(); }
  }, el('img', { class: 'pixel', src: 'assets/fruits/' + id + '.png', alt: '', style: `width:${t.w * 2}px;height:${t.h * 2}px;flex:0 0 auto` }), t.label)));
  $('plant').hidden = planted;
  $('plant').disabled = !pendingKind;
  $('plant-note').textContent = planted ? `Planted ${new Date(tree.planted_on + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Chosen once, when we plant it';

  // Watering
  $('run').textContent = ws.run ? `${ws.run} day${ws.run === 1 ? '' : 's'} in a row` : '';
  $('waterers').replaceChildren(...members.map((id) => {
    const done = ws.todayBy.has(id);
    const mine = id === ctx.me.id;
    const b = el('button', { type: 'button', class: 'water-btn' + (done ? ' done' : ''), disabled: !mine || !planted, 'aria-pressed': String(done),
      html: `<svg width="20" height="20" viewBox="0 0 24 24" fill="${done ? '#2F6FB2' : 'none'}" stroke="${done ? '#2F6FB2' : '#121417'}" stroke-width="1.8" aria-hidden="true"><path d="M12 3s6 6.6 6 11a6 6 0 01-12 0c0-4.4 6-11 6-11z"/></svg><span></span>` });
    b.querySelector('span').textContent = done ? `${nameOf(id)} watered today` : (mine ? (planted ? 'Water it' : 'Plant first, then water') : `${nameOf(id)} hasn’t watered yet`);
    if (mine) b.addEventListener('click', () => water(done));
    return b;
  }));

  // Growth
  $('growth').replaceChildren(...STAGES.map((label, i) => el('button', {
    type: 'button', class: i <= realStage && planted ? 'done' : '', 'aria-pressed': String(i === stage),
    onclick: () => { previewStage = i === realStage ? null : i; render(); }
  }, el('span'), el('span', {}, label))));
  const left = daysToNextStage(ws.wateredDays);
  $('next-stage').textContent = !planted ? '' : realStage === 5 ? 'Fully grown. Keep watering so it stays happy.' : `${left} more watered day${left === 1 ? '' : 's'} until ${STAGES[realStage + 1].toLowerCase()}.`;

  // Basket
  const recent = basket.slice(-30);
  $('basket').replaceChildren(...(recent.length ? recent.map((p) => {
    const t = TREES[p.fruit] || TREES.apple;
    return el('img', { class: 'pixel', src: 'assets/fruits/' + p.fruit + '.png', alt: p.fruit, title: `${nameOf(p.user_id)} picked this`, style: `width:${t.w * 3}px;height:${t.h * 3}px` });
  }) : [el('span', { style: 'font-size:14px;color:#6B4A2F' }, 'Tap ripe fruit on the tree to pick it.')]));
  $('basket-line').textContent = members.map((id) => `${nameOf(id)}: ${basket.filter((p) => p.user_id === id).length}`).join(' · ') + ` picked in ${loc().short}`;
  const other = allBasket.length - basket.length;
  if (other) $('basket-line').textContent += ` · ${other} more from the other tree`;
}

async function pick(spot, fruit) {
  const { data, error } = await sb.from('basket').insert({ location: where, fruit, day: today(), spot }).select().single();
  if (error) {
    if (error.code === '23505') { toast('Someone just picked that one!'); await load(); render(); return; }
    return toast(friendlyError(error));
  }
  allBasket.push(data); basket.push(data);
  render();
}

async function water(done) {
  const day = today();
  const l = where;
  const q = done ? sb.from('waterings').delete().eq('user_id', ctx.me.id).eq('location', l).eq('day', day) : sb.from('waterings').insert({ location: l, day });
  const { error } = await q;
  if (error) return toast(friendlyError(error));
  if (done) allWaterings = allWaterings.filter((w) => !(w.user_id === ctx.me.id && w.location === l && w.day === day));
  else allWaterings.push({ user_id: ctx.me.id, location: l, day });
  select(l);
  render();
}

$('plant').addEventListener('click', async () => {
  if (!pendingKind) return;
  if (!confirm(`Plant a ${pendingKind} tree in ${loc().short}? You can’t change the type later.`)) return;
  const { data, error } = await sb.from('trees').update({ kind: pendingKind }).eq('location', where).select().single();
  if (error) return toast(friendlyError(error));
  trees[where] = data; tree = data; pendingKind = null;
  render();
});

document.querySelectorAll('#locs button').forEach((b) => b.addEventListener('click', async () => {
  if (b.dataset.l === where) return;
  select(b.dataset.l);
  pendingKind = null; previewStage = null; previewSeason = null; weather = null;
  render();
  await loadWeather();
  render();
}));

try {
  await load();
  await loadWeather();
  render();
} catch (e) {
  toast(friendlyError(e));
}
// Keep the weather and "today" fresh if the page stays open.
setInterval(async () => { await loadWeather(); render(); }, 30 * 60 * 1000);
// …and roll over to the new day/season at local midnight even without a weather refresh.
setInterval(() => { if (tree) render(); }, 5 * 60 * 1000);
