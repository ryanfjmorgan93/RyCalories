import { ATTRIBUTIONS } from '@/data/exerciseDemos';
import { Card, Divider } from './components/Card';

/** Third-party attribution and the one fact about what this app sends off the device. */
export function AboutCard() {
  return (
    <Card className="px-4" data-testid="about-card">
      {ATTRIBUTIONS.map((a, i) => (
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
      <div className="py-3 text-sm text-muted">
        Leaves the device: Open Food Facts lookups (switchable above), the Video link (opens the browser), and Google&apos;s ML Kit
        statistics when the assistant runs.
      </div>
    </Card>
  );
}
