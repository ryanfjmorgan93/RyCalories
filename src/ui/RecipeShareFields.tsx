/**
 * The Portions/Weigh-it share controls, shared by every place a share of a recipe is taken: the
 * recipe builder's own Share section, the Recipes list's per-recipe Sheet, and the meal editor's
 * "From a recipe" picker. One shared `ShareState` and one shared field layout, so the maths behind
 * "Your share" (shareFraction/shareNutrition) is never duplicated per screen.
 */
import { useState } from 'react';
import { displayMacros } from '@/domain/food';
import { fmtKcal, fmtNum } from '@/domain/format';
import { shareFraction, shareNutrition, type ShareInput } from '@/domain/recipe';
import type { RecipeIngredient } from '@/domain/types';
import { Segmented } from './components/Chip';
import { NumberField } from './components/NumberField';

export interface ShareState {
  mode: 'portions' | 'weigh';
  made: number | null;
  eaten: number | null;
  dishGrams: number | null;
  plateGrams: number | null;
}

export function defaultShareState(portionsMade: number): ShareState {
  return { mode: 'portions', made: portionsMade > 0 ? portionsMade : 1, eaten: 1, dishGrams: null, plateGrams: null };
}

export function useShareState(portionsMade: number): [ShareState, (patch: Partial<ShareState>) => void] {
  const [state, setState] = useState<ShareState>(() => defaultShareState(portionsMade));
  const patch = (p: Partial<ShareState>) => setState((s) => ({ ...s, ...p }));
  return [state, patch];
}

export function shareInputFrom(s: ShareState): ShareInput {
  return s.mode === 'portions'
    ? { mode: 'portions', made: s.made ?? 0, eaten: s.eaten ?? 0 }
    : { mode: 'weigh', dishGrams: s.dishGrams ?? 0, plateGrams: s.plateGrams ?? 0 };
}

export function RecipeShareFields({
  ingredients,
  state,
  onChange,
}: {
  ingredients: RecipeIngredient[];
  state: ShareState;
  onChange: (patch: Partial<ShareState>) => void;
}) {
  const input = shareInputFrom(state);
  const fraction = shareFraction(input);
  const macros = displayMacros(shareNutrition(ingredients, fraction ?? 0));

  return (
    <div className="grid gap-3">
      <div data-testid="share-mode">
        <Segmented<'portions' | 'weigh'>
          value={state.mode}
          onChange={(mode) => onChange({ mode })}
          options={[
            { value: 'portions', label: 'Portions' },
            { value: 'weigh', label: 'Weigh it' },
          ]}
        />
      </div>

      {state.mode === 'portions' ? (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Made" value={state.made} onChange={(v) => onChange({ made: v })} step={1} min={1} mode="numeric" testId="share-made" />
          <NumberField label="Eating" value={state.eaten} onChange={(v) => onChange({ eaten: v })} step={0.5} min={0} testId="share-eating" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <NumberField label="Whole dish (g)" value={state.dishGrams} onChange={(v) => onChange({ dishGrams: v })} step={10} min={0} mode="numeric" testId="share-dish" />
          <NumberField label="Your plate (g)" value={state.plateGrams} onChange={(v) => onChange({ plateGrams: v })} step={10} min={0} mode="numeric" testId="share-plate" />
        </div>
      )}

      <div className="flex items-baseline justify-between rounded-xl bg-surface-2 px-3 py-3" data-testid="share-kcal">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-muted">Your share</span>
        <span className="num font-extrabold tabular-nums">
          {fmtKcal(macros.kcal)} <span className="text-muted">· {fmtNum(macros.protein)} g protein</span>
        </span>
      </div>
    </div>
  );
}
