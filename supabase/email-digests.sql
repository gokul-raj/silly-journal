-- ─────────────────────────────────────────────────────────────
-- Email nudges: every morning at 8 AM Eastern, if one of us has any unread
-- notifications from the other, send a short, discreet email with the count.
--
-- Run this AFTER notifications.sql and comment-threads.sql, and after the
-- "email-digest" Edge Function is deployed (see README). Safe to run again.
-- ─────────────────────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- When each of us was last emailed (used if only_new is turned on below).
create table if not exists public.notif_email_state (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  last_emailed_at timestamptz not null default now()
);
alter table public.notif_email_state enable row level security;
drop policy if exists "own email state" on public.notif_email_state;
create policy "own email state" on public.notif_email_state for select using (user_id = auth.uid());
insert into public.notif_email_state (user_id, last_emailed_at) select id, now() - interval '1 day' from public.profiles on conflict do nothing;

-- Everything the other person did that `who` hasn't read yet (same rules as the bell).
create or replace function public.unread_notifications(who uuid)
returns table (key text, at timestamptz, kind text)
language sql stable security definer set search_path = public as $$
  with me as (
    select who as id,
           (select p.id from profiles p where p.id <> who limit 1) as partner,
           coalesce((select cleared_at from notif_state where user_id = who), now() - interval '3 days') as cleared,
           now() - interval '30 days' as since
  ),
  items as (
    select 'entry:' || e.id as key, e.created_at as at, 'posted' as kind
      from entries e, me where e.author = me.partner and e.created_at >= me.since
    union all
    select 'ec:' || c.id, c.created_at,
           case when pc.user_id = me.id then 'replied to your comment'
                when e.author = me.id then 'commented on your post'
                else 'commented' end
      from entry_comments c join entries e on e.id = c.entry_id
      left join entry_comments pc on pc.id = c.parent_id, me
      where c.user_id = me.partner and c.created_at >= me.since
    union all
    select 'gym:' || g.id, g.created_at, case when g.kind = 'gym' then 'updated gym post' else 'asked a gym question' end
      from gym_posts g, me where g.author = me.partner and g.created_at >= me.since
    union all
    select 'gc:' || c.id, c.created_at,
           case when pc.user_id = me.id then 'replied to your comment'
                when g.author = me.id then 'commented on your post'
                else 'commented' end
      from gym_comments c join gym_posts g on g.id = c.post_id
      left join gym_comments pc on pc.id = c.parent_id, me
      where c.user_id = me.partner and c.created_at >= me.since
    union all
    select 'water:' || w.location || ':' || w.day::text, w.created_at, 'watered a tree'
      from waterings w, me where w.user_id = me.partner and w.created_at >= me.since
  )
  select i.key, i.at, i.kind from items i, me
  where i.at > me.cleared
    and not exists (select 1 from notif_reads r where r.user_id = me.id and r.key = i.key)
$$;
revoke all on function public.unread_notifications(uuid) from public, anon, authenticated;

-- Who is due an email right now, and what to say. Marks them as emailed (last_emailed_at = now)
-- so a second run the same morning sends nothing. Only the Edge Function may call it.
--   min_new:  send when at least this many unread (1 = any unread at all)
--   only_new: true = count only notifications that arrived since the last email
drop function if exists public.claim_email_digests(int);
create or replace function public.claim_email_digests(min_new int default 1, only_new boolean default false)
returns table (user_id uuid, email text, partner_name text, n int, lines text[], previous timestamptz)
language plpgsql volatile security definer set search_path = public as $$
declare m record; cnt int; ls text[]; pname text; prev timestamptz;
begin
  for m in select p.id, u.email from profiles p join auth.users u on u.id = p.id loop
    select coalesce(s.last_emailed_at, now()) into prev from notif_email_state s where s.user_id = m.id;
    if prev is null then
      insert into notif_email_state (user_id) values (m.id) on conflict do nothing;
      continue;
    end if;
    if prev > now() - interval '20 hours' and not only_new then continue; end if; -- once a day at most
    select count(*) into cnt from unread_notifications(m.id) x where not only_new or x.at > prev;
    if cnt < greatest(min_new, 1) or m.email is null then continue; end if;
    select coalesce(nullif(p.display_name, ''), p.username) into pname from profiles p where p.id <> m.id limit 1;
    select array_agg(pname || ' ' || x.kind || case when x.c > 1 then ' (' || x.c || ')' else '' end order by x.first)
      into ls
      from (select kind, count(*) as c, min(at) as first from unread_notifications(m.id) where not only_new or at > prev group by kind) x;
    update notif_email_state set last_emailed_at = now() where notif_email_state.user_id = m.id;
    user_id := m.id; email := m.email; partner_name := pname; n := cnt; lines := ls; previous := prev;
    return next;
  end loop;
end $$;
revoke all on function public.claim_email_digests(int, boolean) from public, anon, authenticated;
grant execute on function public.claim_email_digests(int, boolean) to service_role;

-- If an email couldn't be sent, put the clock back so it's tried again next time.
create or replace function public.unclaim_email_digest(p_user uuid, p_previous timestamptz)
returns void language sql security definer set search_path = public as $$
  update notif_email_state set last_emailed_at = p_previous where user_id = p_user;
$$;
revoke all on function public.unclaim_email_digest(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.unclaim_email_digest(uuid, timestamptz) to service_role;

-- Once a day at 8 AM Eastern, ask the Edge Function to send whatever is due.
-- The scheduler runs on UTC, so it wakes at 12:00 and 13:00 UTC and only goes ahead
-- in whichever of those is 8 AM in New York (that changes with daylight saving).
select cron.unschedule(jobname) from cron.job where jobname in ('silly-journal-email-digest');
select cron.schedule(
  'silly-journal-email-digest',
  '0 12,13 * * *',
  $$ select net.http_post(
       url := 'https://hjzmdhcdeqyzsbarszox.supabase.co/functions/v1/email-digest',
       headers := '{"Content-Type": "application/json"}'::jsonb,
       body := '{}'::jsonb
     )
     where extract(hour from now() at time zone 'America/New_York') = 8 $$
);
