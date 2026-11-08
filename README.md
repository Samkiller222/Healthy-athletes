# Healthy Athletes call-up system

Event-day logistics for Special Olympics Malta Healthy Athletes: reception check-in, station call-up, a hall display and an organiser dashboard. **It never stores health data.** The full brief is in [HANDOFF.md](HANDOFF.md).

## Database

`db/migrations/` holds the Postgres schema (all in its own `healthy_athletes` schema), runs on Neon (Frankfurt), and holds the, check constraints and row-level security for the four roles (organiser, receptionist, station lead, display). The Display account has no table access: it reads only the `display_feed` view and the `display_board()` function, which give first name + athlete code, never surname or club.

## Tests

`tests/run.sh` creates a scratch database, applies a small stand-in for Neon's auth functions and API roles, then the migrations, then runs:

- `tests/sql/schema_guard.sql` fails if any column name matches the health/contact deny-list, if a text column appears that is not allow-listed, if an enum-like column lacks a check constraint, if any table has RLS off, or if a storage bucket exists.
- `tests/sql/rls_test.sql` checks what each role can and cannot see or change, using fake data only, inside a rolled-back transaction.

Run locally with a superuser connection:

```sh
PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres ./tests/run.sh
```

CI runs the same script on every pull request (`.github/workflows/db-tests.yml`). Changing the deny-list or the text-column allow-list needs a reviewed PR.

**This repo is public.** Never commit real names, CSV imports, `.env` files or keys.

## Organiser screens (web/)

A static site with no build step: plain HTML and ES modules. Every screen goes through `web/js/api.js`, so the backend can be swapped without touching the pages. The Neon SDK (`@neon/neon-js`) is vendored as one file in `web/vendor/`; `scripts/vendor-neon.sh` rebuilds it.

- `index.html`: sign-in with email and password (Neon Auth).
- `organiser/events.html`, `organiser/event.html`: events, stations (quick-add for the Healthy Athletes disciplines, colours, order, active) and station-lead assignment; switch off an event's station-lead accounts after the event.
- `organiser/staff.html`: create Organiser, Receptionist, Station lead and Display logins with a generated password; deactivate (blocks sign-in and ends sessions), revoke the Display account, issue a new password.
- `organiser/athletes.html`: CSV import, athlete list, manual deletion. The CSV may only have `first_name`, `last_name`, `club`, `age_band`, `code`; any other column rejects the whole file, in the browser and again in the database (`import_athletes`). The file is read in the browser and never uploaded.

Run locally: `python3 -m http.server -d web 8000` (Neon Auth allows localhost). `web/config.js` holds the public Neon Auth and Data API URLs, never a connection string.

## Hall TV display (web/display/)

`display/index.html` is the full-screen call-up board for the hall TV. The Display account lands on it after signing in.

- Left, **Calling now**: everyone currently called, newest first and largest, with the station's icon and colour.
- Right, one row per active station: icon, name and TV subtitle, who is **next**, how many are **in queue**, and an estimated **wait** (queue length x the station's average minutes per athlete over its last 10 finished visits, or the organiser's "minutes per athlete" until there are any).
- Athletes appear by **first name + athlete code only**, never surname or club.
- Data comes from one database function, `display_board()`, polled every 3 seconds. It shows the event marked **Live** (or `?event=<id>`). A yellow "Reconnecting" banner appears if the connection drops; the clock follows the server's time (Malta time).
- A soft chime plays on each new call once someone clicks **Turn on call chime** (browsers block sound until a click). In kiosk mode start Chrome with `--kiosk --autoplay-policy=no-user-gesture-required` and no click is needed.
- `display/index.html?demo` shows made-up data with no sign-in, to check the layout on the TV.

Stations are set up per event on the event page: name, TV subtitle, icon (fixed list), colour, order and minutes per athlete.

### Backend: Neon

- **Neon Auth** (managed Better Auth) signs staff in. Public sign-up is off; logins are created from the Staff screen with Better Auth's admin API. Organisers get the Neon Auth `admin` role (needed for that API); nobody else does.
- **Neon Data API** exposes only the `healthy_athletes` schema, as the `authenticated` role, and RLS decides the rows. Signed-out requests (`anonymous`) get nothing.
- Neon's `auth` schema is not readable by the API roles, so the migrations reach `auth.uid()` / `auth.jwt()` only through security definer functions (`current_user_id()`, `current_aal()`). The test stub copies this restriction.
- **MFA for organisers is off for now**: Neon Auth has no MFA yet. When it does, a migration making `organiser_mfa_required()` return true makes the database refuse organiser rights without a second factor (already tested).

Setting up a fresh Neon project:

1. Turn on Neon Auth, then the Data API with `db_schemas = healthy_athletes`.
2. Apply `db/migrations/` in order.
3. In Neon Auth, turn off sign-up and add the site's URL to the trusted domains.
4. Create the first organiser: create the user in Neon Auth, give them the `admin` role, then
   `insert into healthy_athletes.staff (auth_user_id, name, role) values ('<user id>', '<name>', 'organiser');`
   Every other account is created from the Staff screen.

`node --test 'tests/web/*.test.mjs'` runs the CSV import tests.
