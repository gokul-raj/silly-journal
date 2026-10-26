import { sb, requireUser, nameOf, friendlyError } from './sb.js';
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
