-- AI front office, task A-18: ONE owner approval queue. Held Meta (Instagram / Messenger) replies move from fo_outbox into
-- fo_pending_actions (kind 'outbox_reply', product 'setter'), so the reply queue and every other held action live in one table.
-- LOCAL / PGlite ONLY until the owner approves applying it anywhere else. Never `supabase db push` this.
--
-- Backward compatible on purpose (the TypeScript callers are unchanged):
--   * public.fo_outbox is now a VIEW with the same columns (id, workspace_id, contact_id, channel_id, body, prompt_version,
--     status, created_at, decided_at, decided_by, note) over fo_pending_actions where kind = 'outbox_reply'. Status words are
--     translated: pending = queued, performed = sent, expired = cancelled; the rest are the same word.
--   * fo_queue_outbound / fo_decide_outbox / fo_outbox_sent keep their names, arguments, grants and return shapes.
--   * The view takes the caller's rights (security_invoker), so the RLS policy of fo_pending_actions (workspace members only)
--     is what protects it. authenticated may only select; anon has nothing. INSTEAD OF triggers (security definer, not
--     callable) let server-side SQL that still writes to fo_outbox (fo_ingest's opt-out, lab restore of old scenarios) work.
--
-- Differences worth knowing:
--   * An outbox reply now expires 30 days after it was queued (the queue's expiry rule). Expired replies read as 'cancelled'.
--   * contact_id is ON DELETE SET NULL (it was CASCADE): the record of what was held and decided is kept. Such a reply can no
--     longer be approved ('Contact not found.').
--   * The generic fo_decide_action / fo_finish_action refuse to APPROVE or FINISH an outbox reply: only fo_decide_outbox +
--     fo_outbox_sent send it, exactly once. Rejecting through the generic call is allowed (it never sends).

-- 1. The queue accepts the new kind, and an outbox reply must carry what the sender needs.
alter table public.fo_pending_actions drop constraint fo_pending_actions_kind_check;
alter table public.fo_pending_actions add constraint fo_pending_actions_kind_check
  check (kind in ('book','reschedule','cancel','send','follow_up','transfer','outbox_reply'));
alter table public.fo_pending_actions add constraint fo_pending_actions_outbox_reply_shape
  check (kind <> 'outbox_reply' or (product = 'setter'
    and length(payload->>'body') between 1 and 1000 and length(payload->>'prompt_version') between 1 and 120));
create index fo_pending_actions_outbox_queued on public.fo_pending_actions(workspace_id, created_at) where kind = 'outbox_reply' and status = 'pending';

-- 2. Status words: outbox <-> queue.
create function public.fo_outbox_to_action_status(s text) returns text language sql immutable set search_path='' as $$
select case s when 'queued' then 'pending' when 'sent' then 'performed' when 'approved' then 'approved' when 'rejected' then 'rejected'
  when 'failed' then 'failed' when 'cancelled' then 'cancelled' else null end $$;
revoke all on function public.fo_outbox_to_action_status(text) from public, anon, authenticated;

-- 3. Move the existing rows, keeping ids so nothing that points at an outbox id breaks. Replies still queued get a fresh
--    30 days so the move itself never expires one.
insert into public.fo_pending_actions(id, workspace_id, product, kind, contact_id, channel_id, payload, summary, status, idempotency_key,
  created_at, expires_at, decided_at, decided_by, committed_at, note)
select o.id, o.workspace_id, 'setter', 'outbox_reply', o.contact_id, o.channel_id,
  jsonb_build_object('kind', 'outbox_reply', 'body', o.body, 'prompt_version', o.prompt_version),
  left('Reply: ' || trim(o.body), 300), public.fo_outbox_to_action_status(o.status), 'outbox:' || o.id::text,
  o.created_at,
  case when o.status = 'queued' then now() + interval '30 days' else o.created_at + interval '30 days' end,
  case when o.status = 'queued' then null else coalesce(o.decided_at, o.created_at) end,
  o.decided_by,
  case when o.status = 'sent' then coalesce(o.decided_at, o.created_at) end,
  o.note
from public.fo_outbox o;

drop table public.fo_outbox;

-- 4. The compatible view.
create view public.fo_outbox with (security_invoker = true) as
select a.id, a.workspace_id, a.contact_id, a.channel_id, a.payload->>'body' as body, a.payload->>'prompt_version' as prompt_version,
  case when a.status = 'pending' and a.expires_at <= now() then 'cancelled'
    else case a.status when 'pending' then 'queued' when 'performed' then 'sent' when 'expired' then 'cancelled' else a.status end end as status,
  a.created_at, a.decided_at, a.decided_by, a.note
from public.fo_pending_actions a where a.kind = 'outbox_reply';
alter view public.fo_outbox alter column id set default gen_random_uuid();
alter view public.fo_outbox alter column status set default 'queued';
alter view public.fo_outbox alter column created_at set default now();
revoke all on public.fo_outbox from anon, authenticated;
grant select on public.fo_outbox to authenticated;

create function public.fo_outbox_view_insert() returns trigger language plpgsql security definer set search_path='' as $$
declare st text; pid uuid; c timestamptz;
begin
  st := public.fo_outbox_to_action_status(coalesce(new.status, 'queued'));
  if st is null then raise exception 'Unknown reply status.'; end if;
  pid := coalesce(new.id, gen_random_uuid()); c := coalesce(new.created_at, now());
  insert into public.fo_pending_actions(id, workspace_id, product, kind, contact_id, channel_id, payload, summary, status, idempotency_key,
    created_at, expires_at, decided_at, decided_by, committed_at, note)
  values (pid, new.workspace_id, 'setter', 'outbox_reply', new.contact_id, new.channel_id,
    jsonb_build_object('kind', 'outbox_reply', 'body', new.body, 'prompt_version', new.prompt_version),
    left('Reply: ' || trim(coalesce(new.body, '')), 300), st, 'outbox:' || pid::text, c,
    case when st = 'pending' then now() + interval '30 days' else c + interval '30 days' end,
    case when st = 'pending' then null else coalesce(new.decided_at, c) end, new.decided_by,
    case when st = 'performed' then coalesce(new.decided_at, c) end, new.note);
  return new;
end $$;
create trigger fo_outbox_view_insert instead of insert on public.fo_outbox for each row execute function public.fo_outbox_view_insert();

-- Status, decision fields, note and body can change (fo_ingest's opt-out cancels queued replies this way).
create function public.fo_outbox_view_update() returns trigger language plpgsql security definer set search_path='' as $$
declare st text;
begin
  st := public.fo_outbox_to_action_status(new.status);
  if st is null then raise exception 'Unknown reply status.'; end if;
  update public.fo_pending_actions set status = st,
    decided_at = case when st = 'pending' then null else coalesce(new.decided_at, decided_at, now()) end,
    decided_by = new.decided_by, note = new.note,
    committed_at = case when st = 'performed' then coalesce(committed_at, now()) end,
    payload = jsonb_set(payload, '{body}', to_jsonb(new.body))
   where id = old.id and kind = 'outbox_reply';
  return new;
end $$;
create trigger fo_outbox_view_update instead of update on public.fo_outbox for each row execute function public.fo_outbox_view_update();
revoke all on function public.fo_outbox_view_insert(), public.fo_outbox_view_update() from public, anon, authenticated;

-- 5. The three outbox functions, over the queue. Same names, arguments, grants (create or replace keeps them) and returns.
create or replace function public.fo_queue_outbound(channel uuid, channel_key text, contact uuid, message text, prompt text) returns uuid language plpgsql security definer set search_path='' as $$
declare w uuid; pid uuid := gen_random_uuid();
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if not exists (select 1 from public.fo_contacts where fo_contacts.id = contact and workspace_id = w and opted_out_at is null) then raise exception 'Contact not found or opted out.'; end if;
  if message is null or length(message) not between 1 and 1000 then raise exception 'Reply must be 1 to 1000 characters.'; end if;
  if prompt is null or length(prompt) not between 1 and 120 then raise exception 'Prompt version required.'; end if;
  insert into public.fo_pending_actions(id, workspace_id, product, kind, contact_id, channel_id, payload, summary, idempotency_key, expires_at)
  values (pid, w, 'setter', 'outbox_reply', contact, channel,
    jsonb_build_object('kind', 'outbox_reply', 'body', message, 'prompt_version', prompt),
    left('Reply: ' || trim(message), 300), 'outbox:' || pid::text, now() + interval '30 days');
  return pid;
end $$;

-- A member approves or rejects. Exactly one caller moves a queued reply out of 'pending' (row lock); any later call finds
-- nothing to decide and raises, so the app sends at most once. Returns what the sender needs.
create or replace function public.fo_decide_outbox(w uuid, item uuid, decision text, edited text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.fo_pending_actions; c public.fo_contacts; ch public.fo_channels; txt text;
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  if decision not in ('approved','rejected') then raise exception 'Unknown decision.'; end if;
  select * into a from public.fo_pending_actions where id = item and workspace_id = w and kind = 'outbox_reply' and status = 'pending' for update;
  if not found then raise exception 'Nothing to decide.'; end if;
  if a.expires_at <= now() then
    update public.fo_pending_actions set status = 'expired', decided_at = now(), note = 'Expired before a decision.' where id = a.id;
    return jsonb_build_object('id', a.id, 'status', 'cancelled');
  end if;
  select * into c from public.fo_contacts where id = a.contact_id;
  if not found then raise exception 'Contact not found.'; end if;
  if decision = 'approved' and c.opted_out_at is not null then raise exception 'Contact opted out.'; end if;
  -- The channel may have been deleted since (channel_id is set null): such a reply cannot be sent, so it is not approved.
  select * into ch from public.fo_channels where id = a.channel_id;
  if not found then raise exception 'Channel not found.'; end if;
  txt := case when decision = 'approved' and nullif(trim(edited), '') is not null then left(trim(edited), 1000) else a.payload->>'body' end;
  update public.fo_pending_actions set status = decision, decided_at = now(), decided_by = auth.uid(),
    payload = jsonb_set(payload, '{body}', to_jsonb(txt)), summary = left('Reply: ' || trim(txt), 300)
   where id = a.id returning * into a;
  return jsonb_build_object('id', a.id, 'status', a.status, 'body', a.payload->>'body', 'kind', ch.kind,
    'recipient', case ch.kind when 'instagram' then c.instagram_id when 'messenger' then c.messenger_id end,
    'lastInbound', (select max(m.created_at) from public.fo_messages m where m.contact_id = c.id and m.channel_id = ch.id and m.direction = 'inbound'));
end $$;

create or replace function public.fo_outbox_sent(w uuid, item uuid, ok boolean, info text) returns void language plpgsql security definer set search_path='' as $$
declare a public.fo_pending_actions;
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  update public.fo_pending_actions set status = case when ok then 'performed' else 'failed' end,
    committed_at = case when ok then now() end, note = nullif(left(info, 500), '')
   where id = item and workspace_id = w and kind = 'outbox_reply' and status = 'approved' returning * into a;
  if not found then raise exception 'Not approved.'; end if;
  -- Booking confirmations were already logged by fo_book's caller; everything else is logged now, as sent.
  if ok and a.payload->>'prompt_version' <> 'setter/booking-confirmation@1' then
    insert into public.fo_messages(workspace_id, contact_id, channel_id, direction, body, agent, prompt_version)
    values (w, a.contact_id, a.channel_id, 'outbound', a.payload->>'body', 'setter', (a.payload->>'prompt_version') || '+approved');
  end if;
end $$;

-- 6. The generic owner calls must not approve or finish a reply without sending it (that would strand it as 'approved').
create or replace function public.fo_decide_action(action uuid, decision text, decision_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.fo_pending_actions;
begin
  if decision is null or decision not in ('approve','reject') then raise exception 'Decision must be approve or reject.'; end if;
  select * into a from public.fo_pending_actions where id = action for update;
  if not found or public.workspace_role(a.workspace_id) is null then raise exception 'Action not found.'; end if;
  if public.workspace_role(a.workspace_id) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if a.kind = 'outbox_reply' and decision = 'approve' then raise exception 'Approve this reply from the reply queue.'; end if;
  if a.status = 'pending' and a.expires_at <= now() then
    update public.fo_pending_actions set status = 'expired', decided_at = now(), note = 'Expired before a decision.' where id = a.id returning * into a;
    return jsonb_build_object('item', to_jsonb(a), 'changed', false);
  end if;
  if a.status <> 'pending' then return jsonb_build_object('item', to_jsonb(a), 'changed', false); end if;
  update public.fo_pending_actions set status = case decision when 'approve' then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), note = nullif(left(trim(coalesce(decision_note,'')), 500), '')
   where id = a.id returning * into a;
  return jsonb_build_object('item', to_jsonb(a), 'changed', true);
end $$;

create or replace function public.fo_finish_action(action uuid, succeeded boolean, result_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.fo_pending_actions;
begin
  select * into a from public.fo_pending_actions where id = action for update;
  if not found or public.workspace_role(a.workspace_id) is null then raise exception 'Action not found.'; end if;
  if public.workspace_role(a.workspace_id) is distinct from 'owner' then raise exception 'Owner access required.'; end if;
  if a.kind = 'outbox_reply' then raise exception 'A reply is finished by sending it from the reply queue.'; end if;
  if a.status in ('performed','failed') then return jsonb_build_object('item', to_jsonb(a), 'changed', false); end if;
  if a.status <> 'approved' then raise exception 'Action is not approved.'; end if;
  update public.fo_pending_actions set status = case when succeeded then 'performed' else 'failed' end,
    committed_at = case when succeeded then now() end, note = nullif(left(trim(coalesce(result_note,'')), 500), '')
   where id = a.id returning * into a;
  return jsonb_build_object('item', to_jsonb(a), 'changed', true);
end $$;

-- The owner's generic action list (fo_list_actions, from 202611100001) no longer shows replies: the TypeScript action
-- contract does not know that kind. Replies are listed and approved in the reply queue (fo_outbox, fo_decide_outbox).
create or replace function public.fo_list_actions(w uuid, status_filter text, max_items integer) returns setof public.fo_pending_actions language plpgsql stable security definer set search_path='' as $$
begin
  if public.workspace_role(w) is null then raise exception 'Workspace access required.'; end if;
  return query select * from public.fo_pending_actions a where a.workspace_id = w and a.kind <> 'outbox_reply' and (status_filter is null or a.status = status_filter)
    order by a.created_at desc, a.id limit least(greatest(coalesce(max_items, 100), 1), 500);
end $$;

-- 7. Lab sandbox: clear counts replies and other held actions separately, as before; the snapshot keeps replies under
--    'outbox' (view shape, so old saved scenarios restore the same way) and the other held actions under 'pendingActions'
--    (never both, or restore would insert a reply twice). Snapshot format v stays 1: no table changed shape.
create or replace function public.fo_lab_clear(w uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare n jsonb := '{}'; c integer;
begin
  if not public.fo_is_lab(w) then raise exception 'Lab sandbox not found.'; end if;
  delete from public.fo_pending_actions where workspace_id = w and kind = 'outbox_reply'; get diagnostics c = row_count; n := n || jsonb_build_object('outbox', c);
  delete from public.fo_pending_actions where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('pendingActions', c);
  delete from public.fo_jobs where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('jobs', c);
  delete from public.fo_calls where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('calls', c);
  delete from public.fo_handoffs where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('handoffs', c);
  delete from public.fo_appointments where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('appointments', c);
  delete from public.fo_messages where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('messages', c);
  delete from public.fo_events where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('events', c);
  delete from public.fo_contacts where workspace_id = w; get diagnostics c = row_count; n := n || jsonb_build_object('contacts', c);
  return n;
end $$;

create or replace function public.fo_lab_snapshot(w uuid) returns jsonb language sql stable security definer set search_path='' as $$
select jsonb_build_object('v', 1,
  'contacts', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_contacts t where t.workspace_id = w), '[]'),
  'calls', coalesce((select jsonb_agg(to_jsonb(t) order by t.started_at, t.id) from public.fo_calls t where t.workspace_id = w), '[]'),
  'messages', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_messages t where t.workspace_id = w), '[]'),
  'events', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from public.fo_events t where t.workspace_id = w), '[]'),
  'handoffs', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_handoffs t where t.workspace_id = w), '[]'),
  'appointments', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_appointments t where t.workspace_id = w), '[]'),
  'jobs', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_jobs t where t.workspace_id = w), '[]'),
  'outbox', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_outbox t where t.workspace_id = w), '[]'),
  'pendingActions', coalesce((select jsonb_agg(to_jsonb(t) order by t.created_at, t.id) from public.fo_pending_actions t where t.workspace_id = w and t.kind <> 'outbox_reply'), '[]')) $$;

revoke all on function public.fo_lab_clear(uuid), public.fo_lab_snapshot(uuid) from public, anon, authenticated;
