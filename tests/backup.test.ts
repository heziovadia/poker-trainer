import { describe, it, expect } from 'vitest';
import { Repository, BackupError } from '../src/storage/repository';
import { MemoryStorageAdapter } from '../src/storage/storage';
import { emptyStats, recordHand } from '../src/training/stats';

function filled(): Repository {
  const r = new Repository(new MemoryStorageAdapter());
  r.savePrefs({ ...r.loadPrefs(), playerName: 'חזי', level: 2 });
  r.saveLifetime(recordHand(emptyStats(), 10, 2, true, 1));
  return r;
}

describe('backup and restore', () => {
  it('round-trips all data into a fresh store', () => {
    const backup = JSON.parse(JSON.stringify(filled().exportAll()));
    const target = new Repository(new MemoryStorageAdapter());
    target.importAll(backup);
    expect(target.loadPrefs().playerName).toBe('חזי');
    expect(target.loadPrefs().level).toBe(2);
    expect(target.loadLifetime().hands).toBe(1);
  });

  it('rejects files that are not a Poker Trainer backup and keeps current data', () => {
    const r = filled();
    expect(() => r.importAll({ foo: 1 })).toThrow(BackupError);
    expect(() => r.importAll({ app: 'poker-trainer', version: 1, data: { history: 'x' } })).toThrow(BackupError);
    expect(r.loadPrefs().playerName).toBe('חזי');
    expect(r.loadLifetime().hands).toBe(1);
  });
});
