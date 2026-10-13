import { describe, expect, it } from 'vitest';
import { QUOTES, quoteOfTheDay, welcomeLine } from './dailyQuote';

function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

describe('quoteOfTheDay', () => {
  it('is the same all day and changes the next day', () => {
    expect(quoteOfTheDay('2026-10-13')).toEqual(quoteOfTheDay('2026-10-13'));
    expect(quoteOfTheDay('2026-10-14')).not.toEqual(quoteOfTheDay('2026-10-13'));
  });

  it('shows every quote once before any repeats', () => {
    const seen = new Set<string>();
    for (let i = 0; i < QUOTES.length; i++) seen.add(quoteOfTheDay(addDays('2026-01-01', i)).text);
    expect(seen.size).toBe(QUOTES.length);
  });

  it('works for a list whose length shares a factor with the stride', () => {
    const seven = Array.from({ length: 7 }, (_, i) => ({ text: `q${i}`, author: 'a' }));
    const seen = new Set<string>();
    for (let i = 0; i < 7; i++) seen.add(quoteOfTheDay(addDays('2026-01-01', i), seven).text);
    expect(seen.size).toBe(7);
  });

  it('every quote has text and an author', () => {
    for (const q of QUOTES) {
      expect(q.text.trim().length).toBeGreaterThan(0);
      expect(q.author.trim().length).toBeGreaterThan(0);
    }
  });
});

describe('welcomeLine', () => {
  it('follows the time of day', () => {
    expect(welcomeLine(7)).toBe('Good morning');
    expect(welcomeLine(13)).toBe('Good afternoon');
    expect(welcomeLine(20)).toBe('Good evening');
  });
});
