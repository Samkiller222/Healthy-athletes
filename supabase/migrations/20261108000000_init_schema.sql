-- Healthy Athletes call-up system: initial schema, constraints and RLS.
--
-- LOGISTICS ONLY. This database must never hold health data: no results,
-- scores, referrals, diagnoses, medications, notes, dates of birth, phone
-- numbers or emails for athletes. See HANDOFF.md section 2. The schema guard
-- test (tests/sql/schema_guard.sql) enforces this in CI.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.events (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  date       date not null,
  venue      text not null check (char_length(venue) between 1 and 120),
  status     text not null default 'planned'
             check (status in ('planned', 'live', 'closed')),
  created_at timestamptz not null default now()
);

create table public.stations (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 60),
  colour        text not null default '#1f6feb'
                check (colour ~ '^#[0-9a-fA-F]{6}$'),
  display_order integer not null default 0,
  active        boolean not null default true,
  unique (event_id, name)
);

create table public.clubs (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 120)
);

create table public.athletes (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code ~ '^HA-[0-9]{4,6}$'),
  first_name text not null check (char_length(first_name) between 1 and 60),
  last_name  text not null check (char_length(last_name) between 1 and 60),
  club_id    uuid references public.clubs (id) on delete set null,
  age_band   text check (age_band in ('under_18', '18_plus')),
  created_at timestamptz not null default now()
);

create table public.staff (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 80),
  role         text not null
               check (role in ('organiser', 'receptionist', 'station_lead', 'display')),
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

create table public.station_leads (
  event_id   uuid not null references public.events (id) on delete cascade,
  station_id uuid not null references public.stations (id) on delete cascade,
  staff_id   uuid not null references public.staff (id) on delete cascade,
  primary key (event_id, station_id, staff_id)
);

create table public.checkins (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events (id) on delete cascade,
  athlete_id    uuid not null references public.athletes (id) on delete cascade,
  checked_in_at timestamptz not null default now(),
  checked_in_by uuid references public.staff (id) on delete set null,
  unique (event_id, athlete_id)
);

create table public.station_visits (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events (id) on delete cascade,
  station_id   uuid not null references public.stations (id) on delete cascade,
  athlete_id   uuid not null references public.athletes (id) on delete cascade,
  status       text not null default 'queued'
               check (status in ('queued', 'called', 'in_station', 'done', 'skipped')),
  skip_reason  text
               check (skip_reason in ('not_present', 'declined', 'time_ran_out')),
  queue_position integer,
  recall_count integer not null default 0 check (recall_count >= 0),
  queued_at    timestamptz not null default now(),
  called_at    timestamptz,
  started_at   timestamptz,
  finished_at  timestamptz,
  updated_by   uuid references public.staff (id) on delete set null,
  unique (event_id, station_id, athlete_id),
  -- A skip reason is required when skipped and forbidden otherwise.
  check ((status = 'skipped') = (skip_reason is not null))
);

-- An athlete can be called to (or be inside) only one station at a time.
create unique index station_visits_one_active_call
  on public.station_visits (event_id, athlete_id)
  where status in ('called', 'in_station');

create index station_visits_queue
  on public.station_visits (station_id, status, queue_position, queued_at);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  staff_id   uuid references public.staff (id) on delete set null,
  action     text not null check (action in ('insert', 'update', 'delete', 'export')),
  table_name text not null,
  row_id     uuid,
  at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Role helpers (security definer so policies can read staff without recursion)
-- ---------------------------------------------------------------------------

create function public.current_staff_id() returns uuid
  language sql stable security definer set search_path = public
as $$
  select id from public.staff where auth_user_id = auth.uid() and active
$$;

create function public.current_staff_role() returns text
  language sql stable security definer set search_path = public
as $$
  select role from public.staff where auth_user_id = auth.uid() and active
$$;

create function public.has_role(variadic roles text[]) returns boolean
  language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_staff_role() = any (roles), false)
$$;

-- Stations the current user leads (any event).
create function public.led_station_ids() returns setof uuid
  language sql stable security definer set search_path = public
as $$
  select sl.station_id
  from public.station_leads sl
  where sl.staff_id = public.current_staff_id()
    and public.current_staff_role() = 'station_lead'
$$;

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Station leads may only change call-up fields, never which athlete,
-- station or event a visit belongs to.
create function public.station_visits_guard() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if public.current_staff_role() = 'station_lead' then
    if new.event_id <> old.event_id
       or new.station_id <> old.station_id
       or new.athlete_id <> old.athlete_id
       or new.queued_at <> old.queued_at then
      raise exception 'station leads may only change call-up status';
    end if;
  end if;
  new.updated_by := public.current_staff_id();
  return new;
end
$$;

create trigger station_visits_guard
  before update on public.station_visits
  for each row execute function public.station_visits_guard();

-- Audit trail: who changed what, never the values themselves.
create function public.write_audit() returns trigger
  language plpgsql security definer set search_path = public
as $$
declare
  rid uuid;
begin
  if tg_op = 'DELETE' then
    rid := old.id;
  else
    rid := new.id;
  end if;
  insert into public.audit_log (staff_id, action, table_name, row_id)
  values (public.current_staff_id(), lower(tg_op), tg_table_name, rid);
  return null;
end
$$;

create trigger audit_checkins
  after insert or update or delete on public.checkins
  for each row execute function public.write_audit();
create trigger audit_station_visits
  after insert or update or delete on public.station_visits
  for each row execute function public.write_audit();
create trigger audit_athletes
  after insert or update or delete on public.athletes
  for each row execute function public.write_audit();
create trigger audit_staff
  after insert or update or delete on public.staff
  for each row execute function public.write_audit();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table public.events         enable row level security;
alter table public.stations       enable row level security;
alter table public.clubs          enable row level security;
alter table public.athletes       enable row level security;
alter table public.staff          enable row level security;
alter table public.station_leads  enable row level security;
alter table public.checkins       enable row level security;
alter table public.station_visits enable row level security;
alter table public.audit_log      enable row level security;

-- The anon key can read and write nothing.
revoke all on all tables in schema public from anon;
revoke all on all functions in schema public from anon;

-- Organisers: full control of everything except the audit log (read only).
create policy organiser_all on public.events         for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_all on public.stations       for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_all on public.clubs          for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_all on public.athletes       for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_all on public.staff          for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_all on public.station_leads  for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_all on public.checkins       for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_all on public.station_visits for all to authenticated using (public.has_role('organiser')) with check (public.has_role('organiser'));
create policy organiser_read on public.audit_log     for select to authenticated using (public.has_role('organiser'));

-- Every active staff member can see their own staff row.
create policy staff_self_read on public.staff
  for select to authenticated using (auth_user_id = auth.uid());

-- Receptionists: read structure and athletes, manage check-ins and queues.
create policy reception_read on public.events   for select to authenticated using (public.has_role('receptionist'));
create policy reception_read on public.stations for select to authenticated using (public.has_role('receptionist'));
create policy reception_read on public.clubs    for select to authenticated using (public.has_role('receptionist'));
create policy reception_read on public.athletes for select to authenticated using (public.has_role('receptionist'));
create policy reception_all on public.checkins
  for all to authenticated
  using (public.has_role('receptionist')) with check (public.has_role('receptionist'));
create policy reception_all on public.station_visits
  for all to authenticated
  using (public.has_role('receptionist')) with check (public.has_role('receptionist'));

-- Station leads: only their own station.
create policy lead_read_events on public.events
  for select to authenticated
  using (id in (select s.event_id from public.stations s where s.id in (select public.led_station_ids())));
create policy lead_read_stations on public.stations
  for select to authenticated
  using (id in (select public.led_station_ids()));
create policy lead_read_assignment on public.station_leads
  for select to authenticated
  using (staff_id = public.current_staff_id());
create policy lead_read_visits on public.station_visits
  for select to authenticated
  using (station_id in (select public.led_station_ids()));
create policy lead_update_visits on public.station_visits
  for update to authenticated
  using (station_id in (select public.led_station_ids()))
  with check (station_id in (select public.led_station_ids()));
-- Leads see only athletes queued at their station.
create policy lead_read_athletes on public.athletes
  for select to authenticated
  using (id in (select v.athlete_id from public.station_visits v
                where v.station_id in (select public.led_station_ids())));

-- Display role: no table policies at all. It reads display_feed only.

-- ---------------------------------------------------------------------------
-- Display feed: the only thing the Display account can select.
-- First name + code only. Never surname or club.
-- ---------------------------------------------------------------------------

create view public.display_feed
  with (security_barrier = true)
as
  select st.event_id,
         st.id            as station_id,
         st.name          as station_name,
         st.colour        as station_colour,
         st.display_order,
         a.code           as athlete_code,
         a.first_name,
         v.called_at
  from public.station_visits v
  join public.stations st on st.id = v.station_id
  join public.athletes a  on a.id = v.athlete_id
  where v.status = 'called'
    and public.has_role('display', 'organiser', 'receptionist', 'station_lead');

revoke all on public.display_feed from anon;
grant select on public.display_feed to authenticated;

commit;
