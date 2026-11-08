-- Reconstructed from the live schema snapshot (supabase/schema.sql).
-- Historical migration version is already recorded in production.
create table if not exists public.stream_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  platform_count integer not null default 0,
  quality text,
  via text
);
alter table public.stream_sessions enable row level security;
drop policy if exists "select_own_sessions" on public.stream_sessions;
create policy "select_own_sessions" on public.stream_sessions for select using (auth.uid() = user_id);
drop policy if exists "insert_own_sessions" on public.stream_sessions;
create policy "insert_own_sessions" on public.stream_sessions for insert with check (auth.uid() = user_id);
drop policy if exists "update_own_sessions" on public.stream_sessions;
create policy "update_own_sessions" on public.stream_sessions for update using (auth.uid() = user_id);
