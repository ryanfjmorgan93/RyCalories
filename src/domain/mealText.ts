/**
 * The no-AI path: turning typed meal text into separate foods with whatever amount the user
 * typed themselves. Pure functions only — no IO, no clock, no database.
 *
 * These amounts are the user's own numbers, unlike a photo recognition (which never gives
 * amounts at all — see `mealAnalysis.ts`), so they are trusted to pre-fill a card rather than
 * being asked for again. Anything this parser doesn't recognise is not an error: it becomes a
 * plain named ingredient with no amount, same as if the user had typed only the name.
 */

export interface ParsedMealTextItem {
  name: string;
  count?: number;
  grams?: number;
  /** A recognised count-style unit word, singular ("rasher", "slice", "clove"). */
  unit?: string;
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * Count-style unit words this app recognises, plural → singular canonical form. Deliberately
 * short: a volume unit like "tbsp" has no fixed gram weight worth guessing at, so it is left
 * as ordinary, unrecognised text rather than given a false sense of precision. "Egg" is not
 * here — it is the ingredient name itself, not a unit something else is measured in.
 */
const UNIT_WORDS: Record<string, string> = {
  rasher: 'rasher',
  rashers: 'rasher',
  slice: 'slice',
  slices: 'slice',
  clove: 'clove',
  cloves: 'clove',
};

// "30g cheddar" / "30 g cheddar" / "1.5kg mince" — a number directly followed by a weight unit.
const GRAM_PATTERN = /^([\d.,]+)\s*(kg|g)\b\s*(?:of\s+)?(.+)$/i;
// "3 eggs" / "2 rashers bacon" / "2 rashers of bacon" / "a rasher of bacon" — a number or number
// word, an optional recognised unit word, an optional "of", then the name.
const COUNT_PATTERN = /^(\d+(?:[.,]\d+)?|[a-z]+)\s+(rashers?|slices?|cloves?)?\s*(?:of\s+)?(.+)$/i;

/** Accept both '.' and ',' as the decimal separator; a typed quantity never uses a thousands one. */
function parseDecimal(raw: string): number {
  return Number(raw.replace(',', '.'));
}

/**
 * Split typed meal text into its separate foods, splitting on commas, semicolons, newlines and
 * the standalone word "and" — never on "and" inside a word ("sandwich"), because the split is on
 * a whole word, not a substring. A comma directly between two digits ("1,5kg") is the European
 * decimal separator, not a list separator, and is left for the amount parser below to read.
 */
export function parseMealText(text: string): ParsedMealTextItem[] {
  return text
    .split(/(?<!\d),(?!\d)|[;\n]+|\band\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(parseSegment);
}

function parseSegment(segment: string): ParsedMealTextItem {
  const gram = GRAM_PATTERN.exec(segment);
  if (gram) {
    const value = parseDecimal(gram[1]!);
    const name = gram[3]!.trim();
    if (Number.isFinite(value) && value >= 0 && name) {
      const grams = gram[2]!.toLowerCase() === 'kg' ? value * 1000 : value;
      return { name, grams };
    }
  }

  const count = COUNT_PATTERN.exec(segment);
  if (count) {
    const leading = count[1]!;
    const value = /^[a-z]+$/i.test(leading) ? WORD_NUMBERS[leading.toLowerCase()] : parseDecimal(leading);
    const name = count[3]!.trim();
    if (value !== undefined && Number.isFinite(value) && value >= 0 && name) {
      const unit = count[2] ? UNIT_WORDS[count[2].toLowerCase()] : undefined;
      return unit ? { name, count: value, unit } : { name, count: value };
    }
  }

  return { name: segment };
}
