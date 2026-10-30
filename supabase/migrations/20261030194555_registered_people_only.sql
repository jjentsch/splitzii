create function splitzii_private.require_registered_participants() returns trigger
language plpgsql set search_path = '' as $$
declare v_person jsonb;
begin
  for v_person in select value from jsonb_array_elements(new.data->'participants') loop
    if nullif(v_person->>'user_id','') is null then
      -- Keep historical unlinked people usable without allowing new ones.
      if tg_op='UPDATE' and exists (
        select 1 from jsonb_array_elements(old.data->'participants') p where p=v_person
      ) then continue; end if;
      raise exception 'This person must sign in to Splitzii before you can add them' using errcode='22023';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function splitzii_private.require_registered_participants() from public,anon,authenticated;
create trigger require_registered_participants before insert or update of data on public.ledger_groups
for each row execute function splitzii_private.require_registered_participants();

create function splitzii_private.require_registered_friend() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id is null then
    raise exception 'This person must sign in to Splitzii before you can add them' using errcode='22023';
  end if;
  if new.user_id=new.owner_id then
    raise exception 'Choose another Splitzii user as a friend' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function splitzii_private.require_registered_friend() from public,anon,authenticated;
create trigger require_registered_friend before insert on splitzii_private.friends
for each row execute function splitzii_private.require_registered_friend();
