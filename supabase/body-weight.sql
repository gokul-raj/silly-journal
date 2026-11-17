-- ─────────────────────────────────────────────────────────────
-- Body weight on each profile, for cardio calorie estimates in Silly Fitness.
-- Each of us sets our own in Settings (the existing "edit own profile" rule).
-- Safe to run more than once.
-- ─────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists body_weight numeric
  check (body_weight is null or (body_weight > 20 and body_weight < 1000));
alter table public.profiles add column if not exists body_weight_unit text not null default 'lb'
  check (body_weight_unit in ('lb', 'kg'));
