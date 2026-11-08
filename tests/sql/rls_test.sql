-- RLS tests for the four roles. Uses fake data only. Runs in a transaction
-- that is rolled back, so it leaves the database unchanged.

\set ON_ERROR_STOP 1

begin;

-- Fake users ---------------------------------------------------------------
insert into auth.users (id) values
  ('00000000-0000-0000-0000-00000000000a'),  -- organiser
  ('00000000-0000-0000-0000-00000000000b'),  -- receptionist
  ('00000000-0000-0000-0000-00000000000c'),  -- station lead, Opening Eyes
  ('00000000-0000-0000-0000-00000000000d'),  -- station lead, Special Smiles
  ('00000000-0000-0000-0000-00000000000e'),  -- display
  ('00000000-0000-0000-0000-00000000000f');  -- deactivated lead

insert into public.staff (id, auth_user_id, name, role, active) values
  ('10000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'Test Organiser', 'organiser', true),
  ('10000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000b', 'Test Reception', 'receptionist', true),
  ('10000000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-00000000000c', 'Test Lead Eyes', 'station_lead', true),
  ('10000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000d', 'Test Lead Smiles', 'station_lead', true),
  ('10000000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-00000000000e', 'Hall Display', 'display', true),
  ('10000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-00000000000f', 'Old Lead', 'station_lead', false);

insert into public.events (id, name, date, venue) values
  ('20000000-0000-0000-0000-000000000001', 'Test Event', '2027-01-01', 'Test Hall');

insert into public.stations (id, event_id, name, display_order) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Opening Eyes', 1),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Special Smiles', 2);

insert into public.station_leads (event_id, station_id, staff_id) values
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c'),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000d'),
  ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000f');

insert into public.clubs (id, name) values ('40000000-0000-0000-0000-000000000001', 'Test Club');

insert into public.athletes (id, code, first_name, last_name, club_id) values
  ('50000000-0000-0000-0000-000000000001', 'HA-0001', 'Alex', 'Testone', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002', 'HA-0002', 'Bea',  'Testtwo', '40000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000003', 'HA-0003', 'Cal',  'Testthree', null);

insert into public.station_visits (id, event_id, station_id, athlete_id, status) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'called'),
  ('60000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'queued'),
  ('60000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000001', 'queued');

-- Assertion helpers (in a throwaway schema, dropped by the rollback) -------
create schema t;
grant usage on schema t to anon, authenticated;

create function t.expect(label text, actual bigint, expected bigint) returns void
  language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;

create function t.expect_error(label text, stmt text) returns void
  language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    raise notice 'ok  % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL %: statement succeeded but should have been refused', label;
end $$;

-- Rows affected by an UPDATE (0 means RLS hid the row).
create function t.rows_updated(stmt text) returns bigint
  language plpgsql as $$
declare n bigint;
begin
  execute stmt;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema t to anon, authenticated;

-- Constraints (as table owner) ---------------------------------------------
select t.expect_error('status must be an allowed value',
  $q$update public.station_visits set status = 'needs_referral' where id = '60000000-0000-0000-0000-000000000002'$q$);
select t.expect_error('skipped needs a fixed reason',
  $q$update public.station_visits set status = 'skipped' where id = '60000000-0000-0000-0000-000000000002'$q$);
select t.expect_error('skip reason must be from the fixed list',
  $q$update public.station_visits set status = 'skipped', skip_reason = 'felt unwell' where id = '60000000-0000-0000-0000-000000000002'$q$);
select t.expect_error('athlete cannot be called at two stations',
  $q$update public.station_visits set status = 'called' where id = '60000000-0000-0000-0000-000000000003'$q$);
select t.expect_error('athlete code format',
  $q$insert into public.athletes (code, first_name, last_name) values ('anything', 'X', 'Y')$q$);

-- anon ---------------------------------------------------------------------
set local role anon;
select t.expect_error('anon cannot read athletes', 'select * from public.athletes');
select t.expect_error('anon cannot read display_feed', 'select * from public.display_feed');
select t.expect_error('anon cannot read visits', 'select * from public.station_visits');
reset role;

-- organiser ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select t.expect('organiser sees all athletes', (select count(*) from public.athletes), 3);
select t.expect('organiser sees all visits', (select count(*) from public.station_visits), 3);
select t.expect('organiser sees all staff', (select count(*) from public.staff), 6);
select t.expect('organiser reads audit log', (select count(*) from public.audit_log where table_name = 'station_visits'), 3);
select t.expect('organiser can create a station', t.rows_updated(
  $q$insert into public.stations (event_id, name) values ('20000000-0000-0000-0000-000000000001', 'Fit Feet')$q$), 1);
select t.expect_error('nobody can write the audit log directly',
  $q$insert into public.audit_log (action, table_name) values ('delete', 'athletes')$q$);
reset role;

-- receptionist -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', true);
select t.expect('reception sees all athletes', (select count(*) from public.athletes), 3);
select t.expect('reception sees all visits', (select count(*) from public.station_visits), 3);
select t.expect('reception sees only own staff row', (select count(*) from public.staff), 1);
select t.expect('reception cannot read audit log', (select count(*) from public.audit_log), 0);
select t.expect('reception can check in', t.rows_updated(
  $q$insert into public.checkins (event_id, athlete_id) values ('20000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003')$q$), 1);
select t.expect('reception can queue at a station', t.rows_updated(
  $q$insert into public.station_visits (event_id, station_id, athlete_id) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003')$q$), 1);
select t.expect_error('reception cannot create stations',
  $q$insert into public.stations (event_id, name) values ('20000000-0000-0000-0000-000000000001', 'MedFest')$q$);
select t.expect_error('reception cannot create staff',
  $q$insert into public.staff (auth_user_id, name, role) values ('00000000-0000-0000-0000-00000000000b', 'x', 'organiser')$q$);
reset role;

-- station lead (Opening Eyes) ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
select t.expect('lead sees only own station', (select count(*) from public.stations), 1);
select t.expect('lead sees only own station visits', (select count(*) from public.station_visits), 2);
select t.expect('lead sees only athletes in own queue', (select count(*) from public.athletes), 2);
select t.expect('lead cannot see check-ins', (select count(*) from public.checkins), 0);
select t.expect('lead cannot see clubs', (select count(*) from public.clubs), 0);
select t.expect('lead can mark in_station', t.rows_updated(
  $q$update public.station_visits set status = 'in_station', started_at = now() where id = '60000000-0000-0000-0000-000000000001'$q$), 1);
select t.expect('lead cannot touch another station', t.rows_updated(
  $q$update public.station_visits set status = 'called' where id = '60000000-0000-0000-0000-000000000002'$q$), 0);
select t.expect_error('lead cannot move a visit to another athlete',
  $q$update public.station_visits set athlete_id = '50000000-0000-0000-0000-000000000002' where id = '60000000-0000-0000-0000-000000000001'$q$);
select t.expect_error('lead cannot insert visits',
  $q$insert into public.station_visits (event_id, station_id, athlete_id) values ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002')$q$);
select t.expect('lead cannot delete visits', t.rows_updated(
  $q$delete from public.station_visits where id = '60000000-0000-0000-0000-000000000001'$q$), 0);
reset role;

-- deactivated station lead -------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000f', true);
select t.expect('deactivated lead sees no visits', (select count(*) from public.station_visits), 0);
select t.expect('deactivated lead sees no athletes', (select count(*) from public.athletes), 0);
reset role;

-- display ------------------------------------------------------------------
-- Put one athlete back to "called" so the feed has something to show.
update public.station_visits set status = 'called' where id = '60000000-0000-0000-0000-000000000002';

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000e', true);
select t.expect('display sees no athletes table rows', (select count(*) from public.athletes), 0);
select t.expect('display sees no visits', (select count(*) from public.station_visits), 0);
select t.expect('display sees no staff but itself', (select count(*) from public.staff), 1);
select t.expect('display sees the called athlete in the feed', (select count(*) from public.display_feed), 1);
select t.expect('feed shows first name and code only',
  (select count(*) from public.display_feed where athlete_code = 'HA-0002' and first_name = 'Bea' and station_name = 'Special Smiles'), 1);
select t.expect('display cannot update visits', t.rows_updated(
  $q$update public.station_visits set status = 'done'$q$), 0);
reset role;

-- unknown authenticated user (signed up but not staff) ---------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000099', true);
select t.expect('non-staff sees no athletes', (select count(*) from public.athletes), 0);
select t.expect('non-staff sees empty feed', (select count(*) from public.display_feed), 0);
reset role;

-- feed columns: never surname or club --------------------------------------
select t.expect('display_feed has no surname or club column',
  (select count(*) from information_schema.columns
   where table_schema = 'public' and table_name = 'display_feed'
     and column_name in ('last_name', 'club_id', 'club', 'club_name')), 0);

select 'rls tests passed' as outcome;

rollback;
