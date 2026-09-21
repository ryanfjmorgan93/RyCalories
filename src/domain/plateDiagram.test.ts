import { describe, expect, it } from 'vitest';
import { DEFAULT_PLATES } from './plates';
import { buildPlateDiagram, contrastRatio, drawnPlateHeight, drawnPlateThickness, plateColor, plateLabelColor, plateLabelSize, realPlateDiameterMm } from './plateDiagram';

// The plate sizes this app actually ships with (DEFAULT_SETTINGS.plates, mirrored here as
// DEFAULT_PLATES.plates — see plates.ts), ascending — the ones a real lifter's diagram has to get
// right.
const DEFAULT_PLATES_ASC = [...DEFAULT_PLATES.plates].sort((a, b) => a - b);

describe('realPlateDiameterMm / drawnPlateHeight', () => {
  it('is strictly increasing across every plate size in DEFAULT_SETTINGS.plates', () => {
    const heights = DEFAULT_PLATES_ASC.map(drawnPlateHeight);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    }
  });

  it('never maps a heavier plate to a smaller size, for the default set in any order', () => {
    // Shuffle-proof: sort a copy descending and walk it — height must never go up as weight goes
    // down (a "heavier plate never maps to a smaller size" is the same statement backwards).
    const desc = [...DEFAULT_PLATES.plates].sort((a, b) => b - a);
    const heights = desc.map(drawnPlateHeight);
    for (let i = 1; i < heights.length; i++) {
      expect(heights[i]).toBeLessThanOrEqual(heights[i - 1]);
    }
  });

  it('every default plate size lands within the drawn height band', () => {
    for (const kg of DEFAULT_PLATES.plates) {
      const h = drawnPlateHeight(kg);
      expect(h).toBeGreaterThan(0);
      expect(h).toBeGreaterThanOrEqual(30);
      expect(h).toBeLessThanOrEqual(96);
    }
  });

  it('a 25 sits taller than a 20, which sits taller than a 15 (the concrete case from the brief)', () => {
    expect(drawnPlateHeight(25)).toBeGreaterThan(drawnPlateHeight(20));
    expect(drawnPlateHeight(20)).toBeGreaterThan(drawnPlateHeight(15));
  });

  it('interpolates an unusual plate size not in DEFAULT_SETTINGS.plates between its neighbours', () => {
    // 7.5 kg isn't a real plate size in this app's set, but a custom plate list could still name
    // one. It must land strictly between the 5 kg and 10 kg heights, not fall back to either.
    const h5 = drawnPlateHeight(5);
    const h7_5 = drawnPlateHeight(7.5);
    const h10 = drawnPlateHeight(10);
    expect(h7_5).toBeGreaterThan(h5);
    expect(h7_5).toBeLessThan(h10);
  });

  it('extrapolates beyond the table for a very heavy or very light unusual plate, staying monotonic and clamped', () => {
    const h1 = drawnPlateHeight(0.5); // lighter than the lightest listed plate (1.25 kg)
    const h1_25 = drawnPlateHeight(1.25);
    const h25 = drawnPlateHeight(25); // heaviest listed plate
    const h50 = drawnPlateHeight(50); // heavier than any listed plate

    expect(h1).toBeLessThanOrEqual(h1_25);
    expect(h50).toBeGreaterThanOrEqual(h25);
    // Clamped, not runaway: nothing exceeds the drawn band's own ceiling.
    expect(h50).toBeLessThanOrEqual(96);
    expect(h1).toBeGreaterThanOrEqual(30);
  });

  it('treats non-finite or non-positive input as the smallest plate rather than throwing', () => {
    expect(realPlateDiameterMm(NaN)).toBe(90);
    expect(realPlateDiameterMm(0)).toBe(90);
    expect(realPlateDiameterMm(-5)).toBe(90);
  });
});

describe('drawnPlateThickness', () => {
  it('is also non-decreasing across the default set (a secondary cue, not the primary one)', () => {
    const thicknesses = DEFAULT_PLATES_ASC.map(drawnPlateThickness);
    for (let i = 1; i < thicknesses.length; i++) {
      expect(thicknesses[i]).toBeGreaterThanOrEqual(thicknesses[i - 1]);
    }
  });
});

describe('plateColor', () => {
  it('gives every default plate size a colour', () => {
    for (const kg of DEFAULT_PLATES.plates) {
      expect(plateColor(kg)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('falls back to a neutral grey for a plate size with no standard colour', () => {
    expect(plateColor(7.5)).toBe('#6b7280');
  });
});

describe('buildPlateDiagram', () => {
  it('is bar-only (no plate blocks) for an empty perSide', () => {
    const d = buildPlateDiagram([]);
    expect(d.plates).toEqual([]);
    expect(d.clip.x).toBeGreaterThan(d.sleeve.x);
  });

  it('lays out plates left to right in the given (heaviest-first) order, each taller than the next when the weights differ', () => {
    // The 65 kg default-Bench-Press case from the seed data: 20 + 2.5 per side.
    const d = buildPlateDiagram([20, 2.5]);
    expect(d.plates.map((p) => p.kg)).toEqual([20, 2.5]);
    expect(d.plates[0].x).toBeLessThan(d.plates[1].x);
    expect(d.plates[0].height).toBeGreaterThan(d.plates[1].height);
    // Every plate is centred on the same bar centreline.
    for (const p of d.plates) {
      expect(p.y + p.height / 2).toBeCloseTo(d.barY, 5);
    }
    // The clip sits flush after the last (lightest, outboard) plate.
    const last = d.plates[d.plates.length - 1];
    expect(d.clip.x).toBeCloseTo(last.x + last.width, 5);
  });

  it('keeps the same overall height (and so the same bar centreline) regardless of which plates are loaded', () => {
    const bare = buildPlateDiagram([]);
    const loaded = buildPlateDiagram([25, 25, 20, 1.25]);
    expect(loaded.height).toBe(bare.height);
    expect(loaded.barY).toBe(bare.barY);
  });
});

/**
 * The number printed on each plate. This replaced a shared label row above the diagram, which
 * collided in the real render: adjacent plates are far narrower than the text, so a 20 beside a
 * 2.5 ran together and read as "202.5" — a wrong number on the screen that tells you what to
 * load. Thirteen green tests and a full e2e run all missed it, because nothing asserted on what
 * the thing actually looked like.
 */
describe('plate labels', () => {
  // The assertion that matters is not WHICH ink it picks but that the number is readable on the
  // plate. A first attempt used a fixed luminance threshold and gave the muted 15 kg yellow white
  // ink at 2.5:1; this catches that class of mistake instead of encoding one right answer.
  it('gives every standard plate an ink that clears 4.5:1 against it', () => {
    for (const kg of [1.25, 2.5, 5, 10, 15, 20, 25]) {
      expect(contrastRatio(plateColor(kg), plateLabelColor(kg))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('picks the better of the two inks, not a fixed one', () => {
    expect(plateLabelColor(5)).toBe('#111316'); // near-white plate
    expect(plateLabelColor(20)).toBe('#ffffff'); // mid blue
  });

  it('gives an unknown plate size a readable ink rather than throwing', () => {
    expect(contrastRatio(plateColor(7.5), plateLabelColor(7.5))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps every standard plate label within legible bounds', () => {
    for (const kg of [1.25, 2.5, 5, 10, 15, 20, 25]) {
      const size = plateLabelSize(kg);
      expect(size).toBeGreaterThanOrEqual(9);
      expect(size).toBeLessThanOrEqual(14);
    }
  });

  it('never shrinks the label as the plate gets heavier', () => {
    const sizes = [1.25, 2.5, 5, 10, 15, 20, 25].map(plateLabelSize);
    for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThanOrEqual(sizes[i - 1]);
  });

  it('carries the ink and size on every block the diagram lays out', () => {
    for (const block of buildPlateDiagram([20, 2.5]).plates) {
      expect(block.labelColor).toBe(plateLabelColor(block.kg));
      expect(block.labelSize).toBe(plateLabelSize(block.kg));
    }
  });
});
