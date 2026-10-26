// Supabase client, sign-in guard and small shared helpers.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

function pickStorage() {
  try {
    return localStorage.getItem('sj-remember') === '0' ? sessionStorage : localStorage;
  } catch (e) {
    return undefined;
  }
}

export function makeClient(storage) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storage }
  });
}

export const sb = makeClient(pickStorage());

let ctx = null;

// Every page except sign-in calls this first. Not signed in → back to sign-in.
export async function requireUser() {
  if (ctx) return ctx;
  const { data: { session } } = await sb.auth.getSession();
  if (!session) {
    const here = location.pathname.split('/').pop() + location.search;
    location.replace('index.html?next=' + encodeURIComponent(here));
    return new Promise(() => {});
  }
  const { data: profiles, error } = await sb.from('profiles').select('id, username, display_name');
  if (error) throw error;
  const me = profiles.find((p) => p.id === session.user.id);
  if (!me) {
    await sb.auth.signOut();
    location.replace('index.html?error=not-member');
    return new Promise(() => {});
  }
  const partner = profiles.find((p) => p.id !== me.id) || null;
  const byId = Object.fromEntries(profiles.map((p) => [p.id, p]));
  ctx = { user: session.user, me, partner, profiles, byId };
  return ctx;
}

export function nameOf(id) {
  const p = ctx && ctx.byId[id];
  return p ? (p.display_name || p.username) : 'Someone';
}

// Xinyi's tags use the accent colour, Gokul's the dark ink.
export function chipClass(id) {
  const p = ctx && ctx.byId[id];
  return p && p.username === 'sillyxinyi' ? 'chip chip-a' : 'chip chip-b';
}

export function initial(id) {
  return nameOf(id).trim().charAt(0).toUpperCase() || '?';
}

// Private storage → short-lived signed URLs, cached for the page.
const urlCache = new Map();
export async function signedUrl(bucket, path) {
  if (!path) return '';
  const key = bucket + '/' + path;
  if (urlCache.has(key)) return urlCache.get(key);
  const p = sb.storage.from(bucket).createSignedUrl(path, 60 * 60).then(({ data }) => (data ? data.signedUrl : ''));
  urlCache.set(key, p);
  return p;
}

export async function uploadFile(bucket, folder, file) {
  const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : (file.type.split('/')[1] || 'bin');
  const path = folder + '/' + crypto.randomUUID() + '.' + ext.replace(/[^a-z0-9]/g, '');
  const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false });
  if (error) throw error;
  return path;
}

// Shrink big phone photos before upload so pages stay quick.
export async function shrinkImage(file, maxSide = 1600, quality = 0.85) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 1.5e6) return file;
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
    const type = keepAlpha ? 'image/webp' : 'image/jpeg';
    const blob = await new Promise((r) => c.toBlob(r, type, quality));
    return new File([blob], (file.name || 'photo').replace(/\.\w+$/, '') + (keepAlpha ? '.webp' : '.jpg'), { type });
  } catch (e) {
    return file;
  }
}

export function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style') n.style.cssText = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (k === 'html') n.innerHTML = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return n;
}

export function fmtDate(iso, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  return new Date(iso).toLocaleDateString(undefined, opts);
}

export function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  if (s < 86400 * 7) return Math.floor(s / 86400) + ' d ago';
  return fmtDate(iso);
}

export function toast(text) {
  const t = el('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 3200);
}

export function friendlyError(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/JWT|session/i.test(m)) return 'Your sign-in expired. Please sign in again.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Could not reach the server. Check your connection and try again.';
  return m;
}

export const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0112 7.3a4.2 4.2 0 017.5 2.5C19.5 15.4 12 20 12 20z"/></svg>';
