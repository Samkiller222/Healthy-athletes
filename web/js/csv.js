// CSV parsing and validation for the athlete import. Pure functions, no DOM,
// so they can be unit-tested with `node --test`.
//
// Only these columns are accepted. Any other column (for example a medical
// notes column left in a spreadsheet) rejects the whole file: the app must
// never receive health data.

export const COLUMNS = ["first_name", "last_name", "club", "age_band", "code"];
export const MAX_ROWS = 2000;

const ALIASES = {
  first_name: "first_name", firstname: "first_name", first: "first_name", name: "first_name",
  last_name: "last_name", lastname: "last_name", surname: "last_name", last: "last_name", family_name: "last_name",
  club: "club", delegation: "club", club_delegation: "club", team: "club",
  age_band: "age_band", ageband: "age_band", age_group: "age_band",
  code: "code", athlete_code: "code",
};

/** Split CSV text into rows of strings. Handles quotes, "" escapes, CRLF and a BOM. */
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") {
      quoted = true;
    } else if (c === delim) {
      row.push(field); field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("The file has an unclosed quote.");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export function normaliseHeader(h) {
  const key = h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return ALIASES[key] ?? null;
}

export function normaliseAgeBand(v) {
  const s = v.trim().toLowerCase();
  if (s === "") return "";
  if (["under_18", "under 18", "u18", "<18"].includes(s)) return "under_18";
  if (["18_plus", "18+", "18 plus", "adult"].includes(s)) return "18_plus";
  return null;
}

/**
 * Validate parsed rows. Returns { rows, errors, fileError }.
 * rows: [{ line, data: {first_name, ...} }] ready to send; errors: [{ line, message }].
 */
export function validate(table) {
  if (table.length === 0) return { rows: [], errors: [], fileError: "The file is empty." };
  const header = table[0];
  const cols = header.map(normaliseHeader);
  const unknown = header.filter((h, i) => cols[i] === null && h.trim() !== "");
  if (unknown.length) {
    return {
      rows: [], errors: [],
      fileError: `Unknown column(s): ${unknown.join(", ")}. Only ${COLUMNS.join(", ")} are allowed. ` +
        "Remove the other columns and try again. Never import health information.",
    };
  }
  const dupes = cols.filter((c, i) => c && cols.indexOf(c) !== i);
  if (dupes.length) return { rows: [], errors: [], fileError: `Column appears twice: ${[...new Set(dupes)].join(", ")}.` };
  for (const req of ["first_name", "last_name"]) {
    if (!cols.includes(req)) return { rows: [], errors: [], fileError: `Missing required column: ${req}.` };
  }
  if (table.length - 1 > MAX_ROWS) {
    return { rows: [], errors: [], fileError: `Too many rows (${table.length - 1}). At most ${MAX_ROWS} per import.` };
  }

  const rows = [];
  const errors = [];
  const seenCodes = new Set();
  table.slice(1).forEach((cells, idx) => {
    const line = idx + 2;
    if (cells.length > header.length && cells.slice(header.length).some((v) => v.trim() !== "")) {
      errors.push({ line, message: "has more values than there are columns" });
      return;
    }
    const data = {};
    cols.forEach((c, i) => { if (c) data[c] = (cells[i] ?? "").trim(); });
    const problems = [];
    if (!data.first_name) problems.push("first name is missing");
    if (!data.last_name) problems.push("last name is missing");
    if ((data.first_name ?? "").length > 60 || (data.last_name ?? "").length > 60) problems.push("a name is longer than 60 characters");
    if ((data.club ?? "").length > 120) problems.push("club is longer than 120 characters");
    if ("age_band" in data) {
      const band = normaliseAgeBand(data.age_band);
      if (band === null) problems.push(`age band "${data.age_band}" must be under_18, 18_plus or empty`);
      else data.age_band = band;
    }
    if (data.code) {
      data.code = data.code.toUpperCase();
      if (!/^HA-[0-9]{4,6}$/.test(data.code)) problems.push(`code "${data.code}" must look like HA-0123`);
      else if (seenCodes.has(data.code)) problems.push(`code ${data.code} appears twice in the file`);
      seenCodes.add(data.code);
    }
    if (problems.length) errors.push({ line, message: problems.join("; ") });
    else rows.push({ line, data });
  });
  return { rows, errors, fileError: null };
}
