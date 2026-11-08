-- Tests for the organiser tools migration: MFA gate, athlete codes, CSV
-- import, staff and station-lead safeguards. Fake data only, rolled back.

\set ON_ERROR_STOP 1

begin;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'),  -- organiser
  ('00000000-0000-0000-0000-0000000000b1'),  -- receptionist
  ('00000000-0000-0000-0000-0000000000c1'),  -- station lead
  ('00000000-0000-0000-0000-0000000000c2');  -- station lead

insert into healthy_athletes.staff (id, auth_user_id, name, role) values
  ('11000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a1', 'Test Organiser', 'organiser'),
  ('11000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'Test Reception', 'receptionist'),
  ('11000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c1', 'Test Lead One', 'station_lead'),
  ('11000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c2', 'Test Lead Two', 'station_lead');

insert into healthy_athletes.events (id, name, date, venue) values
  ('21000000-0000-0000-0000-000000000001', 'Event A', '2027-01-01', 'Hall A'),
  ('21000000-0000-0000-0000-000000000002', 'Event B', '2027-02-01', 'Hall B');
insert into healthy_athletes.stations (id, event_id, name) values
  ('31000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'Fit Feet'),
  ('31000000-0000-0000-0000-000000000002', '21000000-0000-0000-0000-000000000001', 'MedFest'),
  ('31000000-0000-0000-0000-000000000003', '21000000-0000-0000-0000-000000000002', 'Fit Feet');

create schema t;
grant usage on schema t to anon, authenticated;
create function t.expect(label text, actual anyelement, expected anyelement) returns void
  language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAIL %: expected %, got %', label, expected, actual;
  end if;
  raise notice 'ok  %', label;
end $$;
create function t.expect_error(label text, stmt text, pattern text default '') returns void
  language plpgsql as $$
begin
  begin
    execute stmt;
  exception when others then
    if sqlerrm !~* pattern then
      raise exception 'FAIL %: wrong error: %', label, sqlerrm;
    end if;
    raise notice 'ok  % (%)', label, sqlerrm;
    return;
  end;
  raise exception 'FAIL %: statement succeeded but should have been refused', label;
end $$;
grant execute on all functions in schema t to anon, authenticated;

-- Station leads ------------------------------------------------------------
select t.expect_error('only station-lead accounts can lead a station',
  $q$insert into healthy_athletes.station_leads values ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-0000000000b1')$q$,
  'only station lead accounts');
select t.expect_error('station must belong to the event',
  $q$insert into healthy_athletes.station_leads values ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-0000000000c1')$q$,
  'does not belong');
insert into healthy_athletes.station_leads values
  ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-0000000000c1');
select t.expect_error('a lead runs one station per event',
  $q$insert into healthy_athletes.station_leads values ('21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-0000000000c1')$q$,
  'station_leads_one_station_per_event');
insert into healthy_athletes.station_leads values
  ('21000000-0000-0000-0000-000000000002', '31000000-0000-0000-0000-000000000003', '11000000-0000-0000-0000-0000000000c1');
select t.expect('the same lead can run a station at another event',
  (select count(*) from healthy_athletes.station_leads where staff_id = '11000000-0000-0000-0000-0000000000c1'), 2::bigint);

-- Last organiser -----------------------------------------------------------
select t.expect_error('cannot deactivate the last organiser',
  $q$update healthy_athletes.staff set active = false where id = '11000000-0000-0000-0000-0000000000a1'$q$, 'at least one active organiser');
select t.expect_error('cannot demote the last organiser',
  $q$update healthy_athletes.staff set role = 'receptionist' where id = '11000000-0000-0000-0000-0000000000a1'$q$, 'at least one active organiser');
select t.expect_error('cannot delete the last organiser',
  $q$delete from healthy_athletes.staff where id = '11000000-0000-0000-0000-0000000000a1'$q$, 'at least one active organiser');

-- Athlete codes ------------------------------------------------------------
insert into healthy_athletes.athletes (code, first_name, last_name) values ('HA-0002', 'Manual', 'Code');
insert into healthy_athletes.athletes (first_name, last_name) values ('Auto', 'One'), ('Auto', 'Two');
select t.expect('codes are generated and skip used ones',
  (select string_agg(code, ',' order by code) from healthy_athletes.athletes where first_name = 'Auto'), 'HA-0001,HA-0003');

-- Import as receptionist: refused ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select t.expect_error('receptionist cannot import',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A","last_name":"B"}]')$q$, 'only organisers');
reset role;

-- Import as organiser without MFA: refused ---------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select set_config('request.jwt.claims', '{"aal":"aal1"}', true);
select t.expect_error('organiser without MFA cannot import',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A","last_name":"B"}]')$q$, 'only organisers');
select t.expect('organiser without MFA is not an organiser yet', healthy_athletes.is_organiser(), false);

-- Import as organiser with MFA ---------------------------------------------
select set_config('request.jwt.claims', '{"aal":"aal2"}', true);
select t.expect('organiser with MFA is an organiser', healthy_athletes.is_organiser(), true);

select t.expect_error('unknown columns are rejected',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A","last_name":"B","medical_notes":"x"}]')$q$, 'unknown column\(s\): medical_notes');
select t.expect_error('missing names are rejected',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A"}]')$q$, 'row 1: first_name and last_name are required');
select t.expect_error('bad age band is rejected',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A","last_name":"B","age_band":"1999-04-02"}]')$q$, 'age_band');
select t.expect_error('bad code is rejected',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A","last_name":"B","code":"X1"}]')$q$, 'code must look like');
select t.expect_error('used code is rejected',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A","last_name":"B","code":"HA-0002"}]')$q$, 'already used');
select t.expect_error('non-text values are rejected',
  $q$select healthy_athletes.import_athletes('[{"first_name":"A","last_name":{"x":1}}]')$q$, 'values must be text');
select t.expect_error('a bad row aborts the whole import',
  $q$select healthy_athletes.import_athletes('[{"first_name":"Good","last_name":"Row"},{"first_name":"Bad"}]')$q$, 'row 2');
select t.expect('nothing was imported by the failed import',
  (select count(*) from healthy_athletes.athletes where first_name = 'Good'), 0::bigint);

select t.expect('valid import',
  healthy_athletes.import_athletes($j$[
    {"first_name":" Dana ","last_name":"Testfour","club":"Test Club","age_band":"18+"},
    {"first_name":"Eli","last_name":"Testfive","club":"test club","age_band":"under 18"},
    {"first_name":"Fay","last_name":"Testsix","code":"ha-0100"},
    {"first_name":"Gus","last_name":"Testseven","club":"","age_band":""}
  ]$j$),
  '{"inserted": 4, "skipped": 0}'::jsonb);
select t.expect('names are trimmed and clubs matched case-insensitively',
  (select count(*) from healthy_athletes.athletes a join healthy_athletes.clubs c on c.id = a.club_id
   where c.name = 'Test Club' and a.first_name in ('Dana', 'Eli')), 2::bigint);
select t.expect('age bands normalised',
  (select string_agg(coalesce(age_band, '-'), ',' order by first_name) from healthy_athletes.athletes
   where first_name in ('Dana', 'Eli', 'Gus')), '18_plus,under_18,-');
select t.expect('given code kept (upper-cased)',
  (select code from healthy_athletes.athletes where first_name = 'Fay'), 'HA-0100');

select t.expect('re-importing the same people skips them',
  healthy_athletes.import_athletes($j$[
    {"first_name":"Dana","last_name":"Testfour","club":"Test Club"},
    {"first_name":"Hal","last_name":"Testeight"}
  ]$j$),
  '{"inserted": 1, "skipped": 1}'::jsonb);

select t.expect('imports are audited',
  (select count(*) from healthy_athletes.audit_log where table_name = 'athletes' and action = 'insert'
     and staff_id = '11000000-0000-0000-0000-0000000000a1'), 5::bigint);
reset role;

-- anon cannot call the import at all ---------------------------------------
set local role anon;
select t.expect_error('anon cannot import',
  $q$select healthy_athletes.import_athletes('[]')$q$, 'permission denied');
reset role;

select 'organiser tests passed' as outcome;

rollback;
