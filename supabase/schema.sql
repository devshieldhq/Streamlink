-- Reference copy of the tables StreamLink XR uses in Supabase.
-- Already applied to the live project; kept here so the setup can be rebuilt.

-- Saved stream keys (one row per user per platform). Users only see their own.
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
create policy "select_own_credentials" on public.platform_credentials for select using (auth.uid() = user_id);
create policy "insert_own_credentials" on public.platform_credentials for insert with check (auth.uid() = user_id);
create policy "update_own_credentials" on public.platform_credentials for update using (auth.uid() = user_id);
create policy "delete_own_credentials" on public.platform_credentials for delete using (auth.uid() = user_id);

-- Verified wallet link. Users can READ their own row but have no write policy:
-- only the link-wallet edge function (service role, after checking a signature) writes here.
create table if not exists public.wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  verified_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
create policy "select_own_wallet" on public.wallets for select using (auth.uid() = user_id);

-- Broadcast history for the creator passport (shape as found in the live project).
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
create policy "select_own_sessions" on public.stream_sessions for select using (auth.uid() = user_id);
create policy "insert_own_sessions" on public.stream_sessions for insert with check (auth.uid() = user_id);
create policy "update_own_sessions" on public.stream_sessions for update using (auth.uid() = user_id);


-- Community comments. origin_platform records where an imported comment came
-- from; platform imports must be created by a trusted server-side integration.
create table if not exists public.stream_comments (
  id uuid primary key default gen_random_uuid(),
  session_id text not null,
  author_id uuid references auth.users(id) on delete set null,
  author_name text not null check (char_length(author_name) between 1 and 80),
  body text not null check (char_length(body) between 1 and 2000),
  origin_platform text not null default 'streamlink'
    check (origin_platform in ('streamlink','youtube','twitch','tiktok','x')),
  external_comment_id text,
  created_at timestamptz not null default now(),
  unique (origin_platform, external_comment_id)
);
create index if not exists stream_comments_session_created_idx
  on public.stream_comments (session_id, created_at);
alter table public.stream_comments enable row level security;
drop policy if exists "read_stream_comments" on public.stream_comments;
create policy "read_stream_comments" on public.stream_comments
  for select to authenticated using (true);
drop policy if exists "insert_own_stream_comments" on public.stream_comments;
create policy "insert_own_stream_comments" on public.stream_comments
  for insert to authenticated with check (auth.uid() = author_id and origin_platform = 'streamlink');
