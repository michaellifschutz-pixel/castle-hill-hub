-- Castle Hill Hub — run once in Supabase: SQL Editor -> New query -> paste -> Run.

-- Who may use the Hub. Add a row per person (see the last statement).
create table if not exists public.members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email   text,
  added   timestamptz not null default now()
);
alter table public.members enable row level security;
drop policy if exists "read own membership" on public.members;
create policy "read own membership" on public.members for select using (user_id = auth.uid());

create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid())
$$;

-- The Hub's data: one row per section (todos, inspections, docs, contacts, qapi, timeoff, finance, facility, daily).
create table if not exists public.hub (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.hub enable row level security;
drop policy if exists "members only" on public.hub;
create policy "members only" on public.hub for all using (public.is_member()) with check (public.is_member());

-- Table permissions for signed-in users (newer Supabase projects don't grant these automatically).
-- Row-level security above still limits access to people on the members list.
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.hub to authenticated;
grant select on public.members to authenticated;
grant execute on function public.is_member() to authenticated;

-- Live updates between open tabs/devices.
do $$ begin
  alter publication supabase_realtime add table public.hub;
exception when duplicate_object then null; end $$;

-- Private file storage (reports, licenses, photos). Nothing is public; files open through 1-hour signed links.
insert into storage.buckets (id, name, public, file_size_limit)
values ('hub-files', 'hub-files', false, 52428800)
on conflict (id) do nothing;

drop policy if exists "hub files read"   on storage.objects;
drop policy if exists "hub files insert" on storage.objects;
drop policy if exists "hub files update" on storage.objects;
drop policy if exists "hub files delete" on storage.objects;
create policy "hub files read"   on storage.objects for select using (bucket_id = 'hub-files' and public.is_member());
create policy "hub files insert" on storage.objects for insert with check (bucket_id = 'hub-files' and public.is_member());
create policy "hub files update" on storage.objects for update using (bucket_id = 'hub-files' and public.is_member());
create policy "hub files delete" on storage.objects for delete using (bucket_id = 'hub-files' and public.is_member());

-- AFTER you create your login (Authentication -> Users -> Add user), run this with your email:
-- insert into public.members (user_id, email) select id, email from auth.users where email = 'you@example.com';
