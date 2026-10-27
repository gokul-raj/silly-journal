-- Silly Journal database schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is safe to run more than once.

-- ─────────────────────────────────────────────────────────────
-- Members: exactly the two of you
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique not null check (username ~ '^[a-z0-9_]{3,32}$'),
  display_name text not null,
  created_at timestamptz not null default now()
);

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid());
$$;

-- Lets the sign-in page turn a username into the account email.
create or replace function public.login_email(p_username text) returns text
language sql stable security definer set search_path = public, auth as $$
  select u.email from auth.users u join public.profiles p on p.id = u.id
  where p.username = lower(trim(p_username)) limit 1;
$$;
revoke all on function public.login_email(text) from public;
grant execute on function public.login_email(text) to anon, authenticated;

alter table public.profiles enable row level security;
drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles for select using (public.is_member());
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ─────────────────────────────────────────────────────────────
-- Journal
-- ─────────────────────────────────────────────────────────────
create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null default '',
  place text not null default '',
  body_html text not null default '',
  drawing_path text,
  stickers jsonb not null default '[]'::jsonb,
  paper text not null default 'ruled' check (paper in ('ruled','grid','dots','blank')),
  access text not null default 'both' check (access in ('author','both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.entries enable row level security;
drop policy if exists "members read entries" on public.entries;
create policy "members read entries" on public.entries for select using (public.is_member());
drop policy if exists "write own entries" on public.entries;
create policy "write own entries" on public.entries for insert with check (author = auth.uid() and public.is_member());
drop policy if exists "edit shared or own entries" on public.entries;
create policy "edit shared or own entries" on public.entries for update
  using (public.is_member() and (author = auth.uid() or access = 'both'))
  with check (public.is_member() and (author = auth.uid() or access = 'both'));
drop policy if exists "delete own entries" on public.entries;
create policy "delete own entries" on public.entries for delete using (author = auth.uid());

-- Only the author may change who can edit, or the authorship itself.
create or replace function public.entries_guard() returns trigger language plpgsql as $$
begin
  if new.author <> old.author then raise exception 'author cannot change'; end if;
  if new.access <> old.access and auth.uid() <> old.author then
    raise exception 'only the writer can change who can edit';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists entries_guard on public.entries;
create trigger entries_guard before update on public.entries for each row execute function public.entries_guard();

create table if not exists public.entry_likes (
  entry_id uuid references public.entries (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (entry_id, user_id)
);
create table if not exists public.entry_comments (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.entries (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create table if not exists public.sticker_uploads (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Silly Fitness
-- ─────────────────────────────────────────────────────────────
create table if not exists public.gym_posts (
  id uuid primary key default gen_random_uuid(),
  author uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind text not null check (kind in ('gym','question')),
  photo_path text,
  workouts jsonb not null default '[]'::jsonb,
  body text not null default '',
  created_at timestamptz not null default now(),
  constraint gym_needs_photo check (kind <> 'gym' or photo_path is not null)
);
create table if not exists public.gym_likes (
  post_id uuid references public.gym_posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create table if not exists public.gym_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.gym_posts (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
-- Weekly goal history: a change only applies from the following Monday.
create table if not exists public.gym_goals (
  id uuid primary key default gen_random_uuid(),
  goal int not null check (goal between 1 and 7),
  effective_from date not null,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- Our Trees: one tree in Ithaca and one in Santa Clara.
-- Safe to run more than once. On a database that still has the old
-- single "tree" table, it moves that tree (and its waterings and
-- basket) to the location it was set to, then removes the old table.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.trees (
  location text primary key check (location in ('ithaca','santaclara')),
  kind text check (kind in ('mango','papaya','jackfruit','apple','cherry','lemon','orange','banana')),
  planted_on date,
  updated_at timestamptz not null default now()
);
insert into public.trees (location) values ('ithaca'), ('santaclara') on conflict do nothing;

-- The tree type is chosen once, when it is planted.
create or replace function public.tree_guard() returns trigger language plpgsql as $$
begin
  if old.kind is not null and new.kind is distinct from old.kind then
    raise exception 'this tree is already planted';
  end if;
  if old.kind is null and new.kind is not null then new.planted_on := current_date; end if;
  new.location := old.location;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists tree_guard on public.trees;
create trigger tree_guard before update on public.trees for each row execute function public.tree_guard();

create table if not exists public.waterings (
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  location text,
  day date not null,
  created_at timestamptz not null default now()
);
create table if not exists public.basket (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  location text,
  fruit text not null,
  day date not null,
  spot int not null,
  created_at timestamptz not null default now()
);
alter table public.waterings add column if not exists location text;
alter table public.basket add column if not exists location text;

-- Move the old single tree over, if there is one.
do $$
declare old_loc text := 'ithaca';
begin
  if to_regclass('public.tree') is not null then
    select coalesce(location, 'ithaca') into old_loc from public.tree where id = 1;
    update public.trees t set kind = o.kind, planted_on = o.planted_on
      from public.tree o
      where o.id = 1 and o.kind is not null and t.location = coalesce(old_loc, 'ithaca') and t.kind is null;
    drop table public.tree;
  end if;
  update public.waterings set location = coalesce(old_loc, 'ithaca') where location is null;
  update public.basket set location = coalesce(old_loc, 'ithaca') where location is null;
end $$;

alter table public.waterings alter column location set not null;
alter table public.basket alter column location set not null;
alter table public.waterings drop constraint if exists waterings_location_fkey;
alter table public.waterings add constraint waterings_location_fkey foreign key (location) references public.trees (location);
alter table public.basket drop constraint if exists basket_location_fkey;
alter table public.basket add constraint basket_location_fkey foreign key (location) references public.trees (location);
alter table public.waterings drop constraint if exists waterings_pkey;
alter table public.waterings add primary key (user_id, location, day);
alter table public.basket drop constraint if exists basket_day_spot_key;
alter table public.basket drop constraint if exists basket_location_day_spot_key;
alter table public.basket add constraint basket_location_day_spot_key unique (location, day, spot);

alter table public.trees enable row level security;
drop policy if exists "members read trees" on public.trees;
create policy "members read trees" on public.trees for select using (public.is_member());
drop policy if exists "members update trees" on public.trees;
create policy "members update trees" on public.trees for update using (public.is_member()) with check (public.is_member());

-- ─────────────────────────────────────────────────────────────
-- Shared rules for the member-only tables: read if you are one of
-- the two members, write rows as yourself, delete only your own.
-- ─────────────────────────────────────────────────────────────
do $$
declare r record; t text; owner_col text;
begin
  for r in select * from (values
    ('entry_likes','user_id'), ('entry_comments','user_id'), ('sticker_uploads','owner'),
    ('gym_posts','author'), ('gym_likes','user_id'), ('gym_comments','user_id'),
    ('gym_goals','created_by'), ('waterings','user_id'), ('basket','user_id')
  ) as v(tbl, col)
  loop
    t := r.tbl; owner_col := r.col;
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select using (public.is_member())', t);
    execute format('drop policy if exists "members add own" on public.%I', t);
    execute format('create policy "members add own" on public.%I for insert with check (public.is_member() and %I = auth.uid())', t, owner_col);
    execute format('drop policy if exists "delete own" on public.%I', t);
    execute format('create policy "delete own" on public.%I for delete using (%I = auth.uid())', t, owner_col);
  end loop;
end $$;

drop policy if exists "edit own gym posts" on public.gym_posts;
create policy "edit own gym posts" on public.gym_posts for update using (author = auth.uid()) with check (author = auth.uid());

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

-- ─────────────────────────────────────────────────────────────
-- Private photo storage
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('journal', 'journal', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('stickers', 'stickers', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('gym', 'gym', false) on conflict (id) do nothing;

drop policy if exists "members read files" on storage.objects;
create policy "members read files" on storage.objects for select
  using (bucket_id in ('journal','stickers','gym') and public.is_member());
drop policy if exists "members upload files" on storage.objects;
create policy "members upload files" on storage.objects for insert
  with check (bucket_id in ('journal','stickers','gym') and public.is_member());
drop policy if exists "members replace files" on storage.objects;
create policy "members replace files" on storage.objects for update
  using (bucket_id in ('journal','stickers','gym') and public.is_member());
drop policy if exists "owners delete files" on storage.objects;
create policy "owners delete files" on storage.objects for delete
  using (bucket_id in ('journal','stickers','gym') and owner = auth.uid());
