-- StreamLink XR community upgrade
-- Run this migration in Supabase SQL Editor before using gamer profiles or DMs.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (char_length(display_name) <= 50),
  gamer_tag text check (gamer_tag is null or char_length(gamer_tag) <= 50),
  favorite_games text[] not null default '{}',
  bio text not null default '' check (char_length(bio) <= 280),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "profiles_read_authenticated" on public.profiles;
create policy "profiles_read_authenticated" on public.profiles
  for select to authenticated using (true);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- E2E encrypted direct messages: the browser encrypts content before insert.
-- The database stores ciphertext only. Public keys are published for recipients.
create table if not exists public.dm_keys (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_key text not null,
  updated_at timestamptz not null default now()
);
alter table public.dm_keys enable row level security;
drop policy if exists "dm_keys_read_authenticated" on public.dm_keys;
create policy "dm_keys_read_authenticated" on public.dm_keys
  for select to authenticated using (true);
drop policy if exists "dm_keys_insert_own" on public.dm_keys;
create policy "dm_keys_insert_own" on public.dm_keys
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "dm_keys_update_own" on public.dm_keys;
create policy "dm_keys_update_own" on public.dm_keys
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  ciphertext text not null,
  iv text not null,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists direct_messages_pair_created_idx
  on public.direct_messages (sender_id, recipient_id, created_at);
alter table public.direct_messages enable row level security;
drop policy if exists "dm_read_participant" on public.direct_messages;
create policy "dm_read_participant" on public.direct_messages
  for select to authenticated using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "dm_insert_sender" on public.direct_messages;
create policy "dm_insert_sender" on public.direct_messages
  for insert to authenticated with check (auth.uid() = sender_id);


-- Native StreamLink community comments. External-platform imports must be
-- inserted only by a trusted server-side integration.
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
  for insert to authenticated
  with check ((select auth.uid()) = author_id and origin_platform = 'streamlink');

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.dm_keys to authenticated;
grant select, insert on public.direct_messages to authenticated;
grant select, insert on public.stream_comments to authenticated;
