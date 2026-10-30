-- One atomic, versioned document per small personal ledger. No service-role key.
create schema if not exists splitzii_private;
revoke all on schema splitzii_private from public;
grant usage on schema splitzii_private to anon, authenticated;

create table public.ledger_groups (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and data->>'id' = id::text),
  version integer not null default 1 check (version > 0),
  updated_at timestamptz not null default now()
);
create index ledger_groups_owner_idx on public.ledger_groups(owner_id);
alter table public.ledger_groups enable row level security;
create policy "Owners read their ledgers" on public.ledger_groups for select to authenticated using ((select auth.uid()) = owner_id);
-- Writes go through the version-checked function, rather than bypassing it via REST.
revoke all on public.ledger_groups from anon, authenticated;
grant select on public.ledger_groups to authenticated;

create table splitzii_private.agent_tokens (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  token_hash text not null unique,
  created_at timestamptz not null default now()
);
create index agent_tokens_owner_idx on splitzii_private.agent_tokens(owner_id);
alter table splitzii_private.agent_tokens enable row level security;
revoke all on splitzii_private.agent_tokens from public, anon, authenticated;

-- These definer functions are in a non-exposed schema. Every entry point
-- authenticates and scopes ownership explicitly. Public wrappers are invokers.
create function splitzii_private.owner(p_token text) returns uuid
language plpgsql stable set search_path = '' as $$
declare v_owner uuid;
begin
  if p_token is not null then
    select owner_id into v_owner from splitzii_private.agent_tokens
      where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  else
    v_owner := auth.uid();
  end if;
  if v_owner is null then raise exception 'Authentication required' using errcode = '28000'; end if;
  return v_owner;
end;
$$;
revoke all on function splitzii_private.owner(text) from public, anon, authenticated;

create function splitzii_private.read_groups(p_group_id uuid, p_token text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_owner uuid;
begin
  v_owner := splitzii_private.owner(p_token);
  return coalesce((select jsonb_agg(jsonb_build_object('data', g.data, 'version', g.version) order by g.updated_at desc)
    from public.ledger_groups g where g.owner_id = v_owner and (p_group_id is null or g.id = p_group_id)), '[]'::jsonb);
end;
$$;

create function splitzii_private.write_group(p_group_id uuid, p_data jsonb, p_expected_version integer, p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_group public.ledger_groups;
begin
  v_owner := splitzii_private.owner(p_token);
  if p_data->>'id' is distinct from p_group_id::text
    or jsonb_typeof(p_data->'participants') is distinct from 'array'
    or jsonb_typeof(p_data->'expenses') is distinct from 'array'
    or jsonb_typeof(p_data->'repayments') is distinct from 'array'
    then raise exception 'Invalid ledger document' using errcode = '22023'; end if;
  if p_expected_version is null then
    insert into public.ledger_groups(id, owner_id, data) values (p_group_id, v_owner, p_data)
      on conflict (id) do nothing returning * into v_group;
    if not found then
      select * into v_group from public.ledger_groups where id = p_group_id and owner_id = v_owner;
      if not found then raise exception 'Group not found' using errcode = 'P0002'; end if;
    end if;
  else
    update public.ledger_groups set data = p_data, version = version + 1, updated_at = now()
      where id = p_group_id and owner_id = v_owner and version = p_expected_version returning * into v_group;
    if not found then raise exception 'Version conflict' using errcode = '40001'; end if;
  end if;
  return jsonb_build_object('data', v_group.data, 'version', v_group.version);
end;
$$;

create function splitzii_private.manage_tokens(p_action text, p_name text, p_hash text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_id uuid;
begin
  v_owner := auth.uid();
  if v_owner is null then raise exception 'Sign in required' using errcode = '28000'; end if;
  if p_action = 'create' then
    if length(p_name) not between 1 and 120 or p_name is null or p_hash is null or p_hash !~ '^[0-9a-f]{64}$'
      then raise exception 'Invalid token' using errcode = '22023'; end if;
    insert into splitzii_private.agent_tokens(owner_id, name, token_hash) values (v_owner, p_name, p_hash) returning id into v_id;
    return jsonb_build_object('id', v_id, 'name', p_name);
  elsif p_action = 'delete' then
    delete from splitzii_private.agent_tokens where id = p_id and owner_id = v_owner;
    return jsonb_build_object('deleted', true);
  elsif p_action = 'list' then
    return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'created_at', created_at) order by created_at desc)
      from splitzii_private.agent_tokens where owner_id = v_owner), '[]'::jsonb);
  end if;
  raise exception 'Unknown token action' using errcode = '22023';
end;
$$;

revoke all on function splitzii_private.read_groups(uuid, text) from public;
revoke all on function splitzii_private.write_group(uuid, jsonb, integer, text) from public;
revoke all on function splitzii_private.manage_tokens(text, text, text, uuid) from public, anon;
grant execute on function splitzii_private.read_groups(uuid, text), splitzii_private.write_group(uuid, jsonb, integer, text) to anon, authenticated;
grant execute on function splitzii_private.manage_tokens(text, text, text, uuid) to authenticated;

create function public.splitzii_read(p_group_id uuid default null, p_token text default null) returns jsonb
language sql stable security invoker set search_path = '' as $$ select splitzii_private.read_groups(p_group_id, p_token); $$;
create function public.splitzii_write(p_group_id uuid, p_data jsonb, p_expected_version integer default null, p_token text default null) returns jsonb
language sql security invoker set search_path = '' as $$ select splitzii_private.write_group(p_group_id, p_data, p_expected_version, p_token); $$;
create function public.splitzii_tokens(p_action text, p_name text default null, p_hash text default null, p_id uuid default null) returns jsonb
language sql security invoker set search_path = '' as $$ select splitzii_private.manage_tokens(p_action, p_name, p_hash, p_id); $$;
revoke all on function public.splitzii_read(uuid, text), public.splitzii_write(uuid, jsonb, integer, text), public.splitzii_tokens(text, text, text, uuid) from public;
grant execute on function public.splitzii_read(uuid, text), public.splitzii_write(uuid, jsonb, integer, text) to anon, authenticated;
grant execute on function public.splitzii_tokens(text, text, text, uuid) to authenticated;
