import { sb, requireUser, nameOf, el, friendlyError } from './sb.js';
import { mountLayout } from './layout.js';

const ctx = await requireUser();
mountLayout(ctx, 'settings.html');

const $ = (id) => document.getElementById(id);
function say(node, ok, text) {
  node.textContent = text;
  node.className = 'msg ' + (ok ? 'msg-ok' : 'msg-err');
  node.hidden = false;
}

$('uname').value = ctx.me.username;
$('dname').value = ctx.me.display_name;
$('signed-as').textContent = `Signed in as ${ctx.me.username}. Usernames can't be changed.`;

$('profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('dname').value.trim();
  if (!name) return say($('profile-msg'), false, 'Your name can’t be empty.');
  const { error } = await sb.from('profiles').update({ display_name: name }).eq('id', ctx.me.id);
  if (error) return say($('profile-msg'), false, friendlyError(error));
  say($('profile-msg'), true, 'Saved. Your posts now show “' + name + '”.');
});

// ───────── Birthdays ─────────
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAYS_IN = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const people = [ctx.me, ...(ctx.partner ? [ctx.partner] : [])];
const bdayRows = new Map();
for (const p of people) {
  const id = p.id.slice(0, 8);
  const month = el('select', { class: 'input', id: 'bm-' + id, 'aria-label': `${nameOf(p.id)}’s birthday month` },
    el('option', { value: '' }, 'Month'), MONTHS.map((m, i) => el('option', { value: String(i + 1) }, m)));
  const day = el('select', { class: 'input', id: 'bd-' + id, 'aria-label': `${nameOf(p.id)}’s birthday day` }, el('option', { value: '' }, 'Day'));
  const fillDays = () => {
    const keep = day.value;
    const n = month.value ? DAYS_IN[month.value - 1] : 31;
    day.replaceChildren(el('option', { value: '' }, 'Day'), ...Array.from({ length: n }, (_, i) => el('option', { value: String(i + 1) }, String(i + 1))));
    if (keep && +keep <= n) day.value = keep;
  };
  month.addEventListener('change', fillDays);
  fillDays();
  bdayRows.set(p.id, { month, day, fillDays });
  $('bday-rows').append(el('div', { class: 'bday-row' }, el('span', { class: 'who' }, p.id === ctx.me.id ? `${nameOf(p.id)} (you)` : nameOf(p.id)), month, day));
}
let bdayReady = true;
(async () => {
  const { data, error } = await sb.from('birthdays').select('user_id, month, day');
  if (error) {
    bdayReady = false;
    say($('bday-msg'), false, 'Birthdays aren’t set up in the database yet. Run supabase/birthdays.sql in the Supabase SQL Editor.');
    return;
  }
  for (const b of data || []) {
    const r = bdayRows.get(b.user_id);
    if (!r) continue;
    r.month.value = String(b.month); r.fillDays(); r.day.value = String(b.day);
  }
})();
$('bday-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!bdayReady) return;
  const rows = [];
  for (const [user_id, r] of bdayRows) {
    if (!r.month.value && !r.day.value) continue;
    if (!r.month.value || !r.day.value) return say($('bday-msg'), false, `Pick both a month and a day for ${nameOf(user_id)}.`);
    rows.push({ user_id, month: +r.month.value, day: +r.day.value, updated_by: ctx.me.id, updated_at: new Date().toISOString() });
  }
  if (!rows.length) return say($('bday-msg'), false, 'Pick a birthday first.');
  const { error } = await sb.from('birthdays').upsert(rows, { onConflict: 'user_id' });
  if (error) return say($('bday-msg'), false, friendlyError(error));
  say($('bday-msg'), true, 'Saved. The calendar shows ' + rows.map((r) => `${nameOf(r.user_id)}’s on ${MONTHS[r.month - 1]} ${r.day}`).join(' and ') + '.');
});

$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('pw-msg');
  const cur = $('cur').value, next = $('new').value, again = $('confirm').value;
  if (next.length < 10) return say(msg, false, 'The new password needs at least 10 characters.');
  if (next !== again) return say(msg, false, 'The two new passwords don’t match.');
  const { error: e1 } = await sb.auth.signInWithPassword({ email: ctx.user.email, password: cur });
  if (e1) return say(msg, false, 'Your current password isn’t right.');
  const { error: e2 } = await sb.auth.updateUser({ password: next });
  if (e2) return say(msg, false, friendlyError(e2));
  e.target.reset();
  say(msg, true, 'Password updated. You’ll stay signed in on this device.');
});

if (ctx.partner) {
  const pn = nameOf(ctx.partner.id);
  $('reset').textContent = `${pn} forgot their password?`;
  $('reset-text').textContent = `Send ${ctx.partner.username} a reset link by email. They choose the new password themselves, so you never see it.`;
  $('reset-btn').textContent = `Send ${pn} a reset link`;
  $('reset-btn').addEventListener('click', async () => {
    const msg = $('reset-msg');
    const { data: email, error } = await sb.rpc('login_email', { p_username: ctx.partner.username });
    if (error || !email) return say(msg, false, friendlyError(error || 'Couldn’t find their email.'));
    const redirectTo = new URL('reset.html', location.href).href;
    const { error: e2 } = await sb.auth.resetPasswordForEmail(email, { redirectTo });
    if (e2) return say(msg, false, friendlyError(e2));
    say(msg, true, `Reset link sent to ${pn}’s email.`);
  });
} else {
  $('reset').closest('section').hidden = true;
}

$('everywhere').addEventListener('click', async () => {
  await sb.auth.signOut({ scope: 'global' });
  location.replace('index.html');
});
