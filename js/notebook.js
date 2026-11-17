// Shared notebook-page helpers: sizing, safe HTML, photos and stickers.
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3/+esm';
import { signedUrl, el, fmtDate, nameOf, chipClass } from './sb.js';

export const PAGE_W = 800;
export const MIN_H = 1100;

export const BUILTIN_STICKERS = ['cat-sleepy', 'cat-sketch', 'cat-collage', 'cat-orange', 'cat-photo', 'cat-pixel'];

// Scale the fixed 800px page to fit narrow screens, keeping drawings and
// stickers lined up with the text exactly as they were placed.
export function fitPage(frame, page) {
  const apply = () => {
    const w = frame.clientWidth;
    const s = Math.min(1, w / PAGE_W);
    page.style.transform = s < 1 ? `scale(${s})` : '';
    frame.style.height = page.offsetHeight * s + 'px';
    return s;
  };
  const ro = new ResizeObserver(apply);
  ro.observe(frame);
  ro.observe(page);
  return apply;
}

export function scaleOf(page) {
  const m = /scale\(([\d.]+)\)/.exec(page.style.transform || '');
  return m ? Number(m[1]) : 1;
}

const PURIFY = {
  ALLOWED_TAGS: ['p', 'div', 'br', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'font', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'img', 'hr', 'input', 'label', 'mark'],
  ALLOWED_ATTR: ['style', 'class', 'data-path', 'type', 'checked', 'color', 'face', 'size', 'alt'],
  ALLOW_DATA_ATTR: false
};

export function cleanHtml(html) {
  const out = DOMPurify.sanitize(html || '', PURIFY);
  // Only checkbox inputs are allowed inside pages.
  const box = document.createElement('div');
  box.innerHTML = out;
  box.querySelectorAll('input').forEach((i) => { if (i.type !== 'checkbox') i.remove(); });
  return box.innerHTML;
}

// Photos are stored privately; swap in short-lived links when showing them.
export async function hydrateImages(root) {
  const imgs = [...root.querySelectorAll('img[data-path]')];
  await Promise.all(imgs.map(async (img) => { img.src = await signedUrl('journal', img.dataset.path); }));
}

// For saving: strip temporary links so only the storage path is kept.
export function dehydrate(html) {
  const box = document.createElement('div');
  box.innerHTML = html;
  box.querySelectorAll('img[data-path]').forEach((img) => img.removeAttribute('src'));
  box.querySelectorAll('input[type="checkbox"]').forEach((i) => { if (i.checked) i.setAttribute('checked', ''); else i.removeAttribute('checked'); });
  return cleanHtml(box.innerHTML);
}

export async function stickerSrc(src) {
  if (src.startsWith('cat:')) return 'assets/stickers/' + src.slice(4) + '.png';
  if (src.startsWith('up:')) return signedUrl('stickers', src.slice(3));
  if (src.startsWith('ph:')) return signedUrl('journal', src.slice(3));
  return '';
}

// Things that sit on top of the page, all positioned the same way (x, y, w, rot, z):
//   sticker  { src: 'cat:…' | 'up:…' }
//   photo    { src: 'ph:<path>' }
//   text box { type: 'text', text, font: 'hand'|'serif'|'sans', size, color, bg }
//   shape    { type: 'shape', shape: 'circle'|'rect', h, stroke, fill, sw }
export const isPhoto = (item) => !!item.src && item.src.startsWith('ph:');
export const kindOf = (item) => item.type === 'text' || item.type === 'shape' ? item.type : isPhoto(item) ? 'photo' : 'sticker';
export const FONTS = { hand: 'var(--hand)', serif: 'var(--serif)', sans: 'var(--nav)' };
export const NOTE_BG = { none: 'transparent', yellow: '#FFF3A8', pink: '#FFE0EC', white: '#FFFFFF' };

export async function stickerNode(item) {
  const kind = kindOf(item);
  const wrap = document.createElement('div');
  wrap.className = 'nb-sticker nb-' + kind;
  if (kind === 'text') {
    const t = document.createElement('div');
    t.className = 'nb-text-inner';
    t.textContent = item.text || '';
    wrap.append(t);
  } else if (kind === 'shape') {
    wrap.append(Object.assign(document.createElement('div'), { className: 'nb-shape-inner' }));
  } else {
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    img.src = await stickerSrc(item.src);
    wrap.append(img);
  }
  placeSticker(wrap, item);
  return wrap;
}

export function placeSticker(node, it) {
  node.style.left = it.x + 'px';
  node.style.top = it.y + 'px';
  node.style.width = it.w + 'px';
  node.style.transform = `rotate(${it.rot || 0}deg)`;
  node.style.zIndex = String(10 + (it.z || 0));
  const kind = kindOf(it);
  if (kind === 'shape') {
    node.style.height = (it.h || it.w) + 'px';
    const s = node.querySelector('.nb-shape-inner');
    s.style.border = `${it.sw || 3}px solid ${it.stroke || '#ff4f8d'}`;
    s.style.background = it.fill && it.fill !== 'none' ? it.fill : 'transparent';
    s.style.borderRadius = it.shape === 'circle' ? '50%' : '3px';
  } else if (kind === 'text') {
    const t = node.querySelector('.nb-text-inner');
    t.style.fontFamily = FONTS[it.font] || FONTS.hand;
    t.style.fontSize = (it.size || 28) + 'px';
    t.style.color = it.color || '#121417';
    t.style.background = NOTE_BG[it.bg] || NOTE_BG.none;
    node.classList.toggle('has-bg', !!it.bg && it.bg !== 'none');
  }
}

// What gets saved for each item (only the fields that kind uses).
export function itemForSave(it) {
  const base = { id: it.id, x: Math.round(it.x), y: Math.round(it.y), w: Math.round(it.w), rot: it.rot || 0, z: it.z || 0 };
  const kind = kindOf(it);
  if (kind === 'text') return { ...base, type: 'text', text: String(it.text || '').slice(0, 2000), font: it.font || 'hand', size: it.size || 28, color: it.color || '#121417', bg: it.bg || 'none' };
  if (kind === 'shape') return { ...base, type: 'shape', shape: it.shape === 'rect' ? 'rect' : 'circle', h: Math.round(it.h || it.w), stroke: it.stroke || '#ff4f8d', fill: it.fill || 'none', sw: it.sw || 3 };
  return { ...base, src: it.src };
}

// Draw a whole saved page (text, drawing, stickers, photos, text boxes, shapes) exactly as
// it was laid out in the editor. Used by the reading view and the journal feed preview.
export async function buildPage(e) {
  const lay = readLayout(e.stickers);
  const meta = el('div', { class: 'nb-date' },
    el('span', {}, fmtDate(e.created_at, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) + (e.place ? ' · ' + e.place : '')),
    el('span', { class: chipClass(e.author) }, nameOf(e.author)));
  const title = el('h1', { class: 'nb-title' }, e.title || '');
  const body = el('div', { class: 'nb-body', style: 'min-height:0', html: cleanHtml(e.body_html) });
  body.querySelectorAll('input[type="checkbox"]').forEach((i) => { i.disabled = true; });
  const layer = el('div', { class: 'sticker-layer' });
  const page = el('div', { class: 'nb-page paper-' + (e.paper || 'ruled'), style: `min-height:${lay.h}px` },
    el('div', { class: 'nb-content' }, meta, title, body), layer);
  const jobs = [hydrateImages(body)];
  if (e.drawing_path) {
    const img = el('img', { class: 'nb-drawing', alt: '', style: `height:${lay.h}px` });
    page.insertBefore(img, layer);
    jobs.push(signedUrl('journal', e.drawing_path).then((u) => { img.src = u; }));
  }
  jobs.push(Promise.all(lay.stickers.map(stickerNode)).then((nodes) => layer.append(...nodes)));
  await Promise.all(jobs);
  return page;
}

// How far down the page anything actually goes (text, stickers, photos…), in page pixels.
export function contentBottom(page) {
  const top = page.getBoundingClientRect().top;
  const s = scaleOf(page) || 1;
  let max = 0;
  const body = page.querySelector('.nb-body');
  const last = body && [...body.querySelectorAll('*')].reverse().find((n) => n.textContent.trim() || n.tagName === 'IMG' || n.tagName === 'HR');
  for (const n of [page.querySelector('.nb-title'), last, ...page.querySelectorAll('.nb-sticker')]) {
    if (!n) continue;
    max = Math.max(max, (n.getBoundingClientRect().bottom - top) / s);
  }
  return Math.ceil(max);
}

// A one-line preview of a page. Each paragraph, line break, heading or list item reads as
// its own sentence: "…Switch 2. Thank you…" (no extra period if it already ends in . ! ? …).
const BLOCK = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'HR']);
export function pageText(html) {
  const box = document.createElement('div');
  box.innerHTML = cleanHtml(html);
  const parts = [];
  let cur = '';
  const flush = () => { const t = cur.replace(/\s+/g, ' ').trim(); if (t) parts.push(t); cur = ''; };
  const walk = (node) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) cur += c.data;
      else if (c.nodeType === 1) {
        if (c.tagName === 'BR') { flush(); continue; }
        const block = BLOCK.has(c.tagName);
        if (block) flush();
        walk(c);
        if (block) flush();
      }
    }
  };
  walk(box);
  flush();
  // Ends a sentence already? (allowing closing quotes/brackets and emoji-free endings)
  const ended = (t) => /[.!?…](["'”’)\]]*)$/.test(t);
  return parts.map((t, i) => (i < parts.length - 1 && !ended(t) ? t + '.' : t)).join(' ');
}

export function excerpt(html, n = 180) {
  const text = pageText(html);
  return text.length > n ? text.slice(0, n - 1).trimEnd() + '…' : text;
}

export function firstPhotoPath(html, layout) {
  const m = /data-path="([^"]+)"/.exec(html || '');
  if (m) return m[1];
  const ph = readLayout(layout).stickers.filter(isPhoto).sort((a, b) => a.y - b.y)[0];
  return ph ? ph.src.slice(3) : null;
}

// The layout column stores { h, stickers: [...] }; older rows may be a plain list.
export function readLayout(raw) {
  if (Array.isArray(raw)) return { h: MIN_H, stickers: raw };
  return { h: Math.max(MIN_H, (raw && raw.h) || MIN_H), stickers: (raw && raw.stickers) || [] };
}
