-- Reconstructed from the live schema snapshot (supabase/schema.sql).
-- Historical migration version is already recorded in production.
create table if not exists public.platform_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform_name text not null,
  stream_key text,
  ingest_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform_name)
);
alter table public.platform_credentials enable row level security;
drop policy if exists "select_own_credentials" on public.platform_credentials;
create policy "select_own_credentials" on public.platform_credentials for select using (auth.uid() = user_id);
drop policy if exists "insert_own_credentials" on public.platform_credentials;
create policy "insert_own_credentials" on public.platform_credentials for insert with check (auth.uid() = user_id);
drop policy if exists "update_own_credentials" on public.platform_credentials;
create policy "update_own_credentials" on public.platform_credentials for update using (auth.uid() = user_id);
drop policy if exists "delete_own_credentials" on public.platform_credentials;
create policy "delete_own_credentials" on public.platform_credentials for delete using (auth.uid() = user_id);
