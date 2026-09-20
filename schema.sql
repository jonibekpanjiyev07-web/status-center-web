-- ============================================================
-- STATUS CENTER — Supabase schema
-- Supabase loyihangizda: SQL Editor > New query > shu faylni
-- to'liq joylashtiring va "Run" bosing.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- ORGS (workspaces) ----------
create table if not exists orgs (
  code text primary key,
  name text not null,
  dispatch_phone text,
  created_at timestamptz default now()
);

-- ---------- PROFILES (one row per Supabase Auth user) ----------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  org_code text not null references orgs(code) on delete cascade,
  username text not null,
  name text not null,
  role text not null default 'updater' check (role in ('updater','manager')),
  created_at timestamptz default now(),
  unique (org_code, username)
);

-- ---------- LOADS ----------
create table if not exists loads (
  id text not null,
  org_code text not null references orgs(code) on delete cascade,
  carrier text,
  origin text,
  destination text,
  status text not null default 'loading' check (status in ('loading','transit','delayed','delivered')),
  eta timestamptz,
  note text,
  dtoken text not null default encode(gen_random_bytes(12), 'hex'),
  updated_by text,
  updated_at timestamptz default now(),
  primary key (org_code, id)
);

-- ---------- LOAD HISTORY (audit trail) ----------
create table if not exists load_history (
  id bigint generated always as identity primary key,
  org_code text not null,
  load_id text not null,
  status text not null,
  note text,
  eta timestamptz,
  updated_by text,
  updated_at timestamptz default now(),
  foreign key (org_code, load_id) references loads(org_code, id) on delete cascade
);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table orgs enable row level security;
alter table profiles enable row level security;
alter table loads enable row level security;
alter table load_history enable row level security;

create or replace function my_org() returns text
language sql stable security definer set search_path = public as $$
  select org_code from profiles where id = auth.uid()
$$;

create or replace function my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;

-- orgs: a signed-in user can read their own workspace and (if manager) update its settings
create policy "read own org" on orgs for select
  using (code = my_org());
create policy "manager updates own org" on orgs for update
  using (code = my_org() and my_role() = 'manager');

-- profiles: everyone in an org can see each other; a manager can change roles / remove users
create policy "read profiles in org" on profiles for select
  using (org_code = my_org());
create policy "manager updates profiles" on profiles for update
  using (org_code = my_org() and my_role() = 'manager');
create policy "manager deletes profiles" on profiles for delete
  using (org_code = my_org() and my_role() = 'manager' and id <> auth.uid());

-- loads: anyone in the org can read/insert/update; only managers can delete
create policy "read loads in org" on loads for select
  using (org_code = my_org());
create policy "insert loads in org" on loads for insert
  with check (org_code = my_org());
create policy "update loads in org" on loads for update
  using (org_code = my_org());
create policy "manager deletes loads" on loads for delete
  using (org_code = my_org() and my_role() = 'manager');

-- history: readable and insertable within the org
create policy "read history in org" on load_history for select
  using (org_code = my_org());
create policy "insert history in org" on load_history for insert
  with check (org_code = my_org());

-- ============================================================
-- RPC FUNCTIONS (called from the app instead of raw table access)
-- ============================================================

-- Create a brand-new workspace + its first manager account.
create or replace function create_org(p_code text, p_name text, p_username text, p_full_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from orgs where code = p_code) then
    raise exception 'org_taken';
  end if;
  insert into orgs (code, name) values (p_code, p_name);
  insert into profiles (id, org_code, username, name, role)
    values (auth.uid(), p_code, p_username, p_full_name, 'manager');
end;
$$;
grant execute on function create_org to authenticated;

-- Join an existing workspace as an "updater" (self-service).
create or replace function join_org(p_code text, p_username text, p_full_name text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from orgs where code = p_code) then
    raise exception 'org_not_found';
  end if;
  insert into profiles (id, org_code, username, name, role)
    values (auth.uid(), p_code, p_username, p_full_name, 'updater');
end;
$$;
grant execute on function join_org to authenticated;

-- Driver-only update: verified purely by the per-load token, no login needed.
create or replace function driver_update_load(
  p_org text, p_load_id text, p_token text,
  p_status text, p_note text, p_eta timestamptz
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_carrier text;
begin
  if not exists (select 1 from loads where org_code = p_org and id = p_load_id and dtoken = p_token) then
    raise exception 'invalid_link';
  end if;
  select carrier into v_carrier from loads where org_code = p_org and id = p_load_id;
  update loads set status = p_status, note = p_note, eta = p_eta,
    updated_by = coalesce(v_carrier, 'Driver'), updated_at = now()
    where org_code = p_org and id = p_load_id;
  insert into load_history (org_code, load_id, status, note, eta, updated_by)
    values (p_org, p_load_id, p_status, p_note, p_eta, coalesce(v_carrier, 'Driver'));
end;
$$;
grant execute on function driver_update_load to anon;

-- Driver-only read: returns just enough info to show the driver their load, via token.
create or replace function driver_get_load(p_org text, p_load_id text, p_token text)
returns table(id text, carrier text, origin text, destination text, status text, eta timestamptz)
language sql security definer set search_path = public as $$
  select id, carrier, origin, destination, status, eta
  from loads
  where org_code = p_org and id = p_load_id and dtoken = p_token
$$;
grant execute on function driver_get_load to anon;

-- ============================================================
-- REALTIME: let the app subscribe to live changes on "loads"
-- ============================================================
alter publication supabase_realtime add table loads;
