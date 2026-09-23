import { completionOf } from '@/domain/setTable';
import type { SetLog } from '@/domain/types';
import type { Slot, SlotGroup } from './types';

/**
 * The Fold's left pane (≥840px, `src/index.css` `.fold-list`): every exercise as one compact row —
 * name, progress, state — tap to focus it in the right-hand pane. Pure CSS hides this pane below
 * 840px, so it costs nothing there beyond being in the DOM (see the media query for why that's
 * the deliberate trade — no JS breakpoint detection, so the layout just reflows on a real fold).
 */
export function FoldList({
  groups,
  setsBySlot,
  skipped,
  currentKey,
  focusedGroupKey,
  onFocus,
}: {
  groups: SlotGroup[];
  setsBySlot: Map<string, SetLog[]>;
  skipped: Set<string>;
  currentKey: string | null;
  focusedGroupKey: string | null;
  onFocus: (groupKey: string) => void;
}) {
  return (
    <nav aria-label="Exercises" data-testid="fold-list" className="fold-list flex-col gap-1.5 pt-3">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col gap-1">
          {group.slots.map((slot) => (
            <FoldRow
              key={slot.key}
              slot={slot}
              sets={setsBySlot.get(slot.key) ?? []}
              isSkipped={slot.rx ? skipped.has(slot.rx.id) : false}
              isCurrent={slot.key === currentKey}
              isFocused={group.key === focusedGroupKey}
              onClick={() => onFocus(group.key)}
            />
          ))}
        </div>
      ))}
    </nav>
  );
}

function FoldRow({
  slot,
  sets,
  isSkipped,
  isCurrent,
  isFocused,
  onClick,
}: {
  slot: Slot;
  sets: SetLog[];
  isSkipped: boolean;
  isCurrent: boolean;
  isFocused: boolean;
  onClick: () => void;
}) {
  const target = slot.rx?.targetSets ?? 3;
  const { countedDone, complete } = completionOf(sets, target);
  const state = isSkipped ? 'skipped' : complete ? 'done' : isCurrent ? 'current' : 'pending';
  const dot = state === 'done' ? 'bg-ok' : state === 'current' ? 'bg-accent' : state === 'skipped' ? 'bg-warn' : 'bg-line';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={isFocused ? 'true' : undefined}
      className={`flex min-h-11 items-center gap-2.5 rounded-control border px-3 py-2 text-left ${
        isFocused ? 'border-accent bg-glass-2' : 'border-transparent'
      }`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{slot.exercise.name}</span>
      <span className="num shrink-0 text-xs font-bold text-dim">
        {isSkipped ? 'skip' : `${countedDone} of ${target}`}
      </span>
    </button>
  );
}
