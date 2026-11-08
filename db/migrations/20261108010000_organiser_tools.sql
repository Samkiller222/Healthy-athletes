-- Organiser tools: MFA enforcement, athlete codes, CSV import, staff and
-- station-lead safeguards.
--
-- LOGISTICS ONLY. No health data. See HANDOFF.md section 2.

begin;

-- ---------------------------------------------------------------------------
-- MFA for organisers (HANDOFF section 3)
-- Neon Auth has no MFA yet (on its roadmap), so for now Sam decided organisers
-- sign in with a password only (2026-11-08). The check is built in and
-- switched off: once Neon Auth puts an assurance level ('aal') in its JWT,
-- a migration that makes organiser_mfa_required() return true turns it on,
-- and organisers without a second factor then get no organiser rights.
-- ---------------------------------------------------------------------------

create function healthy_athletes.organiser_mfa_required() returns boolean
  language sql stable
as $$
  select false
$$;

create function healthy_athletes.current_aal() returns text
  language sql stable security definer set search_path = healthy_athletes, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;

create or replace function healthy_athletes.has_role(variadic roles text[]) returns boolean
  language sql stable security definer set search_path = healthy_athletes, pg_temp
as $$
  select coalesce(
           s.r = any (roles)
           and (s.r <> 'organiser'
                or not healthy_athletes.organiser_mfa_required()
                or healthy_athletes.current_aal() = 'aal2'),
           false)
  from (select healthy_athletes.current_staff_role() as r) s
$$;

-- Non-variadic wrapper, easy to call over the API (edge function, UI).
create function healthy_athletes.is_organiser() returns boolean
  language sql stable security definer set search_path = healthy_athletes, pg_temp
as $$
  select healthy_athletes.has_role('organiser')
$$;

-- ---------------------------------------------------------------------------
-- Athlete codes: HA-0001, HA-0002, ... generated when none is given.
-- ---------------------------------------------------------------------------

create sequence healthy_athletes.athlete_code_seq;

create function healthy_athletes.next_athlete_code() returns text
  language plpgsql volatile security definer set search_path = healthy_athletes, pg_temp
as $$
declare
  n bigint;
  c text;
begin
  loop
    n := nextval('healthy_athletes.athlete_code_seq');
    if n > 999999 then
      raise exception 'athlete codes exhausted';
    end if;
    c := 'HA-' || lpad(n::text, greatest(4, length(n::text)), '0');
    exit when not exists (select 1 from healthy_athletes.athletes where code = c);
  end loop;
  return c;
end
$$;

alter table healthy_athletes.athletes alter column code set default healthy_athletes.next_athlete_code();

-- ---------------------------------------------------------------------------
-- Athlete CSV import. The browser parses the CSV and sends the rows as JSON.
-- Runs with the caller's rights (RLS applies). Rejects unknown columns, so a
-- spreadsheet with extra columns (e.g. medical notes) cannot be imported.
-- All or nothing: any bad row aborts the whole import.
-- ---------------------------------------------------------------------------

create function healthy_athletes.import_athletes(rows jsonb) returns jsonb
  language plpgsql volatile security invoker set search_path = healthy_athletes, pg_temp
as $$
declare
  allowed constant text[] := array['first_name', 'last_name', 'club', 'age_band', 'code'];
  r        jsonb;
  i        integer := 0;
  bad      text;
  v_first  text;
  v_last   text;
  v_club   text;
  v_band   text;
  v_code   text;
  v_club_id uuid;
  n_inserted integer := 0;
  n_skipped  integer := 0;
begin
  if not healthy_athletes.has_role('organiser') then
    raise exception 'only organisers can import athletes' using errcode = '42501';
  end if;
  if rows is null or jsonb_typeof(rows) <> 'array' then
    raise exception 'expected a list of rows';
  end if;
  if jsonb_array_length(rows) > 2000 then
    raise exception 'too many rows (at most 2000 per import)';
  end if;

  for r in select value from jsonb_array_elements(rows) loop
    i := i + 1;
    if jsonb_typeof(r) <> 'object' then
      raise exception 'row %: not a row object', i;
    end if;

    select string_agg(k, ', ') into bad
    from jsonb_object_keys(r) k
    where k <> all (allowed);
    if bad is not null then
      raise exception 'row %: unknown column(s): %', i, bad;
    end if;

    select string_agg(key, ', ') into bad
    from jsonb_each(r)
    where jsonb_typeof(value) not in ('string', 'null');
    if bad is not null then
      raise exception 'row %: values must be text: %', i, bad;
    end if;

    v_first := nullif(btrim(r ->> 'first_name'), '');
    v_last  := nullif(btrim(r ->> 'last_name'), '');
    v_club  := nullif(btrim(r ->> 'club'), '');
    v_code  := upper(nullif(btrim(r ->> 'code'), ''));
    v_band  := lower(coalesce(btrim(r ->> 'age_band'), ''));

    if v_first is null or v_last is null then
      raise exception 'row %: first_name and last_name are required', i;
    end if;
    if char_length(v_first) > 60 or char_length(v_last) > 60 then
      raise exception 'row %: names must be 60 characters or fewer', i;
    end if;
    if v_club is not null and char_length(v_club) > 120 then
      raise exception 'row %: club must be 120 characters or fewer', i;
    end if;

    if v_band = '' then
      v_band := null;
    elsif v_band in ('under_18', 'under 18', 'u18', '<18') then
      v_band := 'under_18';
    elsif v_band in ('18_plus', '18+', '18 plus', 'adult') then
      v_band := '18_plus';
    else
      raise exception 'row %: age_band must be under_18, 18_plus or empty', i;
    end if;

    if v_code is not null then
      if v_code !~ '^HA-[0-9]{4,6}$' then
        raise exception 'row %: code must look like HA-0123', i;
      end if;
      if exists (select 1 from healthy_athletes.athletes where code = v_code) then
        raise exception 'row %: code % is already used', i, v_code;
      end if;
    end if;

    v_club_id := null;
    if v_club is not null then
      select id into v_club_id from healthy_athletes.clubs where lower(name) = lower(v_club);
      if v_club_id is null then
        insert into healthy_athletes.clubs (name) values (v_club) returning id into v_club_id;
      end if;
    end if;

    -- Same name in the same club without a code: treat as already imported.
    if v_code is null and exists (
      select 1 from healthy_athletes.athletes a
      where lower(a.first_name) = lower(v_first)
        and lower(a.last_name) = lower(v_last)
        and a.club_id is not distinct from v_club_id
    ) then
      n_skipped := n_skipped + 1;
      continue;
    end if;

    insert into healthy_athletes.athletes (code, first_name, last_name, club_id, age_band)
    values (coalesce(v_code, healthy_athletes.next_athlete_code()), v_first, v_last, v_club_id, v_band);
    n_inserted := n_inserted + 1;
  end loop;

  return jsonb_build_object('inserted', n_inserted, 'skipped', n_skipped);
end
$$;

-- ---------------------------------------------------------------------------
-- Staff safeguards
-- ---------------------------------------------------------------------------

-- Never lock everyone out: keep at least one active organiser.
create function healthy_athletes.staff_keep_one_organiser() returns trigger
  language plpgsql security definer set search_path = healthy_athletes, pg_temp
as $$
begin
  if old.role = 'organiser' and old.active
     and (tg_op = 'DELETE' or new.role <> 'organiser' or not new.active) then
    if not exists (select 1 from healthy_athletes.staff
                   where role = 'organiser' and active and id <> old.id) then
      raise exception 'there must always be at least one active organiser';
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger staff_keep_one_organiser
  before update or delete on healthy_athletes.staff
  for each row execute function healthy_athletes.staff_keep_one_organiser();

-- Only station-lead accounts can lead a station, the station must belong to
-- the event, and a lead runs one station per event.
create function healthy_athletes.station_leads_check() returns trigger
  language plpgsql security definer set search_path = healthy_athletes, pg_temp
as $$
begin
  if not exists (select 1 from healthy_athletes.staff where id = new.staff_id and role = 'station_lead') then
    raise exception 'only station lead accounts can be assigned to a station';
  end if;
  if not exists (select 1 from healthy_athletes.stations where id = new.station_id and event_id = new.event_id) then
    raise exception 'that station does not belong to this event';
  end if;
  return new;
end
$$;

create trigger station_leads_check
  before insert or update on healthy_athletes.station_leads
  for each row execute function healthy_athletes.station_leads_check();

alter table healthy_athletes.station_leads
  add constraint station_leads_one_station_per_event unique (event_id, staff_id);

-- Audit structural changes and deletions too.
create trigger audit_events
  after insert or update or delete on healthy_athletes.events
  for each row execute function healthy_athletes.write_audit();
create trigger audit_stations
  after insert or update or delete on healthy_athletes.stations
  for each row execute function healthy_athletes.write_audit();

-- ---------------------------------------------------------------------------
-- Function privileges: nothing for anonymous.
-- ---------------------------------------------------------------------------

revoke all on function healthy_athletes.current_aal() from public, anonymous;
revoke all on function healthy_athletes.organiser_mfa_required() from public, anonymous;
grant execute on function healthy_athletes.organiser_mfa_required() to authenticated;
revoke all on function healthy_athletes.is_organiser() from public, anonymous;
revoke all on function healthy_athletes.next_athlete_code() from public, anonymous;
revoke all on function healthy_athletes.import_athletes(jsonb) from public, anonymous;
revoke all on function healthy_athletes.staff_keep_one_organiser() from public, anonymous, authenticated;
revoke all on function healthy_athletes.station_leads_check() from public, anonymous, authenticated;
grant execute on function healthy_athletes.current_aal() to authenticated;
grant execute on function healthy_athletes.is_organiser() to authenticated;
grant execute on function healthy_athletes.import_athletes(jsonb) to authenticated;
-- Used as the athletes.code default, so inserting roles need it.
grant execute on function healthy_athletes.next_athlete_code() to authenticated;
revoke all on sequence healthy_athletes.athlete_code_seq from anonymous, authenticated;

commit;
