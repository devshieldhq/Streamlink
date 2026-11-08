-- Reconstructed from the live schema snapshot (supabase/schema.sql).
-- Historical migration version is already recorded in production.
create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  verified_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "select_own_wallet" on public.wallets;
create policy "select_own_wallet" on public.wallets for select using (auth.uid() = user_id);
