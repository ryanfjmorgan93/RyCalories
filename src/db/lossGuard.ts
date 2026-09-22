/**
 * Loss-detection plumbing: the baseline row counts to compare against at boot, and the Dexie
 * middleware that keeps that baseline honest across every in-app deletion of a session or a set.
 *
 * Baseline storage is localStorage, not a Dexie table: it must still be readable when the very
 * thing it is guarding (the `iron` database) is the thing that may have gone missing, and it must
 * never itself be wiped by `resetToSeed`/`wipeAll`/`importBackup('replace')`, all of which clear
 * every Dexie table. It is small (one JSON object) and per-device, which is exactly what
 * localStorage is for.
 *
 * The middleware exists because deletions do not all go through one call: `Table.clear()` (used by
 * resetToSeed/wipeAll), `bulkDelete`, `.delete(id)` and `.where(...).delete()` are four different
 * paths, and only a `dbcore`-level hook on `mutate` sees every one of them without needing each
 * call site to remember to say so. It brackets each delete/deleteRange mutation on `sessions` or
 * `setLogs` with a "pending" flag (so a boot that lands mid-mutation, e.g. the app was killed, does
 * not mistake an in-flight legitimate deletion for loss) and refreshes the baseline once the
 * transaction the mutation belongs to actually commits (not merely once this one table's part of
 * it resolves — a multi-table transaction like `deleteSession` should not refresh the baseline
 * from a still-uncommitted partial state).
 */
import Dexie from 'dexie';
import type { IronDB } from './db';

const BASELINE_KEY = 'iron.lossBaseline.v1';
const PENDING_KEY = 'iron.lossPendingDeletion.v1';

export interface LossBaseline {
  sessions: number;
  sets: number;
  build: string;
  dbVersion: number;
  at: string;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function getBaseline(): LossBaseline | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LossBaseline>;
    if (typeof parsed.sessions !== 'number' || typeof parsed.sets !== 'number') return null;
    return {
      sessions: parsed.sessions,
      sets: parsed.sets,
      build: parsed.build ?? '',
      dbVersion: parsed.dbVersion ?? 0,
      at: parsed.at ?? '',
    };
  } catch {
    return null;
  }
}

export function writeBaseline(baseline: LossBaseline): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(BASELINE_KEY, JSON.stringify(baseline));
  } catch {
    /* best effort — a stale baseline is safer than a boot that fails */
  }
}

export function isPendingDeletion(): boolean {
  const s = storage();
  if (!s) return false;
  try {
    return s.getItem(PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

function markPendingDeletion(): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(PENDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

function clearPendingDeletion(): void {
  const s = storage();
  if (!s) return;
  try {
    s.removeItem(PENDING_KEY);
  } catch {
    /* ignore */
  }
}

const WATCHED_TABLES = new Set(['sessions', 'setLogs']);

/**
 * Recompute the baseline from the live tables. Best-effort — never throws.
 *
 * `build` is carried over from whatever baseline already existed rather than read fresh here:
 * this runs from db.ts at module scope, which stays free of `@/buildInfo` (its `__APP_VERSION__`
 * etc. are Vite `define`s the Vitest config does not set, and every repo/backup test imports
 * db.ts). `build`/`dbVersion` are diagnostic only — `detectLoss` compares just `sessions`/`sets` —
 * and src/db/historySafety.ts writes the accurate build on every boot-time and restore/dismiss
 * baseline write, which is where it matters.
 *
 * Called via `setTimeout(…, 0)` from the middleware below, never directly from a transaction's
 * 'complete' handler: a *nested* `db.transaction()` (e.g. `deleteSession` calling into helpers
 * that open their own) fires 'complete' for the inner scope as soon as its own callback settles,
 * before the real underlying IndexedDB transaction — shared with the outer scope — has actually
 * committed. Starting a fresh count() against the same two stores at that point competes with the
 * still-open outer transaction and made Dexie abort it early (`PrematureCommitError`) in exactly
 * the multi-step flows (swap/undo, session delete) this feature most needs to stay correct for.
 * Deferring to a macrotask lets whatever transaction is genuinely still in flight actually finish
 * first.
 */
async function refreshBaseline(db: IronDB): Promise<void> {
  try {
    const [sessions, sets] = await Promise.all([db.sessions.count(), db.setLogs.count()]);
    const prevBuild = getBaseline()?.build ?? '';
    writeBaseline({ sessions, sets, build: prevBuild, dbVersion: Math.round(db.verno), at: new Date().toISOString() });
  } catch {
    /* best effort */
  }
}

function scheduleRefreshBaseline(db: IronDB): void {
  setTimeout(() => void refreshBaseline(db), 0);
}

/**
 * Registers the dbcore middleware. Must run before the database is ever opened, so it is called
 * once from db.ts at module scope — including under Vitest, where it is a guarded no-op (no
 * localStorage in the default `node` test environment): the many existing tests that call
 * `Table.clear()` via `resetToSeed`/`wipeAll` must keep behaving exactly as before.
 */
export function installLossGuardMiddleware(db: IronDB): void {
  db.use({
    stack: 'dbcore',
    name: 'lossGuard',
    create(down) {
      return {
        ...down,
        table(tableName) {
          const downTable = down.table(tableName);
          if (!WATCHED_TABLES.has(tableName)) return downTable;
          return {
            ...downTable,
            // Deliberately Promise-chained, not async/await: an async function always returns a
            // plain native Promise for ITS OWN return value, which does not carry Dexie's
            // transaction zone (PSD) the way chaining directly onto `downTable.mutate(req)` does.
            // Returning that native-wrapped promise from here broke the zone propagation the
            // surrounding `db.transaction(...)` relies on to know the transaction is still live,
            // and IndexedDB auto-commits a transaction no new request is added to in time — every
            // multi-table transaction that deletes through this hook then failed with Dexie's
            // PrematureCommitError. Plain `.then()/.catch()` on the exact promise `mutate` returns
            // avoids that extra hop.
            mutate: (req) => {
              if (req.type !== 'delete' && req.type !== 'deleteRange') return downTable.mutate(req);
              markPendingDeletion();
              const trans = Dexie.currentTransaction;
              let settled = false;
              const settle = (deleted: boolean) => {
                if (settled) return;
                settled = true;
                clearPendingDeletion();
                if (deleted) scheduleRefreshBaseline(db);
              };
              if (trans) {
                trans.on('complete', () => settle(true));
                trans.on('abort', () => settle(false));
              }
              return downTable.mutate(req).then(
                (res) => {
                  if (!trans) settle(true);
                  return res;
                },
                (err) => {
                  if (!trans) settle(false);
                  throw err;
                },
              );
            },
          };
        },
      };
    },
  });
}
