-- A-72: atomic "first end-of-call report" flag for fo_voice_end (for the dropped-call call-back, A-66).
--
-- Contract (same signature, same grants, still jsonb; existing callers ignore the new key):
--   public.fo_voice_end(channel, channel_key, call_id, caller, reason, call_summary, call_transcript) returns jsonb
--   { call, contact, outcomes, first }
--   first = true  for exactly ONE end-of-call report per (channel, call id): the one that set ended_at.
--   first = false for every later or concurrent duplicate. Duplicates do not overwrite the stored reason, summary or
--   transcript, and do not log a second 'call' event.
-- Atomicity: the call row is locked (fo_voice_call_row ... for update) and ended_at is set by
--   "update ... where ended_at is null returning", so two concurrent identical reports cannot both win.
-- The caller (A-66) creates the call-back handoff only when first = true.
-- Tenant isolation is unchanged: fo_channel_workspace(channel, channel_key) still decides the workspace.
create or replace function public.fo_voice_end(channel uuid, channel_key text, call_id text, caller text, reason text, call_summary text, call_transcript text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; k public.fo_calls; u public.fo_calls; won boolean;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  k := public.fo_voice_call_row(w, channel, call_id, caller);
  update public.fo_calls set ended_at = now(), ended_reason = left(reason, 120),
    summary = nullif(left(call_summary, 4000), ''), transcript = nullif(left(call_transcript, 20000), '')
   where id = k.id and ended_at is null returning * into u;
  won := found;
  if won then k := u; end if;
  if won and k.contact_id is not null then
    insert into public.fo_events(workspace_id, contact_id, kind, agent, detail)
    values (w, k.contact_id, 'call', 'receptionist', left('Call ended (' || coalesce(nullif(reason,''), 'unknown') || ')' || coalesce(': ' || nullif(array_to_string(k.outcomes, ', '), ''), ''), 500));
  end if;
  return jsonb_build_object('call', k.id, 'contact', k.contact_id, 'outcomes', to_jsonb(k.outcomes), 'first', won);
end $$;

revoke all on function public.fo_voice_end(uuid,text,text,text,text,text,text) from public;
grant execute on function public.fo_voice_end(uuid,text,text,text,text,text,text) to anon, authenticated;
