import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db';
import { clearProductCache, lookupBarcode, lookupName } from './productRepo';
import { wipeAll } from './repo';

const TREK = {
  code: '5060088709054',
  product_name: 'TREK PROTEIN FLAPJACKS',
  brands: ['Trek'],
  serving_quantity: 50,
  nutriments: { 'energy-kcal_100g': 452.5, proteins_100g: 18.5, carbohydrates_100g: 44, fat_100g: 22 },
};

/** Stand in for the network. Returns whatever the queue holds, and records what was asked. */
function mockFetch(responses: Array<{ ok?: boolean; body?: unknown } | Error>) {
  const calls: string[] = [];
  const queue = [...responses];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      const next = queue.shift();
      if (next === undefined) throw new Error('unexpected request');
      if (next instanceof Error) throw next;
      return { ok: next.ok ?? true, json: async () => next.body };
    }),
  );
  return calls;
}

beforeEach(async () => {
  await wipeAll();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('barcode lookup', () => {
  it('reads a product and remembers it', async () => {
    const calls = mockFetch([{ body: { status: 1, product: TREK } }]);
    const first = await lookupBarcode('5060088709054');
    expect(first.from).toBe('network');
    expect(first.label?.brand).toBe('Trek');
    expect(first.label?.per100.kcal).toBe(452.5);
    expect(first.label?.servingGrams).toBe(50);

    // Second time it never touches the network, which is what makes a scanned food work offline.
    const second = await lookupBarcode('5060088709054');
    expect(second.from).toBe('cache');
    expect(second.label?.brand).toBe('Trek');
    expect(calls).toHaveLength(1);
  });

  it('remembers a miss so an unknown barcode stops re-asking', async () => {
    const calls = mockFetch([{ body: { status: 0 } }]);
    expect((await lookupBarcode('0000000000000')).label).toBeNull();
    expect((await lookupBarcode('0000000000000')).from).toBe('cache');
    expect(calls).toHaveLength(1);
  });

  it('re-asks once a remembered miss is stale, because the database keeps growing', async () => {
    mockFetch([{ body: { status: 0 } }]);
    await lookupBarcode('0000000000000');
    await db.productCache.update('code:0000000000000', { fetchedAt: '2020-01-01T00:00:00.000Z' });

    vi.unstubAllGlobals();
    const calls = mockFetch([{ body: { status: 1, product: TREK } }]);
    const again = await lookupBarcode('0000000000000');
    expect(again.from).toBe('network');
    expect(again.label?.brand).toBe('Trek');
    expect(calls).toHaveLength(1);
  });

  it('says nothing rather than throwing when the network fails', async () => {
    mockFetch([new Error('ECONNRESET')]);
    const r = await lookupBarcode('5060088709054');
    // 'unavailable', not 'offline': the device has a connection, the service did not answer.
    // Reporting that as "no connection" sends the user off to check their wifi.
    expect(r).toEqual({ label: null, from: 'unavailable' });
    // And a failure is NOT remembered as a miss — the food may well be in the database.
    expect(await db.productCache.count()).toBe(0);
  });

  it('treats a bad HTTP status the same way', async () => {
    mockFetch([{ ok: false }]);
    expect((await lookupBarcode('5060088709054')).from).toBe('unavailable');
    expect(await db.productCache.count()).toBe(0);
  });

  it('does not ask at all when the device is offline', async () => {
    const calls = mockFetch([]);
    vi.stubGlobal('navigator', { onLine: false });
    expect((await lookupBarcode('5060088709054')).from).toBe('offline');
    expect(calls).toHaveLength(0);
  });

  it('still answers from cache while offline', async () => {
    mockFetch([{ body: { status: 1, product: TREK } }]);
    await lookupBarcode('5060088709054');
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { onLine: false });
    const r = await lookupBarcode('5060088709054');
    expect(r.from).toBe('cache');
    expect(r.label?.brand).toBe('Trek');
  });

  it('refuses something that is not a barcode without asking', async () => {
    const calls = mockFetch([]);
    expect(await lookupBarcode('12')).toEqual({ label: null, from: 'invalid' });
    expect(await lookupBarcode('')).toEqual({ label: null, from: 'invalid' });
    expect(calls).toHaveLength(0);
  });
});

describe('name lookup', () => {
  it('finds the right product and remembers the answer', async () => {
    const calls = mockFetch([{ body: { products: [TREK] } }]);
    const r = await lookupName({ text: 'Protein Flapjack', brand: 'Trek' });
    expect(r.from).toBe('network');
    expect(r.label?.name).toBe('TREK PROTEIN FLAPJACKS');

    expect((await lookupName({ text: 'protein  flapjack!', brand: 'TREK' })).from).toBe('cache');
    expect(calls).toHaveLength(1);
  });

  it('goes to the host that allows cross-origin reads when it has a brand to filter on', async () => {
    // search.openfoodfacts.org sends no Access-Control-Allow-Origin, so a browser blocks the
    // response before it can be read. The main API host does send it, and accepts a brand tag.
    const calls = mockFetch([{ body: { products: [TREK] } }]);
    await lookupName({ text: 'Protein Flapjack', brand: 'Natural Balance Foods' });
    expect(calls[0]).toContain('world.openfoodfacts.org/api/v2/search');
    expect(calls[0]).toContain('brands_tags=natural-balance-foods');
  });

  it('falls back to full-text search only when there is no brand', async () => {
    const calls = mockFetch([{ body: { hits: [TREK] } }]);
    await lookupName({ text: 'Protein Flapjack' });
    expect(calls[0]).toContain('search.openfoodfacts.org');
  });

  it('does not serve a brandless answer to a branded search', async () => {
    // Joined into one key, "Trek Protein Flapjack" with no brand and "Protein Flapjack" branded
    // "Trek" collapse together — but only the second enforces the brand rule, so the first's
    // laxer answer would defeat it.
    const calls = mockFetch([{ body: { hits: [TREK] } }, { body: { products: [TREK] } }]);
    await lookupName({ text: 'Trek Protein Flapjack' });
    const second = await lookupName({ text: 'Protein Flapjack', brand: 'Trek' });
    expect(second.from).toBe('network');
    expect(calls).toHaveLength(2);
  });

  it('reports a service that will not answer as unavailable, not as being offline', async () => {
    mockFetch([{ ok: false }]);
    expect((await lookupName({ text: 'Protein Flapjack', brand: 'Trek' })).from).toBe('unavailable');
  });

  it('survives a database that cannot be read', async () => {
    // A cache read that throws used to escape the call and leave the UI stuck on "Looking up…".
    const spy = vi.spyOn(db.productCache, 'get').mockRejectedValue(new Error('IndexedDB gone'));
    mockFetch([{ body: { products: [TREK] } }]);
    const r = await lookupName({ text: 'Protein Flapjack', brand: 'Trek' });
    expect(r.label?.brand).toBe('Trek');
    spy.mockRestore();
  });

  it('returns nothing rather than a rival manufacturer', async () => {
    // The whole point of the brand rule: a wrong number behind a label badge is worse than none.
    const aldi = { ...TREK, code: '999', brands: ['Aldi'], product_name: 'Protein Flapjack' };
    mockFetch([{ body: { hits: [aldi] } }]);
    const r = await lookupName({ text: 'Protein Flapjack', brand: 'Trek' });
    expect(r.label).toBeNull();
    expect(r.from).toBe('network');
  });

  it('copes with a response that is not shaped as expected', async () => {
    mockFetch([{ body: { products: 'nope' } }, { body: null }, { body: { products: [{}] } }]);
    expect((await lookupName({ text: 'a' })).label).toBeNull();
    expect((await lookupName({ text: 'b' })).label).toBeNull();
    expect((await lookupName({ text: 'c' })).label).toBeNull();
  });

  it('does not ask for an empty query, and does not blame the network for it', async () => {
    const calls = mockFetch([]);
    expect(await lookupName({ text: '  !  ' })).toEqual({ label: null, from: 'invalid' });
    expect(calls).toHaveLength(0);
  });
});

describe('clearing the cache', () => {
  it('reports what it removed', async () => {
    mockFetch([{ body: { status: 1, product: TREK } }]);
    await lookupBarcode('5060088709054');
    expect(await clearProductCache()).toBe(1);
    expect(await db.productCache.count()).toBe(0);
  });
});
