import Dexie, { type EntityTable } from 'dexie';
import { installLossGuardMiddleware } from './lossGuard';
import type {
  Bodyweight,
  Exercise,
  FoodMemory,
  Meal,
  MealItem,
  Phase,
  ProductCacheEntry,
  ProgressionDecision,
  Recipe,
  Routine,
  RoutineExercise,
  Session,
  SetLog,
  Settings,
} from '@/domain/types';

/**
 * Local-first store. Every table is keyed by a stable UUID string so that a
 * future sync layer can ship rows as-is (no autoincrement keys anywhere).
 */
/**
 * Current Dexie schema version. Exported so the recovery screen can report what it attempted, and
 * hand-maintained: it must equal the highest `this.version(n)` declared below. Nothing computes it
 * automatically, and letting it drift is not cosmetic — src/db/historySafety.ts's pre-migration
 * backup gates on `probe.version < DB_VERSION * 10`, settingsQueries' "behind" flag and the
 * recovery screen both read it directly, and a `DB_VERSION` left one behind the schema means the
 * pre-migration backup silently never fires for that upgrade. `src/db/db.test.ts` asserts this
 * against the live `db.verno` so the two cannot drift apart unnoticed.
 */
export const DB_VERSION = 3;

/** The IndexedDB database name, exported so callers that must talk to it raw (recovery, the
 * pre-migration backup) do not each hardcode it. src/boot/recovery.ts keeps its own copy
 * deliberately — see the note on its `dumpRaw`. */
export const DB_NAME = 'iron';

export class IronDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  routineExercises!: EntityTable<RoutineExercise, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  setLogs!: EntityTable<SetLog, 'id'>;
  decisions!: EntityTable<ProgressionDecision, 'id'>;
  bodyweight!: EntityTable<Bodyweight, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  meals!: EntityTable<Meal, 'id'>;
  mealItems!: EntityTable<MealItem, 'id'>;
  foods!: EntityTable<FoodMemory, 'id'>;
  productCache!: EntityTable<ProductCacheEntry, 'key'>;
  phases!: EntityTable<Phase, 'id'>;
  recipes!: EntityTable<Recipe, 'id'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      exercises: 'id, name, kind, muscleGroup, createdAt',
      routines: 'id, order, archived',
      routineExercises: 'id, routineId, exerciseId, [routineId+order]',
      sessions: 'id, routineId, startedAt, endedAt, source',
      setLogs:
        'id, sessionId, routineExerciseId, exerciseId, completedAt, [sessionId+exerciseId], [sessionId+routineExerciseId], [exerciseId+completedAt], [routineExerciseId+completedAt]',
      decisions: 'id, sessionId, routineExerciseId, decidedAt, [routineExerciseId+decidedAt]',
      bodyweight: 'id, date',
      settings: 'id',
    });

    // Version 2 adds nutrition. Deliberately declared as a DELTA: Dexie's stores() accumulates
    // across versions rather than redeclaring, so the eight workout tables above are inherited
    // untouched and only an explicit `null` would drop one. That is the mechanical reason this
    // upgrade cannot endanger the training history.
    //
    // There is no upgrade callback on purpose. Adding one that awaits crypto.subtle (as
    // stableUuid does) would raise TransactionInactiveError on a real WebView while passing
    // under fake-indexeddb — a test that goes green on a pattern that bricks the phone. Any
    // future upgrade here must mint every id BEFORE opening the transaction, as hevy.ts does.
    this.version(2).stores({
      meals: 'id, date, loggedAt, [date+loggedAt]',
      mealItems: 'id, mealId, name, [mealId+index]',
      foods: 'id, key, name, lastUsedAt',
      productCache: 'key, fetchedAt',
      phases: 'id, startDate',
    });

    // Version 3 adds recipes (cooked meals). Additive DELTA, same as version 2 above: every table
    // declared so far is inherited untouched, and there is deliberately no upgrade callback — see
    // the comment on version(2) for why one that awaits (e.g. stableUuid's crypto.subtle) would
    // pass under fake-indexeddb while bricking a real WebView. A `Recipe` row embeds its
    // ingredients (src/domain/types.ts), so one `put` is atomic and no child table is needed.
    this.version(3).stores({
      recipes: 'id, name, updatedAt',
    });
  }
}

export const db = new IronDB();
// Must be registered before the database is opened (Dexie opens lazily on first operation, so
// this runs in time as long as nothing above this line touches `db`). See lossGuard.ts.
installLossGuardMiddleware(db);

/**
 * Every table a backup covers. Adding a table here without adding it to `Backup['tables']` in
 * backup.ts would make replace-restore clear it and never repopulate it, so the two lists are
 * kept deliberately in lockstep.
 */
export const TABLE_NAMES = [
  'exercises',
  'routines',
  'routineExercises',
  'sessions',
  'setLogs',
  'decisions',
  'bodyweight',
  'settings',
  'meals',
  'mealItems',
  'foods',
  'productCache',
  'phases',
  'recipes',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];
