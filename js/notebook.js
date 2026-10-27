// Shared notebook-page helpers: sizing, safe HTML, photos and stickers.
import DOMPurify from 'https://cdn.jsdelivr.net/npm/dompurify@3/+esm';
import { signedUrl } from './sb.js';

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

export async function stickerNode(item) {
  const wrap = document.createElement('div');
  wrap.className = 'nb-sticker' + (isPhoto(item) ? ' nb-photo' : '');
  const img = document.createElement('img');
  img.alt = '';
  img.draggable = false;
  img.src = await stickerSrc(item.src);
  wrap.append(img);
  placeSticker(wrap, item);
  return wrap;
}

// Photos live on the page like stickers: { src: 'ph:<path>', x, y, w, rot, z }.
export const isPhoto = (item) => item.src.startsWith('ph:');

export function placeSticker(node, it) {
  node.style.left = it.x + 'px';
  node.style.top = it.y + 'px';
  node.style.width = it.w + 'px';
  node.style.transform = `rotate(${it.rot || 0}deg)`;
  node.style.zIndex = String(10 + (it.z || 0));
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
