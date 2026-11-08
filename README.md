# Healthy Athletes call-up system

Event-day logistics for Special Olympics Malta Healthy Athletes: reception check-in, station call-up, a hall display and an organiser dashboard. **It never stores health data.** The full brief is in [HANDOFF.md](HANDOFF.md).

## Database

`supabase/migrations/` holds the Postgres schema, check constraints and row-level security for the four roles (organiser, receptionist, station lead, display). The Display account can read only the `display_feed` view (station, athlete code, first name, called time).

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
