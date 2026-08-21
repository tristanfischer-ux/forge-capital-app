-- Reject any auth.users row that is not the allow-listed address.
-- Spec: single allowed address, database function or auth hook — not a
-- client-side check. RLS on platform_founders is not enough: a second
-- Google account could still mint a session.

create or replace function public.enforce_sign_in_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(coalesce(NEW.email, '')) is distinct from 'tristan.fischer@gmail.com' then
    raise exception 'sign-up not allowed';
  end if;
  return NEW;
end;
$$;

drop trigger if exists enforce_sign_in_allowlist on auth.users;
create trigger enforce_sign_in_allowlist
  before insert or update of email on auth.users
  for each row
  execute function public.enforce_sign_in_allowlist();

comment on function public.enforce_sign_in_allowlist() is
  'Hard allow-list: only tristan.fischer@gmail.com may exist in auth.users.';
