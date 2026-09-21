import { fmtKg, fmtNum } from '@/domain/format';
import { buildPlateDiagram } from '@/domain/plateDiagram';
import { plateLabel, platesPerSide, type PlateOptions } from '@/domain/plates';
import { Sheet } from './components/Sheet';

/**
 * What to load on the bar for a target weight: the target big, a drawn side-view of the loaded
 * bar (bar, sleeve, plates to scale, clip), the bar weight, and the shortfall when the plates on
 * hand can't make the target exactly.
 */
export function PlateSheet({ open, onClose, weight, plates }: { open: boolean; onClose: () => void; weight: number; plates: PlateOptions }) {
  const load = platesPerSide(weight, plates);
  const diagram = load ? buildPlateDiagram(load.perSide) : null;
  return (
    <Sheet open={open} onClose={onClose} title="Plates">
      <div className="text-center">
        <div className="num text-4xl font-extrabold">{fmtKg(weight)}</div>
      </div>
      {load && diagram ? (
        <>
          <div className="mt-5 flex justify-center">
            <svg
              viewBox={`0 0 ${diagram.width} ${diagram.height}`}
              className="w-full max-w-xs"
              role="img"
              aria-label={plateLabel(load)}
              data-testid="plate-diagram"
            >
              <rect
                x={diagram.shaft.x}
                y={diagram.shaft.y}
                width={diagram.shaft.width}
                height={diagram.shaft.height}
                rx={diagram.shaft.height / 2}
                className="fill-dim"
              />
              <rect
                x={diagram.sleeve.x}
                y={diagram.sleeve.y}
                width={diagram.sleeve.width}
                height={diagram.sleeve.height}
                rx={4}
                className="fill-muted stroke-line"
                strokeWidth={1}
              />
              {diagram.plates.map((p, i) => (
                <g key={i} data-testid="plate-block">
                  <rect x={p.x} y={p.y} width={p.width} height={p.height} rx={3} fill={p.color} className="stroke-dim" strokeWidth={1.5} />
                  <text x={p.x + p.width / 2} y={diagram.labelY} textAnchor="middle" fontSize={15} fontWeight={700} className="fill-fg num">
                    {fmtNum(p.kg)}
                  </text>
                </g>
              ))}
              <rect
                x={diagram.clip.x}
                y={diagram.clip.y}
                width={diagram.clip.width}
                height={diagram.clip.height}
                rx={3}
                className="fill-dim stroke-line"
                strokeWidth={1}
              />
            </svg>
          </div>
          {load.perSide.length === 0 && <div className="mt-1 text-center text-sm text-muted">bar only</div>}
          <div className="mt-4 text-center text-sm text-muted">per side · bar {fmtKg(plates.barKg)}</div>
          {load.remainder > 0 && <div className="mt-1 text-center text-sm font-semibold text-warn">{fmtNum(load.remainder)} kg short</div>}
        </>
      ) : (
        <div className="mt-5 text-center text-muted">Below the bar ({fmtKg(plates.barKg)})</div>
      )}
    </Sheet>
  );
}
