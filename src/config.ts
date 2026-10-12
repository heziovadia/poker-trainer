/**
 * Public build configuration. The Supabase URL and publishable ("anon") key are safe to ship to
 * browsers: every player can only read and write their own rows (Row Level Security, see
 * supabase/schema.sql). When they are empty the app runs in local-only mode.
 */
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
export const supabaseEnabled = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
