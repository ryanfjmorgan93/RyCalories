import { addSupplement } from '@/db/supplementRepo';
import { getSettings, saveSettings } from '@/db/repo';
import { toDateKey } from '@/domain/dates';
import { fmtNum } from '@/domain/format';
import { SUPPLEMENT_TIME_LABEL, supplementLabel } from '@/domain/supplements';
import { calorieChange, proteinChange } from '@/domain/targetChange';
import { useClaudeCoach } from '@/state/claudeCoach';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { toast } from './components/Toast';

/**
 * What the coach offered this turn: new daily targets and supplements for the checklist. Each is a
 * button; nothing changes until the owner taps it (docs/adr/0004). Targets go through the same
 * change the weekly review's "Use" buttons make, against the settings as they are at the tap.
 */
export function CoachOfferCard() {
  const offer = useClaudeCoach((s) => s.offer);
  const take = useClaudeCoach((s) => s.takeFromOffer);
  const dismiss = useClaudeCoach((s) => s.dismissOffer);
  if (!offer) return null;
  const { targets, supplements } = offer;

  const applyTarget = async (what: 'calories' | 'protein') => {
    const wanted = targets?.[what];
    if (wanted === undefined) return;
    const settings = await getSettings();
    const change = what === 'calories' ? calorieChange(settings, wanted, toDateKey()) : proteinChange(settings, wanted);
    if (change) {
      await saveSettings(change.patch);
      toast(what === 'calories' ? 'Calorie target updated' : 'Protein target updated', 'ok');
    }
    take(what);
  };

  return (
    <Card className="p-4" data-testid="coach-offer">
      <div className="label mb-3">Offered · nothing changes until you tap</div>
      <div className="flex flex-wrap gap-2">
        {targets?.calories !== undefined && (
          <Button size="sm" variant="primary" onClick={() => void applyTarget('calories')} data-testid="coach-offer-calories">
            Use {fmtNum(targets.calories)} kcal
          </Button>
        )}
        {targets?.protein !== undefined && (
          <Button size="sm" variant="primary" onClick={() => void applyTarget('protein')} data-testid="coach-offer-protein">
            Use {fmtNum(targets.protein)} g protein
          </Button>
        )}
      </div>
      {supplements?.map((s) => (
        <div key={s.name} className="mt-3 flex items-center gap-3 border-t border-line pt-3 first:mt-0 first:border-0 first:pt-0" data-testid="coach-offer-supplement">
          <div className="min-w-0 flex-1">
            <div className="font-medium">{supplementLabel(s)}</div>
            <div className="text-sm text-muted">
              {SUPPLEMENT_TIME_LABEL[s.time]} · {s.why}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            data-testid={`coach-offer-add-${s.name}`}
            onClick={async () => {
              const r = await addSupplement({ name: s.name, dose: s.dose, time: s.time, source: 'coach' });
              if (r.ok) toast(r.existed ? `${r.supplement.name} is already on your list` : `${r.supplement.name} added to your list`, 'ok');
              take({ supplement: s.name });
            }}
          >
            Add
          </Button>
        </div>
      ))}
      <div className="mt-3">
        <Button size="sm" variant="ghost" onClick={dismiss} data-testid="coach-offer-dismiss">
          Dismiss
        </Button>
      </div>
    </Card>
  );
}
