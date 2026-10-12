/** Typed access to everything the app persists. */
import { storage, StorageAdapter } from './storage';
import { Stats, normalizeStats, emptyStats } from '../training/stats';
import { HandRecord } from '../training/history';
import { Level } from '../coach/types';

export interface Preferences {
  level: Level;
  botDelayMs: number;
  fourColorDeck: boolean;
  adaptive: boolean;
  /** Show quiz questions before decisions (levels 1-3). */
  quizzes: boolean;
  /** Name shown at the table and in reports. */
  playerName: string;
}

export const DEFAULT_PREFS: Preferences = { level: 1, botDelayMs: 700, fourColorDeck: true, adaptive: true, quizzes: true, playerName: '' };

const MAX_HISTORY = 300;
const KEYS = ['prefs', 'stats-lifetime', 'stats-session', 'history'] as const;

/** A full copy of everything the app stores, saved to / restored from a JSON file. */
export interface Backup {
  app: 'poker-trainer';
  version: 1;
  exportedAt: string;
  data: Partial<Record<(typeof KEYS)[number], unknown>>;
}

export class BackupError extends Error {}

export class Repository {
  constructor(private s: StorageAdapter = storage) {}

  loadPrefs(): Preferences {
    return { ...DEFAULT_PREFS, ...(this.s.get<Partial<Preferences>>('prefs') ?? {}) };
  }
  savePrefs(p: Preferences): void {
    this.s.set('prefs', p);
  }

  loadLifetime(): Stats {
    return normalizeStats(this.s.get<Stats>('stats-lifetime'));
  }
  saveLifetime(st: Stats): void {
    this.s.set('stats-lifetime', st);
  }

  loadSession(): Stats {
    return normalizeStats(this.s.get<Stats>('stats-session'));
  }
  saveSession(st: Stats): void {
    this.s.set('stats-session', st);
  }
  newSession(): Stats {
    const st = emptyStats();
    this.saveSession(st);
    return st;
  }

  loadHistory(): HandRecord[] {
    return this.s.get<HandRecord[]>('history') ?? [];
  }
  addHand(h: HandRecord): HandRecord[] {
    const list = [h, ...this.loadHistory()];
    // Keep starred hands even when trimming.
    const trimmed = list.filter((x, i) => i < MAX_HISTORY || x.starred);
    this.s.set('history', trimmed);
    return trimmed;
  }
  toggleStar(id: string): HandRecord[] {
    const list = this.loadHistory().map((h) => (h.id === id ? { ...h, starred: !h.starred } : h));
    this.s.set('history', list);
    return list;
  }

  resetAll(): void {
    for (const k of KEYS) this.s.remove(k);
  }

  exportAll(): Backup {
    const data: Backup['data'] = {};
    for (const k of KEYS) {
      const v = this.s.get(k);
      if (v !== null) data[k] = v;
    }
    return { app: 'poker-trainer', version: 1, exportedAt: new Date().toISOString(), data };
  }

  /** Validates a backup and replaces the stored data with it. Nothing is changed if it is invalid. */
  importAll(raw: unknown): void {
    const b = raw as Backup;
    if (!b || typeof b !== 'object' || b.app !== 'poker-trainer' || b.version !== 1 || typeof b.data !== 'object' || !b.data) {
      throw new BackupError('הקובץ אינו גיבוי של Poker Trainer');
    }
    if (b.data.history !== undefined && !Array.isArray(b.data.history)) throw new BackupError('היסטוריית הידיים בקובץ פגומה');
    for (const k of ['prefs', 'stats-lifetime', 'stats-session'] as const) {
      const v = b.data[k];
      if (v !== undefined && (typeof v !== 'object' || v === null || Array.isArray(v))) throw new BackupError('הנתונים בקובץ פגומים');
    }
    for (const k of KEYS) {
      if (b.data[k] !== undefined) this.s.set(k, b.data[k]);
      else this.s.remove(k);
    }
  }
}

export const repo = new Repository();
