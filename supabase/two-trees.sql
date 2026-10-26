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
