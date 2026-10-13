import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import catalogue from './exerciseCatalogue.json';
import { findDemo } from './exerciseDemos';
import { ROBOT_RENDER_KEYS } from './robotRenders';
import { heroDemo, robotSrc } from '@/ui/demoPicture';

const PUBLIC = fileURLToPath(new URL('../../public', import.meta.url));
const catalogueSlugs = new Set((catalogue as { slug: string }[]).map((e) => e.slug));

describe('robot renders', () => {
  it('lists exactly the files under public/robots (run scripts/robot-renders.mjs after a change)', () => {
    const files = [
      ...readdirSync(`${PUBLIC}/robots`).filter((f) => f.endsWith('.webp')).map((f) => `/robots/${f}`),
      ...readdirSync(`${PUBLIC}/robots/cat`).filter((f) => f.endsWith('.webp')).map((f) => `/robots/cat/${f}`),
    ].sort();
    expect(ROBOT_RENDER_KEYS.map((k) => robotSrc(k)).sort()).toEqual(files);
  });

  it('names only demo keys the app carries', () => {
    for (const key of ROBOT_RENDER_KEYS) {
      if (key.startsWith('cat:')) expect(catalogueSlugs.has(key.slice(4)), key).toBe(true);
      else expect(findDemo(key), key).toBeDefined();
    }
  });

  it('keeps every render small enough to bundle', () => {
    for (const key of ROBOT_RENDER_KEYS) {
      const file = `${PUBLIC}${robotSrc(key)}`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThan(48 * 1024);
    }
  });

  it('has no render for a key without one, or no key', () => {
    expect(robotSrc(undefined)).toBeUndefined();
    expect(robotSrc('cat:not-a-real-entry')).toBeUndefined();
  });
});

describe('heroDemo', () => {
  it('prefers the first key with a render, else the first key', () => {
    const withRender = ROBOT_RENDER_KEYS[0];
    expect(heroDemo(['no-such-demo', withRender])).toBe(withRender);
    expect(heroDemo(['no-such-demo', 'other'])).toBe('no-such-demo');
    expect(heroDemo([])).toBeUndefined();
  });
});
