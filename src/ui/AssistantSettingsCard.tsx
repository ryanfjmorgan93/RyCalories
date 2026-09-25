import { useEffect, useState } from 'react';
import { buildSystemPrompt } from '../domain/assistant';
import { Nano, type NanoDownloadEvent, type NanoState } from '../state/nano';
import { NanoBackend, useAssistant } from '../state/assistant';
import { useCoach } from '../state/coach';
import { useNanoDownloadPercent } from './useNanoDownload';
import { copyText } from './clipboard';
import { Button } from './components/Button';
import { Card, Row } from './components/Card';
import { Chip } from './components/Chip';
import { toast } from './components/Toast';

// One stateless backend instance for the "Test" button — deliberately not the shared useAssistant
// store, so a smoke test here never writes to the user's actual conversation thread.
const testBackend = new NanoBackend();

// `isDownloading` (the local `downloading` flag OR'd with `status.state === 'downloading'`) is
// the source of truth for the in-progress state: the plugin reports download events as they
// happen, but `status.state` itself only catches up once `refreshStatus()` runs afterwards.
function statusLabel(state: NanoState | undefined, isDownloading: boolean, percent: number | null, downloadable = 'Download (about 2 GB)'): string {
  if (isDownloading) return percent === null ? 'Downloading…' : `Downloading ${percent} %`;
  switch (state) {
    case 'ready':
      return 'Ready';
    case 'downloadable':
      return downloadable;
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


/**
 * The coach's model: the fuller variant of the same on-device Nano, which AICore may download
 * separately. Its detail line names the base model and its token limit, read on the phone.
 */
function CoachModelRow() {
  const { status, refreshStatus, download } = useCoach();
  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);
  const percent = useNanoDownloadPercent('full', refreshStatus);
  const isDownloading = percent !== null || status?.state === 'downloading';
  return (
    <div className="border-t border-line" data-testid="coach-model">
      <Row
        title="Coach model"
        subtitle={statusLabel(status?.state, isDownloading, percent, 'Not downloaded')}
        right={<Chip tone={chipTone(status?.state, isDownloading)}>{(status?.state ?? 'checking').toUpperCase()}</Chip>}
      />
      {status && (
        <div className="num px-4 pb-3 text-xs text-muted" data-testid="coach-model-detail">
          {status.detail}
        </div>
      )}
      {(status?.state === 'downloadable' || isDownloading) && (
        <div className="px-4 pb-3">
          <Button size="sm" variant="secondary" disabled={isDownloading} onClick={() => void download()} data-testid="coach-model-download">
            {isDownloading ? 'Downloading…' : 'Download'}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Settings card for the on-device assistant: status, download, a smoke test, and the one fact about data leaving the device. */
export function AssistantSettingsCard() {
  const { status, refreshStatus, download } = useAssistant();
  const [percent, setPercent] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [rechecking, setRechecking] = useState(false);

  useEffect(() => {
    void refreshStatus();
    let cancelled = false;
    let handle: { remove: () => Promise<void> } | undefined;
    void Nano.addListener('nanoDownload', (e: NanoDownloadEvent) => {
      if (e.model === 'full') return; // the coach model's download, shown on its own line below
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

  const recheck = async () => {
    setRechecking(true);
    try {
      await refreshStatus();
    } finally {
      setRechecking(false);
    }
  };

  const copyDiagnostics = async () => {
    const ok = await copyText(status?.detail ?? '');
    toast(ok ? 'Copied' : 'Could not copy.', ok ? 'ok' : 'danger');
  };

  const isDownloading = downloading || status?.state === 'downloading';

  return (
    <Card data-testid="assistant-card">
      <Row
        title="On-device assistant"
        subtitle={statusLabel(status?.state, isDownloading, percent)}
        right={<Chip tone={chipTone(status?.state, isDownloading)}>{(status?.state ?? 'checking').toUpperCase()}</Chip>}
      />

      {status && (
        <div className="num px-4 pb-3 text-xs text-muted" data-testid="assistant-detail">
          {status.detail}
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 pb-3">
        {/* Only when there is something to download. On 'unavailable' AICore cannot serve the
            model at all, so a Download button there is a control that cannot work — the same
            decorative-control fault the Ask gating fixes. */}
        {(status?.state === 'downloadable' || isDownloading) && (
          <Button size="sm" variant="secondary" disabled={isDownloading} onClick={() => void download()} data-testid="assistant-download">
            {isDownloading ? 'Downloading…' : 'Download'}
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={testBusy || status?.state !== 'ready'} onClick={() => void runTest()}>
          {testBusy ? 'Testing…' : 'Test'}
        </Button>
        <Button size="sm" variant="outline" disabled={rechecking} onClick={() => void recheck()} data-testid="assistant-recheck">
          {rechecking ? 'Checking…' : 'Re-check'}
        </Button>
        <Button size="sm" variant="outline" disabled={!status?.detail} onClick={() => void copyDiagnostics()} data-testid="assistant-copy-diagnostics">
          Copy diagnostics
        </Button>
      </div>

      <CoachModelRow />

      {testResult !== null && (
        <div className="px-4 pb-3 text-sm" data-testid="assistant-test-result">
          {testResult}
        </div>
      )}

      <div className="border-t border-line px-4 py-3 text-xs text-muted">
        Runs on the phone through Google AICore. Google&apos;s ML Kit library may send usage statistics.
      </div>
    </Card>
  );
}
