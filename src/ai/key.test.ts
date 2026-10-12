/**
 * @vitest-environment jsdom
 *
 * The API key's one rule: it lives in localStorage['iron.claudeKey'] and nowhere else. The tests
 * below set a key, then produce every artefact the app can write out of its data (the JSON backup,
 * both CSVs, the raw dump the pre-migration backup uses, and an automatic backup file) and check the
 * key is in none of them, after checking each artefact is real data and not an empty string.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const written: string[] = [];
vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: vi.fn(async (opts: { data: string }) => {
      written.push(opts.data);
      return { uri: 'file://x' };
    }),
    readdir: vi.fn(async () => ({ files: [] })),
    deleteFile: vi.fn(async () => undefined),
    readFile: vi.fn(async () => ({ data: '' })),
  },
}));

import { dumpRaw } from '@/boot/recovery';
import { backupNow } from '@/db/autoBackup';
import { exportBackup, exportBodyweightCsv, exportCsv } from '@/db/backup';
import { db } from '@/db/db';
import { logBodyweight, logSet, resetToSeed, startSession } from '@/db/repo';
import { SEED_EXERCISE_IDS, SEED_ROUTINE_IDS } from '@/db/seed';
import { clearApiKey, getApiKey, hasKey, KEY_STORAGE, maskKey, redactKeys, setApiKey } from './key';
import { resetMemory } from './store';

const KEY = 'sk-ant-api03-Zq9XvT2mP7LkR4wB8nHcD1fGjYsA6uEoIt3VhNb5MxCdWa-abcd';

beforeEach(async () => {
  localStorage.clear();
  resetMemory();
  await resetToSeed();
  written.length = 0;
});

describe('storing the key', () => {
  it('keeps it in localStorage under iron.claudeKey and reads it back', () => {
    expect(hasKey()).toBe(false);
    expect(getApiKey()).toBeNull();
    expect(setApiKey(KEY)).toBe(true);
    expect(localStorage.getItem('iron.claudeKey')).toBe(KEY);
    expect(KEY_STORAGE).toBe('iron.claudeKey');
    expect(hasKey()).toBe(true);
    expect(getApiKey()).toBe(KEY);
  });

  it('drops whitespace and line breaks from a paste, and refuses an empty key', () => {
    expect(setApiKey(`  ${KEY.slice(0, 20)}\n${KEY.slice(20)} \n`)).toBe(true);
    expect(getApiKey()).toBe(KEY);
    expect(setApiKey('   \n ')).toBe(false);
    expect(getApiKey()).toBe(KEY);
  });

  it('removes it', () => {
    setApiKey(KEY);
    clearApiKey();
    expect(hasKey()).toBe(false);
    expect(localStorage.getItem('iron.claudeKey')).toBeNull();
  });

  it('shows a masked form that holds only the kind and the last four characters', () => {
    expect(maskKey(KEY)).toBe('sk-ant-…abcd');
    expect(maskKey(null)).toBeNull();
    expect(maskKey('short')).toBe('••••');
    setApiKey(KEY);
    expect(maskKey()).toBe('sk-ant-…abcd');
    expect(maskKey()!).not.toContain('Zq9X');
  });

  it('survives storage that throws: no key, no crash', () => {
    setApiKey(KEY);
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });
    expect(getApiKey()).toBeNull();
    expect(hasKey()).toBe(false);
    expect(setApiKey(KEY)).toBe(false);
    expect(() => clearApiKey()).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });

  it('never keeps the key in memory once storage is gone', () => {
    setApiKey(KEY);
    clearApiKey();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(getApiKey()).toBeNull();
  });

  it('redacts anything shaped like a key from text', () => {
    expect(redactKeys(`failed with ${KEY} at once`)).toBe('failed with sk-ant-… at once');
    expect(redactKeys('nothing to hide')).toBe('nothing to hide');
  });
});

describe('what leaves the app in a backup', () => {
  it('never includes the key: JSON backup, both CSVs, the raw dump and an automatic backup file', async () => {
    setApiKey(KEY);
    await logBodyweight('2026-10-01', 81.2, 'after breakfast');
    const session = await startSession(SEED_ROUTINE_IDS['Upper (Push)']);
    await logSet({ sessionId: session.id, routineExerciseId: null, exerciseId: SEED_EXERCISE_IDS['Bench Press (Barbell)'], type: 'working', weight: 80, reps: 8 });
    // A coach thread and note exist, as they will in real use.
    await db.coachNotes.put({ id: 'n1', createdAt: '2026-10-01T08:00:00.000Z', text: 'Left knee twinges on deep squats' });
    await db.coachMessages.put({ id: 'm1', at: '2026-10-01T08:00:00.000Z', role: 'user', text: 'How was my week?' });

    const backupJson = JSON.stringify(await exportBackup(), null, 2);
    const csv = await exportCsv();
    const weightCsv = await exportBodyweightCsv();
    const raw = await dumpRaw();
    const auto = await backupNow('auto');

    // Each artefact is the real thing, not an empty string that trivially lacks the key.
    expect(backupJson).toContain('Left knee twinges');
    expect(backupJson).toContain('Bench Press');
    expect(weightCsv).toContain('81.2');
    expect(csv.split('\n')[0]).toContain('weight_kg');
    expect(raw).toContain('Left knee twinges');
    expect(auto.ok).toBe(true);
    expect(written.length).toBeGreaterThan(0);
    expect(written.at(-1)).toContain('Left knee twinges');

    // Every file the app wrote to disk in the course of this, not only the last one.
    const files = Object.fromEntries(written.map((content, i) => [`file ${i}`, content]));
    for (const [name, content] of Object.entries({ backupJson, csv, weightCsv, raw, ...files })) {
      expect(content, `${name} must not contain the key`).not.toContain(KEY);
      expect(content, `${name} must not contain any part of the key`).not.toContain(KEY.slice(10, 30));
      expect(content, `${name} must not name the storage key`).not.toContain('iron.claudeKey');
    }
  });

  it('leaves the key out of the settings row too', async () => {
    setApiKey(KEY);
    const settings = JSON.stringify(await db.settings.toArray());
    expect(settings).not.toContain(KEY);
    expect(settings.toLowerCase()).not.toContain('claude');
  });
});

describe('where the key is allowed to be read', () => {
  const root = join(process.cwd(), 'src');

  function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
    return out;
  }

  const files = sourceFiles(root).map((f) => ({ path: relative(root, f).split('\\').join('/'), text: readFileSync(f, 'utf8') }));

  it('only the key module and the client module read the raw key', () => {
    const readers = files.filter((f) => /\bgetApiKey\b/.test(f.text)).map((f) => f.path).sort();
    expect(readers).toEqual(['ai/client.ts', 'ai/key.ts']);
  });

  it('only the key module names its storage slot', () => {
    const namers = files.filter((f) => f.text.includes('iron.claudeKey')).map((f) => f.path);
    expect(namers).toEqual(['ai/key.ts']);
  });

  it('nothing in src/ai writes to the console, where a key could end up', () => {
    const offenders = files.filter((f) => f.path.startsWith('ai/') && /\bconsole\./.test(f.text)).map((f) => f.path);
    expect(offenders).toEqual([]);
  });
});
