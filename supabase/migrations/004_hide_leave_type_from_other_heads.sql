-- Department heads see who is off and when, but not the type of leave, notes or attachments
-- of other people's requests. Full Access members and the requester still see everything.
create or replace function public.get_time_off() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r text; out jsonb;
begin
  select role into r from public.members where user_id = auth.uid();
  if r is null then raise exception 'not a hub member'; end if;
  select coalesce(jsonb_agg(
           case when r = 'admin' or it->>'by' = auth.uid()::text then it
                else it - 'reason' - 'file' - 'by' - 'type' - 'decided' - 'created' end), '[]'::jsonb)
    into out
    from public.hub h, jsonb_array_elements(coalesce(h.data->'items', '[]'::jsonb)) it
   where h.id = 'timeoff'
     and (it->>'status' is distinct from 'Denied' or it->>'by' = auth.uid()::text);
  return out;
end $$;
revoke all on function public.get_time_off() from public, anon;
grant execute on function public.get_time_off() to authenticated;
