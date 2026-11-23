-- Castle Hill Hub — access levels (Full Access / Department Head) and time-off requests.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

-- 1. Access level on each member.
alter table public.members add column if not exists role text not null default 'admin';
alter table public.members add column if not exists name text;
alter table public.members add column if not exists dept text;
do $$ begin
  alter table public.members add constraint members_role_check check (role in ('admin', 'depthead'));
exception when duplicate_object then null; end $$;

-- 2. Only Full Access members can open the hub's records and files.
--    (Every existing rule uses is_member(), so this one change covers them all.)
create or replace function public.is_member() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where user_id = auth.uid() and role = 'admin')
$$;

-- 3. Department heads reach Time Off only through these three functions.
create or replace function public.get_time_off() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text; out jsonb;
begin
  select role into r from public.members where user_id = auth.uid();
  if r is null then raise exception 'not a hub member'; end if;
  select coalesce(jsonb_agg(
           case when r = 'admin' or it->>'by' = auth.uid()::text then it
                else it - 'reason' - 'file' - 'by' end), '[]'::jsonb)
    into out
    from public.hub h, jsonb_array_elements(coalesce(h.data->'items', '[]'::jsonb)) it
   where h.id = 'timeoff'
     and (it->>'status' is distinct from 'Denied' or it->>'by' = auth.uid()::text);
  return out;
end $$;

create or replace function public.submit_time_off(p_start date, p_end date, p_type text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m public.members%rowtype; item jsonb;
begin
  select * into m from public.members where user_id = auth.uid();
  if not found then raise exception 'not a hub member'; end if;
  if p_end is null then p_end := p_start; end if;
  if p_start is null or p_end < p_start then raise exception 'Check the dates: the last day is before the first day.'; end if;
  if p_end > p_start + 120 then raise exception 'Requests can cover up to 120 days.'; end if;
  if p_type is null or p_type not in ('Vacation','Personal','Sick','Holiday','Half Day','Other') then p_type := 'Other'; end if;
  item := jsonb_build_object(
    'id', 'r' || replace(gen_random_uuid()::text, '-', ''),
    'name', coalesce(nullif(m.name, ''), m.email), 'dept', coalesce(m.dept, ''),
    'start', p_start::text, 'end', p_end::text, 'type', p_type, 'status', 'Pending',
    'reason', left(coalesce(p_reason, ''), 500), 'created', current_date::text,
    'by', auth.uid()::text, 'file', null);
  insert into public.hub (id, data) values ('timeoff', jsonb_build_object('items', jsonb_build_array(item)))
  on conflict (id) do update
    set data = jsonb_set(coalesce(public.hub.data, '{}'::jsonb), '{items}',
                         coalesce(public.hub.data->'items', '[]'::jsonb) || item),
        updated_at = now();
  return item;
end $$;

create or replace function public.cancel_time_off(p_id text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.members where user_id = auth.uid()) then raise exception 'not a hub member'; end if;
  update public.hub
     set data = jsonb_set(data, '{items}', (
           select coalesce(jsonb_agg(it), '[]'::jsonb)
             from jsonb_array_elements(coalesce(data->'items', '[]'::jsonb)) it
            where not (it->>'id' = p_id and it->>'by' = auth.uid()::text and it->>'status' = 'Pending'))),
         updated_at = now()
   where id = 'timeoff';
end $$;

revoke all on function public.get_time_off() from public, anon;
revoke all on function public.submit_time_off(date, date, text, text) from public, anon;
revoke all on function public.cancel_time_off(text) from public, anon;
grant execute on function public.get_time_off() to authenticated;
grant execute on function public.submit_time_off(date, date, text, text) to authenticated;
grant execute on function public.cancel_time_off(text) to authenticated;
