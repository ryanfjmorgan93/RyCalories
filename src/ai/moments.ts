/**
 * The coach speaking first.
 *
 * `momentLine(moment, facts)` is one small Haiku 5.5 request for a moment in the owner's day (the app
 * opening, a set, an exercise, the end of a session, a meal, the end of the day). It gets the facts
 * the caller has, the persona's quiet-unless-useful rules and the cached context, and returns one
 * or two sentences, or `null` when the coach has nothing worth saying: an empty reply, a refusal to
 * speak, offline, no key, over the cap, any failure at all. It never throws, never shows an error,
 * and spends nothing when it cannot speak. Haiku is called with thinking disabled and low effort
 * (it is a one-liner), max_tokens 200.
 *
 * The line it says is stored in `coachMessages` with its moment, which is how "what you have already
 * said today" (context.ts) reaches the next call and how the coach line on Home survives a restart.
 *
 * 'open' is debounced: once per three hours, unless the facts have changed since it last spoke.
 *
 * `weeklyReview(facts)` is the one Sonnet 5.5 call here (effort medium): the Monday review, and
 * optionally a proposed change to the calorie or protein target for the UI to offer. It throws a
 * `ClaudeError` instead of staying quiet, because the owner asked for it by name.
 */
import * as z from 'zod/v4';
import { db } from '@/db/db';
import { nowIso, toDateKey } from '@/domain/dates';
import { uuid } from '@/domain/ids';
import type { CoachMoment } from '@/domain/types';
import { blockedReason, createMessage, HAIKU, SONNET, textOf, type CallDeps } from './client';
import { buildStableContext, buildVolatileContext, type ContextOptions } from './context';
import { MOMENT_RULES, personaWith, REVIEW_RULES } from './persona';
import { toStrictJsonSchema } from './schema';
import { lsGetJson, lsSet } from './store';

export type Moment = Exclude<CoachMoment, 'week'>;

/** What the caller knows about the moment: simple values the coach can read. Order is kept. */
export type MomentFacts = Record<string, string | number | boolean | null | undefined | readonly (string | number)[]>;

export const MOMENT_MAX_TOKENS = 200;
export const OPEN_DEBOUNCE_MS = 3 * 60 * 60 * 1000;
export const OPEN_STORAGE = 'iron.claudeOpenMoment';
/** How long the stable context is reused between moments. Chat always builds it fresh. */
export const STABLE_TTL_MS = 10 * 60 * 1000;

export interface MomentOptions extends CallDeps {
  context?: ContextOptions;
  /** Store the line in coachMessages. Default true. */
  persist?: boolean;
  /** The clock for the debounce and the stored timestamp. Defaults to now. */
  now?: Date;
}

const MOMENT_TEXT: Record<Moment, string> = {
  open: 'The owner has just opened the app.',
  set: 'The owner has just logged a set.',
  exercise: 'The owner has just finished the last set of an exercise.',
  session: 'The owner has just finished their session.',
  meal: 'The owner has just logged a meal.',
  day: 'The day is nearly over. Look back over it.',
};

/** The facts as the prompt shows them: "- key: value", arrays joined, empty values left out. */
export function factsText(facts: MomentFacts): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(facts)) {
    if (value === undefined || value === null || value === '') continue;
    lines.push(`- ${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  }
  return lines.length > 0 ? lines.join('\n') : '- (no further facts)';
}

/** A short stable hash of the facts, independent of key order (FNV-1a over the sorted lines). */
export function hashFacts(facts: MomentFacts): string {
  const text = factsText(Object.fromEntries(Object.entries(facts).sort(([a], [b]) => a.localeCompare(b))));
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

interface OpenMark {
  at: number;
  hash: string;
}

function isOpenMark(v: unknown): v is OpenMark {
  return typeof v === 'object' && v !== null && typeof (v as OpenMark).at === 'number' && typeof (v as OpenMark).hash === 'string';
}

/** Whether the app-open line may speak now: not within three hours of the last one, unless the facts are different. */
export function openMayAsk(hash: string, now: Date): boolean {
  const mark = lsGetJson(OPEN_STORAGE, isOpenMark);
  if (!mark) return true;
  return mark.hash !== hash || now.getTime() - mark.at >= OPEN_DEBOUNCE_MS;
}

const SILENCE = /^\W*(nothing|none|no comment|nothing to say|quiet|silence|silent|n\/a|skip|pass)\W*$/i;

/**
 * A reply as the line to show: trimmed, unquoted, and null for silence in any of its forms (empty,
 * or the word "nothing"). A reply that runs long is cut at its last full sentence.
 */
export function tidyLine(reply: string): string | null {
  let text = reply.trim().replace(/^["“”']+|["“”']+$/g, '').trim();
  if (!text || SILENCE.test(text)) return null;
  if (text.length > 420) {
    const cut = text.slice(0, 420);
    const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    text = end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, 417).trimEnd()}…`;
  }
  return text;
}

// The stable context is the expensive part to build, and a moment can come after every set; it is
// reused for ten minutes (a routine edited a minute ago is not worth a rebuild for a one-liner).
let stableCache: { day: string; at: number; text: string } | null = null;

export function resetMomentCache(): void {
  stableCache = null;
}

async function stableFor(now: Date, context: ContextOptions | undefined, volatileChars: number): Promise<string> {
  const day = toDateKey(now);
  if (stableCache && stableCache.day === day && now.getTime() - stableCache.at < STABLE_TTL_MS) return stableCache.text;
  const text = await buildStableContext({ ...context, now, volatileChars });
  stableCache = { day, at: now.getTime(), text };
  return text;
}

const inflight = new Set<string>();

/**
 * One line from the coach for a moment, or null. Never throws.
 */
export async function momentLine(moment: Moment, facts: MomentFacts = {}, opts: MomentOptions = {}): Promise<string | null> {
  const now = opts.now ?? new Date();
  // Silent when Claude cannot be called: no key, offline, over the cap. Checked before the debounce
  // is touched, so a quiet moment does not use up the next chance.
  if (blockedReason(now) !== null) return null;

  const hash = hashFacts(facts);
  const guardKey = `${moment}:${hash}`;
  if (inflight.has(guardKey)) return null;
  if (moment === 'open' && !openMayAsk(hash, now)) return null;
  inflight.add(guardKey);
  try {
    const volatile = await buildVolatileContext({ ...opts.context, now });
    const stable = await stableFor(now, opts.context, volatile.length);
    const message = await createMessage(
      {
        model: HAIKU,
        max_tokens: MOMENT_MAX_TOKENS,
        thinking: { type: 'disabled' },
        output_config: { effort: 'low' },
        system: [
          { type: 'text', text: `${personaWith(MOMENT_RULES)}\n\n${stable}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: volatile },
        ],
        messages: [{ role: 'user', content: `${MOMENT_TEXT[moment]}\n\nFacts:\n${factsText(facts)}` }],
      },
      opts,
    );
    // The debounce counts the ask, not the answer: an empty reply to these facts is not asked again.
    if (moment === 'open') lsSet(OPEN_STORAGE, JSON.stringify({ at: now.getTime(), hash } satisfies OpenMark));
    const line = tidyLine(textOf(message.content));
    if (line && opts.persist !== false) {
      // A line that cannot be stored is still worth showing once.
      await db.coachMessages.put({ id: uuid(), at: nowIso(), role: 'coach', text: line, moment }).catch(() => undefined);
    }
    return line;
  } catch {
    return null;
  } finally {
    inflight.delete(guardKey);
  }
}

// ---------------------------------------------------------------------------
// Weekly review

export interface TargetProposal {
  calories?: number;
  protein?: number;
}

export interface WeeklyReview {
  text: string;
  /** A change to the targets for the owner to accept or ignore. Absent when the review proposes none. */
  proposal?: TargetProposal;
}

const ReviewShape = z.object({
  review: z.string().describe('The review, for the owner to read'),
  propose_calories: z.number().optional().describe('A new daily calorie target, only if the numbers clearly call for one'),
  propose_protein: z.number().optional().describe('A new daily protein target in grams, only if the numbers clearly call for one'),
});

export const REVIEW_SCHEMA = toStrictJsonSchema(ReviewShape);

const CALORIES_RANGE: [number, number] = [1200, 6000];
const PROTEIN_RANGE: [number, number] = [40, 400];

function inRange(n: number | undefined, [lo, hi]: [number, number]): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
}

/** The review's text and any target change it proposes, from the model's structured answer (or, failing that, its plain text). */
export function parseReview(raw: string): WeeklyReview {
  let parsed: z.infer<typeof ReviewShape> | null = null;
  try {
    const result = ReviewShape.safeParse(JSON.parse(raw));
    if (result.success) parsed = result.data;
  } catch {
    parsed = null;
  }
  if (!parsed) return { text: raw.trim() };
  const proposal: TargetProposal = {};
  if (inRange(parsed.propose_calories, CALORIES_RANGE)) proposal.calories = Math.round(parsed.propose_calories);
  if (inRange(parsed.propose_protein, PROTEIN_RANGE)) proposal.protein = Math.round(parsed.propose_protein);
  return { text: parsed.review.trim(), ...(Object.keys(proposal).length > 0 ? { proposal } : {}) };
}

export interface ReviewOptions extends MomentOptions {}

/**
 * The Monday review: Sonnet 5.5 at medium effort over the full context and the week's facts.
 * Throws a `ClaudeError` (no key, offline, over the cap, a failed call). The text is stored as a
 * coach message for the 'week' moment unless `persist` is false.
 */
export async function weeklyReview(facts: MomentFacts = {}, opts: ReviewOptions = {}): Promise<WeeklyReview> {
  const now = opts.now ?? new Date();
  const volatile = await buildVolatileContext({ ...opts.context, now });
  const stable = await buildStableContext({ ...opts.context, now, volatileChars: volatile.length });
  const message = await createMessage(
    {
      model: SONNET,
      max_tokens: 2000,
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: REVIEW_SCHEMA } },
      system: [
        { type: 'text', text: `${personaWith(REVIEW_RULES)}\n\n${stable}`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: volatile },
      ],
      messages: [{ role: 'user', content: `It is time for the weekly review.\n\nFacts:\n${factsText(facts)}` }],
    },
    opts,
  );
  const review = parseReview(textOf(message.content));
  if (review.text && opts.persist !== false) {
    await db.coachMessages.put({ id: uuid(), at: nowIso(), role: 'coach', text: review.text, moment: 'week' });
  }
  return review;
}
