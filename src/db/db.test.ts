/**
 * The lockstep tests MERGE_PLAN.md §P2 already paid for once and could drift again: `DB_VERSION`
 * must equal the schema Dexie actually opens at, and `TABLE_NAMES` must equal the tables Dexie
 * actually declares — because a `DB_VERSION` left behind the schema makes
 * historySafety.ts's pre-migration backup silently never fire for that upgrade (see the comment on
 * `DB_VERSION` in db.ts), and a `TABLE_NAMES` out of step with `db.tables` makes replace-mode
 * backup restore clear a table and never repopulate it (see the comment on `TABLE_NAMES`).
 */
import { describe, expect, it } from 'vitest';
import { db, DB_VERSION, TABLE_NAMES } from './db';

describe('schema/version lockstep', () => {
  it('DB_VERSION equals the Dexie version actually opened', async () => {
    // Force the lazy-opening connection to actually open, so db.verno reflects the real schema
    // rather than the value Dexie reports before its first operation.
    await db.open();
    expect(db.verno).toBe(DB_VERSION);
  });

  it('TABLE_NAMES is exactly the set of tables Dexie declares — no more, no fewer', async () => {
    await db.open();
    const declared = db.tables.map((t) => t.name).sort();
    expect([...TABLE_NAMES].sort()).toEqual(declared);
  });
});
