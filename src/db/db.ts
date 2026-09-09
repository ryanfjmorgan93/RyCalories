import Dexie, { type EntityTable } from 'dexie';
import type {
  Bodyweight,
  Exercise,
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
export const DB_VERSION = 1;

export class IronDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>;
  routines!: EntityTable<Routine, 'id'>;
  routineExercises!: EntityTable<RoutineExercise, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  setLogs!: EntityTable<SetLog, 'id'>;
  decisions!: EntityTable<ProgressionDecision, 'id'>;
  bodyweight!: EntityTable<Bodyweight, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

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
  }
}

export const db = new IronDB();

export const TABLE_NAMES = [
  'exercises',
  'routines',
  'routineExercises',
  'sessions',
  'setLogs',
  'decisions',
  'bodyweight',
  'settings',
] as const;
export type TableName = (typeof TABLE_NAMES)[number];
