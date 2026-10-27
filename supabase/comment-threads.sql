-- ─────────────────────────────────────────────────────────────
-- Comment replies (one level: replies to a comment, no replies to replies)
-- and likes on comments. Safe to run more than once.
-- ─────────────────────────────────────────────────────────────
alter table public.entry_comments add column if not exists parent_id uuid references public.entry_comments (id) on delete cascade;
alter table public.gym_comments add column if not exists parent_id uuid references public.gym_comments (id) on delete cascade;

-- A reply must point at a top-level comment on the same page / post.
create or replace function public.entry_comment_thread_guard() returns trigger language plpgsql as $$
declare p record;
begin
  if new.parent_id is null then return new; end if;
  select entry_id, parent_id into p from public.entry_comments where id = new.parent_id;
  if not found or p.entry_id <> new.entry_id then raise exception 'reply must be on the same page'; end if;
  if p.parent_id is not null then raise exception 'replies can only go one level deep'; end if;
  return new;
end $$;
drop trigger if exists entry_comment_thread_guard on public.entry_comments;
create trigger entry_comment_thread_guard before insert or update on public.entry_comments for each row execute function public.entry_comment_thread_guard();

create or replace function public.gym_comment_thread_guard() returns trigger language plpgsql as $$
declare p record;
begin
  if new.parent_id is null then return new; end if;
  select post_id, parent_id into p from public.gym_comments where id = new.parent_id;
  if not found or p.post_id <> new.post_id then raise exception 'reply must be on the same post'; end if;
  if p.parent_id is not null then raise exception 'replies can only go one level deep'; end if;
  return new;
end $$;
drop trigger if exists gym_comment_thread_guard on public.gym_comments;
create trigger gym_comment_thread_guard before insert or update on public.gym_comments for each row execute function public.gym_comment_thread_guard();

create table if not exists public.entry_comment_likes (
  comment_id uuid not null references public.entry_comments (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create table if not exists public.gym_comment_likes (
  comment_id uuid not null references public.gym_comments (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
do $$
declare t text;
begin
  foreach t in array array['entry_comment_likes', 'gym_comment_likes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "members read" on public.%I', t);
    execute format('create policy "members read" on public.%I for select using (public.is_member())', t);
    execute format('drop policy if exists "members add own" on public.%I', t);
    execute format('create policy "members add own" on public.%I for insert with check (public.is_member() and user_id = auth.uid())', t);
    execute format('drop policy if exists "delete own" on public.%I', t);
    execute format('create policy "delete own" on public.%I for delete using (user_id = auth.uid())', t);
  end loop;
end $$;
