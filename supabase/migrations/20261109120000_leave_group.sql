-- Leaving keeps the person's participant row (and so their balance) but drops
-- their account link and access. The last person to leave deletes the group.
create or replace function splitzii_private.require_registered_participants() returns trigger
language plpgsql set search_path = '' as $$
declare v_person jsonb;
begin
  for v_person in select value from jsonb_array_elements(new.data->'participants') loop
    if nullif(v_person->>'user_id','') is null then
      -- Keep historical unlinked people usable without allowing new ones.
      if tg_op='UPDATE' and exists (
        select 1 from jsonb_array_elements(old.data->'participants') p
        where p=v_person or (v_person ? 'left_at' and p->>'id'=v_person->>'id')
      ) then continue; end if;
      raise exception 'This person must sign in to Splitzii before you can add them' using errcode='22023';
    end if;
  end loop;
  return new;
end;
$$;

create function splitzii_private.leave_group(p_group_id uuid, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_group public.ledger_groups; v_participant uuid; v_owner uuid; v_name text;
begin
  v_actor := splitzii_private.owner(p_token);
  select * into v_group from public.ledger_groups where id=p_group_id for update;
  if not found or (v_group.owner_id<>v_actor and not splitzii_private.member(p_group_id,v_actor)) then
    raise exception 'Group not found' using errcode='P0002'; end if;
  select participant_id into v_participant from splitzii_private.memberships where group_id=p_group_id and user_id=v_actor;
  update splitzii_private.memberships set user_id=null,email=null where group_id=p_group_id and user_id=v_actor;
  -- The owner keeps access; otherwise ownership passes to the first remaining linked person.
  if v_group.owner_id<>v_actor then v_owner := v_group.owner_id; else
  select m.user_id into v_owner from jsonb_array_elements(v_group.data->'participants') with ordinality p(value,ordinality)
    join splitzii_private.memberships m on m.group_id=p_group_id and m.participant_id=(p.value->>'id')::uuid
    where m.user_id is not null order by p.ordinality limit 1;
  end if;
  if v_owner is null then
    delete from public.ledger_groups where id=p_group_id;
    return jsonb_build_object('group_id',p_group_id,'left',true,'group_deleted',true);
  end if;
  update public.ledger_groups set owner_id=v_owner,version=version+1,updated_at=now(),
    data=data || jsonb_build_object('owner_user_id',v_owner,'participants',
      (select jsonb_agg(case when p.value->>'id'=v_participant::text
        then (p.value - 'user_id' - 'email') || jsonb_build_object('left_at',now()) else p.value end order by p.ordinality)
       from jsonb_array_elements(data->'participants') with ordinality p(value,ordinality)))
    where id=p_group_id;
  if v_participant is not null then
    select p->>'name' into v_name from jsonb_array_elements(v_group.data->'participants') p where p->>'id'=v_participant::text;
    perform splitzii_private.append_activity(p_group_id,v_actor,
      jsonb_build_array(jsonb_build_object('type','member_left','entity_id',v_participant,'description',coalesce(v_name,'Someone'))));
  end if;
  return jsonb_build_object('group_id',p_group_id,'left',true,'group_deleted',false);
end;
$$;
revoke all on function splitzii_private.leave_group(uuid,text) from public;
grant execute on function splitzii_private.leave_group(uuid,text) to anon,authenticated;
create function public.splitzii_leave(p_group_id uuid,p_token text default null) returns jsonb
language sql security invoker set search_path = '' as $$ select splitzii_private.leave_group(p_group_id,p_token); $$;
revoke all on function public.splitzii_leave(uuid,text) from public;
grant execute on function public.splitzii_leave(uuid,text) to anon,authenticated;
