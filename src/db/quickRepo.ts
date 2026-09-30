/**
 * Starting a quick session ("Short session"): the writes behind it. The plan itself is pure
 * (`@/domain/quickSession`); this file turns an accepted plan into rows.
 *
 * No routine-free session exists: a session needs a routine with exercises to open onto. A quick
 * session therefore runs on a HIDDEN one-off routine made at Start, never while previewing or
 * shuffling. The routine is archived (every list that hides archived routines hides it for free),
 * marked `quick` (so the few places that read archived routines on purpose can tell it from one the
 * owner deleted), and leaves with its session (`deleteSession`). Its rows are built field by field,
 * never copied from a real routine's: a copied `linkProgression` would make a hidden row a link
 * leader, and a copied weight or mode is exactly what must not leak.
 */
import { db } from './db';
import { getActiveSession } from './repo';
import { catalogueDemoKey, exerciseFromCatalogue, type CatalogueEntry } from '@/domain/catalogue';
import { nowIso } from '@/domain/dates';
import { normaliseName } from '@/domain/exerciseMatch';
import { uuid } from '@/domain/ids';
import type { QuickPlan } from '@/domain/quickSession';
import type { Exercise, Routine, RoutineExercise, Session } from '@/domain/types';

/** The hidden routine's name, and the stem of its session's title. */
export const QUICK_SESSION_NAME = 'Quick session';

/**
 * Start a session from an accepted plan, in ONE transaction: the live-session check, the exercises
 * a catalogue row becomes, the hidden routine, its rows and the session. If a session is already
 * live it is returned and nothing is created; if anything throws, nothing is written.
 *
 * `effort` is what the plan was generated for. The plan does not carry it (the generator is
 * untouched), and it decides what the session may count for: a light session never reaches a record
 * or an e1RM (`sessionCountsForRecords`).
 *
 * `catalogueEntries` must hold every entry a catalogue-origin row names, already loaded: a Dexie
 * transaction cannot await anything that is not a Dexie call, so nothing is imported in here. A
 * catalogue row reuses an exercise the owner already has (same `cat:<slug>` demo key, else the same
 * name) rather than adding a second one.
 */
export async function startQuickSession(plan: QuickPlan, catalogueEntries: readonly CatalogueEntry[], effort: 'light' | 'normal'): Promise<Session> {
  const entryBySlug = new Map(catalogueEntries.map((e) => [e.slug, e]));
  return db.transaction('rw', [db.sessions, db.routines, db.routineExercises, db.exercises], async () => {
    const active = await getActiveSession();
    if (active) return active;
    if (plan.rows.length === 0) throw new Error('Quick session has no exercises');

    const now = nowIso();
    const exerciseIds = await resolveExercises(plan, entryBySlug, now);

    const lower = plan.rows.filter((r) => r.candidate.isLowerBody).length;
    const routine: Routine = {
      id: uuid(),
      name: QUICK_SESSION_NAME,
      order: -1,
      isLowerBody: lower * 2 > plan.rows.length,
      archived: true,
      quick: true,
    };
    await db.routines.put(routine);

    const rxs: RoutineExercise[] = plan.rows.map((row, order) => ({
      id: uuid(),
      routineId: routine.id,
      exerciseId: exerciseIds[order],
      order,
      targetSets: row.sets,
      repMin: row.repMin,
      repMax: row.repMax,
      currentWeight: row.weightKg ?? 0,
      increment: row.candidate.defaultIncrement,
      mode: row.mode,
      optional: false,
    }));
    await db.routineExercises.bulkPut(rxs);

    const session: Session = {
      id: uuid(),
      routineId: routine.id,
      title: `${QUICK_SESSION_NAME} · ${effort}`,
      startedAt: now,
      quick: effort,
    };
    await db.sessions.put(session);
    return session;
  });
}

/**
 * The exercise id for each row of the plan, in order. An owned exercise must still exist; a
 * catalogue one is found among the owner's exercises or created, and created once however many
 * rows name it.
 */
async function resolveExercises(plan: QuickPlan, entryBySlug: ReadonlyMap<string, CatalogueEntry>, createdAt: string): Promise<string[]> {
  const ownIds = plan.rows.filter((r) => r.candidate.origin !== 'catalogue').map((r) => r.candidate.id);
  const owned = new Set((await db.exercises.bulkGet(ownIds)).filter((e): e is Exercise => !!e).map((e) => e.id));
  for (const id of ownIds) if (!owned.has(id)) throw new Error('Exercise not found');

  const needsCatalogue = plan.rows.some((r) => r.candidate.origin === 'catalogue');
  const byDemo = new Map<string, Exercise>();
  const byName = new Map<string, Exercise>();
  if (needsCatalogue) {
    for (const e of await db.exercises.toArray()) {
      if (e.demo) byDemo.set(e.demo, e);
      byName.set(normaliseName(e.name), e);
    }
  }

  const ids: string[] = [];
  for (const row of plan.rows) {
    const c = row.candidate;
    if (c.origin !== 'catalogue') {
      ids.push(c.id);
      continue;
    }
    const entry = c.catalogueSlug ? entryBySlug.get(c.catalogueSlug) : undefined;
    if (!entry) throw new Error(`Catalogue entry not found: ${c.catalogueSlug ?? c.name}`);
    let exercise = byDemo.get(catalogueDemoKey(entry.slug)) ?? byName.get(normaliseName(entry.name));
    if (!exercise) {
      exercise = { ...exerciseFromCatalogue(entry), id: uuid(), createdAt };
      await db.exercises.put(exercise);
      byDemo.set(catalogueDemoKey(entry.slug), exercise);
      byName.set(normaliseName(exercise.name), exercise);
    }
    ids.push(exercise.id);
  }
  return ids;
}
