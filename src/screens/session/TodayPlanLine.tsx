import { Button } from '@/ui/components/Button';

/**
 * The small line a card shows while its plan is changed for today: what today's plan is, with
 * "Keep in routine" (writes it to the saved routine) and "Undo" (back to the routine's plan).
 * `text` comes from `describeOverride`.
 */
export function TodayPlanLine({
  text,
  onKeep,
  onUndo,
  className = '',
}: {
  text: string;
  onKeep: () => void;
  onUndo: () => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-x-1 gap-y-0 ${className}`} data-testid="today-plan-line">
      <span className="num mr-1 text-sm font-bold text-accent" data-testid="today-plan-text">
        {text}
      </span>
      <Button size="sm" variant="ghost" className="px-2" onClick={onKeep} data-testid="today-keep">
        Keep in routine
      </Button>
      <Button size="sm" variant="ghost" className="px-2" onClick={onUndo} data-testid="today-undo">
        Undo
      </Button>
    </div>
  );
}
