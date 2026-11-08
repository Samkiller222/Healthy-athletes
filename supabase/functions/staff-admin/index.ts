// staff-admin: lets an Organiser manage staff logins.
//
// Creating a login or changing someone else's password needs Supabase's
// service-role key, which must never reach the browser. This function holds
// it server-side and only acts for a signed-in Organiser who has passed MFA.
// Staff rows themselves are written with the caller's own token, so RLS and
// the audit log apply as normal.
//
// Actions (POST JSON body { action, ... }):
//   list                                  -> { staff: [{ id, name, role, active, email, created_at }] }
//   create   { email, password, name, role }
//   set_active { staff_id, active }        (deactivating also blocks sign-in)
//   set_password { staff_id, password }    (not for other organisers)

import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const ROLES = ["organiser", "receptionist", "station_lead", "display"];
const BAN_FOREVER = "876000h"; // ~100 years
const SCHEMA = "healthy_athletes";

const cors = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

class Refused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || !v.trim()) throw new Refused(`${field} is required`);
  const s = v.trim();
  if (s.length > max) throw new Refused(`${field} is too long`);
  return s;
}

function password(v: unknown): string {
  if (typeof v !== "string" || v.length < 12) {
    throw new Refused("password must be at least 12 characters");
  }
  if (v.length > 72) throw new Refused("password is too long");
  return v;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return reply(405, { error: "method not allowed" });

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const authHeader = req.headers.get("Authorization") ?? "";

  // Client acting as the caller: RLS applies.
  const asCaller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
    db: { schema: SCHEMA },
  });
  // Admin client: only for auth.users operations.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  try {
    const { data: isOrganiser, error: roleErr } = await asCaller.rpc("is_organiser");
    if (roleErr || isOrganiser !== true) {
      throw new Refused("only organisers signed in with MFA can manage staff", 403);
    }

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      throw new Refused("invalid JSON");
    }

    switch (body.action) {
      case "list": {
        const { data: staff, error } = await asCaller
          .from("staff")
          .select("id, auth_user_id, name, role, active, created_at")
          .order("role")
          .order("name");
        if (error) throw error;
        const emails = new Map<string, string>();
        for (let page = 1; ; page++) {
          const { data, error: e } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
          if (e) throw e;
          for (const u of data.users) emails.set(u.id, u.email ?? "");
          if (data.users.length < 1000) break;
        }
        return reply(200, {
          staff: staff.map(({ auth_user_id, ...s }) => ({ ...s, email: emails.get(auth_user_id) ?? "" })),
        });
      }

      case "create": {
        const email = str(body.email, "email", 254).toLowerCase();
        const name = str(body.name, "name", 80);
        const role = str(body.role, "role", 20);
        if (!ROLES.includes(role)) throw new Refused("unknown role");
        const pw = password(body.password);

        const { data: created, error } = await admin.auth.admin.createUser({
          email,
          password: pw,
          email_confirm: true,
        });
        if (error) throw new Refused(error.message);

        const { data: row, error: insErr } = await asCaller
          .from("staff")
          .insert({ auth_user_id: created.user.id, name, role })
          .select("id, name, role, active, created_at")
          .single();
        if (insErr) {
          await admin.auth.admin.deleteUser(created.user.id);
          throw insErr;
        }
        return reply(200, { staff: { ...row, email } });
      }

      case "set_active": {
        const staffId = str(body.staff_id, "staff_id", 40);
        const active = body.active === true;
        const { data: row, error } = await asCaller
          .from("staff")
          .update({ active })
          .eq("id", staffId)
          .select("auth_user_id")
          .single();
        if (error) throw new Refused(error.message);
        const { error: banErr } = await admin.auth.admin.updateUserById(row.auth_user_id, {
          ban_duration: active ? "none" : BAN_FOREVER,
        });
        if (banErr) throw banErr;
        return reply(200, { ok: true });
      }

      case "set_password": {
        const staffId = str(body.staff_id, "staff_id", 40);
        const pw = password(body.password);
        const { data: row, error } = await asCaller
          .from("staff")
          .select("auth_user_id, role")
          .eq("id", staffId)
          .single();
        if (error) throw new Refused("staff member not found", 404);
        if (row.role === "organiser") {
          throw new Refused("organisers change their own password from the sign-in page", 403);
        }
        const { error: pwErr } = await admin.auth.admin.updateUserById(row.auth_user_id, { password: pw });
        if (pwErr) throw new Refused(pwErr.message);
        return reply(200, { ok: true });
      }

      default:
        throw new Refused("unknown action");
    }
  } catch (e) {
    if (e instanceof Refused) return reply(e.status, { error: e.message });
    console.error("staff-admin error", (e as Error)?.message ?? e);
    return reply(500, { error: (e as { message?: string })?.message ?? "server error" });
  }
});
