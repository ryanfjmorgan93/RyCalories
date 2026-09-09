import { useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { checkInData } from '@/db/checkinQueries';
import { buildCheckIn, fmtDateKey, fmtDelta } from '@/domain/checkin';
import { toDateKey } from '@/domain/dates';
import { fmtNum, fmtRange, fmtReps, fmtWeight } from '@/domain/format';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row, SectionTitle, Stat } from '@/ui/components/Card';
import { Chip } from '@/ui/components/Chip';
import { toast } from '@/ui/components/Toast';
import { TopBar } from '@/ui/components/TopBar';

const WINDOW_DAYS = 14;

async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the textarea path
  }
  if (!fallback) return false;
  try {
    fallback.value = text;
    fallback.focus();
    fallback.select();
    fallback.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  }
}

export function CheckInScreen() {
  const asOf = toDateKey();
  const data = useLiveQuery(() => checkInData(asOf, WINDOW_DAYS), [asOf]);
  const checkIn = useMemo(() => (data ? buildCheckIn(data) : null), [data]);
  const hidden = useRef<HTMLTextAreaElement>(null);

  const copy = async () => {
    if (!checkIn) return;
    const ok = await copyText(checkIn.text, hidden.current);
    toast(ok ? 'Copied' : 'Copy failed', ok ? 'ok' : 'danger');
  };

  if (!data || !checkIn) {
    return (
      <div>
        <TopBar title="Check-in" back="/settings" />
        <div className="px-4 py-8 text-muted">Loading…</div>
      </div>
    );
  }

  const bw = checkIn.bodyweight;
  const niggles = data.niggles.filter((n) => n.date >= checkIn.from && n.date <= asOf).sort((a, b) => a.date.localeCompare(b.date));
  const sessionCount = data.sessions.filter((s) => s.date >= checkIn.from && s.date <= asOf).length;

  return (
    <div>
      <TopBar title="Check-in" back="/settings" subtitle={`${fmtDateKey(checkIn.from)} – ${fmtDateKey(asOf)} · last ${WINDOW_DAYS} days`} />
      <div className="px-4">
        <SectionTitle>Lifts</SectionTitle>
        {data.lifts.length === 0 ? (
          <EmptyState>No check-in lifts in any routine</EmptyState>
        ) : (
          <Card>
            {data.lifts.map((l, i) => {
              const calibrating = l.mode === 'calibrating' || l.weight === null;
              return (
                <div key={l.name}>
                  {i > 0 && <Divider />}
                  <Row
                    title={l.name}
                    subtitle={`${l.targetSets} × ${fmtRange(l.repMin, l.repMax)}${l.lastSessionReps ? ` · last ${fmtReps(l.lastSessionReps)}` : ''}`}
                    right={
                      calibrating ? (
                        <Chip tone="info" size="sm">
                          calibrating
                        </Chip>
                      ) : (
                        <div className="num text-2xl font-extrabold">{fmtWeight(l.kind, l.weight as number)}</div>
                      )
                    }
                  />
                </div>
              );
            })}
          </Card>
        )}

        <SectionTitle>Bodyweight</SectionTitle>
        {bw.readings === 0 || bw.first === null || bw.last === null || bw.avg === null || bw.delta === null ? (
          <EmptyState>No readings in the window</EmptyState>
        ) : (
          <Card className="grid grid-cols-3 gap-4 px-4 py-3">
            <Stat label="Now" value={`${fmtNum(bw.last)} kg`} sub={`from ${fmtNum(bw.first)}`} />
            <Stat label="Change" value={fmtDelta(bw.delta)} tone={bw.delta > 0 ? 'ok' : bw.delta < 0 ? 'warn' : undefined} sub="kg" />
            <Stat label="Average" value={fmtNum(bw.avg)} sub={`${bw.readings} reading${bw.readings === 1 ? '' : 's'}`} />
          </Card>
        )}

        <SectionTitle>Sessions</SectionTitle>
        <Card className="px-4 py-3">
          <Stat label="Completed" value={sessionCount} />
          {checkIn.sessionCounts.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {checkIn.sessionCounts.map((c) => (
                <Chip key={c.title} size="sm">
                  {c.title} ×{c.count}
                </Chip>
              ))}
            </div>
          )}
        </Card>

        <SectionTitle>Niggles</SectionTitle>
        {niggles.length === 0 ? (
          <EmptyState>None</EmptyState>
        ) : (
          <Card>
            {niggles.map((n, i) => (
              <div key={`${n.date}-${n.tag}-${i}`}>
                {i > 0 && <Divider />}
                <Row
                  title={`${n.tag} (${n.severity})`}
                  subtitle={n.note ? `${fmtDateKey(n.date)} · ${n.note}` : fmtDateKey(n.date)}
                  right={<Chip tone={n.severity >= 3 ? 'danger' : n.severity === 2 ? 'warn' : 'neutral'} size="sm">{n.severity}</Chip>}
                />
              </div>
            ))}
          </Card>
        )}

        <SectionTitle>Text</SectionTitle>
        <Card className="overflow-x-auto p-4">
          <pre className="whitespace-pre-wrap break-words font-mono text-sm text-fg" data-testid="checkin-text">
            {checkIn.text}
          </pre>
        </Card>

        <Button size="xl" variant="primary" full className="mt-4" onClick={() => void copy()} data-testid="copy-checkin">
          Copy check-in
        </Button>

        <textarea
          ref={hidden}
          readOnly
          aria-hidden="true"
          tabIndex={-1}
          className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        />
        <div className="h-6" />
      </div>
    </div>
  );
}
