-- ============================================================
-- MIGRATION: "Clear board" endi arxivlaydi, o'chirmaydi.
-- Bu qismni Supabase > SQL Editor > New query'ga joylashtirib
-- Run bosing. (schema.sql'ni qayta ishga tushirish shart emas.)
-- ============================================================

alter table loads add column if not exists archived boolean not null default false;

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
  update loads set status = p_status, note = p_note, eta = p_eta, archived = false,
    updated_by = coalesce(v_carrier, 'Driver'), updated_at = now()
    where org_code = p_org and id = p_load_id;
  insert into load_history (org_code, load_id, status, note, eta, updated_by)
    values (p_org, p_load_id, p_status, p_note, p_eta, coalesce(v_carrier, 'Driver'));
end;
$$;
grant execute on function driver_update_load to anon;
