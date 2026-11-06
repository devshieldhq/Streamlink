-- Index recipient-first lookups for direct-message conversations.
create index if not exists direct_messages_recipient_sender_created_idx
  on public.direct_messages (recipient_id, sender_id, created_at);
