// Silly Journal email nudges. Called once a day (8 AM Eastern) by the database scheduler.
// Asks the database who has unread notifications, and emails them
// a short, discreet summary through Gmail.
//
// Secrets to set in Supabase → Edge Functions → Secrets:
//   GMAIL_USER          the Gmail address the emails come from
//   GMAIL_APP_PASSWORD  a Gmail "app password" for that account (not your normal password)
import { createClient } from 'npm:@supabase/supabase-js@2';
import nodemailer from 'npm:nodemailer@6';

const SITE = Deno.env.get('SITE_URL') ?? 'https://gokul-raj.github.io/silly-journal/';

function serviceKey(): string {
  const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (k) return k;
  try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? ''; } catch { return ''; }
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

export function buildEmail(d: { partner_name: string; n: number; lines: string[] }) {
  const subject = `New updates from ${d.partner_name} on Silly Journal!`;
  const headline = `${d.n} new notification${d.n === 1 ? '' : 's'}`;
  const text = [headline, '', ...d.lines.map((l) => '• ' + l), '', 'Open Silly Journal: ' + SITE].join('\n');
  const img = (name: string) => new URL('assets/email/' + name, SITE).href;
  const items = d.lines.map((l) => `<tr><td width="22" valign="top" style="padding:7px 0 0 0;color:#ff4f8d;font-size:14px;line-height:20px">&#9829;</td><td style="padding:6px 0;font-size:16px;line-height:22px;color:#121417;border-bottom:1px solid #F0EEE8">${esc(l)}</td></tr>`).join('');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#EDEDEB">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EDEDEB"><tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:520px;background:#FFFDF8;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(18,20,23,.12)">
    <tr><td><a href="${SITE}"><img src="${img('header.png')}" width="520" alt="Silly Journal" style="display:block;width:100%;max-width:520px;height:auto;border:0"></a></td></tr>
    <tr><td style="padding:26px 32px 6px 32px;font-family:Helvetica,Arial,sans-serif">
      <p style="margin:0;font-size:28px;line-height:34px;font-weight:700;color:#121417">${esc(headline)}</p>
      <p style="margin:4px 0 18px 0;font-size:15px;line-height:22px;color:#4B5563">from ${esc(d.partner_name)}</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${items}</table>
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0"><tr><td style="background:#ff4f8d;border-radius:6px">
        <a href="${SITE}" style="display:inline-block;padding:12px 22px;font-family:Helvetica,Arial,sans-serif;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none">Open Silly Journal</a>
      </td></tr></table>
    </td></tr>
    <tr><td><img src="${img('footer.png')}" width="520" alt="" style="display:block;width:100%;max-width:520px;height:auto;border:0"></td></tr>
  </table>
  <p style="margin:14px 0 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#6B7280">Sent at 8 AM Eastern when something on Silly Journal is waiting for you.</p>
</td></tr></table></body></html>`;
  return { subject, text, html };
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));
  const user = Deno.env.get('GMAIL_USER');
  const pass = Deno.env.get('GMAIL_APP_PASSWORD');
  if (!user || !pass) return new Response('Set GMAIL_USER and GMAIL_APP_PASSWORD in Edge Function secrets.', { status: 500 });

  // Gmail's secure port (Supabase blocks 25 and 587). SMTP_HOST/SMTP_PORT only exist for local testing.
  const mail = nodemailer.createTransport({ host: Deno.env.get('SMTP_HOST') ?? 'smtp.gmail.com', port: Number(Deno.env.get('SMTP_PORT') ?? 465), secure: true, auth: { user, pass } });

  // Setup check: {"check": true} only logs in to Gmail; nothing is sent.
  if (body && body.check) {
    try { await mail.verify(); return new Response('Gmail login works. Emails will come from ' + user + '.'); }
    catch (e) { return new Response('Gmail login failed: ' + (e instanceof Error ? e.message : String(e)), { status: 500 }); }
  }

  // Sample email: {"test": true} sends a "0 new notifications" email to GMAIL_USER only.
  if (body && body.test) {
    const sample = buildEmail({ partner_name: typeof body.from === 'string' ? body.from.slice(0, 40) : 'Xinyi', n: 0, lines: ['(This is a test email. Real ones only come when there is something new.)'] });
    try { await mail.sendMail({ from: `"Silly Journal" <${user}>`, to: user, ...sample }); return new Response('Test email sent to ' + user + '.'); }
    catch (e) { return new Response('Test email failed: ' + (e instanceof Error ? e.message : String(e)), { status: 500 }); }
  }

  const sb = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey(), { auth: { persistSession: false } });
  // Any unread notification at all → email (the database allows one email per person per day).
  const { data, error } = await sb.rpc('claim_email_digests', { min_new: 1, only_new: false });
  if (error) return new Response('Database: ' + error.message, { status: 500 });
  if (!data?.length) return new Response('Nothing to send.');

  const results: string[] = [];
  for (const d of data) {
    const { subject, text, html } = buildEmail(d);
    try {
      await mail.sendMail({ from: `"Silly Journal" <${user}>`, to: d.email, subject, text, html });
      results.push(`sent ${d.n} to ${d.partner_name === 'Gokul' ? 'Xinyi' : 'Gokul'}`);
    } catch (e) {
      // Put the clock back so this batch is tried again tomorrow.
      await sb.rpc('unclaim_email_digest', { p_user: d.user_id, p_previous: d.previous });
      results.push('failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  }
  return new Response(results.join('\n'));
});
