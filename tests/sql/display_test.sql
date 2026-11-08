-- Tests for the TV display board (display_board()). Fake data only.
-- Runs in a transaction that is rolled back.

\set ON_ERROR_STOP 1

begin;

create schema t;
grant usage on schema t to anonymous, authenticated;

create function t.expect(label text, actual text, expected text) returns void
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
grant execute on all functions in schema t to anonymous, authenticated;

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000e1'),
  ('00000000-0000-0000-0000-0000000000e2');
insert into healthy_athletes.staff (auth_user_id, name, role) values
  ('00000000-0000-0000-0000-0000000000e1', 'Hall Display', 'display');
-- e2 signs in but has no staff row.

insert into healthy_athletes.events (id, name, date, venue, status) values
  ('20000000-0000-0000-0000-0000000000d1', 'Live Test Event', current_date, 'Test Hall', 'live'),
  ('20000000-0000-0000-0000-0000000000d2', 'Planned Event', current_date + 7, 'Test Hall', 'planned');

-- Constraints on the new station columns.
select t.expect_error('icon must be from the fixed list',
  $q$insert into healthy_athletes.stations (event_id, name, icon) values ('20000000-0000-0000-0000-0000000000d1', 'X', 'skull')$q$);
select t.expect_error('subtitle has a length limit',
  $q$insert into healthy_athletes.stations (event_id, name, subtitle) values ('20000000-0000-0000-0000-0000000000d1', 'X', repeat('a', 61))$q$);
select t.expect_error('minutes per athlete must be sensible',
  $q$insert into healthy_athletes.stations (event_id, name, minutes_per_athlete) values ('20000000-0000-0000-0000-0000000000d1', 'X', 0)$q$);

insert into healthy_athletes.stations (id, event_id, name, subtitle, icon, display_order, minutes_per_athlete, active) values
  ('30000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1', 'Opening Eyes', 'Vision', 'eye', 1, 8, true),
  ('30000000-0000-0000-0000-0000000000d2', '20000000-0000-0000-0000-0000000000d1', 'Special Smiles', 'Dental', 'tooth', 2, 10, true),
  ('30000000-0000-0000-0000-0000000000d3', '20000000-0000-0000-0000-0000000000d1', 'Closed Station', null, 'star', 3, 10, false);

insert into healthy_athletes.athletes (id, code, first_name, last_name) values
  ('50000000-0000-0000-0000-0000000000d1', 'HA-9001', 'Dana', 'Surnameone'),
  ('50000000-0000-0000-0000-0000000000d2', 'HA-9002', 'Eli',  'Surnametwo'),
  ('50000000-0000-0000-0000-0000000000d3', 'HA-9003', 'Flo',  'Surnamethree'),
  ('50000000-0000-0000-0000-0000000000d4', 'HA-9004', 'Gus',  'Surnamefour');

insert into healthy_athletes.station_visits (event_id, station_id, athlete_id, status, queued_at, called_at, finished_at) values
  -- Opening Eyes: Dana called, Eli and Flo queued (Eli first), Gus done in 4 min
  ('20000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000d1', 'called', now() - interval '30 min', now() - interval '1 min', null),
  ('20000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000d2', 'queued', now() - interval '20 min', null, null),
  ('20000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000d3', 'queued', now() - interval '10 min', null, null),
  ('20000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d1', '50000000-0000-0000-0000-0000000000d4', 'done',   now() - interval '40 min', now() - interval '20 min', now() - interval '16 min'),
  -- Special Smiles: Gus queued, nothing finished yet
  ('20000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d2', '50000000-0000-0000-0000-0000000000d4', 'queued', now() - interval '5 min', null, null),
  -- Closed station: Eli called there would not show (but can't be called twice; use queued)
  ('20000000-0000-0000-0000-0000000000d1', '30000000-0000-0000-0000-0000000000d3', '50000000-0000-0000-0000-0000000000d3', 'queued', now(), null, null);

-- anonymous: refused ------------------------------------------------------
set local role anonymous;
select t.expect_error('anonymous cannot call display_board', 'select healthy_athletes.display_board()');
reset role;

-- signed in but not staff: refused -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e2', true);
select t.expect_error('non-staff cannot call display_board', 'select healthy_athletes.display_board()');
reset role;

-- display account ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
create temp table b as select healthy_athletes.display_board() as j;

select t.expect('picks the live event', (select j #>> '{event,name}' from b), 'Live Test Event');
select t.expect('one athlete called', (select jsonb_array_length(j -> 'calls')::text from b), '1');
select t.expect('call shows first name', (select j #>> '{calls,0,first_name}' from b), 'Dana');
select t.expect('call shows code', (select j #>> '{calls,0,athlete_code}' from b), 'HA-9001');
select t.expect('inactive stations are hidden', (select jsonb_array_length(j -> 'stations')::text from b), '2');
select t.expect('stations in display order', (select j #>> '{stations,0,name}' from b), 'Opening Eyes');
select t.expect('station icon', (select j #>> '{stations,0,icon}' from b), 'eye');
select t.expect('station subtitle', (select j #>> '{stations,0,subtitle}' from b), 'Vision');
select t.expect('queued count', (select j #>> '{stations,0,queued}' from b), '2');
select t.expect('next is the earliest queued', (select j #>> '{stations,0,next,first_name}' from b), 'Eli');
select t.expect('wait uses measured average (2 x 4 min)', (select j #>> '{stations,0,wait_minutes}' from b), '8');
select t.expect('wait falls back to minutes per athlete (1 x 10)', (select j #>> '{stations,1,wait_minutes}' from b), '10');

-- Never surname, club or anything beyond first name + code.
select t.expect('no surname anywhere in the board',
  (select (j::text ~ 'Surname')::text from b), 'false');
select t.expect('only first name and code per athlete',
  (select string_agg(k, ',' order by k) from b, jsonb_object_keys(j #> '{stations,0,next}') k),
  'athlete_code,first_name');

-- Still no direct table access for the display account.
select t.expect('display still reads no athletes rows',
  (select count(*)::text from healthy_athletes.athletes), '0');
drop table b;
reset role;

-- Empty queue: no wait shown, no next.
update healthy_athletes.station_visits set status = 'done', called_at = now() - interval '3 min', finished_at = now()
  where station_id = '30000000-0000-0000-0000-0000000000d2';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
select t.expect('empty queue has no wait',
  (select healthy_athletes.display_board() #>> '{stations,1,wait_minutes}'), null);
select t.expect('empty queue has no next',
  (select healthy_athletes.display_board() #> '{stations,1,next}' = 'null'::jsonb)::text, 'true');
reset role;

-- No live event: empty board, not an error.
update healthy_athletes.events set status = 'closed';
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000e1', true);
select t.expect('no live event gives empty board',
  (select (healthy_athletes.display_board() -> 'event') = 'null'::jsonb)::text, 'true');
reset role;

select 'display tests passed' as outcome;

rollback;
