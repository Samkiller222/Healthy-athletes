// Data-access layer. Every screen talks to the backend only through these
// functions, so the backend (currently Supabase) can be swapped without
// touching the pages. Each function throws an Error with a readable message.

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DB_SCHEMA } from "../config.js";

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

const sb = configured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { db: { schema: DB_SCHEMA } })
  : null;

function need() {
  if (!sb) throw new Error("The app is not connected to a database yet (see web/config.js).");
  return sb;
}

function check({ data, error }) {
  if (error) throw new Error(error.message || String(error));
  return data;
}

// --- Sign-in and MFA -------------------------------------------------------

export async function signIn(email, password) {
  check(await need().auth.signInWithPassword({ email, password }));
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

/** The signed-in staff member ({ id, name, role, active }) or null. */
export async function currentStaff() {
  const { data: { session } } = await need().auth.getSession();
  if (!session) return null;
  const rows = check(await sb.from("staff")
    .select("id, name, role, active")
    .eq("auth_user_id", session.user.id)
    .eq("active", true));
  return rows[0] ?? null;
}

/** "aal1" or "aal2" for the current session, plus whether a TOTP factor exists. */
export async function mfaStatus() {
  const aal = check(await need().auth.mfa.getAuthenticatorAssuranceLevel());
  const factors = check(await sb.auth.mfa.listFactors());
  const totp = (factors.totp ?? []).find((f) => f.status === "verified") ?? null;
  return { level: aal.currentLevel, factorId: totp?.id ?? null };
}

/** Start authenticator-app setup. Returns { factorId, qrSvg, secret }. */
export async function mfaEnrol() {
  // Clear any half-finished setup first.
  const factors = check(await need().auth.mfa.listFactors());
  for (const f of factors.all ?? []) {
    if (f.status !== "verified") await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const d = check(await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: "Healthy Athletes" }));
  return { factorId: d.id, qrSvg: d.totp.qr_code, secret: d.totp.secret };
}

export async function mfaVerify(factorId, code) {
  check(await need().auth.mfa.challengeAndVerify({ factorId, code }));
}

// --- Events ----------------------------------------------------------------

export async function listEvents() {
  return check(await need().from("events").select("*").order("date", { ascending: false }));
}
export async function getEvent(id) {
  return check(await need().from("events").select("*").eq("id", id).single());
}
export async function createEvent(e) {
  return check(await need().from("events").insert(e).select().single());
}
export async function updateEvent(id, patch) {
  return check(await need().from("events").update(patch).eq("id", id).select().single());
}
/** Deletes the event with its stations, check-ins and queues (athletes stay). */
export async function deleteEvent(id) {
  check(await need().from("events").delete().eq("id", id));
}

// --- Stations and leads ----------------------------------------------------

export async function listStations(eventId) {
  return check(await need().from("stations").select("*").eq("event_id", eventId)
    .order("display_order").order("name"));
}
export async function createStation(s) {
  return check(await need().from("stations").insert(s).select().single());
}
export async function updateStation(id, patch) {
  return check(await need().from("stations").update(patch).eq("id", id).select().single());
}
export async function deleteStation(id) {
  check(await need().from("stations").delete().eq("id", id));
}
export async function listLeads(eventId) {
  return check(await need().from("station_leads").select("station_id, staff_id").eq("event_id", eventId));
}
/** Make staffId the (only) lead of stationId at this event; null clears it. */
export async function setLead(eventId, stationId, staffId) {
  check(await need().from("station_leads").delete().eq("event_id", eventId).eq("station_id", stationId));
  if (staffId) {
    check(await sb.from("station_leads").delete().eq("event_id", eventId).eq("staff_id", staffId));
    check(await sb.from("station_leads").insert({ event_id: eventId, station_id: stationId, staff_id: staffId }));
  }
}

// --- Staff (logins are managed by the staff-admin server function) ---------

async function staffAdmin(body) {
  const { data, error } = await need().functions.invoke("staff-admin", { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error ?? msg; } catch { /* keep msg */ }
    throw new Error(msg);
  }
  return data;
}
export async function listStaff() { return (await staffAdmin({ action: "list" })).staff; }
export async function createStaff(s) { return (await staffAdmin({ action: "create", ...s })).staff; }
export async function setStaffActive(staffId, active) { await staffAdmin({ action: "set_active", staff_id: staffId, active }); }
export async function setStaffPassword(staffId, password) { await staffAdmin({ action: "set_password", staff_id: staffId, password }); }

// --- Athletes --------------------------------------------------------------

export async function listClubs() {
  return check(await need().from("clubs").select("id, name").order("name"));
}

/** Page through athletes, optionally filtered by name, code or club. */
export async function listAthletes({ search = "", offset = 0, limit = 50 } = {}) {
  let q = need().from("athletes")
    .select("id, code, first_name, last_name, age_band, clubs(name)", { count: "exact" })
    .order("code").range(offset, offset + limit - 1);
  const s = search.trim().replace(/[%_,()]/g, " ").trim();
  if (s) q = q.or(`code.ilike.%${s}%,first_name.ilike.%${s}%,last_name.ilike.%${s}%`);
  const { data, error, count } = await q;
  if (error) throw new Error(error.message);
  return { rows: data, total: count ?? 0 };
}

/** Rows: [{ first_name, last_name, club?, age_band?, code? }]. Returns { inserted, skipped }. */
export async function importAthletes(rows) {
  return check(await need().rpc("import_athletes", { rows }));
}
export async function deleteAthlete(id) {
  check(await need().from("athletes").delete().eq("id", id));
}
/** Manual data deletion after an event: removes every athlete (and their queues). */
export async function deleteAllAthletes() {
  check(await need().from("athletes").delete().not("id", "is", null));
}
