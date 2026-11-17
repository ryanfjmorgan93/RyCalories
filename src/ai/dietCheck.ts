/**
 * The diet check (docs/superpowers/specs/2026-11-17-diet-check-design.md): one Sonnet 5.5 request,
 * only ever on the owner's tap, that reads the last 4 weeks of their food and answers in a fixed
 * shape: a headline, four scored parts, what is working, what to add and cut, and a verdict on the
 * foods they eat most. The answer is cleaned (`cleanDietCheck`) and kept in the Settings row, so
 * the screen and a food's sheet read it without asking again. Throws a `ClaudeError`.
 */
import * as z from 'zod/v4';
import { loadDietDigest } from '@/db/dietQueries';
import { saveSettings } from '@/db/repo';
import { toDateKey } from '@/domain/dates';
import { cleanDietCheck, DIET_MIN_DAYS, digestText, type DietCheck } from '@/domain/dietCheck';
import { ClaudeError, createMessage, SONNET, textOf, type CallDeps } from './client';
import { buildStableContext, buildVolatileContext, type ContextOptions } from './context';
import { DIET_RULES, personaWith } from './persona';
import { toStrictJsonSchema } from './schema';

const Part = z.object({ points: z.number().describe('0 to 25, higher is better'), line: z.string().describe('Why, in at most 20 words') });
const Advice = z.object({ what: z.string(), why: z.string() });

const DietShape = z.object({
  headline: z.string(),
  detail: z.string(),
  whole_foods: Part,
  fruit_veg: Part,
  fibre: Part,
  processed_salt: Part,
  working: z.array(z.string()),
  add: z.array(Advice),
  cut: z.array(Advice),
  regulars: z.array(
    z.object({
      name: z.string().describe('Exactly as in the list of foods'),
      verdict: z.enum(['keep', 'fine', 'swap', 'cut']),
      body_fat: z.string(),
      the_catch: z.string(),
      better: z.string(),
    }),
  ),
});

export const DIET_SCHEMA = toStrictJsonSchema(DietShape);

export const TOO_FEW_DAYS = `Log food on at least ${DIET_MIN_DAYS} days in the last 4 weeks first.`;
const UNREADABLE = 'The coach answered in a form the app could not read. Try again.';

export interface DietOptions extends CallDeps {
  now?: Date;
  context?: ContextOptions;
}

/** Read the diary, ask the coach, and keep the answer. */
export async function checkDiet(opts: DietOptions = {}): Promise<DietCheck> {
  const now = opts.now ?? new Date();
  const digest = await loadDietDigest(toDateKey(now));
  if (digest.loggedDays < DIET_MIN_DAYS) throw new ClaudeError('other', TOO_FEW_DAYS);
  const volatile = await buildVolatileContext({ ...opts.context, now });
  const stable = await buildStableContext({ ...opts.context, now, volatileChars: volatile.length });
  const message = await createMessage(
    {
      model: SONNET,
      max_tokens: 8000, // adaptive thinking counts toward it; only what is generated is billed
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: DIET_SCHEMA } },
      system: [
        { type: 'text', text: `${personaWith(DIET_RULES)}\n\n${stable}`, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: volatile },
      ],
      messages: [{ role: 'user', content: `Check my diet.\n\n${digestText(digest)}` }],
    },
    // Once: a failed attempt is spend the ledger cannot see, and the owner can tap again.
    { ...opts, maxRetries: opts.maxRetries ?? 0 },
  );
  let parsed: z.infer<typeof DietShape>;
  try {
    parsed = DietShape.parse(JSON.parse(textOf(message.content)));
  } catch (e) {
    throw new ClaudeError('other', UNREADABLE, e);
  }
  const check = cleanDietCheck(parsed, digest, now.toISOString());
  if (!check) throw new ClaudeError('other', UNREADABLE);
  await saveSettings({ dietCheck: check });
  return check;
}
