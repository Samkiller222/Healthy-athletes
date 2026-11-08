// Supabase connection for the browser. The publishable (anon) key is meant
// to be public: row-level security decides what each signed-in role can see.
// NEVER put the service-role key here.
export const SUPABASE_URL = "";
export const SUPABASE_ANON_KEY = "";
// All app tables live in their own Postgres schema.
export const DB_SCHEMA = "healthy_athletes";
