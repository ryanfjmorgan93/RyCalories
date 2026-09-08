import { fmtNum } from '@/domain/format';

export interface ChartPoint {
  /** ms epoch */
  t: number;
  y: number;
  label?: string;
}

export interface Band {
  min: number;
  max: number;
}

/**
 * Minimal responsive SVG line chart: one series, optional second (dashed) series and a target band.
 * No axes clutter: y gridlines with values, first/last x labels, dots on points.
 */
export function LineChart({
  points,
  secondary,
  band,
  unit = '',
  height = 160,
  emptyText = 'No data yet',
  tone = 'accent',
}: {
  points: ChartPoint[];
  secondary?: ChartPoint[];
  band?: Band;
  unit?: string;
  height?: number;
  emptyText?: string;
  tone?: 'accent' | 'info' | 'ok';
}) {
  const w = 360;
  const h = height;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 22;
  const all = [...points, ...(secondary ?? [])];
  if (points.length === 0) {
    return <div className="flex items-center justify-center rounded-2xl border border-dashed border-line text-sm text-muted" style={{ height }}>{emptyText}</div>;
  }
  const ts = all.map((p) => p.t);
  const ys = all.map((p) => p.y);
  let tMin = Math.min(...ts);
  let tMax = Math.max(...ts);
  if (tMin === tMax) {
    tMin -= 86400000;
    tMax += 86400000;
  }
  let yMin = Math.min(...ys, band ? band.min : Infinity);
  let yMax = Math.max(...ys, band ? band.max : -Infinity);
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }
  const span = yMax - yMin;
  yMin -= span * 0.12;
  yMax += span * 0.12;
  const ticks = niceTicks(yMin, yMax, 4);
  const x = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * (w - padL - padR);
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * (h - padT - padB);
  const path = (ps: ChartPoint[]) => ps.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
  const stroke = tone === 'info' ? 'var(--c-info)' : tone === 'ok' ? 'var(--c-ok)' : 'var(--c-accent)';
  const first = points[0];
  const last = points[points.length - 1];
  const fmtDate = (t: number) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(t));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="block w-full" style={{ height }} role="img" aria-label="Line chart">
      {band && (
        <rect x={padL} y={y(band.max)} width={w - padL - padR} height={Math.max(0, y(band.min) - y(band.max))} fill="var(--c-ok)" opacity="0.12" />
      )}
      {ticks.map((tv) => (
        <g key={tv}>
          <line x1={padL} x2={w - padR} y1={y(tv)} y2={y(tv)} stroke="var(--c-line)" strokeWidth="1" />
          <text x={padL - 6} y={y(tv) + 4} textAnchor="end" fontSize="10" fill="var(--c-muted)">
            {fmtNum(tv)}
            {unit}
          </text>
        </g>
      ))}
      {secondary && secondary.length > 1 && <path d={path(secondary)} fill="none" stroke="var(--c-muted)" strokeWidth="2" strokeDasharray="4 4" strokeLinejoin="round" />}
      <path d={path(points)} fill="none" stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.t)} cy={y(p.y)} r={points.length > 40 ? 2 : 3.5} fill="var(--c-bg)" stroke={stroke} strokeWidth="2" />
      ))}
      <text x={padL} y={h - 6} fontSize="10" fill="var(--c-muted)">
        {fmtDate(first.t)}
      </text>
      <text x={w - padR} y={h - 6} fontSize="10" fill="var(--c-muted)" textAnchor="end">
        {fmtDate(last.t)}
      </text>
    </svg>
  );
}

function niceTicks(min: number, max: number, count: number): number[] {
  const raw = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}
