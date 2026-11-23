# Castle Hill Hub

Facility hub for Optima Care Castle Hill: to-dos, life safety inspections, documents, QAPI, time off, finance, daily census, contacts.

- **Website:** static files in `site/`, deployed by Netlify on every push to `main` (see `netlify.toml`).
- **Data and files:** Supabase project `wrqafbjeafxdnzvhqafo` (login, database table `hub`, private storage bucket `hub-files`). No data lives in this repository.
- **Ask tab:** Supabase Edge Function in `supabase/functions/ask` (Claude API).
- **Database setup:** `supabase/schema.sql`.

`site/config.js` holds the Supabase URL and the public anon key. That key is designed to be public; access is enforced by login and row-level security.

First-time setup steps: `SETUP.md`.
