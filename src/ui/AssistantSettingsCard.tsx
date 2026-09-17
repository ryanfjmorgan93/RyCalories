import { useEffect, useState } from 'react';
import { buildSystemPrompt } from '../domain/assistant';
import { Nano, type NanoDownloadEvent, type NanoState } from '../state/nano';
import { NanoBackend, useAssistant } from '../state/assistant';
import { Button } from './components/Button';
import { Card, Row } from './components/Card';
import { Chip } from './components/Chip';

// One stateless backend instance for the "Test" button — deliberately not the shared useAssistant
// store, so a smoke test here never writes to the user's actual conversation thread.
const testBackend = new NanoBackend();

// `isDownloading` (the local `downloading` flag OR'd with `status.state === 'downloading'`) is
// the source of truth for the in-progress state: the plugin reports download events as they
// happen, but `status.state` itself only catches up once `refreshStatus()` runs afterwards.
function statusLabel(state: NanoState | undefined, isDownloading: boolean, percent: number | null): string {
  if (isDownloading) return percent === null ? 'Downloading…' : `Downloading ${percent} %`;
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'downloadable':
      return 'Download (about 2 GB)';
    case 'unavailable':
      return 'Unavailable';
    default:
      return 'Checking…';
  }
}

function chipTone(state: NanoState | undefined, isDownloading: boolean): 'ok' | 'warn' | 'danger' | 'neutral' {
  if (state === 'ready') return 'ok';
  if (isDownloading || state === 'downloadable') return 'warn';
  if (state === 'unavailable') return 'danger';
  return 'neutral';
}

/** Settings card for the on-device assistant: status, download, a smoke test, and the one fact about data leaving the device. */
export function AssistantSettingsCard() {
  const { status, refreshStatus, download } = useAssistant();
  const [percent, setPercent] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    void refreshStatus();
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void Nano.addListener('nanoDownload', (e: NanoDownloadEvent) => {
      if (e.phase === 'started' || e.phase === 'progress') {
        setDownloading(true);
        setPercent(e.total > 0 ? Math.min(100, Math.max(0, Math.round((e.downloaded / e.total) * 100))) : null);
      } else if (e.phase === 'completed') {
        setDownloading(false);
        setPercent(100);
        void refreshStatus();
      } else if (e.phase === 'failed') {
        setDownloading(false);
        setPercent(null);
        void refreshStatus();
      }
    }).then((h) => {
      if (cancelled) void h.remove();
      else handle = h;
    });
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [refreshStatus]);

  const runTest = async () => {
    setTestBusy(true);
    setTestResult(null);
    try {
      const reply = await testBackend.ask(buildSystemPrompt(), 'What is 2 + 2?');
      setTestResult(reply);
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : String(e));
    } finally {
      setTestBusy(false);
    }
  };

  const isDownloading = downloading || status?.state === 'downloading';

  return (
    <Card>
      <Row
        title="On-device assistant"
        subtitle={statusLabel(status?.state, isDownloading, percent)}
        right={<Chip tone={chipTone(status?.state, isDownloading)}>{(status?.state ?? 'checking').toUpperCase()}</Chip>}
      />

      <div className="flex gap-2 px-4 pb-3">
        {status?.state !== 'ready' && (
          <Button size="sm" variant="secondary" disabled={isDownloading} onClick={() => void download()}>
            {isDownloading ? 'Downloading…' : 'Download'}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={testBusy || status?.state !== 'ready'} onClick={() => void runTest()}>
          {testBusy ? 'Testing…' : 'Test'}
        </Button>
      </div>

      {testResult !== null && (
        <div className="px-4 pb-3 text-sm" data-testid="assistant-test-result">
          {testResult}
        </div>
      )}

      {status && (
        <details className="px-4 pb-3 text-xs text-muted">
          <summary className="cursor-pointer select-none">Details</summary>
          <div className="num mt-1">{status.detail}</div>
        </details>
      )}

      <div className="border-t border-line px-4 py-3 text-xs text-muted">
        Runs on the phone through Google AICore. Google&apos;s ML Kit library may send usage statistics.
      </div>
    </Card>
  );
}
