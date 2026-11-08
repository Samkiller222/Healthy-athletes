-- TV call-up display (HANDOFF build step 3, section 4.3).
--
-- Stations get an icon, a short subtitle and a typical minutes-per-athlete
-- so the hall display can show each station's icon, who is next, how many
-- are queued and an estimated wait. display_board() returns everything the
-- TV needs in one call. Athletes appear by full name + athlete code (Sam's
-- decision, 2026-11-08, matching the hall layout he chose); never club or
-- anything else about the athlete.
--
-- LOGISTICS ONLY. No health data. See HANDOFF.md section 2.

begin;

-- ---------------------------------------------------------------------------
-- Station appearance. Icons come from a fixed list so the TV can draw them
-- without loading anything; the subtitle is a short public label such as
-- "Vision" (it describes the station, never an athlete).
-- ---------------------------------------------------------------------------

alter table healthy_athletes.stations
  add column icon text not null default 'star'
    check (icon in ('eye', 'tooth', 'ear', 'foot', 'heart', 'run', 'mind',
                    'apple', 'stethoscope', 'star')),
  add column subtitle text
    check (char_length(subtitle) between 1 and 60),
  add column minutes_per_athlete integer not null default 10
    check (minutes_per_athlete between 1 and 120);

-- ---------------------------------------------------------------------------
-- display_board(event_id)
--
-- One JSON document for the TV:
--   event     { id, name }
--   calls     athletes currently called, newest first (max 6):
--             { first_name, last_name, athlete_code, station_id, called_at }
--   stations  every active station in display order:
--             { id, name, subtitle, icon, colour, queued, wait_minutes,
--               next: { first_name, last_name, athlete_code } | null }
--   now       server time, so the TV clock can't drift far
--
-- With no event id it picks today's live event (or the latest live one).
-- Readable by every active staff role, including Display. Security definer
-- because Display has no table access at all: this function is its only
-- window, and it only ever hands out name + code.
--
-- Estimated wait = people queued x average minutes per athlete, where the
-- average is taken from the station's last 10 finished visits at this event
-- (called -> done), or the station's minutes_per_athlete before any have
-- finished.
-- ---------------------------------------------------------------------------

create function healthy_athletes.display_board(p_event_id uuid default null)
  returns jsonb
  language plpgsql stable security definer set search_path = healthy_athletes, pg_temp
as $$
declare
  ev healthy_athletes.events;
begin
  if not healthy_athletes.has_role('display', 'organiser', 'receptionist', 'station_lead') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_event_id is null then
    select * into ev from healthy_athletes.events
    where status = 'live'
    order by (date = current_date) desc, date desc, created_at desc
    limit 1;
  else
    select * into ev from healthy_athletes.events where id = p_event_id;
  end if;

  if ev.id is null then
    return jsonb_build_object('event', null, 'calls', '[]'::jsonb,
                              'stations', '[]'::jsonb, 'now', now());
  end if;

  return jsonb_build_object(
    'event', jsonb_build_object('id', ev.id, 'name', ev.name),
    'now', now(),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object(
               'first_name', c.first_name,
               'last_name', c.last_name,
               'athlete_code', c.code,
               'station_id', c.station_id,
               'called_at', c.called_at) order by c.called_at desc)
      from (
        select a.first_name, a.last_name, a.code, v.station_id, v.called_at
        from healthy_athletes.station_visits v
        join healthy_athletes.athletes a on a.id = v.athlete_id
        join healthy_athletes.stations st on st.id = v.station_id
        where v.event_id = ev.id and v.status = 'called' and st.active
        order by v.called_at desc nulls last
        limit 6
      ) c), '[]'::jsonb),
    'stations', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', st.id,
               'name', st.name,
               'subtitle', st.subtitle,
               'icon', st.icon,
               'colour', st.colour,
               'queued', q.queued,
               'wait_minutes', case when q.queued = 0 then null
                                    else ceil(q.queued * coalesce(avg_min.m, st.minutes_per_athlete))::int end,
               'next', nx.next) order by st.display_order, st.name)
      from healthy_athletes.stations st
      cross join lateral (
        select count(*)::int as queued
        from healthy_athletes.station_visits v
        where v.station_id = st.id and v.event_id = ev.id and v.status = 'queued'
      ) q
      cross join lateral (
        select avg(extract(epoch from (d.finished_at - d.called_at)) / 60.0) as m
        from (
          select v.finished_at, v.called_at
          from healthy_athletes.station_visits v
          where v.station_id = st.id and v.event_id = ev.id and v.status = 'done'
            and v.called_at is not null and v.finished_at > v.called_at
          order by v.finished_at desc
          limit 10
        ) d
      ) avg_min
      left join lateral (
        select jsonb_build_object('first_name', a.first_name, 'last_name', a.last_name, 'athlete_code', a.code) as next
        from healthy_athletes.station_visits v
        join healthy_athletes.athletes a on a.id = v.athlete_id
        where v.station_id = st.id and v.event_id = ev.id and v.status = 'queued'
        order by v.queue_position nulls last, v.queued_at
        limit 1
      ) nx on true
      where st.event_id = ev.id and st.active), '[]'::jsonb));
end
$$;

revoke all on function healthy_athletes.display_board(uuid) from public, anonymous;
grant execute on function healthy_athletes.display_board(uuid) to authenticated;

commit;
