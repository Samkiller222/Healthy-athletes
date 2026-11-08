-- Schema guard: fails if the database could hold health or contact data.
-- See HANDOFF.md section 2. Changing these lists needs a reviewed PR.

\set ON_ERROR_STOP 1

do $$
declare
  -- Column names that suggest health, contact or free-text data.
  deny constant text := 'diagnos|condition|medic|result|score|referr|allerg|note|comment|dob|birth|disab|phone|email|health|support|mobility|photo|file|upload';
  bad text;
begin
  select string_agg(format('%s.%s', table_name, column_name), ', ')
    into bad
  from information_schema.columns
  where table_schema = 'healthy_athletes'
    and column_name ~* deny;

  if bad is not null then
    raise exception 'schema guard: forbidden column name(s): %', bad;
  end if;
end $$;

-- Text columns are allowed only where listed here. Anything else is a
-- potential free-text field that would fill up with health details.
do $$
declare
  bad text;
begin
  select string_agg(format('%s.%s', c.table_name, c.column_name), ', ')
    into bad
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'healthy_athletes'
    and t.table_type = 'BASE TABLE'
    and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'bytea')
    and format('%s.%s', c.table_name, c.column_name) not in (
      'events.name', 'events.venue', 'events.status',
      'stations.name', 'stations.colour', 'stations.icon', 'stations.subtitle',
      'clubs.name',
      'athletes.code', 'athletes.first_name', 'athletes.last_name', 'athletes.age_band',
      'staff.name', 'staff.role',
      'station_visits.status', 'station_visits.skip_reason',
      'audit_log.action', 'audit_log.table_name'
    );

  if bad is not null then
    raise exception 'schema guard: unexpected text/blob column(s): % (add a check constraint and allow-list it in a reviewed PR)', bad;
  end if;
end $$;

-- Every enum-like text column must carry a check constraint.
do $$
declare
  col text;
  missing text := '';
begin
  foreach col in array array[
    'events.status', 'stations.colour', 'stations.icon', 'stations.subtitle', 'athletes.code', 'athletes.age_band',
    'staff.role', 'station_visits.status', 'station_visits.skip_reason',
    'audit_log.action'
  ] loop
    if not exists (
      select 1
      from information_schema.constraint_column_usage ccu
      join information_schema.check_constraints cc
        on cc.constraint_name = ccu.constraint_name
       and cc.constraint_schema = ccu.constraint_schema
      where ccu.table_schema = 'healthy_athletes'
        and format('%s.%s', ccu.table_name, ccu.column_name) = col
    ) then
      missing := missing || col || ' ';
    end if;
  end loop;

  if missing <> '' then
    raise exception 'schema guard: missing check constraint on: %', missing;
  end if;
end $$;

-- Every healthy_athletes table must have RLS on.
do $$
declare
  bad text;
begin
  select string_agg(relname, ', ') into bad
  from pg_class
  where relnamespace = 'healthy_athletes'::regnamespace
    and relkind = 'r'
    and not relrowsecurity;

  if bad is not null then
    raise exception 'schema guard: RLS disabled on: %', bad;
  end if;
end $$;

-- No storage buckets: the app must not accept file uploads.
do $$
declare
  has_bucket boolean := false;
begin
  if to_regclass('storage.buckets') is not null then
    execute 'select exists (select 1 from storage.buckets)' into has_bucket;
    if has_bucket then
      raise exception 'schema guard: storage buckets exist; uploads are not allowed';
    end if;
  end if;
end $$;

select 'schema guard passed' as result_message;
