import { useEffect, useState } from 'react';
import type { AssistantContext } from '../domain/assistant';
import { useAssistant } from '../state/assistant';
import { Button } from './components/Button';
import { TextInput } from './components/NumberField';
import { Sheet } from './components/Sheet';

/**
 * On-device assistant, in a bottom sheet. Answers only what is asked: no greeting, no suggested
 * prompts. `context` is rebuilt by the caller from whatever screen this is opened on.
 */
export function AssistantBox({
  open,
  onClose,
  context,
  title,
}: {
  open: boolean;
  onClose: () => void;
  context: AssistantContext;
  title?: string;
}) {
  const { status, thread, busy, error, refreshStatus, ask, download } = useAssistant();
  const [question, setQuestion] = useState('');

  useEffect(() => {
    if (open) void refreshStatus();
  }, [open, refreshStatus]);

  const send = () => {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion('');
    void ask(q, context);
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title ?? 'Assistant'}
      footer={
        <div className="flex items-end gap-2">
          <TextInput
            value={question}
            onChange={setQuestion}
            placeholder="Ask a question"
            testId="assistant-input"
            className="flex-1"
          />
          <Button variant="primary" size="md" onClick={send} disabled={busy || !question.trim()} data-testid="assistant-send">
            Send
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3 py-1">
        {status && status.state !== 'ready' && (
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-3">
            <div className="text-sm text-muted">{status.state === 'unavailable' ? 'On-device model unavailable.' : 'Model not downloaded.'}</div>
            {status.state !== 'unavailable' && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-2"
                disabled={status.state === 'downloading'}
                onClick={() => void download()}
              >
                {status.state === 'downloading' ? 'Downloading…' : 'Download'}
              </Button>
            )}
          </div>
        )}

        {thread.length > 0 && (
          <div className="flex flex-col gap-2">
            {thread.map((turn, i) => (
              <div
                key={i}
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm ${
                  turn.role === 'user' ? 'self-end bg-accent text-accent-fg' : 'self-start bg-surface-2 text-fg'
                }`}
              >
                {turn.text}
              </div>
            ))}
          </div>
        )}

        {error && <div className="text-sm text-danger">{error}</div>}
      </div>
    </Sheet>
  );
}
