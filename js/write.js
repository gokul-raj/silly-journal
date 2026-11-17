import { sb, requireUser, nameOf, chipClass, uploadFile, shrinkImage, signedUrl, el, toast, friendlyError, fmtDate } from './sb.js';
import { mountLayout } from './layout.js';
import { PAGE_W, MIN_H, BUILTIN_STICKERS, fitPage, scaleOf, cleanHtml, hydrateImages, dehydrate, stickerNode, placeSticker, readLayout, isPhoto, kindOf, itemForSave } from './notebook.js';

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
let stickers = [];         // stickers, photos, text boxes and shapes (see notebook.js)
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
// Where the cursor was last: the page text or the title. The toolbar formats the page
// text; the title keeps one plain style, so formatting it does nothing (with a hint).
let lastField = body;
for (const n of [body, titleEl]) n.addEventListener('focusin', () => { lastField = n; });
function cmd(name, arg) {
  const s = getSelection();
  if (lastField === titleEl || (s.rangeCount && titleEl.contains(s.anchorNode))) {
    toast('The title keeps its own style. Highlight text on the page to format it.');
    return;
  }
  restore(); document.execCommand(name, false, arg); markDirty();
}

// Keep the highlight when tapping toolbar buttons (mouse, touch and pen).
for (const ev of ['mousedown', 'pointerdown']) $('fmt').addEventListener(ev, (e) => { if (e.target.closest('button')) e.preventDefault(); });
$('fmt').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-cmd]');
  if (b) cmd(b.dataset.cmd, b.dataset.arg);
});
$('block').addEventListener('change', (e) => { cmd('formatBlock', '<' + e.target.value + '>'); });
// Text size, font and colour come from menus; leave the highlight in place afterwards.
const keepHighlight = () => { if (lastField === body) restore(); };
for (const id of ['block', 'font', 'size']) $(id).addEventListener('change', keepHighlight);
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
    const pics = e.clipboardData ? [...e.clipboardData.files].filter((f) => f.type.startsWith('image/')) : [];
    if (pics.length) { e.preventDefault(); addPhotoFiles(pics); return; }
    const text = e.clipboardData && e.clipboardData.getData('text/plain');
    if (text == null) return;
    e.preventDefault();
    document.execCommand('insertText', false, n === titleEl ? text.replace(/\s+/g, ' ') : text);
  });
}

// Photos from the button, dragged in from your computer, or pasted. Each lands where it was
// dropped (or in the middle of what you can see) as a movable photo.
async function addPhotoFiles(files, at) {
  const list = [...files].filter((f) => f.type.startsWith('image/'));
  if (!list.length) return toast('Only pictures can go on the page.');
  const c = at || visibleCenter();
  $('status').textContent = `Uploading ${list.length > 1 ? list.length + ' photos' : 'photo'}…`;
  try {
    for (const [i, file] of list.entries()) {
      const small = await shrinkImage(file);
      const path = await uploadFile('journal', ctx.me.id + '/photos', small);
      addSticker('ph:' + path, c.x + i * 36, c.y + i * 36, { w: 320, rot: -1 });
    }
    $('status').textContent = list.length > 1 ? 'Photos added. Drag them where you want them.' : 'Photo added. Drag it where you want it.';
  } catch (ex) {
    $('status').textContent = '';
    toast(friendlyError(ex));
  }
}
$('photo').addEventListener('change', (e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) addPhotoFiles(files); });

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
let editing = null; // the text box being typed in
const tools = el('div', { class: 'stk-tools', hidden: true, role: 'toolbar', 'aria-label': 'Selected item' });
const ITEM_COLORS = ['#121417', '#ff4f8d', '#E0702E', '#F2B705', '#0F8A6A', '#2F6FB2', '#8E5BD8', '#FFFFFF'];
const FONT_ORDER = ['hand', 'serif', 'sans'];
const FONT_LABEL = { hand: 'Handwriting', serif: 'Serif', sans: 'Plain' };
const BG_ORDER = ['none', 'yellow', 'pink', 'white'];
const maxW = (s) => (isPhoto(s) || kindOf(s) === 'shape' || kindOf(s) === 'text' ? PAGE_W - 20 : 500);
const front = (s) => { s.z = Math.max(0, ...stickers.map((o) => o.z || 0)) + 1; };
const cycle = (list, v) => list[(list.indexOf(v) + 1) % list.length];

function toolButtons(s) {
  const k = kindOf(s);
  const b = (label, aria, fn, extra = {}) => ({ label, aria, fn, ...extra });
  const out = [];
  if (k === 'text') {
    out.push(b('✎', 'Edit text', null, { edit: true }));
    out.push(b('Aa', 'Font: ' + FONT_LABEL[s.font || 'hand'] + ' (tap to change)', (x) => { x.font = cycle(FONT_ORDER, x.font || 'hand'); }, { style: 'font-family:' + ({ hand: 'Caveat, cursive', serif: 'Newsreader, Georgia, serif', sans: 'Helvetica, Arial, sans-serif' })[s.font || 'hand'] }));
    out.push(b('A−', 'Smaller text', (x) => { x.size = Math.max(12, (x.size || 28) - 4); }));
    out.push(b('A+', 'Bigger text', (x) => { x.size = Math.min(120, (x.size || 28) + 4); }));
    out.push(b('▤', 'Note background: ' + (s.bg || 'none') + ' (tap to change)', (x) => { x.bg = cycle(BG_ORDER, x.bg || 'none'); }));
  } else if (k === 'shape') {
    out.push(b('◐', s.fill && s.fill !== 'none' ? 'Fill: on (tap to turn off)' : 'Fill: off (tap to fill)', (x) => { x.fill = x.fill && x.fill !== 'none' ? 'none' : (x.stroke || '#ff4f8d') + '33'; }));
    out.push(b('━', 'Line thickness (tap to change)', (x) => { x.sw = cycle([2, 4, 7, 12], x.sw || 3); }));
  } else {
    out.push(b('−', 'Smaller', (x) => { x.w = Math.max(40, x.w - 20); }), b('+', 'Bigger', (x) => { x.w = Math.min(maxW(x), x.w + 20); }));
  }
  out.push(b('↺', 'Turn left', (x) => { x.rot = (x.rot || 0) - 15; }), b('↻', 'Turn right', (x) => { x.rot = (x.rot || 0) + 15; }));
  out.push(b('⤒', 'Bring to front', front));
  out.push(b('✕', 'Remove from page', (x) => { stickers = stickers.filter((o) => o !== x); }));
  return out;
}
function renderTools() {
  tools.replaceChildren();
  if (!selected) return;
  for (const t of toolButtons(selected)) {
    const btn = el('button', { type: 'button', 'aria-label': t.aria, title: t.aria, style: t.style || null }, t.label);
    btn.addEventListener('pointerdown', (e) => e.preventDefault()); // keep typing focus
    btn.addEventListener('click', () => {
      if (!selected) return;
      if (t.edit) { const n = layer.querySelector(`.nb-sticker[data-id="${selected.id}"]`); if (n) startEdit(selected, n); return; }
      t.fn(selected); markDirty(); restyle(selected);
    });
    tools.append(btn);
  }
  const k = kindOf(selected);
  if (k === 'text' || k === 'shape') {
    const sw = el('div', { class: 'stk-colors', role: 'group', 'aria-label': k === 'text' ? 'Text colour' : 'Line colour' });
    for (const c of ITEM_COLORS) {
      const cur = k === 'text' ? (selected.color || '#121417') : (selected.stroke || '#ff4f8d');
      const btn = el('button', { type: 'button', class: 'dot', 'aria-label': 'Colour ' + c, 'aria-pressed': String(cur.toLowerCase() === c.toLowerCase()), style: 'background:' + c });
      btn.addEventListener('pointerdown', (e) => e.preventDefault());
      btn.addEventListener('click', () => {
        if (k === 'text') selected.color = c;
        else { const filled = selected.fill && selected.fill !== 'none'; selected.stroke = c; if (filled) selected.fill = c + '33'; }
        markDirty(); restyle(selected);
      });
      sw.append(btn);
    }
    tools.append(sw);
  }
}
// Re-apply an item's look after a tool change (without rebuilding the page).
function restyle(s) {
  if (!stickers.includes(s)) { renderStickers(); return; }
  const n = layer.querySelector(`.nb-sticker[data-id="${s.id}"]`);
  if (n) placeSticker(n, s);
  renderTools();
  placeTools();
}
layer.append(tools);

async function renderStickers() {
  [...layer.querySelectorAll('.nb-sticker')].forEach((n) => n.remove());
  if (selected && !stickers.includes(selected)) selected = null;
  renderTools();
  for (const s of stickers) {
    const n = await stickerNode(s);
    n.dataset.id = s.id;
    n.classList.toggle('sel', s === selected);
    n.tabIndex = 0;
    n.setAttribute('role', 'button');
    const kind = kindOf(s);
    n.setAttribute('aria-label', ({ photo: 'Photo', sticker: 'Sticker', text: 'Text box', shape: s.shape === 'rect' ? 'Rectangle' : 'Circle' })[kind] + '. Drag to move.' + (kind === 'text' ? ' Double-click or press Enter to type.' : ''));
    if (kind === 'text') {
      n.addEventListener('dblclick', () => startEdit(s, n));
      n.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !n.classList.contains('editing')) { e.preventDefault(); startEdit(s, n); } });
    }
    n.addEventListener('pointerdown', (e) => startMove(e, s, n));
    const handle = el('span', { class: 'nb-resize', 'aria-hidden': 'true', title: 'Drag to resize' });
    handle.addEventListener('pointerdown', (e) => startResize(e, s, n, handle));
    n.append(handle);
    layer.append(n);
  }
  placeTools();
}
function placeTools() {
  tools.hidden = !selected;
  if (!selected) return;
  tools.style.left = Math.min(Math.max(0, selected.x), PAGE_W - Math.min(PAGE_W, tools.offsetWidth || 300)) + 'px';
  tools.style.top = Math.max(0, selected.y - 12) + 'px';
}
function selectSticker(s) {
  const changed = s !== selected;
  selected = s;
  layer.querySelectorAll('.nb-sticker').forEach((n) => n.classList.toggle('sel', !!s && n.dataset.id === s.id));
  if (changed) renderTools();
  placeTools();
}

// Typing in a text box: double-click it (or tap it again once selected).
function startEdit(s, n) {
  const inner = n.querySelector('.nb-text-inner');
  if (!inner || editing === s) return;
  selectSticker(s);
  editing = s;
  n.classList.add('editing');
  try { inner.contentEditable = 'plaintext-only'; } catch (e) { inner.contentEditable = 'true'; }
  if (inner.contentEditable !== 'plaintext-only') inner.contentEditable = 'true';
  inner.focus();
  const r = document.createRange(); r.selectNodeContents(inner); r.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
  const onInput = () => { s.text = inner.innerText.replace(/\n$/, ''); markDirty(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); inner.blur(); } e.stopPropagation(); };
  const onPaste = (e) => { const t = e.clipboardData && e.clipboardData.getData('text/plain'); if (t == null) return; e.preventDefault(); document.execCommand('insertText', false, t); };
  const done = () => {
    inner.removeEventListener('input', onInput); inner.removeEventListener('keydown', onKey); inner.removeEventListener('paste', onPaste);
    inner.contentEditable = 'false';
    n.classList.remove('editing');
    editing = null;
    s.text = inner.innerText.replace(/\n$/, '');
    if (!s.text.trim()) { stickers = stickers.filter((o) => o !== s); if (selected === s) selected = null; markDirty(); renderStickers(); }
  };
  inner.addEventListener('input', onInput);
  inner.addEventListener('keydown', onKey);
  inner.addEventListener('paste', onPaste);
  inner.addEventListener('blur', done, { once: true });
}
function startMove(e, s, n) {
  if (n.classList.contains('editing') && e.target.closest('.nb-text-inner')) return; // let them select text
  e.preventDefault();
  const wasSelected = selected === s;
  if (editing && editing !== s) document.activeElement.blur();
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
  const up = () => {
    n.removeEventListener('pointermove', move); n.removeEventListener('pointerup', up);
    const moved = s.x !== start.sx || s.y !== start.sy;
    if (moved) markDirty();
    else if (wasSelected && kindOf(s) === 'text') startEdit(s, n); // second tap on a text box: type
  };
  n.addEventListener('pointermove', move);
  n.addEventListener('pointerup', up);
}
// Drag the corner handle to resize; the item keeps its shape.
function startResize(e, s, n, handle) {
  e.preventDefault();
  e.stopPropagation();
  const sc = scaleOf(page);
  const start = { x: e.clientX, y: e.clientY, w: s.w, h: s.h || s.w };
  handle.setPointerCapture(e.pointerId);
  const kind = kindOf(s);
  const move = (ev) => {
    const dx = (ev.clientX - start.x) / sc, dy = (ev.clientY - start.y) / sc;
    if (kind === 'shape') { // shapes stretch freely: wide, tall, round or oval
      s.w = Math.round(Math.min(maxW(s), Math.max(16, start.w + dx)));
      s.h = Math.round(Math.min(pageH, Math.max(16, start.h + dy)));
    } else if (kind === 'text') { // text boxes: drag sideways to make the box wider or narrower
      s.w = Math.round(Math.min(maxW(s), Math.max(60, start.w + dx)));
    } else {
      s.w = Math.round(Math.min(maxW(s), Math.max(40, start.w + (dx + dy) / 2)));
    }
    placeSticker(n, s);
  };
  const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); handle.removeEventListener('pointercancel', up); if (s.w !== start.w || (s.h || s.w) !== start.h) markDirty(); placeTools(); };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('pointerup', up);
  handle.addEventListener('pointercancel', up);
}
page.addEventListener('pointerdown', (e) => { if (!e.target.closest('.nb-sticker') && !e.target.closest('.stk-tools')) selectSticker(null); });
document.addEventListener('keydown', (e) => {
  if (!selected || !['Delete', 'Backspace'].includes(e.key) || editing) return;
  if (document.activeElement && document.activeElement.closest('.nb-sticker')) {
    stickers = stickers.filter((o) => o !== selected); selected = null; markDirty(); renderStickers();
  }
});

// New text box or shape in the middle of what you can see.
function addText() {
  const c = visibleCenter();
  const s = { id: crypto.randomUUID(), type: 'text', text: '', font: 'hand', size: 32, color: '#121417', bg: 'none', w: 260, rot: 0, x: Math.round(c.x - 130), y: Math.round(c.y - 24) };
  front(s);
  stickers.push(s);
  selected = s;
  markDirty();
  renderStickers().then(() => { const n = layer.querySelector(`.nb-sticker[data-id="${s.id}"]`); if (n) startEdit(s, n); });
}
function addShape(shape) {
  const c = visibleCenter();
  const w = shape === 'rect' ? 220 : 160, h = shape === 'rect' ? 140 : 160;
  const s = { id: crypto.randomUUID(), type: 'shape', shape, stroke: '#ff4f8d', fill: 'none', sw: 4, w, h, rot: 0, x: Math.round(c.x - w / 2), y: Math.round(c.y - h / 2) };
  front(s);
  stickers.push(s);
  selected = s;
  markDirty();
  renderStickers();
}
$('add-text').addEventListener('click', addText);
$('add-circle').addEventListener('click', () => addShape('circle'));
$('add-rect').addEventListener('click', () => addShape('rect'));

function addSticker(src, x, y, opts = {}) {
  const s = { id: crypto.randomUUID(), src, w: opts.w || 140, rot: opts.rot ?? Math.round(Math.random() * 16 - 8), z: Math.max(0, ...stickers.map((o) => o.z || 0)) + 1 };
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
  const { data, error } = await sb.from('sticker_uploads').select('id, path, owner').order('created_at', { ascending: false });
  if (!error) uploads = data;
}
async function renderGrid() {
  const grid = $('stk-grid');
  grid.innerHTML = '';
  const items = tab === 'cats'
    ? BUILTIN_STICKERS.map((n) => ({ src: 'cat:' + n, url: 'assets/stickers/' + n + '.png' }))
    : await Promise.all(uploads.map(async (u) => ({ src: 'up:' + u.path, url: await signedUrl('stickers', u.path), upload: u })));
  if (!items.length) grid.append(el('p', { class: 'small muted', style: 'grid-column:1/-1;margin:0' }, 'Stickers either of you uploads show up here for both of you.'));
  for (const it of items) {
    const b = el('button', { type: 'button', class: 'stk-add', draggable: 'true', 'aria-label': 'Add sticker' }, el('img', { src: it.url, alt: '' }));
    b.addEventListener('click', () => { const c = visibleCenter(); addSticker(it.src, c.x, c.y); });
    b.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/x-sticker', it.src));
    const item = el('div', { class: 'stk-item' }, b);
    if (it.upload && it.upload.owner === ctx.me.id) {
      const del = el('button', { type: 'button', class: 'stk-del', 'aria-label': 'Delete this sticker from the list', title: 'Delete from the list' }, '✕');
      del.addEventListener('click', () => deleteUpload(it.upload));
      item.append(del);
    }
    grid.append(item);
  }
}
// Removes a sticker you uploaded from the list. Pages that already use it keep showing it.
async function deleteUpload(u) {
  if (!confirm('Delete this sticker from your sticker list? Pages that already have it will keep it.')) return;
  const { error } = await sb.from('sticker_uploads').delete().eq('id', u.id);
  if (error) return toast(friendlyError(error));
  uploads = uploads.filter((x) => x.id !== u.id);
  renderGrid();
  toast('Sticker deleted from the list');
}
$('stk-tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (!b) return;
  tab = b.dataset.tab;
  document.querySelectorAll('#stk-tabs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  renderGrid();
});
const hasFiles = (e) => [...(e.dataTransfer ? e.dataTransfer.types : [])].includes('Files');
page.addEventListener('dragover', (e) => {
  if ([...e.dataTransfer.types].includes('text/x-sticker')) e.preventDefault();
  else if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; page.classList.add('photo-over'); }
});
page.addEventListener('dragleave', (e) => { if (!page.contains(e.relatedTarget)) page.classList.remove('photo-over'); });
page.addEventListener('drop', (e) => {
  page.classList.remove('photo-over');
  const r = page.getBoundingClientRect();
  const sc = scaleOf(page);
  const at = { x: (e.clientX - r.left) / sc, y: (e.clientY - r.top) / sc };
  if (hasFiles(e) && e.dataTransfer.files.length) { e.preventDefault(); addPhotoFiles(e.dataTransfer.files, at); return; }
  const src = e.dataTransfer.getData('text/x-sticker');
  if (!src) return;
  e.preventDefault();
  addSticker(src, at.x, at.y);
});
// A picture dropped just outside the page shouldn't make the browser open it instead.
for (const ev of ['dragover', 'drop']) document.addEventListener(ev, (e) => { if (hasFiles(e) && !e.defaultPrevented && !e.target.closest('#drop')) e.preventDefault(); });

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

// Older pages have photos inside the text. Lift them onto the page so they can be
// moved and resized too, leaving the same space in the text so nothing shifts.
async function liftInlinePhotos() {
  const imgs = [...body.querySelectorAll('img[data-path]')];
  if (!imgs.length) return;
  await Promise.all(imgs.map((img) => (img.complete ? null : img.decode().catch(() => {}))));
  const pr = page.getBoundingClientRect();
  const sc = scaleOf(page);
  for (const img of imgs) {
    const r = img.getBoundingClientRect();
    const w = Math.round(r.width / sc), h = Math.round(r.height / sc);
    const z = Math.max(0, ...stickers.map((o) => o.z || 0)) + 1;
    stickers.push({ id: crypto.randomUUID(), src: 'ph:' + img.dataset.path, x: Math.round((r.left - pr.left) / sc), y: Math.round((r.top - pr.top) / sc), w: Math.max(80, w), rot: -1, z });
    const space = document.createElement('div');
    space.className = 'photo-space';
    space.style.height = Math.ceil((h + 32) / 32) * 32 + 'px';
    img.replaceWith(space);
  }
}
await liftInlinePhotos();
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
      stickers: { h: pageH, stickers: stickers.filter((s) => kindOf(s) !== 'text' || (s.text || '').trim()).map(itemForSave) }
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
