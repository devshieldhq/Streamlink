-- Apply this to keep the live Supabase project aligned with server.js comments routes.
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
  with check (auth.uid() = author_id and origin_platform = 'streamlink');
grant select, insert on public.stream_comments to authenticated;