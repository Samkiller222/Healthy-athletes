// Neon endpoints for the browser. These URLs are public: Neon Auth decides
// who is signed in and row-level security decides what each role can see.
// Never put a database connection string or password here.
export const NEON_AUTH_URL = "https://ep-lingering-thunder-b9yqkmf8.neonauth.c-7.eu-central-1.aws.neon.tech/neondb/auth";
export const NEON_DATA_API_URL = "https://ep-lingering-thunder-b9yqkmf8.apirest.c-7.eu-central-1.aws.neon.tech/neondb/rest/v1";
// All app tables live in their own Postgres schema.
export const DB_SCHEMA = "healthy_athletes";
