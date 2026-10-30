create table public.course_drafts (
 workspace_id uuid not null references public.workspaces(id),
 id uuid not null, data jsonb not null check (jsonb_typeof(data)='object' and length(data::text)<=256000),
 revision integer not null default 1, primary key(workspace_id,id)
);
alter table public.course_drafts enable row level security;
revoke all on public.course_drafts from anon, authenticated;
grant select on public.course_drafts to authenticated;
create policy course_read on public.course_drafts for select to authenticated using(public.workspace_role(workspace_id) is not null);
create function public.save_course(w uuid, course_id uuid, payload jsonb, expected_revision integer) returns integer language plpgsql security definer set search_path='' as $$
declare next_revision integer;
begin
 if public.workspace_role(w) is distinct from 'owner' then raise exception 'Owner access required'; end if;
 if expected_revision < 0 or expected_revision is null then raise exception 'Refresh before saving'; end if;
 if jsonb_typeof(payload) is distinct from 'object' or jsonb_typeof(payload->'title') is distinct from 'string' or length(trim(payload->>'title')) not between 1 and 160 or jsonb_typeof(payload->'summary') is distinct from 'string' or length(payload->>'summary') > 2000 or jsonb_typeof(payload->'lessons') is distinct from 'array' then raise exception 'Invalid course'; end if;
 if jsonb_array_length(payload->'lessons') not between 1 and 50 then raise exception 'Invalid lessons'; end if;
 if expected_revision=0 then
  insert into public.course_drafts(workspace_id,id,data) values(w,course_id,payload) returning revision into next_revision;
 else
  update public.course_drafts set data=payload,revision=revision+1 where workspace_id=w and id=course_id and revision=expected_revision returning revision into next_revision;
  if not found then raise exception 'Revision conflict'; end if;
 end if;
 return next_revision;
end $$;
revoke all on function public.save_course(uuid,uuid,jsonb,integer) from public,anon;
grant execute on function public.save_course(uuid,uuid,jsonb,integer) to authenticated;
