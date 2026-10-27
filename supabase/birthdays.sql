-- ─────────────────────────────────────────────────────────────
-- Birthdays for the Memories calendar (month and day only).
-- Either of us can set either birthday in Settings. Safe to run more than once;
-- it only fills in a birthday that hasn't been set yet.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.birthdays (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  month int not null check (month between 1 and 12),
  day int not null check (day between 1 and 31),
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);
alter table public.birthdays enable row level security;
drop policy if exists "members read birthdays" on public.birthdays;
create policy "members read birthdays" on public.birthdays for select using (public.is_member());
drop policy if exists "members add birthdays" on public.birthdays;
create policy "members add birthdays" on public.birthdays for insert with check (public.is_member());
drop policy if exists "members change birthdays" on public.birthdays;
create policy "members change birthdays" on public.birthdays for update using (public.is_member()) with check (public.is_member());

insert into public.birthdays (user_id, month, day)
  select id, v.month, v.day from public.profiles p
  join (values ('sillyxinyi', 11, 8), ('sillygokul', 9, 13)) as v(username, month, day) on v.username = p.username
  on conflict (user_id) do nothing;
