/**
 * Claude doing the typing for food: a photo of a meal, a sentence about one, or a photo of a label
 * goes in, and the day's food (or a product the next scan will know) comes out, with no form in
 * between.
 *
 * This is the orchestration; the pure parts (matching what Claude read against the foods the app
 * already knows, building the items) are in src/domain/claudeFood.ts, and the screens' buttons,
 * sheets and Undo bar are in src/ui/useClaudeFood.tsx. Every function here either does the whole
 * job or throws a `ClaudeError` whose message is already the one plain line to show.
 *
 * A meal read from Claude is logged at once, with no confirmation step (the Undo bar and the meal's
 * own screen are the corrections). Its photo is kept in the app's private storage beside the meal
 * (`Meal.photoPath`, relative to the data directory) and nothing else is kept: the scaled copy made
 * for Claude lives in the cache for the seconds the reading takes and is deleted after.
 */
import { Directory, Filesystem } from '@capacitor/filesystem';
import { blockedReason, CLAUDE_ERROR_MESSAGES, ClaudeError, noRetry, toClaudeError, type CallDeps, type ClaudeErrorKind } from '@/ai/client';
import { readLabelPhoto, readMealPhoto, readMealText, type MealReadingItem } from '@/ai/vision';
import { loadUkFoodTable } from '@/data/ukFoodTable';
import { db } from '@/db/db';
import { allFoods, logItemsToSlot, type LoggedItems, type NewMealItem } from '@/db/foodRepo';
import { rememberBarcodeLabel } from '@/db/productRepo';
import { displayMacros } from '@/domain/food';
import { itemsFromReadings, readingConfidence, readingSummary } from '@/domain/claudeFood';
import { uuid } from '@/domain/ids';
import type { MatchSources } from '@/domain/ingredientMatch';
import { barcodeDigits, type LabelNutrition } from '@/domain/products';
import type { MealSlot } from '@/domain/types';
import { deleteMealPhoto, preparePhoto } from './mealPhoto';

/** The three ways Claude does the typing for food. */
export type FoodReadKind = 'photo' | 'describe' | 'label';

/** What is being read, which decides what the way forward is when it cannot be. 'sheet' is a printed InBody result. */
export type ReadKind = FoodReadKind | 'sheet';

const NO_KEY: Record<ReadKind, string> = {
  photo: 'Add your Claude key in Settings to log from a photo.',
  describe: 'Add your Claude key in Settings to log by describing it.',
  label: 'Add your Claude key in Settings to read a label.',
  sheet: 'Add your Claude key in Settings to read a photo of the sheet.',
};

const NO_SIGNAL: Record<ReadKind, string> = {
  photo: 'Photos need signal. Search or scan instead.',
  describe: 'Describing a meal needs signal. Search or scan instead.',
  label: 'Reading a label needs signal. Type it in instead.',
  sheet: 'Reading a photo needs signal. Import the file instead.',
};

const WAY_ON: Record<ReadKind, string> = {
  photo: 'Search or scan instead.',
  describe: 'Search or scan instead.',
  label: 'Type it in instead.',
  sheet: 'Import the file instead.',
};

const EMPTY: Record<'photo' | 'describe', string> = {
  photo: "I couldn't see any food in that photo. Try another, or search instead.",
  describe: "I couldn't find any food in that. Try different words, or search instead.",
};

/**
 * The one plain line for a Claude failure while reading food, with the way forward where there is
 * one. The three kinds that mean "not now" (no key, no signal, the cap) say what to do instead; the
 * rest keep Claude's own plain message, which already says to try again or check the key.
 */
export function foodErrorLine(kind: ClaudeErrorKind, what: ReadKind, message?: string): string {
  switch (kind) {
    case 'no_key':
      return NO_KEY[what];
    case 'offline':
      return NO_SIGNAL[what];
    case 'over_cap':
      return `${CLAUDE_ERROR_MESSAGES.over_cap} ${WAY_ON[what]}`;
    default:
      return message || CLAUDE_ERROR_MESSAGES[kind];
  }
}

/** Why Claude cannot be asked right now, as the line to show, or null when it can. Checked before the camera opens. */
export function blockedLine(what: ReadKind): string | null {
  const reason = blockedReason();
  return reason ? foodErrorLine(reason, what) : null;
}

/** Any thrown value while reading food as its line. */
export function readFailureLine(e: unknown, what: ReadKind): string {
  const err = toClaudeError(e);
  return foodErrorLine(err.kind, what, err.message);
}

// ---------------------------------------------------------------------------
// Pictures

/** A photo scaled for Claude: its base64, and where the scaled copy sits in the cache until `discardImage`. */
export interface PreparedImage {
  base64: string;
  cachePath: string;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Scale a picked photo (src/state/mealPhoto.ts) and read it back as base64. Throws a `ClaudeError` with a plain line if it cannot. */
export async function prepareImage(file: File): Promise<PreparedImage> {
  let cachePath: string | undefined;
  try {
    const prepared = await preparePhoto(file);
    cachePath = prepared.path;
    const { data } = await Filesystem.readFile({ path: prepared.path, directory: Directory.Cache });
    const base64 = typeof data === 'string' ? data : await blobToBase64(data);
    if (!base64) throw new Error('empty');
    return { base64, cachePath };
  } catch {
    if (cachePath) await deleteMealPhoto(cachePath);
    throw new ClaudeError('other', "I couldn't use that photo. Try taking it again.");
  }
}

/** Remove the cache copy made for Claude. Never throws. */
export async function discardImage(image: PreparedImage): Promise<void> {
  await deleteMealPhoto(image.cachePath);
}

/** Where kept meal photos live, under the app's data directory. */
const KEPT_DIR = 'meals';
/** A kept photo is not swept for this long, so one written a moment before its meal cannot be taken for an orphan. */
const SWEEP_GRACE_MS = 10 * 60 * 1000;

/** Keep the photo with its meal. The path is relative to the data directory, as `Meal.photoPath` says; undefined if it could not be written. */
export async function keepMealPhoto(image: PreparedImage): Promise<string | undefined> {
  try {
    const path = `${KEPT_DIR}/${uuid()}.jpg`;
    await Filesystem.writeFile({ path, directory: Directory.Data, data: image.base64, recursive: true });
    return path;
  } catch {
    return undefined;
  }
}

/**
 * Delete kept photos no meal points at any more (the meal was undone or deleted). Run when the Food
 * screen opens. Best effort throughout: a photo left behind costs a little space, never a failure.
 */
export async function sweepKeptPhotos(): Promise<void> {
  try {
    const { files } = await Filesystem.readdir({ path: KEPT_DIR, directory: Directory.Data });
    const old = files.filter((f) => f.type === 'file' && Date.now() - (f.mtime ?? 0) > SWEEP_GRACE_MS);
    if (old.length === 0) return;
    const used = new Set((await db.meals.filter((m) => m.photoPath !== undefined).toArray()).map((m) => m.photoPath));
    for (const f of old) {
      const path = `${KEPT_DIR}/${f.name}`;
      if (used.has(path)) continue;
      await Filesystem.deleteFile({ path, directory: Directory.Data }).catch(() => undefined);
    }
  } catch {
    // No folder yet, or storage unavailable: nothing to sweep.
  }
}

// ---------------------------------------------------------------------------
// Meals

/** Where a read meal goes. */
export interface ReadTarget {
  date: string;
  slot: MealSlot;
}

/** What was logged: enough for the Undo bar, the Adjust link and the coach's comment. */
export interface ReadLogged {
  logged: LoggedItems;
  items: NewMealItem[];
  count: number;
  /** The meal's calories as shown, the sum of each item's displayed figure. */
  kcal: number;
  date: string;
  slot: MealSlot;
}

/** The foods the app already knows, for matching what Claude read against. The table failing to load only means fewer matches. */
export async function knownFoods(): Promise<MatchSources> {
  const [memories, table] = await Promise.all([allFoods(), loadUkFoodTable().catch(() => null)]);
  return { memories, foods: table?.foods ?? [], aliases: table?.aliases ?? [] };
}

/** Log what Claude read to the day's slot: known foods keep their own figures, the rest are estimates. */
export async function logReadings(
  target: ReadTarget,
  readings: readonly MealReadingItem[],
  extras: { enteredText: string; photoPath?: string },
): Promise<ReadLogged> {
  const sources = await knownFoods();
  const items = itemsFromReadings(readings, sources);
  const logged = await logItemsToSlot(target.date, target.slot, items, {
    enteredText: extras.enteredText,
    confidence: readingConfidence(readings),
    ...(extras.photoPath ? { photoPath: extras.photoPath } : {}),
  });
  const kcal = items.reduce((sum, i) => sum + displayMacros(i.nutrition).kcal, 0);
  return { logged, items, count: items.length, kcal, date: target.date, slot: target.slot };
}

/** How the flows learn the owner backed out while Claude was reading. */
export type Cancelled = () => boolean;

/**
 * A photo of a meal, read and logged. Null when the owner cancelled meanwhile (nothing is logged
 * after a cancel). Throws a `ClaudeError` with the line to show, including for a photo with no food in it.
 */
export async function logMealPhoto(file: File, target: ReadTarget, cancelled: Cancelled = () => false): Promise<ReadLogged | null> {
  const image = await prepareImage(file);
  try {
    // No SDK retries for a photo read: a failed attempt is not in the spend ledger (src/ai/client.ts).
    const readings = await readMealPhoto(image.base64, noRetry());
    if (cancelled()) return null;
    if (readings.length === 0) throw new ClaudeError('other', EMPTY.photo);
    const photoPath = await keepMealPhoto(image);
    return await logReadings(target, readings, { enteredText: readingSummary(readings), ...(photoPath ? { photoPath } : {}) });
  } finally {
    await discardImage(image);
  }
}

/** A sentence about a meal, read and logged. The sentence is kept as the meal's entered text. */
export async function logMealText(text: string, target: ReadTarget, cancelled: Cancelled = () => false, deps: CallDeps = {}): Promise<ReadLogged | null> {
  const said = text.trim();
  if (!said) throw new ClaudeError('other', 'Say or type what you ate first.');
  const readings = await readMealText(said, noRetry(deps));
  if (cancelled()) return null;
  if (readings.length === 0) throw new ClaudeError('other', EMPTY.describe);
  return logReadings(target, readings, { enteredText: said.slice(0, 280) });
}

// ---------------------------------------------------------------------------
// Labels

/**
 * A photo of a nutrition label read as a product. With a barcode it is also remembered against it,
 * so the next scan of that pack finds it without a connection. Null when the owner cancelled.
 */
export async function readLabel(file: File, barcode: string | undefined, cancelled: Cancelled = () => false): Promise<LabelNutrition | null> {
  const image = await prepareImage(file);
  try {
    const reading = await readLabelPhoto(image.base64, noRetry());
    if (cancelled()) return null;
    const code = barcode ? (barcodeDigits(barcode) ?? '') : '';
    const label: LabelNutrition = {
      code,
      brand: reading.brand ?? '',
      name: reading.name || reading.brand || 'Packaged food',
      per100: reading.per100,
      ...(reading.servingGrams !== undefined ? { servingGrams: reading.servingGrams } : {}),
      ...(reading.packGrams !== undefined ? { packGrams: reading.packGrams } : {}),
    };
    if (code) await rememberBarcodeLabel(code, label);
    return label;
  } finally {
    await discardImage(image);
  }
}
