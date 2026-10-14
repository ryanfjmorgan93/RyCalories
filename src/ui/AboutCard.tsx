import { ATTRIBUTIONS } from '@/data/exerciseDemos';
import { UK_FOOD_TABLE_ATTRIBUTION } from '@/data/ukFoodTable';
import { Card, Divider } from './components/Card';

/** The exercise catalogue (src/domain/catalogue.ts): its entries, steps and photographs. Facts as recorded in docs/ATTRIBUTION.md. */
const EXERCISE_CATALOGUE_ATTRIBUTION = {
  name: 'Exercise library: free-exercise-db (public domain)',
  url: 'https://github.com/yuhonas/free-exercise-db',
  licence: 'Unlicense — https://unlicense.org/. The original source of the photographs is not stated.',
};

/** The generated exercise-media attributions, plus the exercise catalogue's and the bundled UK food
 * table's — appended, never hand-edited into `exerciseDemos.ts` itself (see `src/data/ukFoodTable.ts`'s
 * doc comment). */
const ALL_ATTRIBUTIONS = [...ATTRIBUTIONS, EXERCISE_CATALOGUE_ATTRIBUTION, UK_FOOD_TABLE_ATTRIBUTION];

/** Third-party attribution and the one fact about what this app sends off the device. */
export function AboutCard() {
  return (
    <Card className="px-4" data-testid="about-card">
      {ALL_ATTRIBUTIONS.map((a, i) => (
        <div key={a.name}>
          {i > 0 && <Divider />}
          <div className="py-3">
            <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent">
              {a.name}
            </a>
            <div className="mt-0.5 text-xs text-muted">{a.licence}</div>
          </div>
        </div>
      ))}
      <Divider />
      <div className="space-y-2 py-3 text-sm text-muted" data-testid="about-leaves-device">
        <p>Leaves the device: Open Food Facts lookups (switchable above) and the Video link (opens the browser).</p>
        <p>Steps, and weight when it is on, are read from Health Connect on this phone. Problem reports stay on this phone until you share them.</p>
        <p data-testid="about-claude-line">
          With a Claude key set, what you send to the coach, a summary of your training, food, supplements and steps, and any photos you choose go to Anthropic&apos;s API.
        </p>
      </div>
    </Card>
  );
}
