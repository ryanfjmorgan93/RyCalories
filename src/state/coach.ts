/**
 * Coach store: one box for the owner's messages. A message that asks for a routine is built by the
 * app itself, from the owner's own exercises and the library, with no model involved; anything else
 * is a question, sent to the phone's own Gemini Nano (the fuller variant) with the conversation so
 * far, the last routine built and why, and as much of the owner's data as fits. In memory only —
 * nothing here persists, and nothing opens by itself.
 */
import { create } from 'zustand';
import { loadClaudeSummaryInput } from '../db/claudeSummaryQueries';
import { loadRoutineInput } from '../db/routineBuildQueries';
import { getSettings } from '../db/repo';
import { toDateKey } from '../domain/dates';
import type { ClaudeSummaryInput } from '../domain/claudeSummary';
import { buildCoachSystemPrompt, coachContextLadder, fitCoachPrompt, promptShapes, shapedPrompt, type CoachTurn } from '../domain/coach';
import { builtTurn, describeRead, readUsable, requestUsable, reshuffle } from '../domain/coachBuild';
import { routeCoachMessage, type CoachRoute } from '../domain/coachIntent';
import { mergeIntent, parseQuickRequest, type QuickOptions } from '../domain/quickRequest';
import { buildRoutines, routineRequestFrom, type BuiltRoutine, type RoutineInput, type RoutineRequest } from '../domain/routineBuilder';
import { useAssistant } from './assistant';
import { describeAnalyzeMealError, Nano, type NanoStatus } from './nano';
import { useQuickIntent } from './quickIntent';
import { untilQuiet } from './untilQuiet';

/** Room left in the model's limit for the answer. */
export const REPLY_TOKENS = 600;

/**
 * How long the model may go quiet before the question is given up. Counting is quick. An answer
 * gets longer: the fuller variant can take many seconds to read a few thousand tokens before its
 * first word, so the clock restarts with every piece that arrives rather than timing the whole.
 * Without these, a model dropped mid-question (AICore evicting it, say) left "Answering…" for ever.
 */
export const COUNT_TIMEOUT_MS = 20_000;
export const QUIET_TIMEOUT_MS = 120_000;

export interface CoachBackend {
  status(): Promise<NanoStatus>;
  /** Starts AICore's download of the fuller variant; progress arrives as `nanoDownload` events. */
  download(): Promise<void>;
  countTokens(system: string, prompt: string): Promise<{ tokens: number; limit: number }>;
  /** Streams the answer through `onText`, one piece at a time; resolves with the whole of it. */
  stream(system: string, prompt: string, maxOutputTokens: number, onText: (piece: string) => void): Promise<string>;
}

let nextRequest = 0;

/** The plugin's fuller variant ('full'), streamed through `nanoStream` events. */
export class NanoCoachBackend implements CoachBackend {
  status(): Promise<NanoStatus> {
    return Nano.status({ model: 'full' });
  }

  async download(): Promise<void> {
    await Nano.download({ model: 'full' });
  }

  countTokens(system: string, prompt: string) {
    return Nano.countTokens({ model: 'full', system, prompt });
  }

  async stream(system: string, prompt: string, maxOutputTokens: number, onText: (piece: string) => void): Promise<string> {
    const requestId = `coach-${++nextRequest}`;
    const handle = await Nano.addListener('nanoStream', (e) => {
      if (e.requestId === requestId) onText(e.text);
    });
    try {
      const { text } = await Nano.generateStream({ model: 'full', system, prompt, requestId, maxOutputTokens, temperature: 0.3 });
      return text;
    } finally {
      await handle.remove();
    }
  }
}

/** What a tap on "Read with assistant" came to, when it changed nothing: shown in place of the button. */
export type AssistOutcome = { kind: 'nothing' } | { kind: 'error'; message: string };

interface EntryBase {
  /** Stable for the life of the conversation: what Shuffle and "Read with assistant" name. */
  id: number;
  /** What the owner typed. */
  question: string;
}

/** A question, answered by the model. */
export interface AskEntry extends EntryBase {
  mode: 'ask';
  /** What the answer was given to read, e.g. "training 8 weeks · food 4 weeks". */
  label: string;
  answer: string;
}

/** A routine, built by the app with no model: its routines, and what the rules read from the words. */
export interface BuildEntry extends EntryBase {
  mode: 'build';
  routines: BuiltRoutine[];
  /** The request the routines were built from: Shuffle builds it again. */
  request: RoutineRequest;
  seed: number;
  /** The fact line: "shoulders, rear delts · 6 exercises". */
  read: string;
  /** Who read the words: the rules, or the on-device assistant on the owner's tap. */
  by: 'rules' | 'assistant';
  /** The words the rules could not read, when they read nothing a routine can be built from and the assistant could be asked. */
  unread: string[];
  assist: AssistOutcome | null;
}

export type CoachEntry = AskEntry | BuildEntry;

/** What the coach asks of the default on-device model: whether it can read a typed line, and to read one on the owner's tap. */
export interface CoachIntent {
  /** Whether the model can answer right now, asked afresh. */
  ready(): Promise<boolean>;
  /** The options it names in `text`: null when it did not answer or named none, with why when it failed. */
  read(text: string): Promise<{ options: Partial<QuickOptions> | null; error: string | null }>;
}

export interface CoachState {
  status: NanoStatus | null;
  entries: CoachEntry[];
  /** The message being worked on, and for a question the answer so far. */
  pending: { mode: 'ask' | 'build'; question: string; label: string; partial: string } | null;
  /** The entry being shuffled or read with the assistant. */
  working: number | null;
  error: string | null;
  refreshStatus: () => Promise<void>;
  download: () => Promise<void>;
  /** Routes a typed message to a build or a question and runs it. `build` makes it a build whatever it says. */
  send: (text: string, opts?: { build?: boolean }) => Promise<void>;
  ask: (question: string) => Promise<void>;
  build: (text: string) => Promise<void>;
  /** The same request built again with a new seed, in place of that entry's routines. */
  shuffle: (id: number) => Promise<void>;
  /** One call to the default model on the owner's tap: only options come back, and the routine is built again with them. */
  readWithAssistant: (id: number) => Promise<void>;
  reset: () => void;
}

/** Whether the coach's last reply was a routine it built: what lets "more rear delts" mean what it means after one. */
export function lastWasRoutine(entries: readonly CoachEntry[]): boolean {
  const last = entries[entries.length - 1];
  return last !== undefined && last.mode === 'build' && last.routines.some((r) => r.rows.length > 0);
}

/** Which of the coach's two jobs a message is, with the first message of a deep-linked visit always a build. */
export function routeOf(text: string, entries: readonly CoachEntry[], forceBuild = false): CoachRoute {
  return forceBuild ? 'build' : routeCoachMessage(text, { lastWasRoutine: lastWasRoutine(entries) });
}

/** The routines of the last build in the conversation: what a question about "this" is about. */
export function lastRoutines(entries: readonly CoachEntry[]): BuiltRoutine[] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.mode === 'build' && e.routines.some((r) => r.rows.length > 0)) return e.routines;
  }
  return [];
}

/** The conversation as the model is told it: every exchange, a built routine standing as the coach's turn. */
function threadFor(entries: readonly CoachEntry[]): CoachTurn[] {
  return entries.flatMap((e): CoachTurn[] => [
    { role: 'user', text: e.question },
    { role: 'coach', text: e.mode === 'ask' ? e.answer : builtTurn(e.routines) },
  ]);
}

/** The seed is drawn here, at the edge: the builder is pure and never reads a random source. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

export const COULD_NOT_READ = 'Could not read exercises';

/** The default model, through the assistant's status and the short session's intent reader. */
export const nanoIntent: CoachIntent = {
  async ready() {
    await useAssistant.getState().refreshStatus();
    return useAssistant.getState().status?.state === 'ready';
  },
  async read(text) {
    const options = await useQuickIntent.getState().read(text);
    return { options, error: useQuickIntent.getState().error };
  },
};

/** The seams a coach store is built around. Each has a real one below; a test supplies its own. */
export interface CoachDeps {
  backend: CoachBackend;
  /** The owner's data for a question. */
  loadInput: () => Promise<ClaudeSummaryInput>;
  /** The builder's input: the owner's exercises, the library, their routines, niggles and stalls. */
  loadBuildInput: () => Promise<RoutineInput>;
  intent?: CoachIntent;
  newSeed?: () => number;
}

/** Thrown inside a question that Clear has since dropped: it stops where it is, and nothing of it is kept. */
class Superseded extends Error {}

/**
 * Built around injected seams so tests run the real ladder, fitting, routing and builder against a
 * fake model. `useCoach` below is the app's, on the Nano plugin and the database.
 */
export function createCoachStore({ backend, loadInput, loadBuildInput, intent = nanoIntent, newSeed = randomSeed }: CoachDeps) {
  // Bumped by Clear: work still going from before it is dropped, not saved.
  let epoch = 0;
  let nextId = 0;
  return create<CoachState>((set, get) => {
    const replace = (id: number, change: (e: BuildEntry) => BuildEntry): void =>
      set({ entries: get().entries.map((e) => (e.id === id && e.mode === 'build' ? change(e) : e)) });

    return {
      status: null,
      entries: [],
      pending: null,
      working: null,
      error: null,

      refreshStatus: async () => {
        try {
          set({ status: await backend.status() });
        } catch (e) {
          set({ status: { state: 'unavailable', detail: describeAnalyzeMealError(e) } });
        }
      },

      download: async () => {
        try {
          await backend.download();
        } catch (e) {
          set({ error: describeAnalyzeMealError(e) });
        }
      },

      send: async (raw, opts) => {
        const text = raw.trim();
        const { pending, working, entries } = get();
        if (!text || pending || working !== null) return;
        if (routeOf(text, entries, opts?.build) === 'build') await get().build(text);
        else await get().ask(text);
      },

      ask: async (raw) => {
        const question = raw.trim();
        const { pending, status, entries } = get();
        if (pending || !question) return;
        if (!status) {
          set({ error: 'Status not checked yet.' });
          return;
        }
        if (status.state !== 'ready') {
          set({ error: status.state === 'unavailable' ? status.detail : 'Model not downloaded.' });
          return;
        }

        const mine = epoch;
        const current = () => epoch === mine;
        set({ pending: { mode: 'ask', question, label: '', partial: '' }, error: null });
        try {
          const system = buildCoachSystemPrompt('ask');
          const thread = threadFor(entries);
          const routines = lastRoutines(entries);
          const ladder = coachContextLadder(await loadInput(), question, 'ask');
          // The oldest turns go first, then the owner's data, then the routine's reasons: see `promptShapes`.
          const fit = await fitCoachPrompt(
            promptShapes(thread.length, ladder.length, routines.length > 0),
            async (shape) => {
              const counted = await untilQuiet(COUNT_TIMEOUT_MS, () => backend.countTokens(system, shapedPrompt(shape, ladder, thread, question, routines).prompt));
              if (!current()) throw new Superseded();
              return counted;
            },
            REPLY_TOKENS,
          );
          if (!current()) return;
          if (!fit) {
            set({ pending: null, error: 'Question too long for the model.' });
            return;
          }
          const { label, prompt } = shapedPrompt(fit.shape, ladder, thread, question, routines);
          set({ pending: { mode: 'ask', question, label, partial: '' } });
          const whole = await untilQuiet(QUIET_TIMEOUT_MS, (touch) =>
            backend.stream(system, prompt, REPLY_TOKENS, (piece) => {
              touch();
              const p = get().pending;
              if (p && current()) set({ pending: { ...p, partial: p.partial + piece } });
            }),
          );
          if (!current()) return;
          const answer = whole.trim();
          if (!answer) {
            set({ pending: null, error: 'The model did not answer.' });
            return;
          }
          set({ entries: [...get().entries, { id: nextId++, mode: 'ask', question, label, answer }], pending: null });
        } catch (e) {
          if (current()) set({ pending: null, error: describeAnalyzeMealError(e) });
        }
      },

      build: async (raw) => {
        const text = raw.trim();
        if (get().pending || !text) return;
        const mine = epoch;
        const current = () => epoch === mine;
        set({ pending: { mode: 'build', question: text, label: '', partial: '' }, error: null });
        try {
          const parsed = parseQuickRequest(text);
          const request = routineRequestFrom(parsed);
          // Words the rules could not read are offered to the model on a tap, and only when the rules read
          // nothing to build to; a routine is built either way, by need, so there is never nothing on screen.
          const offer = !requestUsable(request) && parsed.residue.length > 0 && (await intent.ready());
          if (!current()) return;
          const input = await loadBuildInput();
          if (!current()) return;
          const seed = newSeed();
          const routines = buildRoutines(input, request, seed);
          const entry: BuildEntry = {
            id: nextId++,
            mode: 'build',
            question: text,
            routines,
            request,
            seed,
            read: describeRead(request, routines),
            by: 'rules',
            unread: offer ? parsed.residue : [],
            assist: null,
          };
          set({ entries: [...get().entries, entry], pending: null });
        } catch {
          if (current()) set({ pending: null, error: COULD_NOT_READ });
        }
      },

      shuffle: async (id) => {
        const entry = get().entries.find((e) => e.id === id);
        if (!entry || entry.mode !== 'build' || get().pending || get().working !== null) return;
        const mine = epoch;
        set({ working: id, error: null });
        try {
          const input = await loadBuildInput();
          if (epoch !== mine) return;
          const { routines, seed } = reshuffle(input, entry.request, entry.routines, newSeed);
          replace(id, (e) => ({ ...e, routines, seed, read: describeRead(e.request, routines) }));
          set({ working: null });
        } catch {
          if (epoch === mine) set({ working: null, error: COULD_NOT_READ });
        }
      },

      readWithAssistant: async (id) => {
        const entry = get().entries.find((e) => e.id === id);
        if (!entry || entry.mode !== 'build' || entry.unread.length === 0 || entry.assist?.kind === 'nothing' || get().pending || get().working !== null) return;
        const mine = epoch;
        set({ working: id, error: null });
        try {
          const { options, error } = await intent.read(entry.question);
          if (epoch !== mine) return;
          const parsed = parseQuickRequest(entry.question);
          const merged = options ? mergeIntent(parsed.options, options) : null;
          if (!merged || !readUsable(merged, parsed.split)) {
            replace(id, (e) => ({ ...e, assist: error ? { kind: 'error', message: error } : { kind: 'nothing' } }));
            set({ working: null });
            return;
          }
          const request = routineRequestFrom({ ...parsed, options: merged });
          const input = await loadBuildInput();
          if (epoch !== mine) return;
          const routines = buildRoutines(input, request, entry.seed);
          replace(id, (e) => ({ ...e, request, routines, read: describeRead(request, routines), by: 'assistant', unread: [], assist: null }));
          set({ working: null });
        } catch {
          if (epoch === mine) set({ working: null, error: COULD_NOT_READ });
        }
      },

      reset: () => {
        epoch++;
        set({ entries: [], error: null, pending: null, working: null });
      },
    };
  });
}

const ALL_SECTIONS = { training: true, food: true, bodyweight: true, routines: true };

/** 26 weeks of training, so a question naming an exercise can read its whole recent history. */
export const COACH_WINDOWS = { trainingDays: 182, foodDays: 28, bodyweightDays: 56 };

export const useCoach = createCoachStore({
  backend: new NanoCoachBackend(),
  loadInput: async () => loadClaudeSummaryInput(toDateKey(), ALL_SECTIONS, await getSettings(), COACH_WINDOWS),
  loadBuildInput: async () => loadRoutineInput({ today: toDateKey(), settings: await getSettings() }),
});
