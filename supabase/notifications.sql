-- ─────────────────────────────────────────────────────────────
-- Notifications: what each of us has read. The notifications themselves
-- come from the other person's posts, comments and waterings.
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.notif_state (
  user_id uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  cleared_at timestamptz not null default now()   -- everything before this counts as read
);
create table if not exists public.notif_reads (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  key text not null check (length(key) <= 200),
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.notif_state enable row level security;
alter table public.notif_reads enable row level security;
drop policy if exists "own notif state" on public.notif_state;
create policy "own notif state" on public.notif_state for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());
drop policy if exists "own notif reads" on public.notif_reads;
create policy "own notif reads" on public.notif_reads for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and public.is_member());
