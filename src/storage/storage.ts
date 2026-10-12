/**
 * Persistence layer. Everything goes through StorageAdapter so a remote backend
 * (sync between devices) can replace localStorage later without touching the app.
 */
export interface StorageAdapter {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  remove(key: string): void;
}

import { markDirty } from './cloudSync';

const PREFIX = 'poker-trainer:v1:';

export class LocalStorageAdapter implements StorageAdapter {
  get<T>(key: string): T | null {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  }
  set<T>(key: string, value: T): void {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
      markDirty(key);
    } catch {
      // Quota exceeded or storage disabled: the app keeps working in memory.
    }
  }
  remove(key: string): void {
    try {
      localStorage.removeItem(PREFIX + key);
      markDirty(key);
    } catch {
      /* ignore */
    }
  }
}

export class MemoryStorageAdapter implements StorageAdapter {
  private data = new Map<string, string>();
  get<T>(key: string): T | null {
    const raw = this.data.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  set<T>(key: string, value: T): void {
    this.data.set(key, JSON.stringify(value));
  }
  remove(key: string): void {
    this.data.delete(key);
  }
}

function localStorageWorks(): boolean {
  try {
    const k = PREFIX + '__probe';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

export const storage: StorageAdapter = localStorageWorks() ? new LocalStorageAdapter() : new MemoryStorageAdapter();
