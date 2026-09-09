import { db } from './db';
import type { Session } from '@/domain/types';

/** Every completed session (has `endedAt`), newest first. */
export async function completedSessions(): Promise<Session[]> {
  const done = await db.sessions.filter((s) => !!s.endedAt).toArray();
  done.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return done;
}

/** Set count per session id, from a single scan of the set-log table. */
export async function setCountsBySession(): Promise<Map<string, number>> {
  const all = await db.setLogs.toArray();
  const m = new Map<string, number>();
  for (const s of all) m.set(s.sessionId, (m.get(s.sessionId) ?? 0) + 1);
  return m;
}

/** Elapsed seconds for a session, falling back to endedAt − startedAt when durationSec is absent. */
export function sessionSeconds(s: Session): number {
  if (s.durationSec !== undefined) return s.durationSec;
  if (!s.endedAt) return 0;
  return Math.max(0, Math.round((Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000));
}
