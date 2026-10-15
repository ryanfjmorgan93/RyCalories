import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '@/db/db';
import { addSupplement, removeSupplement, toggleSupplementTaken } from '@/db/supplementRepo';
import { SUPPLEMENT_DOSE_MAX, SUPPLEMENT_NAME_MAX, SUPPLEMENT_TIME_LABEL, SUPPLEMENT_TIMES, supplementDay } from '@/domain/supplements';
import type { SupplementTime } from '@/domain/types';
import { Button, IconButton } from './components/Button';
import { Card } from './components/Card';
import { Segmented } from './components/Chip';
import { Sheet } from './components/Sheet';
import { toast } from './components/Toast';

/**
 * Home's supplement checklist for today, kept small: a tile per supplement, three to a row and all
 * in view, in time-of-day order, tapped to tick or untick (the dose under the name when there is one). With
 * nothing on the list it is one line offering to add some. Edit opens the list.
 */
export function SupplementsCard({ today }: { today: string }) {
  const supplements = useLiveQuery(() => db.supplements.toArray(), []);
  const logs = useLiveQuery(() => db.supplementLogs.where('date').equals(today).toArray(), [today]);
  const [editing, setEditing] = useState(false);
  if (!supplements || !logs) return null;
  const day = supplementDay(supplements, logs, today);

  return (
    <>
      <Card className="mt-3 overflow-hidden" data-testid="supplements-card">
        <div className="flex items-center justify-between px-4 pt-2">
          <span className="label">
            Supplements{day.total > 0 && <span data-testid="supplements-count"> · {day.taken} of {day.total}</span>}
          </span>
          <Button size="sm" variant="ghost" className="-mr-2 text-accent" onClick={() => setEditing(true)} data-testid="supplements-edit">
            {day.total > 0 ? 'Edit' : 'Add'}
          </Button>
        </div>
        {day.total === 0 ? (
          <div className="px-4 pb-3 text-sm text-muted">Nothing on the list.</div>
        ) : (
          // Every one in view at once, three to a row, in time-of-day order: the name with the dose
          // under it, filled when taken. The time of day is on the list itself (Edit) and in each name for a reader.
          <ul className="grid grid-cols-3 gap-1.5 px-3 pt-1 pb-3" data-testid="supplements-row">
            {day.items.map(({ supplement, taken }) => (
              <li key={supplement.id} className="min-w-0">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={taken}
                  aria-label={`${supplement.name}${supplement.dose ? ` ${supplement.dose}` : ''}, ${SUPPLEMENT_TIME_LABEL[supplement.time].toLowerCase()}`}
                  onClick={() => void toggleSupplementTaken(supplement.id, today)}
                  data-testid={`supplement-${supplement.name}`}
                  className={`flex min-h-11 w-full flex-col justify-center rounded-xl border px-2.5 py-1.5 text-left text-sm transition-colors ${
                    taken ? 'border-accent bg-accent text-accent-fg' : 'border-glass-border bg-white/[.04] active:bg-white/[.08]'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-1 font-medium">
                    {taken && (
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" className="shrink-0">
                        <path d="M2.5 6.5 5 9l4.5-6" />
                      </svg>
                    )}
                    <span className="break-words">{supplement.name}</span>
                  </span>
                  {supplement.dose && <span className={`break-words text-xs ${taken ? 'text-accent-fg/70' : 'text-muted'}`}>{supplement.dose}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <SupplementsSheet open={editing} onClose={() => setEditing(false)} />
    </>
  );
}

/** The list itself: add one (name, dose, time of day) or take one off. */
export function SupplementsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const supplements = useLiveQuery(() => db.supplements.toArray(), []);
  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [time, setTime] = useState<SupplementTime>('morning');
  const list = supplementDay(supplements ?? [], [], '').items.map((i) => i.supplement);

  const add = async () => {
    const r = await addSupplement({ name, dose, time });
    if (!r.ok) return;
    if (r.existed) toast(`${r.supplement.name} is already on the list`);
    setName('');
    setDose('');
  };

  return (
    <Sheet open={open} onClose={onClose} title="Supplements">
      <div className="space-y-3 px-4 pb-4" data-testid="supplements-sheet">
        {list.length > 0 && (
          <ul className="divide-y divide-line rounded-control border border-line">
            {list.map((s) => (
              <li key={s.id} className="flex min-h-14 items-center gap-2 pl-3">
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-medium">{s.name}</span>
                  <span className="block break-words text-sm text-muted">{[s.dose, SUPPLEMENT_TIME_LABEL[s.time]].filter(Boolean).join(' · ')}</span>
                </span>
                <IconButton label={`Remove ${s.name}`} onClick={() => void removeSupplement(s.id)} data-testid={`supplement-remove-${s.name}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M6 6l12 12M18 6 6 18" />
                  </svg>
                </IconButton>
              </li>
            ))}
          </ul>
        )}
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={SUPPLEMENT_NAME_MAX}
            placeholder="Name"
            aria-label="Supplement name"
            data-testid="supplement-name"
            enterKeyHint="next"
            className="h-12 w-full rounded-control border border-line bg-surface-2 px-3 text-base outline-none placeholder:text-dim focus:border-accent"
          />
          <input
            value={dose}
            onChange={(e) => setDose(e.target.value)}
            maxLength={SUPPLEMENT_DOSE_MAX}
            placeholder="Dose"
            aria-label="Dose"
            data-testid="supplement-dose"
            enterKeyHint="done"
            className="h-12 w-full rounded-control border border-line bg-surface-2 px-3 text-base outline-none placeholder:text-dim focus:border-accent"
          />
        </div>
        <Segmented value={time} onChange={setTime} options={SUPPLEMENT_TIMES.map((t) => ({ value: t, label: SUPPLEMENT_TIME_LABEL[t], testId: `supplement-time-${t}` }))} />
        <Button full variant="primary" disabled={!name.trim()} onClick={() => void add()} data-testid="supplement-add">
          Add
        </Button>
      </div>
    </Sheet>
  );
}
