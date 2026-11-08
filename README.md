# Healthy Athletes call-up system

Event-day logistics for Special Olympics Malta Healthy Athletes: reception check-in, station call-up, a hall display and an organiser dashboard. **It never stores health data.** The full brief is in [HANDOFF.md](HANDOFF.md).

## Database

`supabase/migrations/` holds the Postgres schema (all in its own `healthy_athletes` schema, so it can share a Supabase project with other apps), check constraints and row-level security for the four roles (organiser, receptionist, station lead, display). The Display account can read only the `display_feed` view (station, athlete code, first name, called time).

## Tests

`tests/run.sh` creates a scratch database, applies a small Supabase stand-in and the migrations, then runs:

- `tests/sql/schema_guard.sql` fails if any column name matches the health/contact deny-list, if a text column appears that is not allow-listed, if an enum-like column lacks a check constraint, if any table has RLS off, or if a storage bucket exists.
- `tests/sql/rls_test.sql` checks what each role can and cannot see or change, using fake data only, inside a rolled-back transaction.

Run locally with a superuser connection:

```sh
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres ./tests/run.sh
```

CI runs the same script on every pull request (`.github/workflows/db-tests.yml`). Changing the deny-list or the text-column allow-list needs a reviewed PR.

**This repo is public.** Never commit real names, CSV imports, `.env` files or keys.

## Organiser screens (web/)

A static site with no build step: plain HTML and ES modules, Supabase JS from a pinned CDN URL. Every screen goes through `web/js/api.js`, so the backend can be swapped without touching the pages.

- `index.html`: sign-in. Organisers must set up an authenticator app (TOTP) the first time and enter a code on every sign-in. The database enforces this too: an organiser without MFA (`aal1`) gets no organiser rights.
- `organiser/events.html`, `organiser/event.html`: events, stations (quick-add for the Healthy Athletes disciplines, colours, order, active) and station-lead assignment; switch off an event's station-lead accounts after the event.
- `organiser/staff.html`: create Organiser, Receptionist, Station lead and Display logins with a generated password; deactivate, revoke the Display account, issue a new password.
- `organiser/athletes.html`: CSV import, athlete list, manual deletion. The CSV may only have `first_name`, `last_name`, `club`, `age_band`, `code`; any other column rejects the whole file, in the browser and again in the database (`import_athletes`). The file is read in the browser and never uploaded.

Run locally: set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `web/config.js` (the publishable key only, never the service-role key), then `python3 -m http.server -d web 8000`.

### Supabase setup

1. Apply the migrations in `supabase/migrations/` in order.
2. Add `healthy_athletes` to *Project Settings → Data API → Exposed schemas*.
3. Deploy `supabase/functions/staff-admin` (it creates logins with the service-role key, which never reaches the browser). Optionally set its `ALLOWED_ORIGIN` secret to the site's URL.
4. Create the first organiser by hand: add a user under *Authentication → Users*, then
   `insert into healthy_athletes.staff (auth_user_id, name, role) values ('<user id>', '<name>', 'organiser');`
   They set up MFA on first sign-in; every other account is created from the Staff screen.
5. Turn on leaked-password protection under *Authentication → Settings*.

`node --test 'tests/web/*.test.mjs'` runs the CSV import tests.
