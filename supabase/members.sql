-- Run this AFTER schema.sql, once you have both created your accounts in
-- Supabase → Authentication → Users. Replace the two emails below with the
-- ones you each signed up with, then Run.

insert into public.profiles (id, username, display_name)
select id, 'sillyxinyi', 'Xinyi' from auth.users where email = 'XINYI_EMAIL_HERE'
on conflict (id) do update set username = excluded.username;

insert into public.profiles (id, username, display_name)
select id, 'sillygokul', 'Gokul' from auth.users where email = 'GOKUL_EMAIL_HERE'
on conflict (id) do update set username = excluded.username;

-- Should list exactly two rows:
select p.username, p.display_name, u.email from public.profiles p join auth.users u on u.id = p.id;
