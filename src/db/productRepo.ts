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
const SEARCH_URL = 'https://search.openfoodfacts.org/search';
const TIMEOUT_MS = 8000;
const SEARCH_PAGE_SIZE = 12;

/**
 * How long a MISS is trusted. Positive results are kept indefinitely — a label does not change,
 * and keeping it is what makes a known food work on aeroplane mode — but "not in the database" is
 * a fact about the database on one day, and it gains entries constantly.
 */
const MISS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Lookup {
  label: LabelNutrition | null;
  /** Where the answer came from. `offline` means it was never asked. */
  from: 'cache' | 'network' | 'offline';
}

function barcodeKey(code: string): string {
  return `code:${code}`;
}

function nameKey(q: MatchQuery): string {
  return `name:${normalise([q.brand, q.text].filter(Boolean).join(' '))}`;
}

/** A cached answer, or null when there is none worth using. */
async function cached(key: string): Promise<Lookup | null> {
  const row = await db.productCache.get(key);
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
  if (digits.length < 8 || digits.length > 14) return { label: null, from: 'offline' };
  const key = barcodeKey(digits);

  const hit = await cached(key);
  if (hit) return hit;
  // Never asked rather than asked and refused: the caller shows these differently.
  if (offline()) return { label: null, from: 'offline' };

  const json = await getJson(`${BARCODE_URL}/${encodeURIComponent(digits)}.json?fields=${OFF_FIELDS}`);
  if (json === null) return { label: null, from: 'offline' };

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
  if (!normalise(query.text)) return { label: null, from: 'offline' };
  const key = nameKey(query);

  const hit = await cached(key);
  if (hit) return hit;
  if (offline()) return { label: null, from: 'offline' };

  const q = [query.brand, query.text].filter(Boolean).join(' ');
  const json = await getJson(
    `${SEARCH_URL}?q=${encodeURIComponent(q)}&page_size=${SEARCH_PAGE_SIZE}&fields=${OFF_FIELDS}`,
  );
  if (json === null) return { label: null, from: 'offline' };

  const hits = (json as { hits?: unknown }).hits;
  const candidates = Array.isArray(hits) ? hits.map(parseProduct).filter((l): l is LabelNutrition => l !== null) : [];
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
