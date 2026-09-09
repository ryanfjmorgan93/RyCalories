import Dexie, { type EntityTable } from 'dexie';
import type {
  Bodyweight,
  Exercise,
  FoodMemory,
  Meal,
  MealItem,
  Phase,
  ProductCacheEntry,
  ProgressionDecision,
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
/** Current Dexie schema version. Exported so the recovery screen can report what it attempted. */
export const DB_VERSION = 2;

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

  constructor(name = 'iron') {
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
  }
}

export const db = new IronDB();

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
] as const;
export type TableName = (typeof TABLE_NAMES)[number];
