import { describe, it, expect, beforeEach } from 'vitest';
import type { SyncBackend } from '../src/storage/cloudSync';

// Minimal browser shims: localStorage and document events.
class MemStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const g = globalThis as unknown as { localStorage: MemStorage; document: unknown; window: unknown };
g.localStorage = new MemStorage();
g.document = { addEventListener() {}, visibilityState: 'visible' };
g.window = { dispatchEvent() {} };

/** In-memory cloud with one area per player, like the Supabase tables. */
function fakeCloud() {
  const players = new Map<string, { keys: Map<string, { v: string; at: number }>; hands: Map<string, string> }>();
  const area = (uid: string) => {
    if (!players.has(uid)) players.set(uid, { keys: new Map(), hands: new Map() });
    return players.get(uid)!;
  };
  const backendFor = (uid: string): SyncBackend => ({
    getKey: async (k) => area(uid).keys.get(k) ?? null,
    setKey: async (k, v, at) => { area(uid).keys.set(k, { v, at }); },
    deleteKey: async (k) => { area(uid).keys.delete(k); },
    listHands: async () => [...area(uid).hands].map(([id, v]) => ({ id, v })),
    setHand: async (id, v) => { area(uid).hands.set(id, v); },
    deleteHand: async (id) => { area(uid).hands.delete(id); },
  });
  return { area, backendFor };
}

const settle = () => new Promise((r) => setTimeout(r, 50));

async function freshModules() {
  const { vi } = await import('vitest');
  vi.resetModules();
  const sync = await import('../src/storage/cloudSync');
  const { Repository } = await import('../src/storage/repository');
  const { LocalStorageAdapter } = await import('../src/storage/storage');
  return { sync, repo: new Repository(new LocalStorageAdapter()) };
}

const hand = (id: string, ts: number) => ({ id, handNumber: 1, timestamp: ts, starred: false, decisions: [] });

describe('cloud sync between devices', () => {
  beforeEach(() => g.localStorage.clear());

  it('progress made on one device appears on another device of the same player', async () => {
    const cloud = fakeCloud();
    // Device A: play locally, then connect.
    let { sync, repo } = await freshModules();
    repo.savePrefs({ ...repo.loadPrefs(), playerName: 'חזי', level: 2 });
    repo.addHand(hand('h1', 1000) as never);
    await sync.connectBackend(cloud.backendFor('hezi'), 'hezi');
    await settle();
    expect(cloud.area('hezi').keys.get('prefs')).toBeDefined();
    expect(cloud.area('hezi').hands.has('h1')).toBe(true);

    // Device B: empty browser, same player.
    g.localStorage.clear();
    ({ sync, repo } = await freshModules());
    await sync.connectBackend(cloud.backendFor('hezi'), 'hezi');
    expect(repo.loadPrefs().playerName).toBe('חזי');
    expect(repo.loadPrefs().level).toBe(2);
    expect(repo.loadHistory().map((h) => h.id)).toEqual(['h1']);
  });

  it('a different player signing in on the same browser never sees or uploads the previous player data', async () => {
    const cloud = fakeCloud();
    let { sync, repo } = await freshModules();
    await sync.connectBackend(cloud.backendFor('hezi'), 'hezi');
    repo.savePrefs({ ...repo.loadPrefs(), playerName: 'חזי' });
    await sync.disconnectBackend();

    ({ sync, repo } = await freshModules());
    await sync.connectBackend(cloud.backendFor('son'), 'son');
    await settle();
    expect(repo.loadPrefs().playerName).toBe('');
    expect(cloud.area('son').keys.get('prefs')).toBeUndefined();
    expect(JSON.parse(cloud.area('hezi').keys.get('prefs')!.v).playerName).toBe('חזי');
  });

  it('the newer copy wins: an older local copy does not overwrite newer cloud progress', async () => {
    const cloud = fakeCloud();
    cloud.area('hezi').keys.set('prefs', { v: JSON.stringify({ playerName: 'חזי', level: 3 }), at: Date.now() + 60_000 });
    const { sync, repo } = await freshModules();
    g.localStorage.setItem('poker-trainer:v1:owner', 'hezi');
    repo.savePrefs({ ...repo.loadPrefs(), playerName: 'חזי', level: 1 });
    await sync.connectBackend(cloud.backendFor('hezi'), 'hezi');
    await settle();
    expect(repo.loadPrefs().level).toBe(3);
    expect(JSON.parse(cloud.area('hezi').keys.get('prefs')!.v).level).toBe(3);
  });
});
