/**
 * Unit coverage for historySafety.ts's pre-migration decision: whether a schema upgrade about to
 * run should get a raw backup written first (point 2 in the file's header comment, guarding
 * `src/db/db.ts`'s `DB_VERSION`).
 *
 * `doBackupBeforeMigration` itself is not exported — and cannot usefully be, end to end, under
 * Vitest: its write side (`writeBackupContent`, via `@capacitor/filesystem`) reads the bare global
 * `window` in its web implementation and has no path that works outside a real browser (confirmed
 * while writing this file: it throws "window is not defined" under the default `node` environment,
 * and under `jsdom` the interaction between jsdom's own IndexedDB stub and fake-indexeddb hangs
 * indefinitely on `indexedDB.deleteDatabase`). That side is exactly what
 * e2e/migration-v3.spec.ts proves instead, against a real browser and the real Filesystem store.
 *
 * What IS safely testable here, and is the actual decision this file guards, is the read side:
 * `probeRaw` (reading a raw on-disk version and seed version with no Dexie upgrade) and
 * `migrationIsComing` (the comparison against `DB_VERSION * 10` that decides whether the backup
 * fires) are exported as the smallest seam onto that decision — see the comment on each in
 * historySafety.ts. Both are exercised here against a raw IndexedDB 'iron' database seeded with
 * fake-indexeddb, the same technique e2e/history-safety.spec.ts uses at browser scale.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DB_NAME, DB_VERSION } from './db';
import { migrationIsComing, probeRaw } from './historySafety';
import { DEFAULT_SETTINGS } from '@/domain/types';

/** Creates 'iron' as raw IndexedDB at `version`, with just enough of a `settings` row for
 * `probeRaw` to read a seed version — mirrors e2e/history-safety.spec.ts's `createRawIronDb`, at
 * unit-test scale (the migration decision does not care about any other store). */
function seedRawIron(version: number, seedVersion: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, version);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('settings', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const idb = req.result;
      const tx = idb.transaction('settings', 'readwrite');
      tx.objectStore('settings').put({ id: 'settings', seedVersion });
      tx.oncomplete = () => {
        idb.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('iron database is blocked'));
  });
}

beforeEach(async () => {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
});

describe('migrationIsComing', () => {
  it('is true for a raw version behind DB_VERSION * 10', () => {
    // Dexie stores its version ×10 in raw IndexedDB. 20 is Dexie schema v2 (this branch's
    // pre-recipes shape) — exactly what an install upgrading through v3 has on disk.
    expect(migrationIsComing(20)).toBe(true);
    expect(DB_VERSION).toBe(3); // pins the assumption the case above and db.test.ts both rely on
  });

  it('is false once the raw version matches the current schema', () => {
    expect(migrationIsComing(DB_VERSION * 10)).toBe(false);
  });

  it('is false for a raw version already ahead (never held back for a newer build)', () => {
    expect(migrationIsComing(40)).toBe(false);
  });

  it('reproduces the exact historical bug: a probe of 20 against an un-bumped DB_VERSION of 2 reads as no migration coming', () => {
    // This is what shipping recipes with DB_VERSION left at 2 would have done: the on-disk version
    // (20, this branch's actual v2 install) sits at DB_VERSION*10 already, so the decision reads
    // "nothing coming" and the pre-migration backup silently never fires for the v3 upgrade —
    // exactly the failure the plan calls out. e2e/migration-v3.spec.ts reproduces this with
    // DB_VERSION genuinely set back to 2 and shows the resulting assertion failure.
    expect(migrationIsComing(20, 2)).toBe(false);
  });
});

describe('probeRaw', () => {
  it('reads the raw version and seed version off a real (fake-indexeddb) database', async () => {
    await seedRawIron(20, DEFAULT_SETTINGS.seedVersion);
    const probe = await probeRaw();
    expect(probe).toEqual({ version: 20, seedVersion: DEFAULT_SETTINGS.seedVersion });
  });

  it('reads seedVersion 1 when the settings store does not exist yet (a v1 install)', async () => {
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 10);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('sessions', { keyPath: 'id' });
      };
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
    const probe = await probeRaw();
    expect(probe).toEqual({ version: 10, seedVersion: 1 });
  });

  it('composes with migrationIsComing to reach the same call production makes', async () => {
    await seedRawIron(DB_VERSION * 10, DEFAULT_SETTINGS.seedVersion);
    const probe = await probeRaw();
    expect(migrationIsComing(probe.version)).toBe(false);
  });
});
