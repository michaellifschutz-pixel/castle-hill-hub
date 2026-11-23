# Castle Hill Hub — Your Own Website

Same Hub you use on claude.ai, at your own web address, behind your own login.
About 30–45 minutes, once. Free tiers cover it (Anthropic API usage for the Ask tab is billed separately).

## What's in the package
| Folder | What it is | Goes where |
|---|---|---|
| `site/` | The website itself (no data inside) | Netlify |
| `supabase/schema.sql` | Database, file storage, and access rules | Supabase SQL Editor |
| `supabase/functions/ask/` | Powers the Ask tab and "snap a photo" document reading | Supabase Edge Functions |
| `private-import/` (separate zip) | All your records + 168 files | Your computer only. **Never upload this folder to Netlify.** |

---

## 1. Create the database (Supabase)
1. Go to **supabase.com**, sign up, **New project**. Name: `castle-hill-hub`. Region: **East US**. Save the database password somewhere safe.
2. Left menu → **SQL Editor** → **New query**. Paste all of `supabase/schema.sql` → **Run**. You should see "Success".
3. Left menu → **Authentication** → **Sign In / Providers** → turn **off** "Allow new users to sign up". (Only people you add can get in.)
4. **Authentication** → **Users** → **Add user** → **Create new user**: your email, a strong password (12+ characters), tick **Auto Confirm User**.
5. Back in **SQL Editor**, run this with your email:
   ```sql
   insert into public.members (user_id, email) select id, email from auth.users where email = 'YOUR EMAIL';
   ```
6. **Project Settings** → **API**: copy the **Project URL** and the **anon public** key.

## 2. Connect the website
Open `site/config.js` in Notepad/TextEdit and paste the two values in place of `YOUR-PROJECT...` and `YOUR-ANON-KEY`. Save.

## 3. Put the website online (Netlify)
1. Go to **app.netlify.com/drop** (sign up free).
2. Drag the **`site`** folder onto the page. In a few seconds you get an address like `https://something.netlify.app`.
3. Optional: **Site configuration** → **Change site name** (e.g. `castlehill-hub`), or add your own domain.
4. Back in Supabase → **Authentication** → **URL Configuration** → set **Site URL** to your Netlify address. (Makes "Forgot Password" links work.)

## 4. Move your data in
1. Unzip `castle-hill-hub-private-import.zip` on your computer.
2. Open `https://YOUR-SITE.netlify.app/#import`, sign in.
3. Choose the **private-import** folder → **Start Import**. It uploads 168 files (~45 MB), then your records. Takes a few minutes; keep the tab open.
4. Close the window. Everything from the claude.ai Hub is there.

## 5. Turn on the Ask tab (optional but recommended)
1. Get an API key at **console.anthropic.com** → API Keys → Create Key (add a payment method under Billing).
2. Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**. Name it exactly `ask`. Replace the sample code with all of `supabase/functions/ask/index.ts` → **Deploy**.
3. **Edge Functions** → **Secrets** → add `ANTHROPIC_API_KEY` = your key.
4. Cost: each question sends the Hub's current records to Claude Opus 5.5 — roughly 10–25¢ per question at today's size. Set a monthly limit in the Anthropic Console under Limits.

Without step 5 everything else works; Ask just says it couldn't get an answer.

---

## Adding staff later
Authentication → Users → Add user, then run the `insert into public.members ...` line with their email.
Right now every member sees **everything**, including HR – Owner Only and Finance. Ask Claude to add per-person access before giving staff logins.

## Changing the site later
Edit files in `site/`, then on Netlify: **Deploys** → drag the `site` folder again.

## Backups
Supabase free projects pause after 7 days without use (one click to resume). For a nightly backup and no pausing, upgrade to Supabase Pro ($25/mo).

## Privacy
The website files hold no data. Records and files live in your Supabase project, readable only after login (row-level security), and files open through links that expire after an hour.
**HIPAA:** the Hub holds staff HR details and some survey/compliance documents. If any of it contains resident health information, use Supabase's HIPAA option (Team plan + signed BAA) and an Anthropic BAA, or keep resident-identifying documents out of the Hub.
