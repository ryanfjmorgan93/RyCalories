import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { completedSessions, sessionSeconds, setCountsBySession } from '@/db/historyQueries';
import { fmtDateTime, fmtMinutes } from '@/domain/format';
import type { Session } from '@/domain/types';
import { Card, Divider, EmptyState, Row, SectionTitle } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { ChevronIcon, TopBar } from '@/ui/components/TopBar';

const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric' });

function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  return monthFmt.format(d);
}

interface MonthGroup {
  label: string;
  sessions: Session[];
}

export function HistoryScreen() {
  const nav = useNavigate();
  const sessions = useLiveQuery(() => completedSessions(), []);
  const setCounts = useLiveQuery(() => setCountsBySession(), []);

  const groups: MonthGroup[] = useMemo(() => {
    const out: MonthGroup[] = [];
    for (const s of sessions ?? []) {
      const label = monthLabel(s.startedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.sessions.push(s);
      else out.push({ label, sessions: [s] });
    }
    return out;
  }, [sessions]);

  return (
    <div>
      <TopBar title="History" back="/" />
      <div className="px-4">
        {sessions === undefined && <div className="py-8 text-muted">Loading…</div>}

        {sessions && sessions.length === 0 && (
          <div className="pt-4">
            <EmptyState>No completed sessions yet.</EmptyState>
          </div>
        )}

        {groups.map((g) => (
          <div key={g.label}>
            <SectionTitle>{g.label}</SectionTitle>
            <Card>
              {g.sessions.map((s, i) => {
                const n = setCounts?.get(s.id) ?? 0;
                return (
                  <div key={s.id}>
                    {i > 0 && <Divider />}
                    <Row
                      onClick={() => nav(`/history/${s.id}`)}
                      title={
                        <span className="flex items-center gap-2">
                          <span className="truncate">{s.title}</span>
                          {s.source === 'hevy' && <Chip size="sm">Hevy</Chip>}
                        </span>
                      }
                      subtitle={`${fmtDateTime(s.startedAt)} · ${fmtMinutes(sessionSeconds(s))} · ${n} ${n === 1 ? 'set' : 'sets'}`}
                      right={<ChevronIcon />}
                    />
                  </div>
                );
              })}
            </Card>
          </div>
        ))}
        <div className="h-6" />
      </div>
    </div>
  );
}
