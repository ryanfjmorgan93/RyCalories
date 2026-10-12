/**
 * Coach store: one box for the owner's messages. A message that asks for a routine is built by the
 * app itself, from the owner's own exercises and the library, with no model involved, and so is a
 * change to the routine on screen. Anything else is a free question, answered by a `CoachBackend`
 * with the conversation so far. No backend is plugged in yet (Claude is the one to come): until
 * there is one, a question is answered with one plain line. In memory only: nothing here persists,
 * and nothing opens by itself.
 */
import { create } from 'zustand';
import { loadRoutineInput } from '../db/routineBuildQueries';
import { getSettings } from '../db/repo';
import { toDateKey } from '../domain/dates';
import type { CoachTurn } from '../domain/coach';
import { applyEdit, buildCoach, buildEdit, builtTurn, describeRead, requestUsable, reshuffle, type CoachRequest } from '../domain/coachBuild';
import { routeCoachMessage, type CoachRoute } from '../domain/coachIntent';
import { parseQuickRequest } from '../domain/quickRequest';
import { routineRequestFrom, type BuiltRoutine, type RoutineInput } from '../domain/routineBuilder';
import { NO_ANSWER, untilQuiet } from './untilQuiet';

/**
 * How long an answer may take before the question is given up, so a backend that never comes back
 * cannot leave "Answering…" on screen for ever.
 */
export const ASK_TIMEOUT_MS = 60_000;

/** What a question is answered with while no backend is plugged in. */
export const NO_BACKEND_REPLY = "Questions go to Claude, which isn't set up yet.";

/** What answers a free question. */
export interface CoachBackend {
  /**
   * The whole answer to `question`, given the conversation so far (a built routine stands as the
   * coach's turn). A rejection's message is shown to the owner as the reason.
   */
  ask(question: string, thread: readonly CoachTurn[]): Promise<string>;
}

interface EntryBase {
  /** Stable for the life of the conversation: what Shuffle names. */
  id: number;
  /** What the owner typed. */
  question: string;
}

/** A question, and its answer. */
export interface AskEntry extends EntryBase {
  mode: 'ask';
  answer: string;
}

/** A routine, built by the app with no model: its routines, and what the rules read from the words. */
export interface BuildEntry extends EntryBase {
  mode: 'build';
  routines: BuiltRoutine[];
  /** The request the routines were built from: Shuffle builds it again. */
  request: CoachRequest;
  seed: number;
  /** The fact line: "shoulders, rear delts · 6 exercises". */
  read: string;
  /** The words the rules could not read, when they read nothing a routine can be built from. */
  unread: string[];
  /** What a change made to the routine before it, as a fact ("Added Hammer Curl"). Null for a routine built from the words alone. */
  edit: string | null;
}

/**
 * What a message came to: 'sent' when the coach answered it or built it, 'error' when it could not
 * (the error is in the state), 'stopped' when the owner stopped or cleared it before it finished,
 * 'ignored' when it was empty or the coach was busy with another.
 */
export type SendOutcome = 'sent' | 'error' | 'stopped' | 'ignored';

export type CoachEntry = AskEntry | BuildEntry;

export interface CoachState {
  entries: CoachEntry[];
  /** The message being worked on. */
  pending: { mode: 'ask' | 'build'; question: string } | null;
  /** The entry being shuffled. */
  working: number | null;
  error: string | null;
  /** Routes a typed message to a build, a change to the routine on screen or a question, and runs it. `build` makes it a build whatever it says. */
  send: (text: string, opts?: { build?: boolean }) => Promise<SendOutcome>;
  ask: (question: string) => Promise<SendOutcome>;
  build: (text: string) => Promise<SendOutcome>;
  /** A change to the routine on screen, said in words: "add biceps", "swap the front raise", "make it shorter". */
  edit: (text: string) => Promise<SendOutcome>;
  /** The same request built again with a new seed, in place of that entry's routines. */
  shuffle: (id: number) => Promise<void>;
  /** Stop what is being answered, built or shuffled. What is already on screen stays. */
  cancel: () => void;
  /** Clear: stop whatever is going and empty the conversation. */
  reset: () => void;
}

/**
 * The routine the conversation is about: the latest build with exercises in it. A question asked
 * since does not end it; clearing the conversation, or building another, does.
 */
export function subjectOf(entries: readonly CoachEntry[]): BuildEntry | undefined {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.mode === 'build' && e.routines.some((r) => r.rows.length > 0)) return e;
  }
  return undefined;
}

/**
 * Whether a routine is the subject of the conversation: what lets "more rear delts" mean what it
 * means after one. The latest build is the one that counts: a build that came to nothing leaves no
 * routine as the subject, however many questions were asked before or since.
 */
export function lastWasRoutine(entries: readonly CoachEntry[]): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.mode === 'build') return e.routines.some((r) => r.rows.length > 0);
  }
  return false;
}

/** Which of the coach's three jobs a message is, with the first message of a deep-linked visit always a build. */
export function routeOf(text: string, entries: readonly CoachEntry[], forceBuild = false): CoachRoute {
  return forceBuild ? 'build' : routeCoachMessage(text, { lastWasRoutine: lastWasRoutine(entries) });
}

/** The conversation as the backend is told it: every exchange, a built routine standing as the coach's turn. */
function threadFor(entries: readonly CoachEntry[]): CoachTurn[] {
  return entries.flatMap((e): CoachTurn[] => [
    { role: 'user', text: e.question },
    { role: 'coach', text: e.mode === 'ask' ? e.answer : builtTurn(e.routines, e.edit) },
  ]);
}

/** The seed is drawn here, at the edge: the builder is pure and never reads a random source. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

export const COULD_NOT_READ = 'Could not read exercises';

/** The reason shown when a backend fails without saying why. */
const COULD_NOT_ANSWER = 'Could not answer.';

/** The seams a coach store is built around. Each has a real one below; a test supplies its own. */
export interface CoachDeps {
  /** Answers a free question. Absent until Claude is plugged in: a question is then answered with `NO_BACKEND_REPLY`. */
  backend?: CoachBackend;
  /** The builder's input: the owner's exercises, the library, their routines, niggles and stalls. */
  loadBuildInput: () => Promise<RoutineInput>;
  newSeed?: () => number;
}

/**
 * Built around injected seams so tests run the real routing and builder against a fake backend.
 * `useCoach` below is the app's, on the database.
 */
export function createCoachStore({ backend, loadBuildInput, newSeed = randomSeed }: CoachDeps) {
  // Bumped by Clear: work still going from before it is dropped, not saved.
  let epoch = 0;
  let nextId = 0;
  // What a Stop or a Clear ends at once: each piece of work that can be waited on has a way out here, so its
  // message comes back as stopped while the phone, or the database, is still thinking.
  const aborts = new Set<() => void>();
  const stopAll = (): void => {
    for (const abort of [...aborts]) abort();
    aborts.clear();
  };
  /** The work, or 'stopped' as soon as it is stopped or cleared: what the work does after that is dropped by the epoch. */
  const guarded = (work: () => Promise<SendOutcome>): Promise<SendOutcome> => {
    let abort: () => void = () => undefined;
    const stopped = new Promise<SendOutcome>((resolve) => {
      abort = () => resolve('stopped');
    });
    aborts.add(abort);
    return Promise.race([work(), stopped]).finally(() => aborts.delete(abort));
  };
  return create<CoachState>((set, get) => {
    const replace = (id: number, change: (e: BuildEntry) => BuildEntry): void =>
      set({ entries: get().entries.map((e) => (e.id === id && e.mode === 'build' ? change(e) : e)) });

    return {
      entries: [],
      pending: null,
      working: null,
      error: null,

      send: async (raw, opts) => {
        const text = raw.trim();
        const { pending, working, entries } = get();
        if (!text || pending || working !== null) return 'ignored';
        const route = routeOf(text, entries, opts?.build);
        if (route === 'build') return get().build(text);
        if (route === 'edit') return get().edit(text);
        return get().ask(text);
      },

      ask: (raw) => guarded(async () => {
        const question = raw.trim();
        const { pending, entries } = get();
        if (pending || !question) return 'ignored';
        if (!backend) {
          set({ entries: [...entries, { id: nextId++, mode: 'ask', question, answer: NO_BACKEND_REPLY }], error: null });
          return 'sent';
        }

        const mine = epoch;
        const current = () => epoch === mine;
        set({ pending: { mode: 'ask', question }, error: null });
        try {
          const answer = (await untilQuiet(ASK_TIMEOUT_MS, () => backend.ask(question, threadFor(entries)))).trim();
          if (!current()) return 'stopped';
          if (!answer) {
            set({ pending: null, error: NO_ANSWER });
            return 'error';
          }
          set({ entries: [...get().entries, { id: nextId++, mode: 'ask', question, answer }], pending: null });
          return 'sent';
        } catch (e) {
          if (!current()) return 'stopped';
          set({ pending: null, error: e instanceof Error && e.message ? e.message : COULD_NOT_ANSWER });
          return 'error';
        }
      }),

      build: (raw) => guarded(async () => {
        const text = raw.trim();
        if (get().pending || !text) return 'ignored';
        const mine = epoch;
        const current = () => epoch === mine;
        set({ pending: { mode: 'build', question: text }, error: null });
        try {
          const parsed = parseQuickRequest(text);
          const request: CoachRequest = routineRequestFrom(parsed);
          const input = await loadBuildInput();
          if (!current()) return 'stopped';
          const seed = newSeed();
          const routines = buildCoach(input, request, seed);
          const entry: BuildEntry = {
            id: nextId++,
            mode: 'build',
            question: text,
            routines,
            request,
            seed,
            read: describeRead(request, routines),
            // Words the rules could not read are said when they read nothing to build to; a routine is
            // built either way, by need, so there is never nothing on screen.
            unread: !requestUsable(request) ? parsed.residue : [],
            edit: null,
          };
          set({ entries: [...get().entries, entry], pending: null });
          return 'sent';
        } catch {
          if (!current()) return 'stopped';
          set({ pending: null, error: COULD_NOT_READ });
          return 'error';
        }
      }),

      edit: (raw) => guarded(async () => {
        const text = raw.trim();
        if (get().pending || get().working !== null || !text) return 'ignored';
        const subject = subjectOf(get().entries);
        // With no routine to change, the words are a request for one.
        if (!subject) return get().build(text);
        const mine = epoch;
        const current = () => epoch === mine;
        set({ pending: { mode: 'build', question: text }, error: null });
        try {
          const input = await loadBuildInput();
          if (!current()) return 'stopped';
          const plan = applyEdit(subject.request, subject.routines, text, subject.seed);
          if (!plan.ok) {
            set({ pending: null, error: plan.reason });
            return 'error';
          }
          const built = buildEdit(input, plan, subject.routines, newSeed);
          const entry: BuildEntry = {
            id: nextId++,
            mode: 'build',
            question: text,
            routines: built.routines,
            request: built.request,
            seed: built.seed,
            read: describeRead(built.request, built.routines),
            unread: [],
            edit: built.fact,
          };
          set({ entries: [...get().entries, entry], pending: null });
          return 'sent';
        } catch {
          if (!current()) return 'stopped';
          set({ pending: null, error: COULD_NOT_READ });
          return 'error';
        }
      }),

      shuffle: async (id) => {
        const entry = get().entries.find((e) => e.id === id);
        if (!entry || entry.mode !== 'build' || get().pending || get().working !== null) return;
        const mine = epoch;
        set({ working: id, error: null });
        try {
          const input = await loadBuildInput();
          if (epoch !== mine) return;
          const { routines, seed } = reshuffle(input, entry.request, entry.routines, newSeed);
          replace(id, (e) => ({ ...e, routines, seed, read: describeRead(e.request, routines), edit: null }));
          set({ working: null });
        } catch {
          if (epoch === mine) set({ working: null, error: COULD_NOT_READ });
        }
      },

      cancel: () => {
        if (get().pending === null && get().working === null) return;
        epoch++;
        stopAll();
        set({ pending: null, working: null, error: null });
      },

      reset: () => {
        epoch++;
        stopAll();
        set({ entries: [], error: null, pending: null, working: null });
      },
    };
  });
}

export const useCoach = createCoachStore({
  loadBuildInput: async () => loadRoutineInput({ today: toDateKey(), settings: await getSettings() }),
});
