import { sb, makeClient, friendlyError } from './sb.js';
import { catBackground } from './layout.js';

catBackground(document.querySelector('.shell'), { fade: false });

const form = document.getElementById('form');
const err = document.getElementById('error');
const btn = document.getElementById('submit');
const pw = document.getElementById('password');
const toggle = document.getElementById('toggle');
const remember = document.getElementById('remember');

const params = new URLSearchParams(location.search);
const next = params.get('next');
const safeNext = next && /^[a-z]+\.html(\?[\w=&%-]*)?$/.test(next) ? next : 'home.html';

try { remember.checked = localStorage.getItem('sj-remember') !== '0'; } catch (e) {}

if (params.get('error') === 'not-member') show('That account isn’t set up for this journal yet.');

sb.auth.getSession().then(({ data }) => { if (data.session) location.replace(safeNext); });

toggle.addEventListener('click', () => {
  const shown = pw.type === 'text';
  pw.type = shown ? 'password' : 'text';
  toggle.textContent = shown ? 'Show' : 'Hide';
  toggle.setAttribute('aria-pressed', String(!shown));
  toggle.setAttribute('aria-label', shown ? 'Show password' : 'Hide password');
});

function show(text) { err.textContent = text; err.hidden = false; }

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  err.hidden = true;
  const username = form.username.value.trim().toLowerCase();
  const password = pw.value;
  if (!username || !password) return show('Enter your username and password.');
  btn.disabled = true;
  btn.textContent = 'Signing in…';
  try {
    try { localStorage.setItem('sj-remember', remember.checked ? '1' : '0'); } catch (e2) {}
    const { data: email, error: e1 } = await sb.rpc('login_email', { p_username: username });
    if (e1) {
      if (/login_email|function|schema cache/i.test(e1.message)) return show('The database isn’t set up yet. Run supabase/schema.sql in the Supabase SQL Editor.');
      throw e1;
    }
    if (!email) return show(`There’s no account with the username “${username}”. Check the spelling, or run supabase/members.sql to link the usernames to your accounts.`);
    // Sign in with the storage the checkbox asked for (this device vs. this tab only).
    const client = makeClient(remember.checked ? localStorage : sessionStorage);
    const { error: e2 } = await client.auth.signInWithPassword({ email, password });
    if (e2) {
      if (/not confirmed/i.test(e2.message)) return show('This account’s email isn’t confirmed yet. In Supabase → Authentication → Users, open the user and confirm it.');
      return show(/invalid/i.test(e2.message) ? 'The username is right, but the password isn’t. Try again.' : friendlyError(e2));
    }
    // Session storage choice is read when the client is created, so reload into the app.
    location.replace(safeNext);
  } catch (ex) {
    show(friendlyError(ex));
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
});
