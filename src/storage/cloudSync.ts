/**
 * Cloud sync. The app always works from localStorage (fast, synchronous); this module mirrors
 * it to a per-player cloud store so the same progress appears on every device the player uses.
 *
 * The store is pluggable (`SyncBackend`):
 *  - Supabase, for the public website (see supabaseBackend.ts), one account per player.
 *  - The claude.ai `db` capability, when the app runs as a claude.ai artifact.
 * Without either, everything stays local.
 *
 * Data model, per player: three small key/value records (prefs, stats-lifetime, stats-session)
 * stored as { v: <JSON string>, at: <ms> }, and one record per finished hand.
 */
import type { HandRecord } from '../training/history';

export interface SyncBackend {
  getKey(key: string): Promise<{ v: string; at: number } | null>;
  setKey(key: string, v: string, at: number): Promise<void>;
  deleteKey(key: string): Promise<void>;
  listHands(): Promise<{ id: string; v: string }[]>;
  setHand(id: string, v: string, at: number): Promise<void>;
  deleteHand(id: string): Promise<void>;
}

const PREFIX = 'poker-trainer:v1:';
const SIMPLE_KEYS = ['prefs', 'stats-lifetime', 'stats-session'] as const;

export type SyncStatus = 'local' | 'connecting' | 'synced' | 'saving' | 'error';

let backend: SyncBackend | null = null;
let status: SyncStatus = 'local';
const listeners = new Set<(s: SyncStatus) => void>();
/** Hand id → "starred" flag as last pushed, to push only new or changed hands. */
let pushedHands = new Map<string, boolean>();
const dirty = new Set<string>();
let timer: ReturnType<typeof setTimeout> | null = null;
let pushing = false;
let visibilityHooked = false;

function setStatus(s: SyncStatus) {
  status = s;
  listeners.forEach((fn) => fn(s));
}
export const getSyncStatus = () => status;
export function onSyncStatus(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ---------------------------------------------------------------- local helpers

function readLocal(key: string): string | null {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}
function writeLocal(key: string, raw: string) {
  try { localStorage.setItem(PREFIX + key, raw); } catch { /* storage unavailable */ }
}
function removeLocal(key: string) {
  try { localStorage.removeItem(PREFIX + key); } catch { /* storage unavailable */ }
}
function localStamp(key: string): number {
  return Number(readLocal(`meta:${key}`) ?? 0) || 0;
}
function stampLocal(key: string, at: number) {
  writeLocal(`meta:${key}`, String(at));
}

/** Removes this browser's copy of the player data (used when a different player signs in, or on sign-out). */
export function clearLocalPlayerData(): void {
  for (const k of [...SIMPLE_KEYS, 'history']) {
    removeLocal(k);
    removeLocal(`meta:${k}`);
  }
  removeLocal('owner');
}

/** Called by the storage adapter on every local write. */
export function markDirty(key: string): void {
  if (!(SIMPLE_KEYS as readonly string[]).includes(key) && key !== 'history') return;
  stampLocal(key, Date.now());
  if (!backend) return;
  dirty.add(key);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), 1500);
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 600));
    return fn();
  }
}

async function flush(): Promise<void> {
  if (!backend || pushing) return;
  const b = backend;
  pushing = true;
  setStatus('saving');
  try {
    while (dirty.size) {
      const key = [...dirty][0];
      dirty.delete(key);
      const raw = readLocal(key);
      const at = localStamp(key) || Date.now();
      if (key === 'history') await pushHistory(b, raw);
      else if (raw !== null) await withRetry(() => b.setKey(key, raw, at));
      else await withRetry(() => b.deleteKey(key));
    }
    setStatus('synced');
  } catch {
    setStatus('error');
  } finally {
    pushing = false;
  }
}

async function pushHistory(b: SyncBackend, raw: string | null): Promise<void> {
  const list: HandRecord[] = raw ? JSON.parse(raw) : [];
  const now = new Map(list.map((h) => [h.id, h.starred]));
  for (const h of list) {
    if (pushedHands.get(h.id) === h.starred) continue;
    await withRetry(() => b.setHand(h.id, JSON.stringify(h), h.timestamp));
    pushedHands.set(h.id, h.starred);
  }
  for (const id of [...pushedHands.keys()]) {
    if (!now.has(id)) {
      await withRetry(() => b.deleteHand(id));
      pushedHands.delete(id);
    }
  }
}

/**
 * Brings local storage up to date with the cloud copy (newer side wins per key; hands are
 * merged by id) and queues a push for whatever is newer locally. Returns true when local data changed.
 */
export async function pull(): Promise<boolean> {
  if (!backend) return false;
  const b = backend;
  let changed = false;
  for (const key of SIMPLE_KEYS) {
    const remote = await withRetry(() => b.getKey(key));
    const cloudAt = remote?.at ?? 0;
    const localAt = localStamp(key);
    if (remote && cloudAt > localAt) {
      writeLocal(key, remote.v);
      stampLocal(key, cloudAt);
      changed = true;
    } else if (readLocal(key) !== null && localAt > cloudAt) {
      dirty.add(key);
    }
  }

  const rows = await withRetry(() => b.listHands());
  const cloud = new Map<string, HandRecord>();
  for (const r of rows) {
    try { cloud.set(r.id, JSON.parse(r.v)); } catch { /* skip a damaged hand */ }
  }
  const localRaw = readLocal('history');
  const local: HandRecord[] = localRaw ? JSON.parse(localRaw) : [];
  const cloudAt = Math.max(0, ...[...cloud.values()].map((h) => h.timestamp));
  const merged = new Map<string, HandRecord>(cloud);
  for (const h of local) {
    // A hand only here is kept; for one on both sides, the local copy wins when it was edited (starred) later.
    if (!merged.has(h.id) || localStamp('history') > cloudAt) merged.set(h.id, h);
  }
  const mergedList = [...merged.values()].sort((a, b2) => b2.timestamp - a.timestamp);
  pushedHands = new Map([...cloud.values()].map((h) => [h.id, h.starred]));
  const mergedRaw = JSON.stringify(mergedList);
  if (mergedRaw !== JSON.stringify(local)) {
    writeLocal('history', mergedRaw);
    changed = true;
  }
  if (mergedList.some((h) => pushedHands.get(h.id) !== h.starred)) dirty.add('history');
  if (dirty.size) void flush();
  return changed;
}

/**
 * Starts syncing this browser with a player's cloud store.
 * `playerId` identifies whose data the local copy holds, so two players sharing one device never mix.
 */
export async function connectBackend(b: SyncBackend, playerId: string): Promise<boolean> {
  backend = b;
  setStatus('connecting');
  try {
    const owner = readLocal('owner');
    if (owner && owner !== playerId) clearLocalPlayerData();
    writeLocal('owner', playerId);
    await pull();
    setStatus(dirty.size ? 'saving' : 'synced');
    if (!visibilityHooked) {
      visibilityHooked = true;
      // Coming back to the app (e.g. switching from phone to computer): pick up the other device's progress.
      document.addEventListener('visibilitychange', () => {
        if (!backend) return;
        if (document.visibilityState === 'visible') {
          void pull().then((changed) => {
            if (changed) window.dispatchEvent(new Event('pt-cloud-updated'));
          }).catch(() => setStatus('error'));
        } else if (dirty.size) {
          void flush();
        }
      });
    }
    return true;
  } catch {
    setStatus('error');
    return false;
  }
}

/** Pushes anything pending, then stops syncing (used on sign-out). */
export async function disconnectBackend(): Promise<void> {
  if (timer) clearTimeout(timer);
  if (dirty.size) await flush();
  backend = null;
  pushedHands = new Map();
  setStatus('local');
}

// ---------------------------------------------------------------- claude.ai backend

type Snap = { exists: boolean; id: string; data(): Record<string, unknown> | undefined };
type DocRef = {
  get(): Promise<Snap>;
  set(d: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(p: string): ColRef;
};
type ColRef = { doc(id?: string): DocRef; get(): Promise<{ docs: Snap[] }> };
type Db = { doc(p: string): DocRef };
type ClaudeHost = { use(name: string): Promise<unknown> };

function claudeBackend(db: Db, uid: string): SyncBackend {
  const docFor = (key: string) => db.doc(`data/users/${uid}/${key}`);
  const hands = () => db.doc(`data/users/${uid}/hist`).collection('hands');
  return {
    async getKey(key) {
      const snap = await docFor(key).get();
      const body = snap.exists ? snap.data() : undefined;
      return body && typeof body.v === 'string' ? { v: body.v, at: typeof body.at === 'number' ? body.at : 0 } : null;
    },
    setKey: (key, v, at) => docFor(key).set({ v, at }),
    deleteKey: (key) => docFor(key).delete(),
    async listHands() {
      const snap = await hands().get();
      return snap.docs.flatMap((d) => {
        const v = d.data()?.v;
        return typeof v === 'string' ? [{ id: d.id, v }] : [];
      });
    },
    setHand: (id, v, at) => hands().doc(id).set({ v, at }),
    deleteHand: (id) => hands().doc(id).delete(),
  };
}

/** Connects to the viewer's private store when the app runs as a claude.ai artifact. */
export async function initClaudeSync(): Promise<boolean> {
  const host = (globalThis as { claude?: ClaudeHost }).claude;
  if (!host || typeof host.use !== 'function') return false;
  setStatus('connecting');
  try {
    const [dbNs, userNs] = await Promise.all([host.use('db'), host.use('user')]);
    const id = userNs ? await (userNs as { id(): Promise<string | null> }).id() : null;
    if (!dbNs || !id) {
      setStatus('local');
      return false;
    }
    return connectBackend(claudeBackend(dbNs as Db, id), id);
  } catch {
    setStatus('error');
    return false;
  }
}

/** Offers a file through the claude.ai viewer's download prompt; false when not running there. */
export async function saveFileViaHost(filename: string, data: string): Promise<boolean> {
  const host = (globalThis as { claude?: ClaudeHost }).claude;
  if (!host || typeof host.use !== 'function') return false;
  const dl = (await host.use('downloads')) as { save(r: { filename: string; data: string }): Promise<unknown> } | null;
  if (!dl) return false;
  try {
    await dl.save({ filename, data });
  } catch {
    /* declined or unavailable: nothing else to do */
  }
  return true;
}
