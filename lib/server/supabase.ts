import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client. SERVER ONLY — never import from a client component.
 * The key is read from SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix, so Next.js never bundles it).
 */
export function db(): SupabaseClient {
  if (typeof window !== "undefined") throw new Error("Supabase service client must not run in the browser");
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
