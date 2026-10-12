/** Supabase client and the per-player sync backend for the public website. */
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config';
import type { SyncBackend } from './cloudSync';

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }
  return client;
}

function check<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Tables: user_data (one row per player and key) and hands (one row per player and hand). */
export function supabaseBackend(sb: SupabaseClient, uid: string): SyncBackend {
  return {
    async getKey(key) {
      const row = check(await sb.from('user_data').select('value, updated_at').eq('user_id', uid).eq('key', key).maybeSingle());
      return row ? { v: row.value as string, at: Number(row.updated_at) || 0 } : null;
    },
    async setKey(key, v, at) {
      check(await sb.from('user_data').upsert({ user_id: uid, key, value: v, updated_at: at }, { onConflict: 'user_id,key' }));
    },
    async deleteKey(key) {
      check(await sb.from('user_data').delete().eq('user_id', uid).eq('key', key));
    },
    async listHands() {
      const rows = check(await sb.from('hands').select('id, data').eq('user_id', uid).order('ts', { ascending: false }).limit(1000));
      return (rows ?? []).map((r) => ({ id: r.id as string, v: r.data as string }));
    },
    async setHand(id, v, at) {
      check(await sb.from('hands').upsert({ user_id: uid, id, data: v, ts: at }, { onConflict: 'user_id,id' }));
    },
    async deleteHand(id) {
      check(await sb.from('hands').delete().eq('user_id', uid).eq('id', id));
    },
  };
}
