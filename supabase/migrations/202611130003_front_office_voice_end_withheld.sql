-- A-76: a dropped call from a withheld number with no contact must not be silent.
--
-- Problem: fo_voice_end only logs an event, and the app only records a call-back, when the call has a contact. A caller
-- who withheld their number and never gave one has no contact, so a dropped call left nothing for staff.
-- Fix (database only; the app code path is unchanged because it already acts on the `contact` key of the result):
--   when the FIRST end-of-call report (first = true) of a call with no contact has a dropped reason, a placeholder
--   contact is created for that one call (name 'Withheld caller', a unique non-deliverable email, since a contact needs a
--   phone or email) and linked to the call. The existing 'call' event is then logged for it and the result carries its id,
--   so the app records the call-back handoff exactly as for any other dropped call.
-- Duplicates: the placeholder is made only by the report that sets ended_at (first = true), under the call-row lock, and the
--   email is derived from the call id, so a duplicate or concurrent report creates no second contact and no second event.
-- Not-dropped endings (assistant ended, voicemail, never answered, forwarded, ...) create no placeholder.
-- Same signature, same security definer / search_path / grants as 202611130002.
create or replace function public.fo_voice_end(channel uuid, channel_key text, call_id text, caller text, reason text, call_summary text, call_transcript text) returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; k public.fo_calls; u public.fo_calls; won boolean; c public.fo_contacts; dropped boolean;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  k := public.fo_voice_call_row(w, channel, call_id, caller);
  update public.fo_calls set ended_at = now(), ended_reason = left(reason, 120),
    summary = nullif(left(call_summary, 4000), ''), transcript = nullif(left(call_transcript, 20000), '')
   where id = k.id and ended_at is null returning * into u;
  won := found;
  if won then k := u; end if;
  -- Same list as the app's isDroppedReason (receptionist/dropped.ts).
  dropped := coalesce(reason ~ '^(customer-ended-call|silence-timed-out|exceeded-max-duration|phone-call-provider-closed-websocket)$'
    or reason ~ '^(pipeline-error|call\.in-progress\.error|twilio-failed|vonage-failed|assistant-request-failed)', false);
  -- Same settled list as createCallback's SETTLED (dropped.ts): a call already dealt with needs no placeholder.
  if won and k.contact_id is null and dropped
     and not (k.outcomes && array['booked','rescheduled','cancelled','message','transfer','not-live']::text[]) then
    insert into public.fo_contacts(workspace_id, email, name)
    values (w, 'withheld-' || md5(k.id::text) || '@call.invalid', 'Withheld caller') on conflict do nothing;
    select * into c from public.fo_contacts where workspace_id = w and email = 'withheld-' || md5(k.id::text) || '@call.invalid' for update;
    insert into public.fo_events(workspace_id, contact_id, kind, to_state, detail) values (w, c.id, 'created', c.state, 'Dropped call, number withheld');
    update public.fo_calls set contact_id = c.id where id = k.id returning * into k;
  end if;
  if won and k.contact_id is not null then
    insert into public.fo_events(workspace_id, contact_id, kind, agent, detail)
    values (w, k.contact_id, 'call', 'receptionist', left('Call ended (' || coalesce(nullif(reason,''), 'unknown') || ')' || coalesce(': ' || nullif(array_to_string(k.outcomes, ', '), ''), ''), 500));
  end if;
  return jsonb_build_object('call', k.id, 'contact', k.contact_id, 'outcomes', to_jsonb(k.outcomes), 'first', won);
end $$;

revoke all on function public.fo_voice_end(uuid,text,text,text,text,text,text) from public;
grant execute on function public.fo_voice_end(uuid,text,text,text,text,text,text) to anon, authenticated;
