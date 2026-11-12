-- G11 (task A-68): fo_save_details only stores answers whose key is one of the business's question ids, with sizes capped.
-- Defence in depth: the Setter and Receptionist already filter ids in code; the database no longer trusts the caller.
-- Same signature, security definer, search_path and grants as 202611060004 (create or replace keeps the grants).
--
-- Rules for new_answers:
--  * more than 50 keys is refused outright (a caller sending that is not the Setter);
--  * a key is kept only if it is a question id in this workspace's saved agent settings (fo_agent_settings.data.questions);
--  * saved settings with no questions: nothing is stored;
--  * no saved settings row yet: the app runs Ventra's own built-in questions, which the database cannot see, so keys are
--    held to the question-id format (^[a-z][a-z0-9_]{1,39}$, as settings.ts requires) instead. Save settings to get the exact check;
--  * string values keep the first 500 characters, numbers and booleans are stored as text, null, arrays and objects are dropped
--    (null answers are now ignored, a behaviour change from 202611060004); only these storable scalars count toward the limit below;
--  * at most 20 answers are merged per call;
--  * a contact holds at most 50 distinct answer keys in total: if the merge would exceed that, the call is refused with an
--    exception and nothing is saved (the update rolls back).
create or replace function public.fo_save_details(channel uuid, channel_key text, contact uuid, new_answers jsonb, contact_name text, contact_email text, contact_phone text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w uuid; merged jsonb; skipped text[] := '{}'; incoming jsonb := coalesce(new_answers, '{}'); settings jsonb; qids text[]; has_settings boolean; clean jsonb;
begin
  w := public.fo_channel_workspace(channel, channel_key);
  if jsonb_typeof(incoming) <> 'object' then raise exception 'Answers must be an object.'; end if;
  if (select count(*) from jsonb_object_keys(incoming)) > 50 then raise exception 'Too many answers.'; end if;
  select data, true into settings, has_settings from public.fo_agent_settings where workspace_id = w;
  if coalesce(has_settings, false) then
    select coalesce(array_agg(q->>'id'), '{}') into qids
      from jsonb_array_elements(case when jsonb_typeof(settings->'questions') = 'array' then settings->'questions' else '[]'::jsonb end) q
     where jsonb_typeof(q) = 'object' and jsonb_typeof(q->'id') = 'string';
  end if;
  select coalesce(jsonb_object_agg(t.k, to_jsonb(left(t.txt, 500))), '{}') into clean
    from (select e.key as k, e.value #>> '{}' as txt
            from jsonb_each(incoming) e
           where jsonb_typeof(e.value) in ('string', 'number', 'boolean')
             and e.key ~ '^[a-z][a-z0-9_]{1,39}$' and (not coalesce(has_settings, false) or e.key = any(qids))
           order by e.key limit 20) t;
  update public.fo_contacts set answers = answers || clean, name = coalesce(nullif(left(trim(contact_name), 160), ''), name), updated_at = now()
   where id = contact and workspace_id = w returning answers into merged;
  if merged is null then raise exception 'Contact not found.'; end if;
  if (select count(*) from jsonb_object_keys(merged)) > 50 then raise exception 'Too many saved answers for this contact.'; end if;
  if nullif(trim(contact_email), '') is not null then
    begin
      update public.fo_contacts set email = lower(trim(contact_email)) where id = contact and email is distinct from lower(trim(contact_email));
    exception when unique_violation or check_violation then skipped := array_append(skipped, 'email'); end;
  end if;
  if nullif(trim(contact_phone), '') is not null then
    begin
      update public.fo_contacts set phone = trim(contact_phone) where id = contact and phone is distinct from trim(contact_phone);
    exception when unique_violation or check_violation then skipped := array_append(skipped, 'phone'); end;
  end if;
  return jsonb_build_object('answers', merged, 'skipped', to_jsonb(skipped));
end $$;
