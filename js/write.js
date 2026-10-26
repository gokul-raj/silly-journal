import { sb, requireUser, nameOf, chipClass, uploadFile, shrinkImage, signedUrl, el, toast, friendlyError, fmtDate } from './sb.js';
import { mountLayout } from './layout.js';
import { PAGE_W, MIN_H, BUILTIN_STICKERS, fitPage, scaleOf, cleanHtml, hydrateImages, dehydrate, stickerNode, placeSticker, readLayout } from './notebook.js';

const ctx = await requireUser();
mountLayout(ctx, '');

const $ = (id) => document.getElementById(id);
const page = $('page'), frame = $('frame'), body = $('body'), titleEl = $('title');
const canvas = $('draw'), layer = $('sticker-layer');
const params = new URLSearchParams(location.search);
const editId = params.get('id');

let entry = null;          // existing row when editing
let access = 'both';
let paper = 'ruled';
let pageH = MIN_H;
let stickers = [];         // { id, src, x, y, w, rot, z }
let dirty = false;
let drawDirty = false;
let hasDrawing = false;
const markDirty = () => { dirty = true; $('status').textContent = 'Unsaved changes'; };

const refit = fitPage(frame, page);

// ───────────────── Load an existing page ─────────────────
if (editId) {
  const { data, error } = await sb.from('entries').select('*').eq('id', editId).single();
  if (error || !data) { location.replace('home.html'); await new Promise(() => {}); }
  if (data.author !== ctx.me.id && data.access !== 'both') {
    location.replace('entry.html?id=' + editId);
    await new Promise(() => {});
  }
  entry = data;
  access = data.access;
  paper = data.paper;
  titleEl.textContent = data.title;
  $('place').value = data.place || '';
  body.innerHTML = cleanHtml(data.body_html);
  await hydrateImages(body);
  const lay = readLayout(data.stickers);
  pageH = lay.h;
  stickers = lay.stickers.map((s) => ({ ...s, id: s.id || crypto.randomUUID() }));
  $('save').textContent = 'Save changes';
}

$('date').textContent = fmtDate(entry ? entry.created_at : new Date().toISOString(), { weekday: 'short', month: 'long', day: 'numeric' });
const authorId = entry ? entry.author : ctx.me.id;
$('author-chip').append(el('span', { class: chipClass(authorId) }, nameOf(authorId)));

// ───────────────── Access + paper ─────────────────
const isAuthor = authorId === ctx.me.id;
function renderAccess() {
  document.querySelectorAll('#access button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === access)));
  const other = ctx.partner ? nameOf(ctx.partner.id) : 'Your partner';
  $('access-hint').textContent = access === 'both'
    ? 'Both of you can edit this page.'
    : (isAuthor ? `${other} can read, like and comment, but not change this page.` : `Only ${nameOf(authorId)} can change who edits this page.`);
}
document.querySelectorAll('#access button').forEach((b) => {
  b.disabled = !isAuthor;
  b.addEventListener('click', () => { access = b.dataset.v; renderAccess(); markDirty(); });
});
renderAccess();

function applyPaper() {
  page.className = page.className.replace(/paper-\w+/g, '').trim() + ' paper-' + paper;
  $('paper').value = paper;
}
$('paper').addEventListener('change', (e) => { paper = e.target.value; applyPaper(); markDirty(); });
applyPaper();

// ───────────────── Text formatting ─────────────────
try { document.execCommand('styleWithCSS', false, true); } catch (e) {}
let savedRange = null;
document.addEventListener('selectionchange', () => {
  const s = getSelection();
  if (s.rangeCount && body.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
});
function restore() {
  body.focus({ preventScroll: true });
  if (savedRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
}
function cmd(name, arg) { restore(); document.execCommand(name, false, arg); markDirty(); }

$('fmt').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
$('fmt').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (b) cmd(b.dataset.cmd, b.dataset.arg);
});
$('block').addEventListener('change', (e) => { cmd('formatBlock', '<' + e.target.value + '>'); });
$('font').addEventListener('change', (e) => { if (e.target.value) cmd('fontName', e.target.value); e.target.value = ''; });
$('size').addEventListener('change', (e) => { if (e.target.value) cmd('fontSize', e.target.value); e.target.value = ''; });
$('fore').addEventListener('input', (e) => cmd('foreColor', e.target.value));
$('checklist').addEventListener('click', () => cmd('insertHTML', '<ul class="checklist"><li><input type="checkbox">&nbsp;</li></ul>'));
body.addEventListener('input', markDirty);
titleEl.addEventListener('input', markDirty);
$('place').addEventListener('input', markDirty);
titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); body.focus(); } });
// Paste as plain text so pages stay tidy.
for (const n of [body, titleEl]) {
  n.addEventListener('paste', (e) => {
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, n === titleEl ? text.replace(/\s+/g, ' ') : text);
  });
}

$('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  $('status').textContent = 'Uploading photo…';
  try {
    const small = await shrinkImage(file);
    const path = await uploadFile('journal', ctx.me.id + '/photos', small);
    const url = await signedUrl('journal', path);
    cmd('insertHTML', `<img data-path="${path}" src="${url}" alt="">`);
    $('status').textContent = 'Photo added';
  } catch (ex) {
    $('status').textContent = '';
    toast(friendlyError(ex));
  }
});

// ───────────────── Drawing ─────────────────
const DPR = 2;
const g = canvas.getContext('2d', { willReadFrequently: true });
let tool = 'type';
let color = '#121417';
const history = [];

function sizeCanvas(h, keep) {
  let old = null;
  if (keep) old = g.getImageData(0, 0, canvas.width, canvas.height);
  canvas.width = PAGE_W * DPR;
  canvas.height = h * DPR;
  canvas.style.height = h + 'px';
  page.style.minHeight = h + 'px';
  if (old) g.putImageData(old, 0, 0);
  refit();
}
sizeCanvas(pageH, false);

if (entry && entry.drawing_path) {
  const url = await signedUrl('journal', entry.drawing_path);
  await new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => { g.drawImage(img, 0, 0, canvas.width, canvas.height); hasDrawing = true; res(); };
    img.onerror = () => { toast('Couldn’t load the drawing.'); res(); };
    img.src = url;
  });
}

const COLORS = [['#121417', 'Ink'], ['#2F5BB7', 'Blue'], ['#ff4f8d', 'Pink'], ['#E08A2E', 'Orange'], ['#F2C94C', 'Yellow'], ['#6FAF7B', 'Green'], ['#F5A3C7', 'Light pink'], ['#FFFFFF', 'White']];
for (const [hex, label] of COLORS) {
  const b = el('button', { type: 'button', class: 'swatch', 'aria-label': label, 'aria-pressed': String(hex === color) }, el('span', { style: 'background:' + hex }));
  b.addEventListener('click', () => { color = hex; syncSwatches(); });
  $('swatches').append(b);
}
function syncSwatches() {
  [...$('swatches').children].forEach((b, i) => b.setAttribute('aria-pressed', String(COLORS[i][0] === color)));
}
$('custom').addEventListener('input', (e) => { color = e.target.value; syncSwatches(); });

$('drawbar').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tool]');
  if (!b) return;
  tool = b.dataset.tool;
  document.querySelectorAll('#drawbar [data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  page.classList.toggle('drawing', tool !== 'type');
  selectSticker(null);
});

function snapshot() {
  history.push(g.getImageData(0, 0, canvas.width, canvas.height));
  if (history.length > 25) history.shift();
}
$('draw-undo').addEventListener('click', () => {
  const prev = history.pop();
  if (!prev) return;
  if (prev.height === canvas.height) g.putImageData(prev, 0, 0);
  drawDirty = true; markDirty();
});

function pt(e) {
  const r = canvas.getBoundingClientRect();
  const s = r.width / PAGE_W;
  return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
}

let drawing = false, last = null;
canvas.addEventListener('pointerdown', (e) => {
  if (tool === 'type') return;
  e.preventDefault();
  const p = pt(e);
  snapshot();
  if (tool === 'fill') { floodFill(Math.round(p.x * DPR), Math.round(p.y * DPR), color); drawDirty = true; hasDrawing = true; markDirty(); return; }
  drawing = true; last = p;
  canvas.setPointerCapture(e.pointerId);
  stroke(p, p);
});
canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  const p = pt(e);
  stroke(last, p);
  last = p;
});
const endStroke = () => { if (drawing) { drawing = false; drawDirty = true; hasDrawing = true; markDirty(); } };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

function stroke(a, b) {
  const size = Number($('brush').value);
  g.save();
  g.scale(DPR, DPR);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = tool === 'eraser' ? size * 3 : size;
  g.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
  g.strokeStyle = color;
  g.beginPath();
  g.moveTo(a.x, a.y);
  g.lineTo(b.x + 0.01, b.y + 0.01);
  g.stroke();
  g.restore();
}

function floodFill(x, y, hex) {
  const W = canvas.width, H = canvas.height;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const i0 = (y * W + x) * 4;
  const t = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const f = [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255];
  if (t[0] === f[0] && t[1] === f[1] && t[2] === f[2] && t[3] === f[3]) return;
  const tol = 48;
  const match = (i) => Math.abs(d[i] - t[0]) + Math.abs(d[i + 1] - t[1]) + Math.abs(d[i + 2] - t[2]) + Math.abs(d[i + 3] - t[3]) <= tol;
  const seen = new Uint8Array(W * H);
  const stack = [[x, y]];
  while (stack.length) {
    let [cx, cy] = stack.pop();
    let i = cy * W + cx;
    while (cx >= 0 && !seen[i] && match(i * 4)) { cx--; i--; }
    cx++; i++;
    let up = false, down = false;
    while (cx < W && !seen[i] && match(i * 4)) {
      seen[i] = 1;
      const p = i * 4;
      d[p] = f[0]; d[p + 1] = f[1]; d[p + 2] = f[2]; d[p + 3] = 255;
      if (cy > 0) { const u = i - W; if (!seen[u] && match(u * 4)) { if (!up) { stack.push([cx, cy - 1]); up = true; } } else up = false; }
      if (cy < H - 1) { const dn = i + W; if (!seen[dn] && match(dn * 4)) { if (!down) { stack.push([cx, cy + 1]); down = true; } } else down = false; }
      cx++; i++;
    }
  }
  g.putImageData(img, 0, 0);
}

$('longer').addEventListener('click', () => { pageH += 400; sizeCanvas(pageH, true); markDirty(); });

// ───────────────── Stickers ─────────────────
let selected = null;
const tools = el('div', { class: 'stk-tools', hidden: true });
const TOOL_BTNS = [['↺', 'Turn left', (s) => { s.rot = (s.rot || 0) - 15; }], ['↻', 'Turn right', (s) => { s.rot = (s.rot || 0) + 15; }],
  ['−', 'Smaller', (s) => { s.w = Math.max(40, s.w - 20); }], ['+', 'Bigger', (s) => { s.w = Math.min(500, s.w + 20); }],
  ['⤒', 'Bring to front', (s) => { s.z = Math.max(0, ...stickers.map((o) => o.z || 0)) + 1; }],
  ['✕', 'Remove sticker', (s) => { stickers = stickers.filter((o) => o !== s); }]];
for (const [label, aria, fn] of TOOL_BTNS) {
  const b = el('button', { type: 'button', 'aria-label': aria, title: aria }, label);
  b.addEventListener('click', () => { if (!selected) return; fn(selected); markDirty(); renderStickers(); });
  tools.append(b);
}
layer.append(tools);

async function renderStickers() {
  [...layer.querySelectorAll('.nb-sticker')].forEach((n) => n.remove());
  if (selected && !stickers.includes(selected)) selected = null;
  for (const s of stickers) {
    const n = await stickerNode(s);
    n.dataset.id = s.id;
    n.classList.toggle('sel', s === selected);
    n.tabIndex = 0;
    n.setAttribute('role', 'button');
    n.setAttribute('aria-label', 'Sticker. Drag to move.');
    n.addEventListener('pointerdown', (e) => startMove(e, s, n));
    layer.append(n);
  }
  placeTools();
}
function placeTools() {
  tools.hidden = !selected;
  if (!selected) return;
  tools.style.left = Math.max(0, selected.x) + 'px';
  tools.style.top = Math.max(0, selected.y - 54) + 'px';
}
function selectSticker(s) {
  selected = s;
  layer.querySelectorAll('.nb-sticker').forEach((n) => n.classList.toggle('sel', s && n.dataset.id === s.id));
  placeTools();
}
function startMove(e, s, n) {
  e.preventDefault();
  selectSticker(s);
  const sc = scaleOf(page);
  const start = { x: e.clientX, y: e.clientY, sx: s.x, sy: s.y };
  n.setPointerCapture(e.pointerId);
  const move = (ev) => {
    s.x = Math.round(start.sx + (ev.clientX - start.x) / sc);
    s.y = Math.round(start.sy + (ev.clientY - start.y) / sc);
    s.x = Math.min(PAGE_W - 30, Math.max(-s.w + 30, s.x));
    s.y = Math.min(pageH - 30, Math.max(-20, s.y));
    placeSticker(n, s);
    placeTools();
  };
  const up = () => { n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up); if (s.x !== start.sx || s.y !== start.sy) markDirty(); };
  n.addEventListener('pointermove', move);
  n.addEventListener('pointerup', up);
}
page.addEventListener('pointerdown', (e) => { if (!e.target.closest('.nb-sticker') && !e.target.closest('.stk-tools')) selectSticker(null); });
document.addEventListener('keydown', (e) => {
  if (!selected || !['Delete', 'Backspace'].includes(e.key)) return;
  if (document.activeElement && document.activeElement.closest('.nb-sticker')) {
    stickers = stickers.filter((o) => o !== selected); selected = null; markDirty(); renderStickers();
  }
});

function addSticker(src, x, y) {
  const s = { id: crypto.randomUUID(), src, w: 140, rot: Math.round(Math.random() * 16 - 8), z: stickers.length };
  s.x = Math.round(x - s.w / 2);
  s.y = Math.round(y - s.w / 2);
  stickers.push(s);
  selected = s;
  markDirty();
  renderStickers();
}
function visibleCenter() {
  const r = page.getBoundingClientRect();
  const sc = scaleOf(page);
  const cy = (Math.min(innerHeight, r.bottom) + Math.max(0, r.top)) / 2;
  return { x: PAGE_W / 2, y: Math.min(pageH - 100, Math.max(100, (cy - r.top) / sc)) };
}

// Drawer
let tab = 'cats';
let uploads = [];
async function loadUploads() {
  const { data, error } = await sb.from('sticker_uploads').select('id, path').order('created_at', { ascending: false });
  if (!error) uploads = data;
}
async function renderGrid() {
  const grid = $('stk-grid');
  grid.innerHTML = '';
  const items = tab === 'cats'
    ? BUILTIN_STICKERS.map((n) => ({ src: 'cat:' + n, url: 'assets/stickers/' + n + '.png' }))
    : await Promise.all(uploads.map(async (u) => ({ src: 'up:' + u.path, url: await signedUrl('stickers', u.path) })));
  if (!items.length) grid.append(el('p', { class: 'small muted', style: 'grid-column:1/-1;margin:0' }, 'Stickers either of you uploads show up here for both of you.'));
  for (const it of items) {
    const b = el('button', { type: 'button', draggable: 'true', 'aria-label': 'Add sticker' }, el('img', { src: it.url, alt: '' }));
    b.addEventListener('click', () => { const c = visibleCenter(); addSticker(it.src, c.x, c.y); });
    b.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-sticker', it.src));
    grid.append(b);
  }
}
$('stk-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#stk-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderGrid();
});
page.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-sticker')) e.preventDefault(); });
page.addEventListener('drop', (e) => {
  const src = e.dataTransfer.getData('text/x-sticker');
  if (!src) return;
  e.preventDefault();
  const r = page.getBoundingClientRect();
  const sc = scaleOf(page);
  addSticker(src, (e.clientX - r.left) / sc, (e.clientY - r.top) / sc);
});

async function uploadStickers(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return;
  $('status').textContent = `Uploading ${list.length} sticker${list.length > 1 ? 's' : ''}…`;
  try {
    for (const f of list) {
      const small = await shrinkImage(f, 600, 0.9);
      const path = await uploadFile('stickers', ctx.me.id, small);
      const { error } = await sb.from('sticker_uploads').insert({ path });
      if (error) throw error;
    }
    await loadUploads();
    tab = 'ours';
    document.querySelectorAll('#stk-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.tab === 'ours')));
    await renderGrid();
    $('status').textContent = dirty ? 'Unsaved changes' : 'Stickers added';
  } catch (ex) {
    $('status').textContent = '';
    toast(friendlyError(ex));
  }
}
$('stk-upload').addEventListener('change', (e) => { uploadStickers(e.target.files); e.target.value = ''; });
const drop = $('drop');
drop.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); uploadStickers(e.dataTransfer.files); });

await loadUploads();
await renderGrid();
await renderStickers();
refit();

// ───────────────── Save ─────────────────
async function save() {
  const title = titleEl.textContent.trim();
  const html = dehydrate(body.innerHTML);
  if (!title && !html.replace(/<[^>]+>|&nbsp;/g, '').trim() && !hasDrawing && !stickers.length) {
    return toast('Write, draw or stick something first.');
  }
  const btn = $('save');
  btn.disabled = true;
  $('status').textContent = 'Saving…';
  try {
    let drawing_path = entry ? entry.drawing_path : null;
    if (drawDirty) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      drawing_path = await uploadFile('journal', ctx.me.id + '/drawings', new File([blob], 'drawing.png', { type: 'image/png' }));
    }
    const row = {
      title, place: $('place').value.trim(), body_html: html, paper, drawing_path,
      stickers: { h: pageH, stickers: stickers.map(({ id, src, x, y, w, rot, z }) => ({ id, src, x, y, w, rot, z })) }
    };
    if (isAuthor) row.access = access;
    let id = entry && entry.id;
    if (entry) {
      const { error } = await sb.from('entries').update(row).eq('id', entry.id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('entries').insert(row).select('id').single();
      if (error) throw error;
      id = data.id;
    }
    dirty = false;
    location.href = 'entry.html?id=' + id;
  } catch (ex) {
    $('status').textContent = 'Not saved';
    toast(friendlyError(ex));
  } finally {
    btn.disabled = false;
  }
}
$('save').addEventListener('click', save);
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save(); } });
addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
$('status').textContent = entry ? 'Editing' : '';
