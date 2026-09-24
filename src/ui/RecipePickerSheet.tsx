/**
 * Pick a saved recipe and log a share of it into a meal. Used from `MealEditScreen`: an unsaved
 * `NewMeal` appends the share to its own local item list (no write); a saved `ExistingMeal` writes
 * it straight through `logShare`. Either way this component only produces the share — the caller
 * decides how it lands, via `onAdd`.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { plural } from '@/domain/format';
import { normalise } from '@/domain/foodMemory';
import { shareFraction } from '@/domain/recipe';
import type { Recipe } from '@/domain/types';
import type { ShareInput } from '@/domain/recipe';
import { useRecipes } from './hooks';
import { Button } from './components/Button';
import { Card, Divider, EmptyState, Row } from './components/Card';
import { TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';
import { RecipeShareFields, shareInputFrom, useShareState } from './RecipeShareFields';

export function RecipePickerSheet({
  open,
  onClose,
  onAdd,
  newRecipeHref,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the picked recipe and the chosen share; the caller decides how it lands. */
  onAdd: (recipe: Recipe, share: ShareInput) => void;
  /** Shown as "New recipe" when present. Omitted when starting a new recipe would lose something
   * (an unsaved meal that already has items — see the doc comment on this file). */
  newRecipeHref?: string;
}) {
  const recipes = useRecipes();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Recipe | null>(null);
  const nav = useNavigate();

  const close = () => {
    onClose();
    setQuery('');
    setSelected(null);
  };

  if (selected) {
    return <ShareStep recipe={selected} onBack={() => setSelected(null)} onClose={close} onAdd={onAdd} />;
  }

  const q = normalise(query);
  const filtered = (recipes ?? []).filter((r) => !q || normalise(r.name).includes(q));

  return (
    <Sheet open={open} onClose={close} title="From a recipe">
      <div className="grid gap-3">
        <TextInput value={query} onChange={setQuery} placeholder="Search recipes" testId="recipe-picker-search" />

        {recipes === undefined && <div className="py-6 text-center text-sm text-muted">Loading…</div>}
        {recipes && recipes.length === 0 && <EmptyState>No recipes yet.</EmptyState>}
        {recipes && recipes.length > 0 && filtered.length === 0 && <EmptyState>No recipes match.</EmptyState>}
        {filtered.length > 0 && (
          <Card>
            {filtered.map((r, i) => (
              <div key={r.id} data-testid={`recipe-picker-row-${r.name}`}>
                {i > 0 && <Divider />}
                <Row
                  onClick={() => setSelected(r)}
                  title={r.name}
                  subtitle={`${plural(r.ingredients.length, 'ingredient')} · makes ${plural(r.portionsMade, 'portion')}`}
                />
              </div>
            ))}
          </Card>
        )}

        {newRecipeHref && (
          <Button size="lg" variant="secondary" full onClick={() => nav(newRecipeHref)} data-testid="recipe-picker-new">
            New recipe
          </Button>
        )}
      </div>
    </Sheet>
  );
}

function ShareStep({
  recipe,
  onBack,
  onClose,
  onAdd,
}: {
  recipe: Recipe;
  onBack: () => void;
  onClose: () => void;
  onAdd: (recipe: Recipe, share: ShareInput) => void;
}) {
  const [state, patch] = useShareState(recipe.portionsMade);
  const input = shareInputFrom(state);
  const fraction = shareFraction(input);

  return (
    <Sheet
      open
      onClose={onClose}
      title={recipe.name}
      footer={
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" variant="secondary" onClick={onBack}>
            Back
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={fraction === null || fraction <= 0}
            data-testid="recipe-picker-add"
            onClick={() => onAdd(recipe, input)}
          >
            Add
          </Button>
        </div>
      }
    >
      <RecipeShareFields ingredients={recipe.ingredients} state={state} onChange={patch} />
    </Sheet>
  );
}
