-- Small private directory/address book. Only scoped RPCs expose this data.
create table splitzii_private.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text unique check (email = lower(email))
);
create index profiles_name_idx on splitzii_private.profiles(lower(name));
create table splitzii_private.friends (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  email text check (email = lower(email)),
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(owner_id, email), unique(owner_id, user_id)
);
create index friends_user_idx on splitzii_private.friends(user_id);
create table splitzii_private.memberships (
  group_id uuid not null references public.ledger_groups(id) on delete cascade,
  participant_id uuid not null,
  user_id uuid references auth.users(id) on delete cascade,
  email text check (email = lower(email)),
  primary key(group_id, participant_id)
);
create unique index memberships_group_user_idx on splitzii_private.memberships(group_id, user_id) where user_id is not null;
create unique index memberships_group_email_idx on splitzii_private.memberships(group_id, email) where email is not null;
create index memberships_user_idx on splitzii_private.memberships(user_id, group_id);
create index memberships_pending_email_idx on splitzii_private.memberships(email) where user_id is null;
create table splitzii_private.activity (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.ledger_groups(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  changes jsonb not null,
  occurred_at timestamptz not null default clock_timestamp()
);
create index activity_actor_idx on splitzii_private.activity(actor_id);
create index activity_group_cursor_idx on splitzii_private.activity(group_id, id);
-- No direct table grants: functions authenticate and scope each operation.
alter table splitzii_private.profiles enable row level security;
alter table splitzii_private.friends enable row level security;
alter table splitzii_private.memberships enable row level security;
alter table splitzii_private.activity enable row level security;
revoke all on splitzii_private.profiles, splitzii_private.friends, splitzii_private.memberships, splitzii_private.activity from public, anon, authenticated;

insert into splitzii_private.profiles(user_id, name, email)
select id, left(coalesce(nullif(raw_user_meta_data->>'full_name',''), nullif(raw_user_meta_data->>'name',''), nullif(split_part(email,'@',1),''), 'Someone'),120),
  case when email_confirmed_at is not null then lower(email) end from auth.users;

create function splitzii_private.member(p_group_id uuid, p_actor uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from splitzii_private.memberships m where m.group_id = p_group_id and m.user_id = p_actor);
$$;
revoke all on function splitzii_private.member(uuid,uuid) from public;
grant execute on function splitzii_private.member(uuid,uuid) to anon, authenticated;
drop policy "Owners read their ledgers" on public.ledger_groups;
create policy "Members read their ledgers" on public.ledger_groups for select to authenticated
using ((select auth.uid()) = owner_id or splitzii_private.member(id, (select auth.uid())));

create function splitzii_private.append_activity(p_group_id uuid, p_actor uuid, p_changes jsonb) returns void
language plpgsql set search_path = '' as $$
begin
  if jsonb_array_length(p_changes) = 0 then return; end if;
  -- One short lock orders event allocation AND commit across all small ledgers.
  -- This avoids skipping a slower transaction when a client advances its cursor.
  perform pg_catalog.pg_advisory_xact_lock(20261030);
  insert into splitzii_private.activity(group_id, actor_id, actor_name, changes)
    values (p_group_id, p_actor, coalesce((select name from splitzii_private.profiles where user_id=p_actor), 'Someone'), p_changes);
end;
$$;
revoke all on function splitzii_private.append_activity(uuid,uuid,jsonb) from public, anon, authenticated;

create function splitzii_private.sync_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_email text; v_member record;
begin
  v_email := case when new.email_confirmed_at is not null then lower(new.email) end;
  insert into splitzii_private.profiles(user_id,name,email) values(new.id,
    left(coalesce(nullif(new.raw_user_meta_data->>'full_name',''),nullif(new.raw_user_meta_data->>'name',''),nullif(split_part(new.email,'@',1),''),'Someone'),120), v_email)
    on conflict(user_id) do update set name=excluded.name,email=excluded.email;
  if v_email is not null then
    for v_member in update splitzii_private.memberships set user_id=new.id
      where user_id is null and email=v_email and not exists (select 1 from splitzii_private.memberships bound where bound.group_id=memberships.group_id and bound.user_id=new.id) returning group_id,participant_id
    loop
      perform splitzii_private.append_activity(v_member.group_id,new.id,
        jsonb_build_array(jsonb_build_object('type','member_joined','entity_id',v_member.participant_id,'description','Joined with verified email')));
    end loop;
    update splitzii_private.friends set user_id=new.id where user_id is null and email=v_email and not exists (select 1 from splitzii_private.friends bound where bound.owner_id=friends.owner_id and bound.user_id=new.id);
  end if;
  return new;
end;
$$;
revoke all on function splitzii_private.sync_profile() from public,anon,authenticated;
create trigger splitzii_auth_profile after insert or update of email,email_confirmed_at,raw_user_meta_data on auth.users
for each row execute function splitzii_private.sync_profile();

create or replace function splitzii_private.read_groups(p_group_id uuid,p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  v_actor := splitzii_private.owner(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('data',
    g.data || jsonb_build_object('owner_user_id',g.owner_id,'participants',
      (select coalesce(jsonb_agg(p.value || case when m.user_id is not null then jsonb_build_object('user_id',m.user_id) else '{}'::jsonb end order by p.ordinality),'[]'::jsonb)
        from jsonb_array_elements(g.data->'participants') with ordinality p(value,ordinality)
        left join splitzii_private.memberships m on m.group_id=g.id and m.participant_id=(p.value->>'id')::uuid)),
    'version',g.version) order by g.updated_at desc)
    from public.ledger_groups g where (g.owner_id=v_actor or splitzii_private.member(g.id,v_actor))
      and (p_group_id is null or g.id=p_group_id)), '[]'::jsonb);
end;
$$;

create or replace function splitzii_private.write_group(p_group_id uuid,p_data jsonb,p_expected_version integer,p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_group public.ledger_groups; v_old jsonb; v_person jsonb; v_people jsonb := '[]';
  v_profile splitzii_private.profiles; v_bound uuid; v_changes jsonb := '[]'; v_entry jsonb; v_previous jsonb; v_type text;
begin
  v_actor := splitzii_private.owner(p_token);
  if p_data->>'id' is distinct from p_group_id::text
    or jsonb_typeof(p_data->'participants') is distinct from 'array'
    or jsonb_typeof(p_data->'expenses') is distinct from 'array'
    or jsonb_typeof(p_data->'repayments') is distinct from 'array'
    or jsonb_array_length(p_data->'participants') not between 1 and 50
    then raise exception 'Invalid ledger document' using errcode='22023'; end if;
  select * into v_group from public.ledger_groups where id=p_group_id for update;
  if found then
    if v_group.owner_id<>v_actor and not splitzii_private.member(p_group_id,v_actor) then
      raise exception 'Group not found' using errcode='P0002'; end if;
    if p_expected_version is null then return jsonb_build_object('data',v_group.data,'version',v_group.version); end if;
    if v_group.version<>p_expected_version then raise exception 'Version conflict' using errcode='40001'; end if;
    v_old := v_group.data;
    -- There is no participant removal/reassignment operation in this version.
    if exists(select 1 from jsonb_array_elements(v_old->'participants') o where not exists
      (select 1 from jsonb_array_elements(p_data->'participants') n where n->>'id'=o->>'id')) then
      raise exception 'Keep existing participants' using errcode='22023'; end if;
  else
    if p_expected_version is not null then raise exception 'Version conflict' using errcode='40001'; end if;
    v_old := null;
  end if;
  for v_person in select value from jsonb_array_elements(p_data->'participants') loop
    if nullif(v_person->>'name','') is null or length(v_person->>'name')>120 or (v_person->>'id')::uuid is null then
      raise exception 'Invalid participant' using errcode='22023'; end if;
    v_bound := null;
    select user_id into v_bound from splitzii_private.memberships where group_id=p_group_id and participant_id=(v_person->>'id')::uuid;
    if v_bound is not null and nullif(v_person->>'user_id','') is not null and v_bound<>(v_person->>'user_id')::uuid then
      raise exception 'This participant is already linked' using errcode='22023'; end if;
    v_profile := null;
    if v_bound is not null or nullif(v_person->>'user_id','') is not null then
      select * into v_profile from splitzii_private.profiles where user_id=coalesce(v_bound,(v_person->>'user_id')::uuid);
      if not found then raise exception 'User not found' using errcode='22023'; end if;
    elsif nullif(v_person->>'email','') is not null then
      select * into v_profile from splitzii_private.profiles where email=lower(trim(v_person->>'email'));
    end if;
    v_person := v_person - 'user_id' - 'email';
    if v_profile.user_id is not null then
      v_person := v_person || jsonb_build_object('user_id',v_profile.user_id);
      if v_profile.email is not null then v_person := v_person || jsonb_build_object('email',v_profile.email); end if;
    else
      -- Recover the submitted pending email after removing untrusted identity fields.
      select p.value->>'email' into v_type from jsonb_array_elements(p_data->'participants') p(value) where p.value->>'id'=v_person->>'id';
      if nullif(v_type,'') is not null then
        if length(v_type)>254 or v_type !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid email' using errcode='22023'; end if;
        v_person := v_person || jsonb_build_object('email',lower(trim(v_type)));
      end if;
    end if;
    v_people := v_people || jsonb_build_array(v_person);
  end loop;
  p_data := p_data || jsonb_build_object('participants',v_people,'owner_user_id',coalesce(v_group.owner_id,v_actor));
  if v_old is null then
    insert into public.ledger_groups(id,owner_id,data) values(p_group_id,v_actor,p_data) on conflict(id) do nothing returning * into v_group;
    if not found then raise exception 'Version conflict' using errcode='40001'; end if;
    v_changes := jsonb_build_array(jsonb_build_object('type','group_created','entity_id',p_group_id,'description',p_data->>'name'));
  else
    if p_data=v_old then return jsonb_build_object('data',v_old,'version',v_group.version); end if;
    update public.ledger_groups set data=p_data,version=version+1,updated_at=now() where id=p_group_id returning * into v_group;
    for v_person in select value from jsonb_array_elements(v_people) loop
      select value into v_previous from jsonb_array_elements(v_old->'participants') where value->>'id'=v_person->>'id';
      if v_previous is null or v_previous is distinct from v_person then
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('type',case when v_previous is null then 'participant_added' else 'participant_linked' end,'entity_id',v_person->>'id','description',v_person->>'name'));
      end if;
    end loop;
    for v_entry in select value from jsonb_array_elements(p_data->'expenses') loop
      select value into v_previous from jsonb_array_elements(v_old->'expenses') where value->>'id'=v_entry->>'id';
      if v_previous is null or v_previous is distinct from v_entry then
        v_type := case when v_previous is not null then 'expense_updated' when exists(select 1 from jsonb_array_elements(coalesce(v_old->'deleted_expenses','[]')) where value->>'id'=v_entry->>'id') then 'expense_restored' else 'expense_added' end;
        v_changes := v_changes || jsonb_build_array(jsonb_build_object('type',v_type,'entity_id',v_entry->>'id','description',v_entry->>'description'));
      end if;
    end loop;
    for v_entry in select o.value from jsonb_array_elements(v_old->'expenses') o(value) where not exists(select 1 from jsonb_array_elements(p_data->'expenses') n where n->>'id'=o.value->>'id') loop
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('type','expense_deleted','entity_id',v_entry->>'id','description',v_entry->>'description'));
    end loop;
    for v_entry in select n.value from jsonb_array_elements(p_data->'repayments') n(value) where not exists(select 1 from jsonb_array_elements(v_old->'repayments') o where o->>'id'=n.value->>'id') loop
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('type','repayment_recorded','entity_id',v_entry->>'id','description',v_entry->>'note'));
    end loop;
    for v_entry in select o.value from jsonb_array_elements(v_old->'repayments') o(value) where not exists(select 1 from jsonb_array_elements(p_data->'repayments') n where n->>'id'=o.value->>'id') loop
      v_changes := v_changes || jsonb_build_array(jsonb_build_object('type','repayment_deleted','entity_id',v_entry->>'id','description',v_entry->>'note'));
    end loop;
  end if;
  insert into splitzii_private.memberships(group_id,participant_id,user_id,email)
    select p_group_id,(p->>'id')::uuid,(p->>'user_id')::uuid,p->>'email' from jsonb_array_elements(v_people) p
    on conflict(group_id,participant_id) do update set user_id=excluded.user_id,email=excluded.email;
  perform splitzii_private.append_activity(p_group_id,v_actor,v_changes);
  return jsonb_build_object('data',v_group.data,'version',v_group.version);
end;
$$;

create function splitzii_private.people(p_action text,p_args jsonb,p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid; v_profile splitzii_private.profiles; v_friend splitzii_private.friends; v_existing splitzii_private.friends; v_query text;
begin
  v_actor := splitzii_private.owner(p_token);
  if p_action='get_current_user' then
    select * into v_profile from splitzii_private.profiles where user_id=v_actor;
    return jsonb_build_object('user_id',v_actor,'name',coalesce(v_profile.name,'Me'),'email',v_profile.email);
  elsif p_action='search_users' then
    v_query := lower(trim(coalesce(p_args->>'query','')));
    if nullif(p_args->>'user_id','') is null and length(v_query)<2 then return '[]'; end if;
    return coalesce((select jsonb_agg(to_jsonb(p)) from
      (select user_id,name,email from splitzii_private.profiles where
        (nullif(p_args->>'user_id','') is not null and user_id=(p_args->>'user_id')::uuid)
        or (nullif(p_args->>'user_id','') is null and
          (email=v_query or (position('@' in v_query)=0 and (position(v_query in lower(name))>0 or left(lower(name),1)=left(v_query,1)))))
        order by case when email=v_query or lower(name)=v_query then 0 else 1 end,name,user_id limit 100) p),'[]');
  elsif p_action='list_friends' then
    return coalesce((select jsonb_agg(to_jsonb(f)-'owner_id' order by f.name,f.id) from splitzii_private.friends f where owner_id=v_actor),'[]');
  elsif p_action='remove_friend' then
    delete from splitzii_private.friends where id=(p_args->>'friend_id')::uuid and owner_id=v_actor;
    return jsonb_build_object('removed',true);
  elsif p_action='add_friend' then
    if nullif(p_args->>'user_id','') is not null then
      select * into v_profile from splitzii_private.profiles where user_id=(p_args->>'user_id')::uuid;
      if not found then raise exception 'User not found' using errcode='22023'; end if;
    elsif nullif(p_args->>'email','') is not null then
      select * into v_profile from splitzii_private.profiles where email=lower(p_args->>'email');
    end if;
    v_friend.id := (p_args->>'request_id')::uuid; v_friend.owner_id := v_actor;
    v_friend.name := left(coalesce(nullif(p_args->>'name',''),v_profile.name,p_args->>'email'),120);
    v_friend.email := coalesce(v_profile.email,lower(p_args->>'email')); v_friend.user_id := v_profile.user_id;
    if nullif(v_friend.name,'') is null or (v_friend.email is not null and (length(v_friend.email)>254 or v_friend.email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')) then raise exception 'Invalid friend' using errcode='22023'; end if;
    select * into v_existing from splitzii_private.friends where id=v_friend.id;
    if found then
      if v_existing.owner_id<>v_actor or (v_existing.name,v_existing.email,v_existing.user_id) is distinct from (v_friend.name,v_friend.email,v_friend.user_id) then raise exception 'Request already used' using errcode='22023'; end if;
      return to_jsonb(v_existing)-'owner_id';
    end if;
    select * into v_existing from splitzii_private.friends where owner_id=v_actor and
      ((v_friend.user_id is not null and user_id=v_friend.user_id) or (v_friend.email is not null and email=v_friend.email));
    if found then return to_jsonb(v_existing)-'owner_id'; end if;
    insert into splitzii_private.friends(id,owner_id,name,email,user_id) values(v_friend.id,v_actor,v_friend.name,v_friend.email,v_friend.user_id) returning * into v_friend;
    return to_jsonb(v_friend)-'owner_id';
  end if;
  raise exception 'Unknown people action' using errcode='22023';
end;
$$;
revoke all on function splitzii_private.people(text,jsonb,text) from public;
grant execute on function splitzii_private.people(text,jsonb,text) to anon,authenticated;
create function public.splitzii_people(p_action text,p_args jsonb default '{}',p_token text default null) returns jsonb
language sql security invoker set search_path = '' as $$ select splitzii_private.people(p_action,p_args,p_token); $$;
revoke all on function public.splitzii_people(text,jsonb,text) from public;
grant execute on function public.splitzii_people(text,jsonb,text) to anon,authenticated;

create function splitzii_private.read_activity(p_cursor bigint,p_group_id uuid,p_limit integer,p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid; v_events jsonb; v_cursor text;
begin
  v_actor := splitzii_private.owner(p_token);
  p_limit := greatest(1,least(coalesce(p_limit,50),100));
  select coalesce(jsonb_agg(to_jsonb(e) order by e.cursor::bigint),'[]') into v_events from
    (select a.id::text as cursor,a.group_id,g.data->>'name' as group_name,
      a.actor_id,a.actor_name,(a.actor_id=v_actor) as is_me,a.changes,a.occurred_at
     from splitzii_private.activity a join public.ledger_groups g on g.id=a.group_id
     where a.id>coalesce(p_cursor,0) and (p_group_id is null or a.group_id=p_group_id)
       and (g.owner_id=v_actor or splitzii_private.member(g.id,v_actor))
     order by a.id limit p_limit+1) e;
  v_cursor := coalesce(v_events->(least(jsonb_array_length(v_events),p_limit)-1)->>'cursor',coalesce(p_cursor,0)::text);
  return jsonb_build_object('events',case when jsonb_array_length(v_events)>p_limit then v_events-p_limit else v_events end,
    'next_cursor',v_cursor,'has_more',jsonb_array_length(v_events)>p_limit);
end;
$$;
revoke all on function splitzii_private.read_activity(bigint,uuid,integer,text) from public;
grant execute on function splitzii_private.read_activity(bigint,uuid,integer,text) to anon,authenticated;
create function public.splitzii_activity(p_cursor bigint default 0,p_group_id uuid default null,p_limit integer default 50,p_token text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$ select splitzii_private.read_activity(p_cursor,p_group_id,p_limit,p_token); $$;
revoke all on function public.splitzii_activity(bigint,uuid,integer,text) from public;
grant execute on function public.splitzii_activity(bigint,uuid,integer,text) to anon,authenticated;
