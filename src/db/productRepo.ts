/**
 * Open Food Facts lookups, cached locally.
 *
 * Everything here is best-effort. The app is offline-first and this is the one place that touches
 * the network, so every failure path — no signal, a timeout, a 500, malformed JSON — must return
 * "no answer" rather than throw. A food logger that cannot log food because a database in Paris is
 * having a bad afternoon is worse than one that never asks.
 *
 * Only two things are ever sent: the barcode digits, or the product name being searched for.
 */
import { db } from './db';
import { nowIso } from '@/domain/dates';
import {
  OFF_FIELDS,
  bestMatch,
  parseProduct,
  type LabelNutrition,
  type MatchQuery,
} from '@/domain/products';
import { normalise } from '@/domain/foodMemory';
import type { ProductCacheEntry } from '@/domain/types';

const BARCODE_URL = 'https://world.openfoodfacts.org/api/v2/product';
/**
 * Brand-filtered search on the main API host. Preferred because that host sends
 * `Access-Control-Allow-Origin: *`, so it works in a plain browser as well as in the app.
 */
const BRAND_SEARCH_URL = 'https://world.openfoodfacts.org/api/v2/search';
/**
 * Full-text search. The only endpoint that accepts free text, but it sends NO
 * Access-Control-Allow-Origin, so a browser blocks the response before it can be read. It works
 * inside the Android shell only because capacitor.config.ts routes fetch through native HTTP,
 * which CORS does not apply to. Hence: used only when there is no brand to filter on.
 */
const TEXT_SEARCH_URL = 'https://search.openfoodfacts.org/search';
const TIMEOUT_MS = 8000;
const SEARCH_PAGE_SIZE = 24;

/**
 * How long a MISS is trusted. Positive results are kept indefinitely — a label does not change,
 * and keeping it is what makes a known food work on aeroplane mode — but "not in the database" is
 * a fact about the database on one day, and it gains entries constantly.
 */
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Lookup {
  label: LabelNutrition | null;
  /**
   * Where the answer came from.
   *   cache        - answered from what we already had
   *   network      - asked, and this is the answer (a null label means a genuine miss)
   *   offline      - the device is offline, so it was never asked
   *   unavailable  - asked and could not get an answer: no route, a timeout, a bad status
   *   invalid      - there was nothing to look up; nothing was asked
   * The last three are deliberately distinct: telling a user "no connection" when the query was
   * empty, or when a service returned 503, is a lie that sends them to check their wifi.
   */
  from: 'cache' | 'network' | 'offline' | 'unavailable' | 'invalid';
}

function barcodeKey(code: string): string {
  return `code:${code}`;
}

/**
 * The cache key for a name lookup.
 *
 * Brand and text are kept in separate segments rather than joined. Joined, a search for "Trek
 * Protein Flapjack" with no brand and one for "Protein Flapjack" branded "Trek" collapse to the
 * same key — but they are not the same search: only the second enforces the brand rule, so the
 * first's laxer answer could be served to the second and defeat the rule entirely.
 */
function nameKey(q: MatchQuery): string {
  return `name:${normalise(q.brand ?? '')}|${normalise(q.text)}`;
}

/** Open Food Facts brand tags are slugs: lowercase, non-alphanumerics collapsed to hyphens. */
function brandSlug(brand: string): string {
  return normalise(brand).split(' ').filter(Boolean).join('-');
}

/**
 * A cached answer, or null when there is none worth using.
 *
 * Never throws: a database that cannot be read is a slow lookup, not a failed one. Letting it
 * throw would escape the caller and leave the sheet stuck on "Looking up…" for ever.
 */
async function cached(key: string): Promise<Lookup | null> {
  const row = await db.productCache.get(key).catch(() => undefined);
  if (!row) return null;
  if (row.per100 === null) {
    const age = Date.now() - Date.parse(row.fetchedAt);
    if (!Number.isFinite(age) || age > MISS_TTL_MS) return null;
    return { label: null, from: 'cache' };
  }
  return {
    label: {
      code: row.code ?? '',
      brand: row.brand ?? '',
      name: row.name ?? '',
      per100: row.per100,
      ...(row.servingGrams !== undefined ? { servingGrams: row.servingGrams } : {}),
      ...(row.packGrams !== undefined ? { packGrams: row.packGrams } : {}),
    },
    from: 'cache',
  };
}

async function remember(key: string, label: LabelNutrition | null): Promise<void> {
  const row: ProductCacheEntry = label
    ? {
        key,
        per100: label.per100,
        code: label.code,
        name: label.name,
        brand: label.brand,
        ...(label.servingGrams !== undefined ? { servingGrams: label.servingGrams } : {}),
        ...(label.packGrams !== undefined ? { packGrams: label.packGrams } : {}),
        fetchedAt: nowIso(),
      }
    : { key, per100: null, fetchedAt: nowIso() };
  try {
    await db.productCache.put(row);
  } catch {
    // A cache that cannot be written is a slow lookup, not a failed one.
  }
}

/** GET JSON with a timeout. Returns null on any failure at all, deliberately. */
async function getJson(url: string): Promise<unknown | null> {
  if (typeof fetch !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function offline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** A product by its barcode. */
export async function lookupBarcode(code: string): Promise<Lookup> {
  const digits = code.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return { label: null, from: 'invalid' };
  const key = barcodeKey(digits);

  const hit = await cached(key);
  if (hit) return hit;
  // Never asked rather than asked and refused: the caller shows these differently.
  if (offline()) return { label: null, from: 'offline' };

  const json = await getJson(`${BARCODE_URL}/${encodeURIComponent(digits)}.json?fields=${OFF_FIELDS}`);
  if (json === null) return { label: null, from: 'unavailable' };

  const body = json as { status?: number; product?: unknown };
  const label = body.status === 1 ? parseProduct(body.product) : null;
  await remember(key, label);
  return { label, from: 'network' };
}

/**
 * The best product for a name, or nothing.
 *
 * "Nothing" is a correct and frequent answer: the brand rule in the matcher discards a rival
 * manufacturer's product however well its name matches, because writing another company's numbers
 * onto your food behind a label badge is worse than admitting we do not know.
 */
export async function lookupName(query: MatchQuery): Promise<Lookup> {
  if (!normalise(query.text)) return { label: null, from: 'invalid' };
  const key = nameKey(query);

  const hit = await cached(key);
  if (hit) return hit;
  if (offline()) return { label: null, from: 'offline' };

  const slug = query.brand ? brandSlug(query.brand) : '';
  const json = slug
    ? await getJson(`${BRAND_SEARCH_URL}?brands_tags=${encodeURIComponent(slug)}&page_size=${SEARCH_PAGE_SIZE}&fields=${OFF_FIELDS}`)
    : await getJson(
        `${TEXT_SEARCH_URL}?q=${encodeURIComponent(query.text)}&page_size=${SEARCH_PAGE_SIZE}&fields=${OFF_FIELDS}`,
      );
  if (json === null) return { label: null, from: 'unavailable' };

  // The two endpoints name their result list differently.
  const body = json as { hits?: unknown; products?: unknown };
  const rows = Array.isArray(body.products) ? body.products : Array.isArray(body.hits) ? body.hits : [];
  const candidates = rows.map(parseProduct).filter((l): l is LabelNutrition => l !== null);
  const best = bestMatch(query, candidates);
  const label = best?.label ?? null;
  await remember(key, label);
  return { label, from: 'network' };
}

/** Drop everything cached from Open Food Facts. Exposed for Settings. */
export async function clearProductCache(): Promise<number> {
  const n = await db.productCache.count();
  await db.productCache.clear();
  return n;
}
