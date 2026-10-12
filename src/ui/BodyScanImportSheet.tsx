import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/db/db';
import { saveScans, type SaveScansResult } from '@/db/bodyScanRepo';
import { dateKeyToDate } from '@/domain/dates';
import { fmtDate, fmtNum, plural } from '@/domain/format';
import type { ParsedInbody, ParsedScan } from '@/domain/inbody';
import { Button } from '@/ui/components/Button';
import { Divider } from '@/ui/components/Card';
import { Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';

/** Rows drawn before the list says how many more there are; a whole history is a hundred or so. */
const SHOWN = 200;

const dateLabel = (key: string) => fmtDate(dateKeyToDate(key).toISOString(), { day: 'numeric', month: 'short', year: 'numeric' });
const kg = (n: number | undefined) => (n === undefined ? '—' : fmtNum(n));

/** The line saved scans are reported with: "Saved 4 scans · 3 weights logged". */
export function savedLine(r: SaveScansResult): string {
  const base = `Saved ${plural(r.saved, 'scan')}`;
  return r.weightsLogged > 0 ? `${base} · ${plural(r.weightsLogged, 'weight')} logged` : base;
}

/**
 * What an InBody file (or a shared one, or a photo read by Claude) holds, before any of it is kept:
 * each scan's date, weight, muscle and body fat, the rows that were skipped and why, and one button.
 * Saving replaces a scan already held for the same date and never overwrites a bodyweight reading
 * the owner logged themselves (see saveScans).
 */
export function BodyScanImportSheet({
  parsed,
  title = 'Import InBody scans',
  open,
  onClose,
  onSaved,
}: {
  parsed: ParsedInbody | null;
  title?: string;
  open: boolean;
  onClose: () => void;
  onSaved?: (result: SaveScansResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const held = useLiveQuery(async () => new Set((await db.bodyScans.orderBy('date').keys()) as string[]), []);

  if (!parsed) return null;
  const { scans, skipped } = parsed;
  const replacing = held ? scans.filter((s) => held.has(s.date)).length : 0;

  const save = async () => {
    if (busy || scans.length === 0) return;
    setBusy(true);
    try {
      const result = await saveScans(scans);
      toast(savedLine(result), 'ok');
      onSaved?.(result);
      onClose();
    } catch {
      toast('Could not save the scans', 'danger');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button size="lg" variant="primary" full disabled={busy || scans.length === 0} onClick={() => void save()} data-testid="inbody-save">
          {scans.length === 0 ? 'Nothing to save' : `Save ${plural(scans.length, 'scan')}`}
        </Button>
      }
    >
      <div data-testid="inbody-preview">
        {scans.length > 0 ? (
          <>
            <div className="text-sm text-muted" data-testid="inbody-summary">
              {plural(scans.length, 'scan')}
              {scans.length > 1 ? ` · ${dateLabel(scans[0].date)} to ${dateLabel(scans[scans.length - 1].date)}` : ` · ${dateLabel(scans[0].date)}`}
            </div>
            {replacing > 0 && (
              <div className="mt-1 text-sm text-muted" data-testid="inbody-replacing">
                Already saved for {replacing} of {scans.length} dates; saving replaces {replacing === 1 ? 'it' : 'them'}.
              </div>
            )}
            <ScanTable scans={scans} />
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted" data-testid="inbody-none">
            No scans found in this file.
          </div>
        )}

        {(parsed.unitsNote || parsed.dateNote) && (
          <div className="mt-3 grid gap-1 text-sm text-muted" data-testid="inbody-notes">
            {parsed.unitsNote && <div>{parsed.unitsNote}</div>}
            {parsed.dateNote && <div>{parsed.dateNote}</div>}
          </div>
        )}

        {skipped.length > 0 && (
          <div className="mt-4" data-testid="inbody-skipped">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Skipped · {skipped.length}</div>
            <ul className="mt-1 grid gap-1 text-sm">
              {skipped.slice(0, 50).map((s, i) => (
                <li key={`${s.row}-${i}`} className="flex gap-2">
                  <span className="num w-14 shrink-0 text-muted">{s.row === 0 ? 'File' : `Row ${s.row}`}</span>
                  <span className="min-w-0 break-words">{s.reason}</span>
                </li>
              ))}
            </ul>
            {skipped.length > 50 && <div className="mt-1 text-sm text-muted">and {skipped.length - 50} more</div>}
          </div>
        )}
      </div>
    </Sheet>
  );
}

function ScanTable({ scans }: { scans: ParsedScan[] }) {
  // Newest first: the scan the owner just took is the one they look for.
  const rows = [...scans].reverse();
  return (
    <div className="mt-3 overflow-hidden rounded-card border border-line">
      <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-x-2 bg-surface-2 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">
        <span>Date</span>
        <span className="text-right">Weight</span>
        <span className="text-right">Muscle</span>
        <span className="text-right">Fat</span>
      </div>
      {rows.slice(0, SHOWN).map((s) => (
        <div key={s.date} data-testid={`inbody-row-${s.date}`}>
          <Divider />
          <div className="grid min-h-11 grid-cols-[1.4fr_1fr_1fr_1fr] items-center gap-x-2 px-3 py-2 text-sm">
            <span className="font-semibold">{dateLabel(s.date)}</span>
            <span className="num text-right tabular-nums">{s.weightKg === undefined ? '—' : `${kg(s.weightKg)} kg`}</span>
            <span className="num text-right tabular-nums">{s.skeletalMuscleKg === undefined ? '—' : `${kg(s.skeletalMuscleKg)} kg`}</span>
            <span className="num text-right tabular-nums">{s.bodyFatPct === undefined ? '—' : `${kg(s.bodyFatPct)} %`}</span>
          </div>
        </div>
      ))}
      {rows.length > SHOWN && <div className="border-t border-line px-3 py-2 text-sm text-muted">and {rows.length - SHOWN} more</div>}
    </div>
  );
}
