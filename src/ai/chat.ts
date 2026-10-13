/**
 * One chat turn with the coach.
 *
 * `sendCoachMessage(text)`:
 *   1. checks Claude can be called at all (key, connection, cap) and, if not, returns the plain
 *      reason with nothing written, so the sheet can keep what the owner typed;
 *   2. persists the owner's turn in `coachMessages`;
 *   3. builds the context (context.ts) and sends it, the last ~20 turns as plain text and the new
 *      message, to Sonnet 5.5 through the SDK's tool runner (max_tokens 4096, effort low, tool
 *      choice automatic), recording the spend of every request;
 *   4. persists the coach's reply with the lines for what its tools changed, and returns it.
 *
 * If the call fails, nothing from the model is stored and the reply is the error's one plain line.
 * Two things follow from what the turn had already done:
 *   - if no tool had changed anything, the owner's message is taken out of the thread again and the
 *     reply says it was not stored, so the sheet hands the text back and a retry is not a double;
 *   - if a tool had changed something, the owner's message stays and the app stores a note of its
 *     own saying so, with those lines (it would otherwise lie by omission).
 * A message that has a Claude key in it is stored and sent with the key blanked (key.ts `redactKeys`).
 *
 * The prompt is laid out for the cache: tools, then one system block (persona, rules and the stable
 * context) carrying the cache breakpoint, then a second system block of volatile context.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { db } from '@/db/db';
import { nowIso } from '@/domain/dates';
import { uuid } from '@/domain/ids';
import type { CoachMessage } from '@/domain/types';
import { createCoachActions, type CoachActions } from './actions';
import { assertCanCall, blockedReason, ClaudeError, runToolLoop, SONNET, textOf, toClaudeError, type CallDeps, type ClaudeErrorKind } from './client';
import { buildCoachContext, type ContextOptions } from './context';
import { redactKeys } from './key';
import { CHAT_RULES, personaWith } from './persona';
import { createCoachTools } from './tools';
import { newTurnRecord, type TurnRecord } from './types';

/** How many past turns are sent as history. */
export const HISTORY_TURNS = 20;
// Room for Sonnet's adaptive thinking as well as the reply: thinking counts toward max_tokens, and a
// reply cut off mid-tool-call is worse than a few unused tokens (only what is generated is billed).
export const CHAT_MAX_TOKENS = 4096;

export interface ChatOptions extends CallDeps {
  /** What the tools do. Defaults to the real actions with no way to change today's sets (see actions.ts). */
  actions?: CoachActions;
  /** Passed to the context builder (a fixed clock, a smaller budget). */
  context?: ContextOptions;
}

export interface ChatReply {
  ok: boolean;
  /** The coach's reply, or the error's one plain line. */
  text: string;
  /** What the tools changed, one short line each. */
  actions: string[];
  /** A routine drafted this turn, not saved. */
  draft: TurnRecord['draft'];
  /**
   * The owner's message is in the thread. False when nothing was sent, and when the turn failed
   * before anything changed (the message is taken back out), so the sheet hands the text back to be sent later.
   */
  stored: boolean;
  /** Present when `ok` is false. */
  error?: ClaudeErrorKind;
}

type Turn = { role: 'user' | 'assistant'; content: string };

/**
 * The thread as the model gets it: oldest first, plain text, starting with the owner. Neighbours
 * of the same role are joined (a coach line spoken unprompted sits beside its reply), and a coach
 * turn that changed things says what, so the model remembers what it did.
 */
export function historyTurns(rows: readonly CoachMessage[], limit = HISTORY_TURNS): Turn[] {
  const recent = [...rows].sort((a, b) => a.at.localeCompare(b.at) || (a.role === b.role ? 0 : a.role === 'user' ? -1 : 1)).slice(-limit);
  const turns: Turn[] = [];
  for (const row of recent) {
    const role = row.role === 'user' ? 'user' : 'assistant';
    const changed = row.actions && row.actions.length > 0 ? ` [Changes made: ${row.actions.join('; ')}]` : '';
    // A key pasted into the box before keys were blanked on the way in is not sent now either.
    const content = redactKeys(`${row.text.trim()}${changed}`).trim();
    if (!content) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content = `${last.content}\n${content}`;
    else turns.push({ role, content });
  }
  while (turns.length > 0 && turns[0]!.role !== 'user') turns.shift();
  return turns;
}

/** A timestamp strictly after `previous`, so a reply always sorts after the turn it answers. */
function laterThan(previous: string): string {
  const now = nowIso();
  return now > previous ? now : new Date(Date.parse(previous) + 1).toISOString();
}

const EMPTY_REPLY = "I didn't have an answer for that. Try asking another way.";
const STOPPED_REPLY = 'That took more steps than I am allowed in one go, so I stopped. Nothing was changed.';

export async function sendCoachMessage(rawText: string, opts: ChatOptions = {}): Promise<ChatReply> {
  // A Claude key pasted into the box by mistake goes no further than this line: not stored, not
  // backed up with the thread, not sent.
  const text = redactKeys(rawText.trim());
  const turn = newTurnRecord();
  let stored = false;
  const fail = (error: ClaudeError): ChatReply => ({ ok: false, text: error.message, actions: turn.actions, draft: turn.draft, stored, error: error.kind });
  if (!text) return fail(new ClaudeError('other', 'Say something first.'));

  // Nothing is written when Claude cannot be called at all: the sheet keeps the text for next time.
  const blocked = blockedReason();
  if (blocked) return fail(new ClaudeError(blocked));

  // Only the recent end of the thread is read: it grows for ever, and only the last turns are sent.
  const history = historyTurns(await db.coachMessages.orderBy('at').reverse().limit(HISTORY_TURNS * 3).toArray());
  const userAt = nowIso();
  const userId = uuid();
  await db.coachMessages.put({ id: userId, at: userAt, role: 'user', text });
  stored = true;

  try {
    assertCanCall();
    const context = await buildCoachContext(opts.context);
    const tools = createCoachTools(opts.actions ?? createCoachActions(), turn);
    const { message, stoppedForCap, hitIterationLimit } = await runToolLoop(
      {
        model: SONNET,
        max_tokens: CHAT_MAX_TOKENS,
        output_config: { effort: 'low' },
        tools,
        system: [
          { type: 'text', text: `${personaWith(CHAT_RULES)}\n\n${context.stable}`, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: context.volatile },
        ],
        messages: [...history, { role: 'user', content: text }] satisfies Anthropic.Beta.Messages.BetaMessageParam[],
      },
      opts,
    );

    // The month's limit was reached with a tool call still waiting: whatever the model said alongside it
    // is about something that did not happen, so it is not shown.
    if (stoppedForCap) throw new ClaudeError('over_cap');

    // At the step limit the model's last words are a preamble to tools it never saw the results of,
    // so what was done is said in its place.
    let reply = hitIterationLimit ? '' : textOf(message.content);
    if (!reply && turn.actions.length > 0) reply = `Done: ${turn.actions.join('; ')}.`;
    if (!reply) reply = hitIterationLimit ? STOPPED_REPLY : EMPTY_REPLY;
    reply = redactKeys(reply);

    const row: CoachMessage = { id: uuid(), at: laterThan(userAt), role: 'coach', text: reply, ...(turn.actions.length > 0 ? { actions: [...turn.actions] } : {}) };
    await db.coachMessages.put(row);
    return { ok: true, text: reply, actions: turn.actions, draft: turn.draft, stored };
  } catch (e) {
    const error = toClaudeError(e);
    if (turn.actions.length > 0) {
      await db.coachMessages.put({ id: uuid(), at: laterThan(userAt), role: 'coach', text: `${error.message} These changes were made first.`, actions: [...turn.actions] });
    } else {
      // Nothing changed and nothing came back: the owner's message would sit in the thread with no
      // answer, and sending it again would put it there twice. Take it out and let the sheet keep the text.
      stored = !(await db.coachMessages.delete(userId).then(() => true, () => false));
    }
    return fail(error);
  }
}
