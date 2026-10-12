/**
 * Claude as a reader: a photo or a sentence in, structured numbers out.
 *
 * Sonnet 5.5 at medium effort for photos (low for text), answering in a JSON schema through
 * `output_config.format` (structured outputs: the reply is guaranteed to be valid JSON of that
 * shape, so there is no tool to force, which Sonnet 5.5 would reject). The reply is still checked
 * with Zod on the way in, and numbers that cannot be right are dropped or corrected rather than
 * trusted.
 *
 * What comes back is a reading, not a record. A meal's numbers are Claude's estimate (the app marks
 * them ≈ and gives them the lowest trust, src/domain/food.ts), a label's are what was printed, and
 * an InBody sheet's are shown to the owner to confirm before anything is saved. Nothing here writes
 * to the database.
 */
import * as z from 'zod/v4';
import { reconcileMacros } from '@/domain/food';
import { ClaudeError, createMessage, SONNET, textOf, type CallDeps } from './client';
import { READER_RULES } from './persona';
import { toStrictJsonSchema } from './schema';

// ---------------------------------------------------------------------------
// Shapes

const MealItemShape = z.object({
  name: z.string().describe('The food, plainly: "Scrambled eggs", "Wholemeal toast"'),
  amount: z.number().describe('How many of the unit: 2 for two slices'),
  unit: z.string().describe('What it is counted in: "slices", "eggs", "bowl", "tbsp", "g"'),
  grams: z.number().describe('Estimated weight of the whole amount in grams'),
  kcal: z.number().describe('Energy of the whole amount, not per 100 g'),
  protein: z.number().describe('Protein in grams for the whole amount'),
  carbs: z.number().describe('Carbohydrate in grams for the whole amount'),
  fat: z.number().describe('Fat in grams for the whole amount'),
  confidence: z.enum(['low', 'medium', 'high']).describe('How sure you are of this item and its amount'),
});

const MealShape = z.object({ items: z.array(MealItemShape).describe('Every distinct food or drink; empty if there is no food') });

const LabelShape = z.object({
  name: z.string().describe('The product name as printed'),
  brand: z.string().optional().describe('The brand, if shown'),
  per100: z
    .object({
      kcal: z.number().describe('Energy per 100 g (or 100 ml) in kilocalories, not kilojoules'),
      protein: z.number().describe('Protein in grams per 100 g'),
      carbs: z.number().describe('Carbohydrate in grams per 100 g'),
      fat: z.number().describe('Fat in grams per 100 g'),
    })
    .describe('Nutrition per 100 g (or 100 ml); convert from per-serving values if that is all the label gives'),
  serving_grams: z.number().optional().describe('The serving size in grams, if printed'),
  pack_grams: z.number().optional().describe('The weight of the whole pack in grams, if printed'),
});

const InbodyShape = z.object({
  date: z.string().optional().describe('The test date as YYYY-MM-DD, if printed'),
  weight_kg: z.number().optional().describe('Weight in kg'),
  skeletal_muscle_kg: z.number().optional().describe('Skeletal muscle mass in kg'),
  body_fat_kg: z.number().optional().describe('Body fat mass in kg'),
  body_fat_pct: z.number().optional().describe('Percent body fat'),
  lean_mass_kg: z.number().optional().describe('Lean body mass in kg'),
  total_body_water_l: z.number().optional().describe('Total body water in litres'),
  bmr_kcal: z.number().optional().describe('Basal metabolic rate in kcal'),
  visceral_fat_level: z.number().optional().describe('Visceral fat level'),
  ecw_ratio: z.number().optional().describe('ECW/TBW ratio'),
  inbody_score: z.number().optional().describe('InBody score'),
  phase_angle: z.number().optional().describe('Whole-body phase angle in degrees'),
});

export const MEAL_SCHEMA = toStrictJsonSchema(MealShape);
export const LABEL_SCHEMA = toStrictJsonSchema(LabelShape);
export const INBODY_SCHEMA = toStrictJsonSchema(InbodyShape);

export interface MealReadingItem {
  name: string;
  amount: number;
  unit: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: 'low' | 'medium' | 'high';
}

export interface LabelReading {
  name: string;
  brand?: string;
  per100: { kcal: number; protein: number; carbs: number; fat: number };
  servingGrams?: number;
  packGrams?: number;
}

/** The measures of an InBody sheet, named as `BodyScan` names them. Only what was printed and plausible. */
export interface InbodyReading {
  /** YYYY-MM-DD when the sheet carries a date. */
  date?: string;
  weightKg?: number;
  skeletalMuscleKg?: number;
  bodyFatKg?: number;
  bodyFatPct?: number;
  leanMassKg?: number;
  totalBodyWaterL?: number;
  bmrKcal?: number;
  visceralFatLevel?: number;
  ecwRatio?: number;
  inbodyScore?: number;
  phaseAngle?: number;
}

// ---------------------------------------------------------------------------
// The call

const BAD_SHAPE = "Claude's answer did not come back in a form I could read. Try again.";

/** A base64 image without any `data:` prefix. */
export function stripDataUrl(base64: string): string {
  return base64.replace(/^data:image\/[a-z+.-]+;base64,/i, '').trim();
}

async function readStructured<S extends z.ZodType>(
  opts: { schema: S; json: Record<string, unknown>; prompt: string; image?: string; effort: 'low' | 'medium'; maxTokens?: number },
  deps: CallDeps,
): Promise<z.infer<S>> {
  const content = opts.image
    ? [
        { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg' as const, data: stripDataUrl(opts.image) } },
        { type: 'text' as const, text: opts.prompt },
      ]
    : opts.prompt;
  const message = await createMessage(
    {
      model: SONNET,
      // Adaptive thinking counts toward max_tokens; a structured reply cut short is unreadable, and
      // only the tokens generated are billed, so the ceiling is generous.
      max_tokens: opts.maxTokens ?? 8000,
      output_config: { effort: opts.effort, format: { type: 'json_schema', schema: opts.json } },
      system: READER_RULES,
      messages: [{ role: 'user', content }],
    },
    deps,
  );
  let raw: unknown;
  try {
    raw = JSON.parse(textOf(message.content));
  } catch {
    throw new ClaudeError('other', BAD_SHAPE);
  }
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) throw new ClaudeError('other', BAD_SHAPE);
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Meals

const MEAL_GUIDE =
  'List every distinct food or drink as its own item, in the units a person would use (slices, eggs, a bowl) with a gram weight alongside. Use UK portion sizes. Give kcal, protein, carbohydrate and fat for the whole amount of each item. If there is no food, return an empty list.';

/** Keep only items whose numbers can be real, and fix a calorie figure the macros contradict. */
export function cleanMealItems(items: readonly z.infer<typeof MealItemShape>[]): MealReadingItem[] {
  const out: MealReadingItem[] = [];
  for (const it of items) {
    const nums = [it.amount, it.grams, it.kcal, it.protein, it.carbs, it.fat];
    const name = it.name.trim();
    if (!name || nums.some((n) => !Number.isFinite(n) || n < 0) || !(it.amount > 0) || it.kcal > 5000) continue;
    const { macros } = reconcileMacros({ kcal: it.kcal, protein: it.protein, carbs: it.carbs, fat: it.fat });
    out.push({ name, amount: it.amount, unit: it.unit.trim() || 'portion', grams: Math.round(it.grams), ...macros, confidence: it.confidence });
  }
  return out;
}

/** A photo of a meal (JPEG, base64) as the items on the plate. */
export async function readMealPhoto(jpegBase64: string, deps: CallDeps = {}): Promise<MealReadingItem[]> {
  const read = await readStructured({ schema: MealShape, json: MEAL_SCHEMA, image: jpegBase64, prompt: `This is a photo of a meal. ${MEAL_GUIDE}`, effort: 'medium' }, deps);
  return cleanMealItems(read.items);
}

/** A sentence describing a meal ("two eggs on toast and a coffee") as the same items. */
export async function readMealText(text: string, deps: CallDeps = {}): Promise<MealReadingItem[]> {
  const said = text.trim();
  if (!said) return [];
  const read = await readStructured({ schema: MealShape, json: MEAL_SCHEMA, prompt: `The owner described a meal: "${said}". Use the amounts they stated and estimate any they did not. ${MEAL_GUIDE}`, effort: 'low' }, deps);
  return cleanMealItems(read.items);
}

// ---------------------------------------------------------------------------
// Labels

function positive(n: number | undefined): number | undefined {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** A photo of a nutrition label (or the pack) as per-100 g values and the serving and pack weights. */
export async function readLabelPhoto(jpegBase64: string, deps: CallDeps = {}): Promise<LabelReading> {
  const read = await readStructured(
    {
      schema: LabelShape,
      json: LABEL_SCHEMA,
      image: jpegBase64,
      prompt:
        'This is a photo of a food label or pack. Read the product name, the brand if shown, and the nutrition per 100 g (or 100 ml), with energy in kilocalories. If the label only gives per-serving values, convert them to per 100 g using the serving size. Give the serving size and the pack weight in grams only if they are printed.',
      effort: 'medium',
    },
    deps,
  );
  const per = read.per100;
  if (![per.kcal, per.protein, per.carbs, per.fat].every((n) => Number.isFinite(n) && n >= 0) || per.kcal > 950) {
    throw new ClaudeError('other', "I couldn't read the numbers on that label. Try a clearer photo.");
  }
  const { macros } = reconcileMacros({ kcal: per.kcal, protein: per.protein, carbs: per.carbs, fat: per.fat });
  const brand = read.brand?.trim();
  const servingGrams = positive(read.serving_grams);
  const packGrams = positive(read.pack_grams);
  return {
    name: read.name.trim(),
    ...(brand ? { brand } : {}),
    per100: macros,
    ...(servingGrams ? { servingGrams } : {}),
    ...(packGrams ? { packGrams } : {}),
  };
}

// ---------------------------------------------------------------------------
// InBody

/** Plausible ranges for each measure: a reading outside them is a misread, not a result. */
const INBODY_RANGES: Record<Exclude<keyof InbodyReading, 'date'>, [number, number]> = {
  weightKg: [20, 400],
  skeletalMuscleKg: [5, 100],
  bodyFatKg: [1, 250],
  bodyFatPct: [1, 70],
  leanMassKg: [10, 250],
  totalBodyWaterL: [10, 150],
  bmrKcal: [500, 5000],
  visceralFatLevel: [1, 30],
  ecwRatio: [0.2, 0.6],
  inbodyScore: [10, 100],
  phaseAngle: [1, 20],
};

/** A photo of a printed InBody result sheet as the measures it carries. Anything missing or implausible is left out. */
export async function readInbodySheet(jpegBase64: string, deps: CallDeps = {}): Promise<InbodyReading> {
  const read = await readStructured(
    {
      schema: InbodyShape,
      json: INBODY_SCHEMA,
      image: jpegBase64,
      prompt:
        'This is a photo of an InBody body composition result sheet. Read only the values that are printed and legible; leave out any you cannot see rather than estimating. Weights are in kg. Give the test date as YYYY-MM-DD.',
      effort: 'medium',
    },
    deps,
  );
  const named: Record<Exclude<keyof InbodyReading, 'date'>, number | undefined> = {
    weightKg: read.weight_kg,
    skeletalMuscleKg: read.skeletal_muscle_kg,
    bodyFatKg: read.body_fat_kg,
    bodyFatPct: read.body_fat_pct,
    leanMassKg: read.lean_mass_kg,
    totalBodyWaterL: read.total_body_water_l,
    bmrKcal: read.bmr_kcal,
    visceralFatLevel: read.visceral_fat_level,
    ecwRatio: read.ecw_ratio,
    inbodyScore: read.inbody_score,
    phaseAngle: read.phase_angle,
  };
  const out: InbodyReading = {};
  for (const [key, value] of Object.entries(named) as [Exclude<keyof InbodyReading, 'date'>, number | undefined][]) {
    const [lo, hi] = INBODY_RANGES[key];
    if (typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi) out[key] = value;
  }
  if (read.date && /^\d{4}-\d{2}-\d{2}$/.test(read.date)) out.date = read.date;
  return out;
}
