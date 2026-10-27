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
  const html = `<div style="font-family:Helvetica,Arial,sans-serif;color:#121417;max-width:480px">
  <p style="font-size:22px;font-weight:700;margin:0 0 12px">${esc(headline)}</p>
  <ul style="padding-left:20px;margin:0 0 20px;font-size:16px;line-height:1.6">${d.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
  <a href="${SITE}" style="display:inline-block;background:#ff4f8d;color:#fff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px">Open Silly Journal</a>
</div>`;
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
