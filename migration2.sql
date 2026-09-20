-- ============================================================
-- MIGRATION 2: ishlash tezligi (indekslar)
-- Ko'p foydalanuvchi va ko'p yozuv bo'lganda so'rovlarni tezlashtiradi.
-- Supabase > SQL Editor > New query'ga joylashtirib Run bosing.
-- ============================================================

create index if not exists idx_loads_org_archived on loads (org_code, archived);
create index if not exists idx_loads_org_status on loads (org_code, status) where archived = false;
create index if not exists idx_loads_org_updated on loads (org_code, updated_at desc);
create index if not exists idx_history_org_load on load_history (org_code, load_id, updated_at desc);
create index if not exists idx_history_org_user_day on load_history (org_code, updated_by, updated_at);
create index if not exists idx_profiles_org on profiles (org_code);
