import { fmtKg, fmtNum } from '@/domain/format';
import { platesPerSide, type PlateOptions } from '@/domain/plates';
import { Chip } from './components/Chip';
import { Sheet } from './components/Sheet';

/**
 * What to load on the bar for a target weight: the target big, the per-side plates as chips,
 * the bar weight, and the shortfall when the plates on hand can't make the target exactly.
 */
export function PlateSheet({ open, onClose, weight, plates }: { open: boolean; onClose: () => void; weight: number; plates: PlateOptions }) {
  const load = platesPerSide(weight, plates);
  return (
    <Sheet open={open} onClose={onClose} title="Plates">
      <div className="text-center">
        <div className="num text-4xl font-extrabold">{fmtKg(weight)}</div>
      </div>
      {load ? (
        <>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {load.perSide.length === 0
              ? <Chip size="lg">bar only</Chip>
              : load.perSide.map((p, i) => (
                  <Chip key={i} size="lg">
                    {fmtNum(p)}
                  </Chip>
                ))}
          </div>
          <div className="mt-4 text-center text-sm text-muted">per side · bar {fmtKg(plates.barKg)}</div>
          {load.remainder > 0 && <div className="mt-1 text-center text-sm font-semibold text-warn">{fmtNum(load.remainder)} kg short</div>}
        </>
      ) : (
        <div className="mt-5 text-center text-muted">Below the bar ({fmtKg(plates.barKg)})</div>
      )}
    </Sheet>
  );
}
