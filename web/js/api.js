// Data-access layer. Every screen talks to the backend only through these
// functions, so the backend can be swapped without touching the pages. Each
// function throws an Error with a readable message.
//
// Backend: Neon. Neon Auth (managed Better Auth) handles sign-in and staff
// logins; the Neon Data API serves the healthy_athletes schema, with
// row-level security deciding what each role sees.

import { createClient } from "../vendor/neon-js-0.10.2.js";
import { NEON_AUTH_URL, NEON_DATA_API_URL, DB_SCHEMA } from "../config.js";

export const configured = Boolean(NEON_AUTH_URL && NEON_DATA_API_URL);

const sb = configured
  ? createClient({
      auth: { url: NEON_AUTH_URL },
      dataApi: { url: NEON_DATA_API_URL, options: { db: { schema: DB_SCHEMA } } },
    })
  : null;

function need() {
  if (!sb) throw new Error("The app is not connected to a database yet (see web/config.js).");
  return sb;
}

function check({ data, error }) {
  if (error) throw new Error(error.message || error.statusText || String(error));
  return data;
}

// --- Sign-in ---------------------------------------------------------------
// Neon Auth has no two-step sign-in yet, so organisers use a password only for
// now (Sam's decision, 2026-11-08). The database is ready to require MFA once
// Neon supports it (healthy_athletes.organiser_mfa_required()).

export async function signIn(email, password) {
  check(await need().auth.signIn.email({ email, password }));
}

export async function signOut() {
  if (sb) await sb.auth.signOut();
}

async function sessionUser() {
  const data = check(await need().auth.getSession());
  return data?.user ?? null;
}

/** The signed-in staff member ({ id, name, role, active }) or null. */
export async function currentStaff() {
  const user = await sessionUser();
  if (!user) return null;
  const rows = check(await sb.from("staff")
    .select("id, name, role, active")
    .eq("auth_user_id", user.id)
    .eq("active", true));
  return rows[0] ?? null;
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

// --- Staff -----------------------------------------------------------------
// Logins live in Neon Auth and are managed with its admin API, which only
// works for users with the Neon Auth "admin" role: every organiser gets that
// role, nobody else does. The staff table (role, active) lives in our schema.

const authRole = (role) => (role === "organiser" ? "admin" : "user");

/** Staff with their login email: [{ id, name, role, active, email, auth_user_id }]. */
export async function listStaff() {
  const staff = check(await need().from("staff")
    .select("id, auth_user_id, name, role, active, created_at").order("role").order("name"));
  const emails = new Map();
  for (let offset = 0; ; offset += 500) {
    const d = check(await sb.auth.admin.listUsers({ query: { limit: 500, offset } }));
    for (const u of d.users ?? []) emails.set(u.id, u.email);
    if (!d.users || d.users.length < 500) break;
  }
  return staff.map((s) => ({ ...s, email: emails.get(s.auth_user_id) ?? "" }));
}

/** Create a login and its staff row. { name, email, role, password }. */
export async function createStaff({ name, email, role, password }) {
  const d = check(await need().auth.admin.createUser({ email, password, name, role: authRole(role) }));
  const userId = d.user.id;
  const { data: row, error } = await sb.from("staff")
    .insert({ auth_user_id: userId, name, role })
    .select("id, name, role, active").single();
  if (error) {
    await sb.auth.admin.removeUser({ userId }); // don't leave a login without a staff row
    throw new Error(error.message);
  }
  return { ...row, email };
}

/** Switch a staff account on or off. Off also blocks sign-in and ends their sessions. */
export async function setStaffActive(staffId, active) {
  const row = check(await need().from("staff").update({ active }).eq("id", staffId)
    .select("auth_user_id").single());
  if (active) {
    check(await sb.auth.admin.unbanUser({ userId: row.auth_user_id }));
  } else {
    check(await sb.auth.admin.banUser({ userId: row.auth_user_id, banReason: "Deactivated by an organiser" }));
    check(await sb.auth.admin.revokeUserSessions({ userId: row.auth_user_id }));
  }
}

/** Give a (non-organiser) staff member a new password; their old sessions end. */
export async function setStaffPassword(staffId, password) {
  const row = check(await need().from("staff").select("auth_user_id, role").eq("id", staffId).single());
  if (row.role === "organiser") throw new Error("Organisers change their own password.");
  check(await sb.auth.admin.setUserPassword({ userId: row.auth_user_id, newPassword: password }));
  check(await sb.auth.admin.revokeUserSessions({ userId: row.auth_user_id }));
}

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
