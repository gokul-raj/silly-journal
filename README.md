# Silly Journal

Xinyi & Gokul's private journal: notebook pages you can type, draw and put stickers on, a shared gym streak (Silly Fitness) and two trees you grow together, one in Ithaca and one in Santa Clara (Our Trees).

It's a plain static site (no build step) hosted on GitHub Pages, with Supabase for sign-in, the database and private photo storage.

## One-time setup

### 1. Database
1. In Supabase, open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql) and click **Run**.
2. Create your two accounts in **Authentication → Users → Add user → Create new user** (your own email and password each; tick "Auto confirm").
3. Open [`supabase/members.sql`](supabase/members.sql), replace the two emails, paste it into a new query and **Run**. It should list exactly two rows: `sillyxinyi` and `sillygokul`.
4. In **Authentication → Sign In / Providers**, turn **off** "Allow new users to sign up".

### Updating an existing database
If you set up the database before the two-trees change, run [`supabase/two-trees.sql`](supabase/two-trees.sql) once in the SQL Editor. It keeps the tree you already planted (in the place it was set to) and gives the other place its own empty tree.

### 2. Links in emails
In **Authentication → URL Configuration**:
- **Site URL:** `https://gokul-raj.github.io/silly-journal/`
- **Redirect URLs:** add `https://gokul-raj.github.io/silly-journal/reset.html`

### 3. Turn on the website
In this repo on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save**. After a minute it's live at https://gokul-raj.github.io/silly-journal/

## How it's protected
- Every page checks you're signed in and sends you to the sign-in page if not.
- Row-level security in the database only lets your two accounts read or write anything; everyone else gets nothing, even with the public key in `js/config.js`.
- Photos, drawings and stickers live in private storage and are shown through links that expire after an hour.
- "Read-only" pages can only be edited by the person who wrote them; the database enforces this, not just the page.

## Files
- `index.html` sign in · `home.html` journal · `write.html` notebook editor · `entry.html` a page with likes & comments
- `fitness.html` Silly Fitness · `tree.html` Our Trees · `about.html` · `settings.html` · `reset.html`
- `js/config.js` Supabase URL + public key, tree locations
- `supabase/schema.sql` tables, security rules, storage buckets
- Weather comes from [Open-Meteo](https://open-meteo.com/) (free, no key).

Free-plan note: Supabase pauses a project after a week with no activity; opening the site wakes it.
