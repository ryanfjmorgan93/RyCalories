import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { listScans } from '@/db/bodyScanRepo';
import { dateKeyToDate } from '@/domain/dates';
import { fmtDate, fmtNum } from '@/domain/format';
import { decodeInbodyBytes, parseInbodyCsv, scanDeltas, type ParsedInbody, type ScanChange } from '@/domain/inbody';
import type { BodyScan } from '@/domain/types';
import { useInbodyShare } from '@/state/inbodyShare';
import { BodyScanImportSheet } from '@/ui/BodyScanImportSheet';
import { Button } from '@/ui/components/Button';
import { Card, Divider, Row } from '@/ui/components/Card';
import { LineChart, type ChartPoint } from '@/ui/components/LineChart';
import { toast } from '@/ui/components/Toast';
import { ChevronIcon } from '@/ui/components/TopBar';

export interface BodyCompositionCardProps {
  /**
   * Reads a photo of the printed InBody sheet. Pass it and the card shows a "Photo of the sheet"
   * button; leave it out and there is no such button. Resolve with the scans read, which the import
   * sheet then shows for the owner to confirm before anything is kept, or null when the sheet could
   * not be read (the card says so).
   */
  onPhoto?: (image: File) => Promise<ParsedInbody | null>;
}

const shortDate = (key: string) => fmtDate(dateKeyToDate(key).toISOString());
const longDate = (key: string) => fmtDate(dateKeyToDate(key).toISOString(), { day: 'numeric', month: 'short', year: 'numeric' });

/** "+0.4" / "−0.3" / "0": a change in the row's own unit, which the row label carries. */
export function fmtChange(n: number | null): string {
  if (n === null) return '—';
  if (n === 0) return '0';
  return n > 0 ? `+${fmtNum(n)}` : `−${fmtNum(Math.abs(n))}`;
}

interface MeasureRow {
  key: string;
  label: string;
  /** Shown beside the latest figure; the changes beside it are in the same unit. */
  unit: string;
  value: (s: BodyScan) => number | undefined;
  change: keyof ScanChange;
}

const MEASURES: MeasureRow[] = [
  { key: 'skeletal-muscle', label: 'Skeletal muscle', unit: 'kg', value: (s) => s.skeletalMuscleKg, change: 'skeletalMuscleKg' },
  { key: 'body-fat-kg', label: 'Fat mass', unit: 'kg', value: (s) => s.bodyFatKg, change: 'bodyFatKg' },
  { key: 'body-fat-pct', label: 'Body fat', unit: '%', value: (s) => s.bodyFatPct, change: 'bodyFatPct' },
  { key: 'weight', label: 'Weight', unit: 'kg', value: (s) => s.weightKg, change: 'weightKg' },
];

/**
 * Body composition on Progress: the latest InBody scan with how it moved since the last one and
 * since about eight weeks ago, a chart of skeletal muscle and body fat mass, and the ways in for a
 * scan (a CSV from the InBody app, shared to Iron or picked here; optionally a photo of the sheet).
 */
export function BodyCompositionCard({ onPhoto }: BodyCompositionCardProps) {
  const nav = useNavigate();
  const scans = useLiveQuery(() => listScans(), []);
  const [parsed, setParsed] = useState<ParsedInbody | null>(null);
  const [sheetTitle, setSheetTitle] = useState<string | undefined>(undefined);
  const [reading, setReading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);

  // A file shared to Iron from the InBody app arrives here, parsed (src/platform/shareTarget.ts).
  const shared = useInbodyShare((s) => s.pending);
  const sharedName = useInbodyShare((s) => s.fileName);
  useEffect(() => {
    if (!shared) return;
    setParsed(shared);
    setSheetTitle(sharedName ? `Import ${sharedName}` : undefined);
    useInbodyShare.getState().clear();
  }, [shared, sharedName]);

  const deltas = useMemo(() => (scans ? scanDeltas(scans) : null), [scans]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same file picked again must still fire change
    if (!file) return;
    try {
      const result = parseInbodyCsv(decodeInbodyBytes(new Uint8Array(await file.arrayBuffer())));
      setSheetTitle(undefined);
      setParsed(result);
    } catch {
      toast('Could not read that file', 'danger');
    }
  };

  const onPhotoPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !onPhoto) return;
    setReading(true);
    try {
      const result = await onPhoto(file);
      if (result && result.scans.length > 0) {
        setSheetTitle('Scans read from the photo');
        setParsed(result);
      } else {
        toast('Could not read that sheet', 'danger');
      }
    } catch {
      toast('Could not read that sheet', 'danger');
    } finally {
      setReading(false);
    }
  };

  const hidden = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={(e) => void onFile(e)}
        data-testid="inbody-file"
        aria-label="InBody file"
      />
      {onPhoto && (
        <input ref={photoInput} type="file" accept="image/*" className="hidden" onChange={(e) => void onPhotoPicked(e)} data-testid="inbody-photo-file" aria-label="Photo of the InBody sheet" />
      )}
    </>
  );

  const buttons = (primary: boolean) => (
    <div className="flex flex-wrap gap-2">
      <Button size="md" variant={primary ? 'primary' : 'secondary'} onClick={() => fileInput.current?.click()} data-testid="inbody-import">
        Import InBody file
      </Button>
      {onPhoto && (
        <Button size="md" variant="outline" disabled={reading} onClick={() => photoInput.current?.click()} data-testid="inbody-photo">
          {reading ? 'Reading…' : 'Photo of the sheet'}
        </Button>
      )}
    </div>
  );

  const sheet = (
    <BodyScanImportSheet parsed={parsed} title={sheetTitle} open={parsed !== null} onClose={() => setParsed(null)} />
  );

  if (scans === undefined) return <div className="py-8 text-center text-sm text-muted">Loading…</div>;

  if (scans.length === 0) {
    return (
      <Card className="p-4" data-testid="body-card">
        {hidden}
        <p className="mb-3 text-sm text-muted" data-testid="body-empty">
          No InBody scans yet.
        </p>
        {buttons(true)}
        {sheet}
      </Card>
    );
  }

  const latest = deltas!.latest!;
  const previous = deltas!.vsPrevious;
  const eight = deltas!.vsEightWeeks && deltas!.vsEightWeeks.scan.date !== previous?.scan.date ? deltas!.vsEightWeeks : null;
  const columns = [
    { id: 'latest', heading: 'Latest' },
    ...(previous ? [{ id: 'previous', heading: `Since ${shortDate(previous.scan.date)}` }] : []),
    ...(eight ? [{ id: 'eight', heading: `Since ${shortDate(eight.scan.date)}` }] : []),
  ];
  const gridCols = `minmax(0,1.5fr) ${columns.map(() => 'minmax(0,1fr)').join(' ')}`;
  const rows = MEASURES.filter((m) => m.value(latest) !== undefined);

  const extras: { label: string; value: string }[] = [];
  if (latest.bmrKcal !== undefined) extras.push({ label: 'BMR', value: `${Math.round(latest.bmrKcal).toLocaleString('en-GB')} kcal` });
  if (latest.visceralFatLevel !== undefined) extras.push({ label: 'Visceral fat level', value: fmtNum(latest.visceralFatLevel) });
  if (latest.inbodyScore !== undefined) extras.push({ label: 'InBody score', value: fmtNum(latest.inbodyScore) });
  if (latest.ecwRatio !== undefined) extras.push({ label: 'ECW/TBW', value: latest.ecwRatio.toFixed(3) });
  if (latest.phaseAngle !== undefined) extras.push({ label: 'Phase angle', value: `${fmtNum(latest.phaseAngle)}°` });

  const point = (s: BodyScan, y: number | undefined): ChartPoint[] => (y === undefined ? [] : [{ t: dateKeyToDate(s.date).getTime(), y }]);
  const muscle = scans.flatMap((s) => point(s, s.skeletalMuscleKg));
  const fat = scans.flatMap((s) => point(s, s.bodyFatKg));
  return (
    <Card data-testid="body-card">
      {hidden}
      <div className="p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Latest scan</span>
          <span className="num text-sm font-semibold" data-testid="body-latest-date">
            {longDate(latest.date)}
          </span>
        </div>

        <div className="mt-3 grid items-baseline gap-x-2 gap-y-2" style={{ gridTemplateColumns: gridCols }} data-testid="body-figures">
          <span />
          {columns.map((c) => (
            <span key={c.id} className="text-right text-xs font-semibold text-muted" data-testid={`body-heading-${c.id}`}>
              {c.heading}
            </span>
          ))}
          {rows.map((m) => (
            <MeasureLine key={m.key} m={m} latest={latest} previous={previous?.change} eight={eight?.change} showPrevious={!!previous} showEight={!!eight} />
          ))}
        </div>

        {extras.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-sm" data-testid="body-extras">
            {extras.map((x) => (
              <span key={x.label}>
                <span className="text-muted">{x.label} </span>
                <span className="num font-semibold tabular-nums">{x.value}</span>
              </span>
            ))}
          </div>
        )}

        {muscle.length >= 2 && <TrendChart title="Skeletal muscle" testId="body-chart-skeletal-muscle" points={muscle} tone="accent" />}
        {fat.length >= 2 && <TrendChart title="Fat mass" testId="body-chart-fat-mass" points={fat} tone="info" />}

        <div className="mt-4">{buttons(false)}</div>
      </div>
      <Divider />
      <Row onClick={() => nav('/body')} title="Bodyweight log" subtitle="Add a reading, see every week" right={<ChevronIcon />} testId="body-weight-link" />
      {sheet}
    </Card>
  );
}

function MeasureLine({
  m,
  latest,
  previous,
  eight,
  showPrevious,
  showEight,
}: {
  m: MeasureRow;
  latest: BodyScan;
  previous?: ScanChange;
  eight?: ScanChange;
  showPrevious: boolean;
  showEight: boolean;
}) {
  return (
    <>
      <span className="text-sm text-muted" data-testid={`body-row-${m.key}`}>
        {m.label}
      </span>
      <span className="num text-right text-xl font-extrabold tabular-nums" data-testid={`body-latest-${m.key}`}>
        {fmtNum(m.value(latest)!)}{' '}
        <span className="text-xs font-bold text-muted">{m.unit}</span>
      </span>
      {showPrevious && (
        <span className="num text-right text-base font-semibold tabular-nums" data-testid={`body-previous-${m.key}`}>
          {fmtChange(previous ? previous[m.change] : null)}
        </span>
      )}
      {showEight && (
        <span className="num text-right text-base font-semibold tabular-nums" data-testid={`body-eight-${m.key}`}>
          {fmtChange(eight ? eight[m.change] : null)}
        </span>
      )}
    </>
  );
}

/** One measure over time. Two small charts rather than one with two lines: muscle and fat mass sit tens of kilograms apart, and on a shared axis a kilogram of change vanishes. */
function TrendChart({ title, testId, points, tone }: { title: string; testId: string; points: ChartPoint[]; tone: 'accent' | 'info' }) {
  return (
    <div className="mt-4" data-testid={testId}>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{title} (kg)</div>
      <LineChart points={points} unit="kg" height={130} tone={tone} />
    </div>
  );
}
