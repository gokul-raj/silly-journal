-- ─────────────────────────────────────────────────────────────
-- Memory calendar highlights: which journal page is the picture for a day.
-- Either of us can set or change it. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.day_highlights (
  day date primary key,
  entry_id uuid not null references public.entries (id) on delete cascade,
  set_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  updated_at timestamptz not null default now()
);
alter table public.day_highlights enable row level security;
drop policy if exists "members read highlights" on public.day_highlights;
create policy "members read highlights" on public.day_highlights for select using (public.is_member());
drop policy if exists "members add highlights" on public.day_highlights;
create policy "members add highlights" on public.day_highlights for insert with check (public.is_member() and set_by = auth.uid());
drop policy if exists "members change highlights" on public.day_highlights;
create policy "members change highlights" on public.day_highlights for update using (public.is_member()) with check (public.is_member() and set_by = auth.uid());
drop policy if exists "members remove highlights" on public.day_highlights;
create policy "members remove highlights" on public.day_highlights for delete using (public.is_member());
