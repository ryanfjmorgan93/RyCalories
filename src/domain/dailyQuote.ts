/**
 * Home's header: a welcome for the time of day and one quote a day, chosen by date so it stays the
 * same all day and changes at midnight. The quotes are a fixed, bundled list with their authors,
 * so the header works offline and sends nothing anywhere. Pure: the date comes in as a key.
 */
import { partOfDay } from './homeToday';

export interface Quote {
  text: string;
  author: string;
}

/** Short lines about training, effort and patience, each with its source. */
export const QUOTES: readonly Quote[] = [
  { text: 'We are what we repeatedly do. Excellence, then, is not an act, but a habit.', author: 'Will Durant' },
  { text: 'The body achieves what the mind believes.', author: 'Napoleon Hill' },
  { text: 'It does not matter how slowly you go as long as you do not stop.', author: 'Confucius' },
  { text: 'Strength does not come from winning. Your struggles develop your strengths.', author: 'Arnold Schwarzenegger' },
  { text: 'The last three or four reps is what makes the muscle grow.', author: 'Arnold Schwarzenegger' },
  { text: 'Everybody wants to be a bodybuilder, but nobody wants to lift no heavy-ass weights.', author: 'Ronnie Coleman' },
  { text: 'Discipline is choosing between what you want now and what you want most.', author: 'Abraham Lincoln' },
  { text: 'Success is the sum of small efforts, repeated day in and day out.', author: 'Robert Collier' },
  { text: 'The iron never lies to you.', author: 'Henry Rollins' },
  { text: 'Motivation is what gets you started. Habit is what keeps you going.', author: 'Jim Ryun' },
  { text: 'Fall seven times, stand up eight.', author: 'Japanese proverb' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'The man who moves a mountain begins by carrying away small stones.', author: 'Confucius' },
  { text: 'Energy and persistence conquer all things.', author: 'Benjamin Franklin' },
  { text: 'Do not pray for an easy life, pray for the strength to endure a difficult one.', author: 'Bruce Lee' },
  { text: 'Pain is temporary. Quitting lasts forever.', author: 'Lance Armstrong' },
  { text: 'You have power over your mind, not outside events. Realise this, and you will find strength.', author: 'Marcus Aurelius' },
  { text: 'No man has the right to be an amateur in the matter of physical training.', author: 'Socrates' },
  { text: 'Hard work beats talent when talent does not work hard.', author: 'Tim Notke' },
  { text: 'The only bad workout is the one that did not happen.', author: 'Unknown' },
  { text: 'A year from now you will wish you had started today.', author: 'Karen Lamb' },
  { text: 'Small daily improvements over time lead to stunning results.', author: 'Robin Sharma' },
  { text: 'Champions keep playing until they get it right.', author: 'Billie Jean King' },
  { text: 'Nothing will work unless you do.', author: 'Maya Angelou' },
  { text: 'Act as if what you do makes a difference. It does.', author: 'William James' },
  { text: 'The difference between try and triumph is a little umph.', author: 'Marvin Phillips' },
  { text: 'Our greatest glory is not in never falling, but in rising every time we fall.', author: 'Confucius' },
  { text: 'If it does not challenge you, it does not change you.', author: 'Fred DeVito' },
  { text: 'What we do in life echoes in eternity.', author: 'Marcus Aurelius' },
  { text: 'Slow progress is still progress.', author: 'Unknown' },
  { text: 'Be stronger than your excuses.', author: 'Unknown' },
];

/** Whole days since 1970-01-01 for a `YYYY-MM-DD` key: the same number all day, wherever the clock is. */
function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
}

/**
 * The quote for a day. Steps through the list with a stride coprime to its length, so consecutive
 * days are far apart in the list and every quote comes round once before any repeats.
 */
export function quoteOfTheDay(dateKey: string, quotes: readonly Quote[] = QUOTES): Quote {
  const n = quotes.length;
  const stride = 7 % n === 0 ? 1 : 7;
  const i = (((dayNumber(dateKey) * stride) % n) + n) % n;
  return quotes[i];
}

/** "Good morning", "Good afternoon" or "Good evening". */
export function welcomeLine(hour: number): string {
  return `Good ${partOfDay(hour)}`;
}
