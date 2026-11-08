-- Minimal stand-in for the parts of Neon the migrations rely on (the Data API
-- roles and pg_session_jwt's auth.uid() / auth.jwt()), so the schema and RLS
-- can be tested against plain Postgres in CI. NOT applied to Neon.

do $$ begin
  create role anonymous nologin;
exception when duplicate_object then null; end $$;
do $$ begin
  create role authenticated nologin;
exception when duplicate_object then null; end $$;

create schema if not exists auth;

-- Stand-in for Neon Auth's user table, so tests can create fake users.
create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- pg_session_jwt reads the user id from the request JWT; tests set it with set_config.
create or replace function auth.uid() returns uuid
  language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- All JWT claims (tests use this to simulate the MFA level, 'aal').
create or replace function auth.jwt() returns jsonb
  language sql stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

-- Like Neon: the API roles get NO access to the auth schema, so the
-- migrations must only reach auth.* through security definer functions.
revoke all on schema auth from public;
