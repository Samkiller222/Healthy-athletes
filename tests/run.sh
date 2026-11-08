#!/usr/bin/env bash
# Apply the Neon stub + all migrations to a scratch Postgres database,
# then run the schema guard and RLS tests.
# Needs psql and a superuser connection via the usual PG* env vars.
set -euo pipefail
cd "$(dirname "$0")/.."

DB="${TEST_DB:-healthy_athletes_test}"
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"

run() { psql -v ON_ERROR_STOP=1 -q -X -o /dev/null -d "$DB" -f "$1"; }

run tests/sql/neon_stub.sql
for f in db/migrations/*.sql; do
  echo "applying $f"
  run "$f"
done
run tests/sql/schema_guard.sql && echo "schema guard passed"
run tests/sql/rls_test.sql && echo "rls tests passed"
run tests/sql/organiser_test.sql && echo "organiser tests passed"
run tests/sql/display_test.sql && echo "display tests passed"
