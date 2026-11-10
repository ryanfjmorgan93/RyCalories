import { Button } from '@/ui/components/Button';
import { Card } from '@/ui/components/Card';

/**
 * Once every non-skipped slot has reached its target: the facts, and the same Finish path as the
 * header's own button (§7 of the review). Rendered at the end of the card list in the stacked
 * layout, and — so the Fold's right pane is never blank once nothing is left to do — as the
 * fallback there too, whenever no other card is pinned as the focus.
 */
export function AllDoneCard({ doneSets, skippedCount, onFinish }: { doneSets: number; skippedCount: number; onFinish: () => void }) {
  const text = skippedCount > 0 ? `${doneSets} sets done · ${skippedCount} skipped` : `All ${doneSets} sets done`;
  return (
    <Card framed className="flex flex-col gap-4 border-ok/40 p-5" data-testid="all-done">
      <span className="disp text-3xl">{text}</span>
      <Button size="lg" variant="primary" onClick={onFinish} className="self-start" data-testid="all-done-finish">
        Finish workout
      </Button>
    </Card>
  );
}
