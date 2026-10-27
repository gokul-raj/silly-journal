// Header, cat sticker background and footer shared by every signed-in page.
import { sb, el, initial, nameOf } from './sb.js';
import { STICKER_FILES, STICKER_LAYOUT } from './stickers-bg.js';
import { mountNotifications } from './notify.js';

const NAV = [
  ['home.html', 'Journal'],
  ['fitness.html', 'Silly Fitness'],
  ['tree.html', 'Our Trees'],
  ['calendar.html', 'Memories'],
  ['about.html', 'About us']
];

export const LOGO = '<svg width="28" height="28" viewBox="0 0 28 28" fill="none" stroke="var(--accent)" stroke-width="2" aria-hidden="true"><circle cx="11" cy="14" r="7"/><circle cx="17" cy="14" r="7"/></svg>';

export function catBackground(shell, { fade = true } = {}) {
  const bg = el('div', { class: 'cat-bg' + (fade ? '' : ' no-fade'), 'aria-hidden': 'true' });
  for (const [f, top, left, w, rot] of STICKER_LAYOUT) {
    bg.append(el('img', { src: 'assets/stickers/' + STICKER_FILES[f] + '.png', alt: '', loading: 'lazy', decoding: 'async', style: `top:${top}px;left:${left}%;width:${w}px;transform:rotate(${rot}deg)` }));
  }
  shell.prepend(bg);
}

export function coupleNames(ctx) {
  const order = (p) => (p.username === 'sillygokul' ? 0 : 1);
  return [...ctx.profiles].sort((a, b) => order(a) - order(b)).map((p) => nameOf(p.id)).join(' & ');
}

export function mountLayout(ctx, active) {
  const shell = document.querySelector('.shell');
  catBackground(shell);
  // Always "Gokul & Xinyi", whoever is signed in.
  const names = coupleNames(ctx);
  const header = el('header', { class: 'site-header' },
    el('a', { class: 'brand', href: 'home.html', html: LOGO + '<span></span>' }),
    el('nav', { class: 'site-nav', 'aria-label': 'Main' },
      NAV.map(([href, label]) => el('a', { href, 'aria-current': href === active ? 'page' : null }, label))),
    el('div', { class: 'me' },
      el('a', { class: 'me-settings', href: 'settings.html' },
        el('span', { class: 'avatar' }, initial(ctx.me.id)), nameOf(ctx.me.id) + ' · Settings'),
      el('a', { href: '#', onclick: async (e) => { e.preventDefault(); await sb.auth.signOut(); location.replace('index.html'); } }, 'Sign out'))
  );
  header.querySelector('.brand span').textContent = names;
  // The home page shows this under its big title instead.
  if (active === 'home.html') header.querySelector('.brand').classList.add('brand-moved');
  shell.prepend(header);
  mountNotifications(ctx, header.querySelector('.me'));
  const foot = el('footer', { class: 'footer' }, document.body.dataset.footer || 'written by the two of us');
  shell.append(foot);
  document.body.classList.remove('wait');
}
