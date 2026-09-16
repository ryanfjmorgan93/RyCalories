/**
 * Pure prompt-building for the on-device assistant (Gemini Nano). No IO, no clock: every input
 * the caller needs is passed in explicitly so this stays trivially testable and the prompt sent
 * to the model is fully deterministic for a given input.
 */

export interface AssistantContext {
  today: string;
  exercise?: {
    name: string;
    muscleGroup: string;
    cue?: string;
    notes?: string;
    prescription?: string;
    lastSessions: { date: string; sets: string }[];
    bests?: string;
    stall?: string;
  };
  session?: { title: string; elapsedMin: number; logged: string[] };
  plan?: { routine: string; exercises: string[] };
  bodyweight?: { latestKg: number; weeklyDeltaKg?: number };
  nutrition?: { kcal: number; kcalTarget?: number; proteinG: number; proteinTargetG?: number };
}

export type AssistantTurn = { role: 'user' | 'assistant'; text: string };

/** Cap on the number of items shown from any list in the context block. */
const LIST_CAP = 3;
/** Cap on the whole context block, in words, so the prompt stays well under the model's ~4,000-token limit. */
const CONTEXT_WORD_CAP = 350;
/** Cap on a trimmed reply, in characters. */
const REPLY_CHAR_CAP = 1200;
/** Turns of prior conversation carried into the prompt. */
const THREAD_TURN_CAP = 4;

export function buildSystemPrompt(): string {
  return [
    "You are a concise lifting assistant built into the user's own training app.",
    'Answer only what is asked, as briefly as the question allows. Use kilograms and British English.',
    'No motivational filler, tips or coaching prose — state facts.',
    'When the answer depends on the data below, use it. If you do not know, say so.',
  ].join('\n');
}

/** Compact labelled lines describing the user's current data. Empty parts are omitted entirely. */
export function buildContextBlock(ctx: AssistantContext): string {
  const lines: string[] = [];

  if (ctx.today) lines.push(`Today: ${ctx.today}`);

  const e = ctx.exercise;
  if (e) {
    lines.push(`Exercise: ${e.name} (${e.muscleGroup})`);
    if (e.cue) lines.push(`Cue: ${e.cue}`);
    if (e.notes) lines.push(`Notes: ${e.notes}`);
    if (e.prescription) lines.push(`Prescription: ${e.prescription}`);
    if (e.lastSessions.length) {
      const items = e.lastSessions.slice(0, LIST_CAP).map((s) => `${s.date} ${s.sets}`);
      lines.push(`Last sessions: ${items.join('; ')}`);
    }
    if (e.bests) lines.push(`Bests: ${e.bests}`);
    if (e.stall) lines.push(`Stall: ${e.stall}`);
  }

  const s = ctx.session;
  if (s) {
    lines.push(`Session: ${s.title} (${s.elapsedMin} min)`);
    if (s.logged.length) lines.push(`Logged: ${s.logged.slice(0, LIST_CAP).join('; ')}`);
  }

  const p = ctx.plan;
  if (p) {
    const items = p.exercises.slice(0, LIST_CAP);
    lines.push(`Plan: ${p.routine}${items.length ? ` — ${items.join(', ')}` : ''}`);
  }

  const b = ctx.bodyweight;
  if (b) {
    const delta = b.weeklyDeltaKg !== undefined ? ` (${b.weeklyDeltaKg >= 0 ? '+' : ''}${b.weeklyDeltaKg} kg/wk)` : '';
    lines.push(`Bodyweight: ${b.latestKg} kg${delta}`);
  }

  const n = ctx.nutrition;
  if (n) {
    const kcal = n.kcalTarget !== undefined ? `${n.kcal}/${n.kcalTarget} kcal` : `${n.kcal} kcal`;
    const protein = n.proteinTargetG !== undefined ? `${n.proteinG}/${n.proteinTargetG} g protein` : `${n.proteinG} g protein`;
    lines.push(`Nutrition: ${kcal}, ${protein}`);
  }

  return capWords(lines.join('\n'), CONTEXT_WORD_CAP);
}

/** Full prompt sent to the model: context block, last 4 turns, then the fresh question. */
export function buildPrompt(ctx: AssistantContext, thread: AssistantTurn[], question: string): string {
  const parts: string[] = [];
  const block = buildContextBlock(ctx);
  if (block) parts.push(block);
  for (const turn of thread.slice(-THREAD_TURN_CAP)) {
    parts.push(`${turn.role === 'user' ? 'User' : 'Assistant'}: ${turn.text}`);
  }
  parts.push(`User: ${question}`);
  return parts.join('\n');
}

/** Trim, collapse runs of blank lines, and cap length at a sentence boundary where possible. */
export function trimReply(text: string): string {
  const collapsed = text.trim().replace(/\n{3,}/g, '\n\n');
  if (collapsed.length <= REPLY_CHAR_CAP) return collapsed;
  const cut = collapsed.slice(0, REPLY_CHAR_CAP);
  const boundary = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
  if (boundary > 0) return cut.slice(0, boundary + 1).trim();
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

function capWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}
