-- 010_gmail_oauth_tokens.sql
-- Per-user Gmail OAuth refresh-token storage for Phase 4 draft creation.
-- RLS scoped so a user can only read/write their own row. Service role
-- bypasses RLS and is used by the /api/auth/gmail/callback route to
-- write the initial refresh token after the user grants consent.

create table if not exists public.gmail_tokens (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  email              text not null,
  access_token       text,
  refresh_token      text not null,
  expires_at         timestamptz,
  scope              text,
  token_type         text,
  connected_at       timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

alter table public.gmail_tokens enable row level security;

drop policy if exists gmail_tokens_owner on public.gmail_tokens;
create policy gmail_tokens_owner on public.gmail_tokens
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on table public.gmail_tokens is 'Gmail OAuth refresh tokens per user.';
comment on column public.gmail_tokens.refresh_token is 'Long-lived refresh token from Gmail OAuth.';

notify pgrst, 'reload schema';
