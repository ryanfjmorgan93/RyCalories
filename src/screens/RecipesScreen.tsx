import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { deleteRecipe, logShare } from '@/db/recipeRepo';
import { toDateKey } from '@/domain/dates';
import { plural } from '@/domain/format';
import { normalise } from '@/domain/foodMemory';
import { shareFraction } from '@/domain/recipe';
import type { Recipe } from '@/domain/types';
import { useRecipes } from '@/ui/hooks';
import { Button, IconButton } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row } from '@/ui/components/Card';
import { TextInput } from '@/ui/components/NumberField';
import { Confirm, Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { MoreIcon, TopBar } from '@/ui/components/TopBar';
import { RecipeShareFields, shareInputFrom, useShareState } from '@/ui/RecipeShareFields';

export function RecipesScreen() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const recipes = useRecipes();
  const [query, setQuery] = useState('');
  const [menuFor, setMenuFor] = useState<Recipe | null>(null);
  const [deleteFor, setDeleteFor] = useState<Recipe | null>(null);
  const [logFor, setLogFor] = useState<Recipe | null>(null);

  const search = params.toString();
  const newRecipeHref = `/food/recipes/new${search ? `?${search}` : ''}`;
  const q = normalise(query);
  const filtered = (recipes ?? []).filter((r) => !q || normalise(r.name).includes(q));

  return (
    <div>
      <TopBar title="Recipes" back="/food" />

      <div className="px-4">
        {recipes && recipes.length > 0 && (
          <>
            <TextInput value={query} onChange={setQuery} placeholder="Search recipes" testId="recipe-search" />
            <div className="h-3" />
          </>
        )}

        {recipes === undefined && <div className="py-10 text-center text-sm text-muted">Loading…</div>}
        {recipes && recipes.length === 0 && <EmptyState>No recipes yet.</EmptyState>}
        {recipes && recipes.length > 0 && filtered.length === 0 && <EmptyState>No recipes match.</EmptyState>}

        {filtered.length > 0 && (
          <Card>
            {filtered.map((r, i) => (
              <div key={r.id} data-testid={`recipe-row-${r.name}`}>
                {i > 0 && <Divider />}
                <Row
                  onClick={() => setLogFor(r)}
                  title={r.name}
                  subtitle={`${plural(r.ingredients.length, 'ingredient')} · makes ${plural(r.portionsMade, 'portion')}`}
                  right={
                    <IconButton label={`More for ${r.name}`} onClick={() => setMenuFor(r)} data-testid={`recipe-more-${r.name}`}>
                      <MoreIcon />
                    </IconButton>
                  }
                />
              </div>
            ))}
          </Card>
        )}

        <div className="h-4" />
        <Button size="lg" variant="primary" full onClick={() => nav(newRecipeHref)} data-testid="recipe-new">
          New recipe
        </Button>
        <div className="h-8" />
      </div>

      <LogSheet
        recipe={logFor}
        open={logFor !== null}
        onClose={() => setLogFor(null)}
        onLogged={(mealId) => nav(`/food/${mealId}`)}
      />

      <Sheet open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.name}>
        <div className="grid gap-3">
          <Button
            size="lg"
            full
            data-testid="recipe-edit"
            onClick={() => {
              const r = menuFor;
              setMenuFor(null);
              if (r) nav(`/food/recipes/${r.id}/edit${search ? `?${search}` : ''}`);
            }}
          >
            Edit
          </Button>
          <Button
            size="lg"
            full
            variant="danger"
            onClick={() => {
              setDeleteFor(menuFor);
              setMenuFor(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Sheet>

      <Confirm
        open={deleteFor !== null}
        title={`Delete ${deleteFor?.name ?? 'recipe'}?`}
        confirmLabel="Delete"
        danger
        onCancel={() => setDeleteFor(null)}
        onConfirm={async () => {
          if (!deleteFor) return;
          await deleteRecipe(deleteFor.id);
          setDeleteFor(null);
          toast('Recipe deleted');
        }}
      />
    </div>
  );
}

/** Share controls for one recipe, opened from tapping its row. "Log" writes straight through
 * `logShare`, into the meal or day named by the screen's own query params (or today, absent
 * either). */
function LogSheet({
  recipe,
  open,
  onClose,
  onLogged,
}: {
  recipe: Recipe | null;
  open: boolean;
  onClose: () => void;
  onLogged: (mealId: string) => void;
}) {
  const [params] = useSearchParams();
  return recipe ? <LogSheetBody key={recipe.id} recipe={recipe} open={open} onClose={onClose} onLogged={onLogged} mealParam={params.get('meal')} dateParam={params.get('date')} /> : null;
}

function LogSheetBody({
  recipe,
  open,
  onClose,
  onLogged,
  mealParam,
  dateParam,
}: {
  recipe: Recipe;
  open: boolean;
  onClose: () => void;
  onLogged: (mealId: string) => void;
  mealParam: string | null;
  dateParam: string | null;
}) {
  const [state, patch] = useShareState(recipe.portionsMade);
  const [logging, setLogging] = useState(false);
  const input = shareInputFrom(state);
  const fraction = shareFraction(input);

  const log = async () => {
    if (logging || fraction === null || fraction <= 0) return;
    setLogging(true);
    try {
      const into = mealParam ? { mealId: mealParam } : { newMeal: { date: dateParam ?? toDateKey() } };
      const mealId = await logShare({ recipe, share: input, into });
      onClose();
      onLogged(mealId);
    } catch {
      setLogging(false);
      toast('Could not log that recipe', 'danger');
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={recipe.name}
      footer={
        <Button size="lg" variant="primary" full disabled={fraction === null || fraction <= 0 || logging} onClick={() => void log()} data-testid="recipe-log">
          Log
        </Button>
      }
    >
      <RecipeShareFields ingredients={recipe.ingredients} state={state} onChange={patch} />
    </Sheet>
  );
}
