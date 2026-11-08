// Unit tests for the athlete CSV import. Run: node --test tests/web
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, validate } from "../../web/js/csv.js";

test("parses quotes, escaped quotes, CRLF and a BOM", () => {
  const rows = parseCsv('﻿first_name,last_name,club\r\n"Ann, Jr","O""Neil","Club\nA"\r\n\r\n');
  assert.deepEqual(rows, [["first_name", "last_name", "club"], ["Ann, Jr", 'O"Neil', "Club\nA"]]);
});

test("detects semicolon-separated files", () => {
  assert.deepEqual(parseCsv("first_name;last_name\nA;B"), [["first_name", "last_name"], ["A", "B"]]);
});

test("rejects an unclosed quote", () => {
  assert.throws(() => parseCsv('first_name\n"A'), /unclosed quote/);
});

test("accepts friendly header names", () => {
  const r = validate(parseCsv("First Name,Surname,Delegation,Age band,Athlete code\nA,B,C,18+,ha-0001"));
  assert.equal(r.fileError, null);
  assert.deepEqual(r.rows[0].data, { first_name: "A", last_name: "B", club: "C", age_band: "18_plus", code: "HA-0001" });
});

test("rejects any unknown column, so health data cannot come in", () => {
  for (const col of ["Medical notes", "DOB", "Allergies", "phone", "x"]) {
    const r = validate(parseCsv(`first_name,last_name,${col}\nA,B,something`));
    assert.match(r.fileError, /Unknown column/, col);
    assert.equal(r.rows.length, 0);
  }
});

test("requires first and last name columns", () => {
  assert.match(validate(parseCsv("first_name,club\nA,B")).fileError, /last_name/);
});

test("rejects duplicate columns", () => {
  assert.match(validate(parseCsv("first_name,last_name,surname\nA,B,C")).fileError, /twice/);
});

test("reports bad rows with their line numbers", () => {
  const r = validate(parseCsv([
    "first_name,last_name,age_band,code",
    "Good,Row,,",
    ",Missing,,",
    "Bad,Band,1990-01-01,",
    "Bad,Code,,X-1",
    "Dup,One,,HA-0005",
    "Dup,Two,,HA-0005",
    "Too,Many,,,extra",
  ].join("\n")));
  assert.equal(r.fileError, null);
  assert.deepEqual(r.rows.map((x) => x.line), [2, 6]);
  assert.deepEqual(r.errors.map((e) => e.line), [3, 4, 5, 7, 8]);
  assert.match(r.errors[0].message, /first name is missing/);
  assert.match(r.errors[3].message, /appears twice/);
});

test("empty file and too many rows", () => {
  assert.match(validate([]).fileError, /empty/);
  const big = ["first_name,last_name", ...Array.from({ length: 2001 }, (_, i) => `A${i},B`)].join("\n");
  assert.match(validate(parseCsv(big)).fileError, /Too many rows/);
});
