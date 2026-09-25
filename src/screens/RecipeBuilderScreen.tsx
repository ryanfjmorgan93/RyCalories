import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { loadUkFoodTable, type UkFoodTable } from '@/data/ukFoodTable';
import { logShare, saveRecipe } from '@/db/recipeRepo';
import { db } from '@/db/db';
import { lookupBarcode } from '@/db/productRepo';
import { useLiveQuery } from 'dexie-react-hooks';
import { nowIso, toDateKey } from '@/domain/dates';
import { displayMacros, fromPer100, type Macros } from '@/domain/food';
import { fmtGrams, fmtKcal, fmtNum } from '@/domain/format';
import { uuid } from '@/domain/ids';
import { matchIngredient, mergeByFood, searchFoods, type IngredientCandidate, type MatchSources, type TableFood } from '@/domain/ingredientMatch';
import { MEAL_ESTIMATE_SYSTEM, MEAL_PHOTO_PROMPT, MEAL_PHOTO_SYSTEM, mealEstimatePrompt, parseMealAnalysis, parseMealEstimate, type MealEstimatePart } from '@/domain/mealAnalysis';
import { parseMealText } from '@/domain/mealText';
import { countToGrams, gapsCount, ingredientGap, recipeDisplayTotals, recipeIsComplete, shareFraction, toEstimatedIngredient, toIngredient } from '@/domain/recipe';
import type { Recipe, RecipeIngredient } from '@/domain/types';
import { describeAnalyzeMealError, Nano } from '@/state/nano';
import { useAssistant } from '@/state/assistant';
import { deleteMealPhoto, preparePhoto, sweepMealPhotos } from '@/state/mealPhoto';
import { useRecipe, useSettings } from '@/ui/hooks';
import { BarcodeScanner } from '@/ui/BarcodeScanner';
import { Button } from '@/ui/components/Button';
import { Card, Divider, EmptyState, Row } from '@/ui/components/Card';
import { MacroLine } from '@/ui/components/MacroBar';
import { NumberField, NumberInput, TextInput } from '@/ui/components/NumberField';
import { Sheet } from '@/ui/components/Sheet';
import { toast } from '@/ui/components/Toast';
import { TopBar } from '@/ui/components/TopBar';
import { RecipeShareFields, shareInputFrom, useShareState } from '@/ui/RecipeShareFields';

type Phase = 'start' | 'recognising' | 'estimating' | 'questions' | 'review';

interface TypedAmount {
  count?: number;
  grams?: number;
}

/** Merge a patch into an ingredient. A key set to `undefined` REMOVES it (used by a scan or a
 * "Change food" to clear a brand/product the previous match left behind), rather than leaving a
 * stale key sitting under an `undefined` value. */
function mergeIngredient(ing: RecipeIngredient, patch: Partial<RecipeIngredient>): RecipeIngredient {
  const next: Record<string, unknown> = { ...ing };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  return next as unknown as RecipeIngredient;
}

function applyTypedAmount(ing: RecipeIngredient, amt: TypedAmount | undefined): RecipeIngredient {
  if (!amt) return ing;
  if (amt.count !== undefined && ing.unit) {
    return { ...ing, unit: { ...ing.unit, count: amt.count }, grams: countToGrams(amt.count, ing.unit.unitGrams) };
  }
  if (amt.grams !== undefined) return { ...ing, grams: amt.grams };
  return ing;
}

/** Turn a list of plain names into ingredients: match each, merge duplicates that resolved to the
 * same food (see `mergeByFood`), and apply any typed amount to the group's first name. */
function buildIngredients(names: string[], sources: MatchSources, amounts?: Map<string, TypedAmount>): RecipeIngredient[] {
  const matches = names.map((n) => ({ name: n, candidate: matchIngredient(n, sources).best }));
  const { merged, unmatched } = mergeByFood(matches);
  const fromGroup = merged.map((g) => applyTypedAmount(toIngredient(g.candidate, g.names[0]!, uuid()), amounts?.get(g.names[0]!)));
  const fromUnmatched = unmatched.map((n) => applyTypedAmount(toIngredient(null, n, uuid()), amounts?.get(n)));
  return [...fromGroup, ...fromUnmatched];
}

/**
 * Turn "Estimate a meal out"'s parsed `{name, grams?}` parts into ingredients: match each,
 * merge duplicates that resolved to the same food (see `mergeByFood`, same as `buildIngredients`),
 * and build every one with `toEstimatedIngredient` so its guessed weight arrives already filled
 * in and marked — estimates go straight to Review, with no one-at-a-time walk.
 */
function buildEstimatedIngredients(parts: MealEstimatePart[], sources: MatchSources): RecipeIngredient[] {
  const gramsByName = new Map(parts.map((p) => [p.name, p.grams]));
  const matches = parts.map((p) => ({ name: p.name, candidate: matchIngredient(p.name, sources).best }));
  const { merged, unmatched } = mergeByFood(matches);
  const fromGroup = merged.map((g) => toEstimatedIngredient(g.candidate, { name: g.names[0]!, grams: gramsByName.get(g.names[0]!) }, uuid()));
  const fromUnmatched = unmatched.map((n) => toEstimatedIngredient(null, { name: n, grams: gramsByName.get(n) }, uuid()));
  return [...fromGroup, ...fromUnmatched];
}

/** Replace an ingredient's food, keeping its current weight — "keep its amount when replacing".
 * `grams` stays the ground truth; a count-style unit's `count` is derived back from it so the two
 * never disagree (see `RecipeIngredient.unit`'s doc comment: `count * unitGrams` reproduces `grams`). */
function replaceKeepingAmount(old: RecipeIngredient, candidate: IngredientCandidate | null, name: string): RecipeIngredient {
  const base = toIngredient(candidate, name, old.id);
  const grams = old.grams;
  const unit = base.unit ? { ...base.unit, count: base.unit.unitGrams > 0 ? Math.round((grams / base.unit.unitGrams) * 100) / 100 : 0 } : undefined;
  return { ...base, grams, ...(unit ? { unit } : {}) };
}

function amountLabel(ing: RecipeIngredient): string {
  if (!(ing.grams > 0)) return '—';
  if (ing.unit && ing.unit.count > 0) {
    const word = ing.unit.count === 1 ? ing.unit.label : ing.unit.plural;
    return `${fmtNum(ing.unit.count)} ${word} · ${fmtGrams(ing.grams)}`;
  }
  return fmtGrams(ing.grams);
}

/** "UK table · Eggs, chicken, whole, raw" / "Your food" / "Label · Tesco Back Bacon" / "Not found". */
function sourceLine(ing: RecipeIngredient, tableFoods: TableFood[]): string {
  if (ingredientGap(ing) === 'figures') return 'Not found';
  if (ing.source === 'table') {
    const code = ing.foodKey?.startsWith('table:') ? ing.foodKey.slice('table:'.length) : undefined;
    const row = code ? tableFoods.find((f) => f.code === code) : undefined;
    return row ? `UK table · ${row.name}` : 'UK table';
  }
  if (ing.source === 'label') {
    const label = [ing.brand, ing.product].filter(Boolean).join(' ');
    return label ? `Label · ${label}` : 'Label';
  }
  return 'Your food';
}

function sourceTag(c: IngredientCandidate): string {
  if (c.source === 'table') return 'UK table';
  if (c.source === 'label') return [c.brand, c.product].filter(Boolean).join(' ') || 'Label';
  return 'Your food';
}

function finiteOrNull(n: number): number | null {
  return Number.isFinite(n) ? n : null;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</div>
      {children}
    </div>
  );
}

/**
 * One ingredient's question: figures first (nothing to weigh until the figures are known — see
 * `ingredientGap`'s doc comment), then the amount. Used both inline, walking the list one at a
 * time straight after recognition or "Use this", and inside a Sheet when a Review row is tapped.
 */
function QuestionCardBody({
  ingredient,
  position,
  total,
  tableFoods,
  onChange,
  onNext,
  onRemove,
  onPick,
  doneLabel,
}: {
  ingredient: RecipeIngredient;
  position: number;
  total: number;
  tableFoods: TableFood[];
  onChange: (patch: Partial<RecipeIngredient>) => void;
  onNext: () => void;
  onRemove: () => void;
  onPick: () => void;
  doneLabel: string;
}) {
  const [scannerOpen, setScannerOpen] = useState(false);
  const [editingUnitGrams, setEditingUnitGrams] = useState(false);
  const [typingFigures, setTypingFigures] = useState(false);
  const ticketRef = useRef(0);
  // "Off means off: no request is made at all, not merely hidden" — the same rule FoodItemSheet
  // applies to its own Scan barcode / Look up the label buttons.
  const lookupEnabled = useSettings()?.productLookup !== false;

  const gap = ingredientGap(ingredient);

  const onScanCode = async (code: string) => {
    setScannerOpen(false);
    if (!lookupEnabled) return;
    const ticket = (ticketRef.current += 1);
    const result = await lookupBarcode(code);
    if (ticket !== ticketRef.current) return;
    if (result.label) {
      onChange({
        per100: result.label.per100,
        source: 'label',
        brand: result.label.brand || undefined,
        product: result.label.name || undefined,
      });
    }
  };

  return (
    <div>
      <div className="mb-3">
        <div className="text-lg font-bold" data-testid="question-name">
          {ingredient.name}
        </div>
        <div className="text-xs text-muted">
          {position} of {total}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="text-sm text-muted" data-testid="question-source">
          {sourceLine(ingredient, tableFoods)}
        </div>

        {gap === 'figures' ? (
          <>
            <div className={lookupEnabled ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-3 gap-2'}>
              <Button size="md" variant="outline" onClick={onPick} data-testid="question-pick">
                Pick a food
              </Button>
              {lookupEnabled && (
                <Button size="md" variant="outline" onClick={() => setScannerOpen(true)} data-testid="question-scan">
                  Scan pack
                </Button>
              )}
              <Button size="md" variant={typingFigures ? 'secondary' : 'outline'} onClick={() => setTypingFigures((v) => !v)} data-testid="question-type-figures">
                Type figures
              </Button>
              <Button size="md" variant="outline" onClick={onRemove} data-testid="question-remove">
                Not in it
              </Button>
            </div>
            {typingFigures && (
              <div className="grid grid-cols-2 gap-3">
                {(['kcal', 'protein', 'carbs', 'fat'] as const).map((k) => (
                  <Field key={k} label={k === 'kcal' ? 'Calories per 100 g' : `${k[0]!.toUpperCase()}${k.slice(1)} per 100 g`}>
                    <NumberInput
                      value={finiteOrNull(ingredient.per100[k])}
                      onChange={(v) => onChange({ per100: { ...ingredient.per100, [k]: v ?? NaN }, source: 'user' })}
                      min={0}
                      placeholder="0"
                      testId={`question-figure-${k}`}
                    />
                  </Field>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {ingredient.unit ? (
              <>
                <Field label="How many?">
                  <NumberField
                    value={ingredient.unit.count > 0 ? ingredient.unit.count : null}
                    onChange={(v) => {
                      const count = v ?? 0;
                      // Editing the amount — count or grams-per-unit, below — clears amountEstimated:
                      // once the user has touched it, it is no longer an unconfirmed guess.
                      onChange({ unit: { ...ingredient.unit!, count }, grams: countToGrams(count, ingredient.unit!.unitGrams), amountEstimated: undefined });
                    }}
                    step={1}
                    min={0}
                    mode="numeric"
                    testId="question-count"
                  />
                </Field>
                {editingUnitGrams ? (
                  <Field label={`Grams per ${ingredient.unit.label}`}>
                    <NumberInput
                      value={ingredient.unit.unitGrams}
                      onChange={(v) => {
                        const unitGrams = v ?? ingredient.unit!.unitGrams;
                        onChange({ unit: { ...ingredient.unit!, unitGrams }, grams: countToGrams(ingredient.unit!.count, unitGrams), amountEstimated: undefined });
                      }}
                      onBlur={() => setEditingUnitGrams(false)}
                      min={1}
                      testId="question-unit-grams"
                    />
                  </Field>
                ) : (
                  <button type="button" onClick={() => setEditingUnitGrams(true)} className="px-1 text-left text-sm text-muted" data-testid="question-unit">
                    ≈{fmtGrams(ingredient.unit.unitGrams)} each
                  </button>
                )}
              </>
            ) : (
              <Field label="How many grams?">
                <NumberField
                  value={ingredient.grams > 0 ? ingredient.grams : null}
                  onChange={(v) => onChange({ grams: v ?? 0, amountEstimated: undefined })}
                  step={10}
                  min={0}
                  mode="numeric"
                  testId="question-grams"
                />
              </Field>
            )}

            <div className={lookupEnabled ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
              {lookupEnabled && (
                <Button size="md" variant="outline" onClick={() => setScannerOpen(true)} data-testid="question-scan">
                  Scan pack
                </Button>
              )}
              <Button size="md" variant="outline" onClick={onPick} data-testid="question-change">
                Change food
              </Button>
              <Button size="md" variant="outline" onClick={onRemove} data-testid="question-remove">
                Not in it
              </Button>
            </div>
          </>
        )}

        <Button size="lg" variant="primary" full onClick={onNext} data-testid="question-next">
          {doneLabel}
        </Button>
      </div>

      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onCode={(code) => void onScanCode(code)} />
    </div>
  );
}

function IngredientPickerSheet({
  open,
  onClose,
  sources,
  existing,
  onResult,
}: {
  open: boolean;
  onClose: () => void;
  sources: MatchSources;
  existing: RecipeIngredient | null;
  onResult: (ing: RecipeIngredient) => void;
}) {
  const [query, setQuery] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [typingFigures, setTypingFigures] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualPer100, setManualPer100] = useState<Macros>({ kcal: NaN, protein: NaN, carbs: NaN, fat: NaN });
  // "Off means off: no request is made at all, not merely hidden" — see QuestionCardBody's own.
  const lookupEnabled = useSettings()?.productLookup !== false;

  useEffect(() => {
    if (open) return;
    setQuery('');
    setScannerOpen(false);
    setTypingFigures(false);
    setManualName('');
    setManualPer100({ kcal: NaN, protein: NaN, carbs: NaN, fat: NaN });
  }, [open]);

  const results = useMemo(() => searchFoods(query, sources), [query, sources]);

  const pick = (candidate: IngredientCandidate) => {
    const ing = existing ? replaceKeepingAmount(existing, candidate, candidate.name) : toIngredient(candidate, candidate.name, uuid());
    onResult(ing);
  };

  const onScanCode = async (code: string) => {
    setScannerOpen(false);
    if (!lookupEnabled) return;
    const result = await lookupBarcode(code);
    if (!result.label) return;
    const candidate: IngredientCandidate = {
      key: `label:${result.label.code || code}`,
      name: result.label.name || result.label.brand || 'Scanned item',
      per100: result.label.per100,
      source: 'label',
      ...(result.label.brand ? { brand: result.label.brand } : {}),
      ...(result.label.name ? { product: result.label.name } : {}),
    };
    pick(candidate);
  };

  const addManual = () => {
    const name = manualName.trim();
    if (!name) return;
    const base = existing ? mergeIngredient(existing, { name }) : toIngredient(null, name, uuid());
    onResult({ ...base, per100: manualPer100, source: 'user' });
  };

  return (
    <Sheet open={open} onClose={onClose} title={existing ? 'Change food' : 'Add ingredient'}>
      <div className="grid gap-3" data-testid="picker">
        <TextInput value={query} onChange={setQuery} placeholder="Search foods" testId="picker-search" autoFocus />

        {results.length > 0 && (
          <Card>
            {results.map((c, i) => (
              <div key={c.key} data-testid={`picker-result-${i}`}>
                {i > 0 && <Divider />}
                <Row onClick={() => pick(c)} title={c.name} subtitle={sourceTag(c)} />
              </div>
            ))}
          </Card>
        )}
        {query.trim() && results.length === 0 && <div className="px-1 text-sm text-muted">No matches.</div>}

        <div className={lookupEnabled ? 'grid grid-cols-2 gap-3' : 'grid gap-3'}>
          {lookupEnabled && (
            <Button size="md" variant="outline" full onClick={() => setScannerOpen(true)} data-testid="picker-scan">
              Scan a pack
            </Button>
          )}
          <Button size="md" variant={typingFigures ? 'secondary' : 'outline'} full onClick={() => setTypingFigures((v) => !v)} data-testid="picker-type-figures">
            Type figures
          </Button>
        </div>

        {typingFigures && (
          <div className="grid gap-3">
            <TextInput value={manualName} onChange={setManualName} placeholder="Name" testId="picker-manual-name" />
            <div className="grid grid-cols-2 gap-3">
              <NumberInput value={finiteOrNull(manualPer100.kcal)} onChange={(v) => setManualPer100((p) => ({ ...p, kcal: v ?? NaN }))} min={0} placeholder="kcal / 100 g" testId="picker-manual-kcal" />
              <NumberInput value={finiteOrNull(manualPer100.protein)} onChange={(v) => setManualPer100((p) => ({ ...p, protein: v ?? NaN }))} min={0} placeholder="Protein g" testId="picker-manual-protein" />
              <NumberInput value={finiteOrNull(manualPer100.carbs)} onChange={(v) => setManualPer100((p) => ({ ...p, carbs: v ?? NaN }))} min={0} placeholder="Carbs g" testId="picker-manual-carbs" />
              <NumberInput value={finiteOrNull(manualPer100.fat)} onChange={(v) => setManualPer100((p) => ({ ...p, fat: v ?? NaN }))} min={0} placeholder="Fat g" testId="picker-manual-fat" />
            </div>
            <Button size="lg" variant="primary" full disabled={!manualName.trim()} onClick={addManual} data-testid="picker-manual-add">
              {existing ? 'Use these figures' : 'Add'}
            </Button>
          </div>
        )}
      </div>
      <BarcodeScanner open={scannerOpen} onClose={() => setScannerOpen(false)} onCode={(code) => void onScanCode(code)} />
    </Sheet>
  );
}

export function RecipeBuilderScreen() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const nav = useNavigate();
  const { status, refreshStatus } = useAssistant();
  const existing = useRecipe(id);
  const memories = useLiveQuery(() => db.foods.toArray(), []) ?? [];
  const [table, setTable] = useState<UkFoodTable | null>(null);

  const [name, setName] = useState('');
  const [ingredients, setIngredients] = useState<RecipeIngredient[]>([]);
  const [phase, setPhase] = useState<Phase>('start');
  const [questionIndex, setQuestionIndex] = useState(0);
  const [sheetIndex, setSheetIndex] = useState<number | null>(null);
  const [pickerFor, setPickerFor] = useState<'add' | number | null>(null);
  const [recogniseNote, setRecogniseNote] = useState<{ kind: 'none' | 'error'; detail?: string } | null>(null);
  const [showTyping, setShowTyping] = useState(false);
  const [typedText, setTypedText] = useState('');
  const [showEstimateInput, setShowEstimateInput] = useState(false);
  const [estimateText, setEstimateText] = useState('');
  const [shareState, patchShare] = useShareState(1);
  const [saving, setSaving] = useState(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const ticketRef = useRef(0);
  const loadedExistingRef = useRef(false);
  const startedEstimateRef = useRef(false);

  useEffect(() => {
    void sweepMealPhotos();
  }, []);
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  useEffect(() => {
    void loadUkFoodTable().then(setTable);
  }, []);

  useEffect(() => {
    if (!id || !existing || loadedExistingRef.current) return;
    loadedExistingRef.current = true;
    setName(existing.name);
    setIngredients(existing.ingredients);
    patchShare({ made: existing.portionsMade });
    setPhase('review');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, existing]);

  const sources: MatchSources = useMemo(() => ({ foods: table?.foods ?? [], aliases: table?.aliases ?? [], memories }), [table, memories]);

  // `?start=estimate` (MealEditScreen's Estimate button) opens the text box directly, the same
  // way it would after tapping "Estimate a meal out" — but only once `status` has actually loaded
  // and reads `ready`, the same gate the start button itself is under; on any other state the
  // screen just lands on the ordinary start phase, showing why.
  useEffect(() => {
    if (startedEstimateRef.current || !status) return;
    if (params.get('start') !== 'estimate') return;
    startedEstimateRef.current = true;
    if (status.state === 'ready') setShowEstimateInput(true);
  }, [status, params]);

  const search = params.toString();
  const backHref = `/food/recipes${search ? `?${search}` : ''}`;

  const updateIngredient = (ingId: string, patch: Partial<RecipeIngredient>) => {
    setIngredients((prev) => prev.map((i) => (i.id === ingId ? mergeIngredient(i, patch) : i)));
  };

  const removeIngredient = (ingId: string) => {
    setIngredients((prev) => prev.filter((i) => i.id !== ingId));
  };

  // -- Photo recognition -----------------------------------------------------------------------

  const onPhotoPicked = async (file: File) => {
    setRecogniseNote(null);
    setPhase('recognising');
    const ticket = (ticketRef.current += 1);
    let path: string | undefined;
    try {
      const prepared = await preparePhoto(file);
      path = prepared.path;
      if (ticket !== ticketRef.current) return;
      // The native plugin needs the absolute file:// URI (`prepared.uri`), not the Directory.Cache-
      // relative `path` — that one is only meaningful to further Capacitor Filesystem calls (see
      // `deleteMealPhoto` below, which correctly keeps using it).
      const { text } = await Nano.analyzeMeal({ path: prepared.uri, system: MEAL_PHOTO_SYSTEM, prompt: MEAL_PHOTO_PROMPT, temperature: 0.2, maxOutputTokens: 256 });
      if (ticket !== ticketRef.current) return;
      const analysis = parseMealAnalysis(text);
      if (analysis.ingredients.length === 0) {
        setRecogniseNote({ kind: 'none' });
        setPhase('review');
        return;
      }
      setIngredients(buildIngredients(analysis.ingredients, sources));
      if (analysis.dish && !name.trim()) setName(analysis.dish);
      setQuestionIndex(0);
      setPhase('questions');
    } catch (e) {
      if (ticket !== ticketRef.current) return;
      setRecogniseNote({ kind: 'error', detail: describeAnalyzeMealError(e) });
      setPhase('review');
    } finally {
      if (path) void deleteMealPhoto(path);
    }
  };

  const cancelRecognition = () => {
    ticketRef.current += 1;
    setPhase('start');
  };

  // -- Estimate a meal out ------------------------------------------------------------------------

  const runEstimate = async () => {
    const text = estimateText.trim();
    if (!text) return;
    setRecogniseNote(null);
    setPhase('estimating');
    const ticket = (ticketRef.current += 1);
    try {
      const { text: raw } = await Nano.generate({ system: MEAL_ESTIMATE_SYSTEM, prompt: mealEstimatePrompt(text), temperature: 0.2, maxOutputTokens: 300 });
      if (ticket !== ticketRef.current) return;
      const estimate = parseMealEstimate(raw);
      if (estimate.parts.length === 0) {
        setRecogniseNote({ kind: 'none' });
        setPhase('review');
        return;
      }
      // Straight to Review, never the one-at-a-time walk: the amounts are already there.
      setIngredients(buildEstimatedIngredients(estimate.parts, sources));
      if (estimate.dish && !name.trim()) setName(estimate.dish);
      setShowEstimateInput(false);
      setEstimateText('');
      setPhase('review');
    } catch (e) {
      if (ticket !== ticketRef.current) return;
      setRecogniseNote({ kind: 'error', detail: describeAnalyzeMealError(e) });
      setPhase('review');
    }
  };

  // -- Typed text --------------------------------------------------------------------------------

  const submitTypedText = () => {
    const items = parseMealText(typedText);
    if (items.length === 0) return;
    const amounts = new Map<string, TypedAmount>(items.map((it) => [it.name, { count: it.count, grams: it.grams }]));
    setIngredients(buildIngredients(items.map((it) => it.name), sources, amounts));
    setTypedText('');
    setShowTyping(false);
    setQuestionIndex(0);
    setPhase('questions');
  };

  // -- Questions walk ------------------------------------------------------------------------------

  const advanceQuestion = () => {
    if (questionIndex >= ingredients.length - 1) setPhase('review');
    else setQuestionIndex((i) => i + 1);
  };

  // -- Picker result -------------------------------------------------------------------------------

  const handlePickerResult = (ing: RecipeIngredient) => {
    if (typeof pickerFor === 'number') {
      const idx = pickerFor;
      setIngredients((prev) => prev.map((x, i) => (i === idx ? ing : x)));
    } else {
      setIngredients((prev) => [...prev, ing]);
      if (phase === 'start') setPhase('review');
    }
    setPickerFor(null);
  };

  // -- Save / log ----------------------------------------------------------------------------------

  const shareInput = shareInputFrom(shareState);
  const fraction = shareFraction(shareInput);
  const complete = recipeIsComplete(ingredients);

  const saveOnly = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await saveRecipe({ id, name, ingredients, portionsMade: shareState.made ?? 1 });
      nav('/food/recipes');
    } catch {
      setSaving(false);
      toast('Could not save the recipe', 'danger');
    }
  };

  const saveAndLog = async () => {
    if (saving || !complete || fraction === null || fraction <= 0) return;
    setSaving(true);
    try {
      const recipeId = await saveRecipe({ id, name, ingredients, portionsMade: shareState.made ?? 1 });
      const recipe: Recipe = {
        id: recipeId,
        name: name.trim() || 'Recipe',
        ingredients,
        portionsMade: shareState.made ?? 1,
        createdAt: existing?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      };
      const mealParam = params.get('meal');
      const dateParam = params.get('date');
      const into = mealParam ? { mealId: mealParam } : { newMeal: { date: dateParam ?? toDateKey() } };
      const mealId = await logShare({ recipe, share: shareInput, into });
      nav(`/food/${mealId}`, { replace: true });
    } catch {
      setSaving(false);
      toast('Could not save the recipe', 'danger');
    }
  };

  const loading = Boolean(id) && existing === undefined;
  const notFound = Boolean(id) && existing === null;

  return (
    <div>
      <TopBar title={id ? name || 'Edit recipe' : 'New recipe'} back={backHref} />

      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="recipe-photo-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void onPhotoPicked(file);
        }}
      />

      {loading && <div className="py-10 text-center text-sm text-muted">Loading…</div>}
      {notFound && (
        <div className="px-4">
          <EmptyState>This recipe no longer exists.</EmptyState>
        </div>
      )}

      {!loading && !notFound && (
        <>
          {phase === 'start' && (
            <div className="grid gap-3 px-4">
              <Button size="xl" full disabled={status?.state !== 'ready'} onClick={() => photoInputRef.current?.click()} data-testid="recipe-take-photo">
                Take a photo
              </Button>
              {status && status.state !== 'ready' && (
                <div className="px-1 text-xs text-muted" data-testid="recipe-assistant-state">
                  Assistant: {status.state}
                  {status.detail ? ` · ${status.detail}` : ''}
                </div>
              )}

              <Button size="xl" full variant="secondary" onClick={() => setShowTyping((v) => !v)} data-testid="recipe-type-it">
                Type it
              </Button>
              {showTyping && (
                <div className="grid gap-2">
                  <TextInput multiline value={typedText} onChange={setTypedText} placeholder="3 eggs, 30g cheddar, 2 rashers bacon" testId="recipe-typed-text" />
                  <Button size="lg" full variant="primary" disabled={!typedText.trim()} onClick={submitTypedText} data-testid="recipe-use-typed">
                    Use this
                  </Button>
                </div>
              )}

              <Button size="xl" full variant="secondary" onClick={() => setPickerFor('add')} data-testid="recipe-add-ingredients">
                Add ingredients
              </Button>

              {/* Gated on the same Nano status as "Take a photo" — `recipe-assistant-state` above
                  already states it factually, once, for both. */}
              <Button size="xl" full variant="secondary" disabled={status?.state !== 'ready'} onClick={() => setShowEstimateInput((v) => !v)} data-testid="recipe-start-estimate">
                Estimate a meal out
              </Button>
              {showEstimateInput && (
                <div className="grid gap-2">
                  <TextInput multiline value={estimateText} onChange={setEstimateText} placeholder="What did you eat?" testId="recipe-estimate-text" />
                  <Button size="lg" full variant="primary" disabled={!estimateText.trim()} onClick={() => void runEstimate()} data-testid="recipe-estimate-submit">
                    Estimate
                  </Button>
                </div>
              )}
            </div>
          )}

          {phase === 'recognising' && (
            <div className="px-4">
              <Card className="p-6 text-center">
                <div className="text-base font-semibold" data-testid="recipe-recognising">
                  Recognising…
                </div>
                <div className="h-4" />
                <Button size="lg" variant="secondary" onClick={cancelRecognition} data-testid="recipe-recognise-cancel">
                  Cancel
                </Button>
              </Card>
            </div>
          )}

          {phase === 'estimating' && (
            <div className="px-4">
              <Card className="p-6 text-center">
                <div className="text-base font-semibold" data-testid="recipe-estimating">
                  Estimating…
                </div>
                <div className="h-4" />
                <Button size="lg" variant="secondary" onClick={cancelRecognition} data-testid="recipe-estimate-cancel">
                  Cancel
                </Button>
              </Card>
            </div>
          )}

          {phase === 'questions' && ingredients[questionIndex] && (
            <div className="px-4">
              <Card className="p-4" data-testid="question-card">
                {/* Remounted per ingredient (key = its id), the same reason FoodItemSheet remounts
                    per edit target: without it, React reuses the one component instance across the
                    walk and its local-only UI state (a "Type figures" panel left open, an in-progress
                    unit-weight edit) leaks from one ingredient's card onto the next one's. */}
                <QuestionCardBody
                  key={ingredients[questionIndex]!.id}
                  ingredient={ingredients[questionIndex]!}
                  position={questionIndex + 1}
                  total={ingredients.length}
                  tableFoods={sources.foods}
                  onChange={(patch) => updateIngredient(ingredients[questionIndex]!.id, patch)}
                  onNext={advanceQuestion}
                  onRemove={() => {
                    removeIngredient(ingredients[questionIndex]!.id);
                    if (questionIndex >= ingredients.length - 1) setPhase('review');
                  }}
                  onPick={() => setPickerFor(questionIndex)}
                  doneLabel={questionIndex < ingredients.length - 1 ? 'Next' : 'Done'}
                />
              </Card>
            </div>
          )}

          {phase === 'review' && (
            <div className="px-4">
              <TextInput value={name} onChange={setName} placeholder="Recipe name" testId="recipe-name" />
              <div className="h-4" />

              {/* Describes the recognition attempt, not the recipe — once the user has added an
                  ingredient by hand, the recipe is no longer "nothing recognised". */}
              {recogniseNote?.kind === 'none' && ingredients.length === 0 && (
                <div className="pb-3 text-sm text-muted" data-testid="recognise-none">
                  Nothing recognised.
                </div>
              )}
              {recogniseNote?.kind === 'error' && ingredients.length === 0 && (
                <div className="pb-3 text-sm text-muted" data-testid="recognise-error">
                  {recogniseNote.detail}
                </div>
              )}

              {ingredients.length === 0 ? (
                <EmptyState>No ingredients yet.</EmptyState>
              ) : (
                <Card>
                  {ingredients.map((ing, i) => {
                    const rowComplete = ingredientGap(ing) === null;
                    const rowMacros = rowComplete ? displayMacros(fromPer100(ing.per100, ing.grams)) : null;
                    return (
                      <div key={ing.id} data-testid={`review-row-${i}`}>
                        {i > 0 && <Divider />}
                        <Row
                          onClick={() => setSheetIndex(i)}
                          title={ing.name}
                          subtitle={
                            ing.amountEstimated ? (
                              <span data-testid={`review-estimated-${i}`}>≈ {fmtGrams(ing.grams)} · est.</span>
                            ) : (
                              amountLabel(ing)
                            )
                          }
                          right={rowMacros ? <span className="num font-extrabold tabular-nums">{fmtKcal(rowMacros.kcal)}</span> : <span className="text-muted">—</span>}
                        />
                      </div>
                    );
                  })}
                </Card>
              )}

              <div className="h-4" />
              <Button size="lg" variant="secondary" full onClick={() => setPickerFor('add')} data-testid="recipe-add-ingredient">
                Add ingredient
              </Button>

              <div className="h-4" />
              {complete ? (
                <div className="flex items-baseline justify-between gap-3 rounded-xl bg-surface-2 px-3 py-3">
                  <div className="flex items-baseline gap-2">
                    <span className="num font-extrabold tabular-nums" data-testid="review-total-kcal">
                      {fmtKcal(recipeDisplayTotals(ingredients).kcal)}
                    </span>
                    {ingredients.some((i) => i.amountEstimated) && (
                      <span className="text-[11px] font-bold uppercase tracking-[0.1em] text-muted" data-testid="review-estimate">
                        Estimate
                      </span>
                    )}
                  </div>
                  <MacroLine m={recipeDisplayTotals(ingredients)} className="text-sm text-muted" />
                </div>
              ) : (
                <div className="text-sm text-muted" data-testid="recipe-gaps">
                  {gapsCount(ingredients)} to fill in
                </div>
              )}

              {complete && (
                <>
                  <div className="h-6" />
                  <RecipeShareFields ingredients={ingredients} state={shareState} onChange={patchShare} />
                  <div className="h-4" />
                  <div className="grid grid-cols-2 gap-3">
                    <Button size="lg" variant="secondary" full disabled={saving} onClick={() => void saveOnly()} data-testid="recipe-save">
                      Save
                    </Button>
                    <Button size="lg" variant="primary" full disabled={saving || fraction === null || fraction <= 0} onClick={() => void saveAndLog()} data-testid="recipe-save-log">
                      Save and log
                    </Button>
                  </div>
                </>
              )}
              <div className="h-8" />
            </div>
          )}
        </>
      )}

      <Sheet open={sheetIndex !== null} onClose={() => setSheetIndex(null)} title={sheetIndex !== null ? ingredients[sheetIndex]?.name : undefined}>
        {sheetIndex !== null && ingredients[sheetIndex] && (
          <QuestionCardBody
            ingredient={ingredients[sheetIndex]!}
            position={sheetIndex + 1}
            total={ingredients.length}
            tableFoods={sources.foods}
            onChange={(patch) => updateIngredient(ingredients[sheetIndex]!.id, patch)}
            onNext={() => setSheetIndex(null)}
            onRemove={() => {
              removeIngredient(ingredients[sheetIndex]!.id);
              setSheetIndex(null);
            }}
            onPick={() => setPickerFor(sheetIndex)}
            doneLabel="Done"
          />
        )}
      </Sheet>

      <IngredientPickerSheet
        open={pickerFor !== null}
        onClose={() => setPickerFor(null)}
        sources={sources}
        existing={typeof pickerFor === 'number' ? (ingredients[pickerFor] ?? null) : null}
        onResult={handlePickerResult}
      />
    </div>
  );
}
