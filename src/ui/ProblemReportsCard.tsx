import { Share } from '@capacitor/share';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { BUILD_LABEL } from '@/buildInfo';
import { clearProblemReports, listProblemReports } from '@/db/problemRepo';
import { problemsText } from '@/domain/problemReports';
import { isNative } from '@/state/native';
import { Button } from './components/Button';
import { Card } from './components/Card';
import { Confirm } from './components/Sheet';
import { toast } from './components/Toast';

const SHOWN = 5;

/**
 * Settings → Problem reports: what the coach wrote down when something did not work, and errors
 * the app caught nowhere else. They stay on the phone; Share (Copy in a browser) hands the owner
 * the text to send to whoever fixes the app. Clear empties the list.
 */
export function ProblemReportsCard() {
  const reports = useLiveQuery(() => listProblemReports(), []);
  const [clearing, setClearing] = useState(false);
  if (!reports) return null;
  const native = isNative();

  const share = async () => {
    const text = problemsText(reports, BUILD_LABEL, new Date());
    if (native) {
      try {
        await Share.share({ title: 'Iron problem reports', text, dialogTitle: 'Share problem reports' });
      } catch {
        // Closing the share sheet is not an error.
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${reports.length} ${reports.length === 1 ? 'report' : 'reports'}`, 'ok');
    } catch {
      toast('Could not copy', 'danger');
    }
  };

  return (
    <Card className="px-4 py-3" data-testid="problem-reports">
      {reports.length === 0 ? (
        <div className="text-sm text-muted" data-testid="problem-count">
          None recorded.
        </div>
      ) : (
        <>
          <div className="text-sm text-muted" data-testid="problem-count">
            {reports.length} on this phone
          </div>
          <ul className="mt-2 space-y-2">
            {reports.slice(0, SHOWN).map((r) => (
              <li key={r.id} data-testid="problem-row">
                <div className="break-words text-sm font-medium">{r.summary}</div>
                <div className="text-xs text-dim">
                  {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(r.at))} · {r.source === 'coach' ? 'Coach' : 'App error'}
                </div>
              </li>
            ))}
          </ul>
          {reports.length > SHOWN && <div className="mt-2 text-xs text-dim">and {reports.length - SHOWN} more in what is shared</div>}
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={() => void share()} data-testid="problem-share">
              {native ? 'Share' : 'Copy'}
            </Button>
            <Button variant="ghost" onClick={() => setClearing(true)} data-testid="problem-clear">
              Clear
            </Button>
          </div>
        </>
      )}
      <Confirm
        open={clearing}
        title="Clear problem reports?"
        body="They are only on this phone. Share them first if they have not been sent."
        confirmLabel="Clear"
        danger
        onConfirm={() => {
          setClearing(false);
          void clearProblemReports();
        }}
        onCancel={() => setClearing(false)}
      />
    </Card>
  );
}
