/**
 * @vitest-environment jsdom
 *
 * The one coach conversation (the sheet; the full-screen coach shares its parts), rendered for real
 * in jsdom with only the network replaced: where a message goes depending on whether Claude can be
 * called, what a question gets when it cannot, and that the rules coach's routines and Claude's
 * turns share one thread. How it looks is not tested.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiKey, setApiKey } from '@/ai/key';
import { recordUsage, setCap } from '@/ai/spend';
import { resetMemory } from '@/ai/store';
import { db } from '@/db/db';
import { resetToSeed } from '@/db/repo';
import type { BuiltRoutine } from '@/domain/routineBuilder';
import { useClaudeCoach } from '@/state/claudeCoach';
import { useCoach } from '@/state/coach';
import { fakeClaude, text, toolUse } from '@/test/fakeClaude';
import { CoachSheet } from './CoachSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'sk-ant-api03-CONVOCONVOCONVOCONVOCONVO1234';
const NO_KEY = 'Add your Claude key in Settings to use the coach.';
const PAUSED = "The coach is paused until the 1st: this month's cap is reached.";

let root: Root | null = null;
let container: HTMLElement | null = null;

async function mount(element: ReactElement): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(element);
  });
}

beforeEach(async () => {
  localStorage.clear();
  resetMemory();
  await resetToSeed();
  await db.coachNotes.clear();
  await db.coachMessages.clear();
  useCoach.getState().reset();
  useClaudeCoach.setState({ busy: false, lastError: null, draft: null });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

const byTestId = <T extends Element = HTMLElement>(id: string): T | null => document.body.querySelector<T>(`[data-testid="${id}"]`);
const all = (id: string): Element[] => [...document.body.querySelectorAll(`[data-testid="${id}"]`)];
const bodyText = (): string => document.body.textContent ?? '';

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function waitFor(check: () => boolean, label: string, ms = 6000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}. Page text: ${bodyText().slice(0, 500)}`);
    await flush(20);
  }
}

async function click(el: Element | null): Promise<void> {
  if (!el) throw new Error('Nothing to click');
  await act(async () => {
    (el as HTMLElement).click();
  });
}

async function typeInto(el: HTMLInputElement | null, value: string): Promise<void> {
  if (!el) throw new Error('Nothing to type into');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const input = () => byTestId<HTMLInputElement>('coach-input');

async function say(message: string): Promise<void> {
  await typeInto(input(), message);
  await click(byTestId('coach-send'));
}

const sheet = (extra: Partial<Parameters<typeof CoachSheet>[0]> = {}) => createElement(CoachSheet, { open: true, onClose: () => undefined, ...extra });

describe('with Claude out of reach, the rules coach builds and changes routines', () => {
  it('builds a routine for "build me a push routine" with no key, sends nothing, and hands it to the review', async () => {
    clearApiKey();
    const fake = fakeClaude({ content: [text('never sent')] });
    vi.stubGlobal('fetch', fake.fetch);
    const review = vi.fn<(routines: BuiltRoutine[]) => void>();
    await mount(sheet({ onSaveDraft: review }));
    expect(byTestId('coach-unavailable')!.textContent).toContain(NO_KEY);

    await say('build me a push routine');
    await waitFor(() => all('coach-routine').length > 0, 'the routine');
    await waitFor(() => byTestId('coach-send')!.textContent === 'Send', 'the box to be idle');
    expect(all('coach-row-name').length).toBeGreaterThan(0);
    expect(byTestId('coach-error')).toBeNull();
    expect(input()!.value).toBe('');

    // The same Review the rest of the app uses: the routines go to the caller, nothing is saved here.
    const routinesBefore = await db.routines.count();
    await click(byTestId('coach-review'));
    expect(review).toHaveBeenCalledTimes(1);
    expect(review.mock.calls[0]![0].length).toBeGreaterThan(0);
    expect(await db.routines.count()).toBe(routinesBefore);

    // Not Claude's conversation: nothing was sent, nothing stored.
    expect(fake.requests).toHaveLength(0);
    expect(await db.coachMessages.count()).toBe(0);
  });

  it('changes the routine on screen ("add biceps") the same way', async () => {
    clearApiKey();
    await mount(sheet({ onSaveDraft: () => undefined }));
    await say('give me a shoulder routine');
    await waitFor(() => all('coach-routine').length === 1, 'the first routine');
    await waitFor(() => byTestId('coach-send')!.textContent === 'Send', 'the box to be idle');
    await say('add biceps');
    await waitFor(() => all('coach-routine').length === 2, 'the changed routine');
    expect(byTestId('coach-edit') ?? all('coach-edit')[0]).toBeTruthy();
    expect(all('coach-entry')).toHaveLength(2);
  });

  it('gives a question the reason, keeps what was typed, and stores nothing, with no key', async () => {
    clearApiKey();
    const fake = fakeClaude({ content: [text('never sent')] });
    vi.stubGlobal('fetch', fake.fetch);
    await mount(sheet());
    await say('why has my bench stalled?');
    await waitFor(() => !!byTestId('coach-error'), 'the reason');
    expect(byTestId('coach-error')!.textContent).toBe(NO_KEY);
    // It said so once: the note above the box gives way to the error.
    expect(byTestId('coach-unavailable')).toBeNull();
    expect(input()!.value).toBe('why has my bench stalled?');
    expect(all('coach-entry')).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
    expect(await db.coachMessages.count()).toBe(0);

    // Tapping the reason puts the note back.
    await click(byTestId('coach-error'));
    expect(byTestId('coach-error')).toBeNull();
    expect(byTestId('coach-unavailable')!.textContent).toContain(NO_KEY);
  });

  it('is paused over the spend cap: the box says so up front, a routine is still built, a question gets the same reason', async () => {
    setApiKey(KEY);
    setCap(5);
    recordUsage('claude-sonnet-5-5', { input_tokens: 3_000_000, output_tokens: 0 }); // $6, past the $5 cap
    const fake = fakeClaude({ content: [text('never sent')] });
    vi.stubGlobal('fetch', fake.fetch);
    await mount(sheet({ onSaveDraft: () => undefined }));
    expect(byTestId('coach-unavailable')!.textContent).toContain(PAUSED);

    await say('build me a chest routine');
    await waitFor(() => all('coach-routine').length === 1, 'the routine');

    await say('how is my week?');
    await waitFor(() => !!byTestId('coach-error'), 'the reason');
    expect(byTestId('coach-error')!.textContent).toBe(PAUSED);
    expect(fake.requests).toHaveLength(0);
  });

  it('is offline: the same, with the connection as the reason', async () => {
    setApiKey(KEY);
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const fake = fakeClaude({ content: [text('never sent')] });
    vi.stubGlobal('fetch', fake.fetch);
    await mount(sheet({ onSaveDraft: () => undefined }));
    expect(byTestId('coach-unavailable')!.textContent).toContain('No connection');
    await say('give me a leg routine');
    await waitFor(() => all('coach-routine').length === 1, 'the routine');
    await say('how is my week?');
    await waitFor(() => !!byTestId('coach-error'), 'the reason');
    expect(byTestId('coach-error')!.textContent).toContain('No connection');
    expect(fake.requests).toHaveLength(0);
    online.mockRestore();
  });
});

describe('with Claude in reach, everything goes to Claude', () => {
  it('sends a request for a routine to Claude, not to the rules, and offers its draft', async () => {
    setApiKey(KEY);
    const fake = fakeClaude(
      { content: [toolUse('t1', 'build_routine', { request: 'a push routine' })], stop_reason: 'tool_use' },
      { content: [text('Draft is ready. Save it if you like it.')] },
    );
    vi.stubGlobal('fetch', fake.fetch);
    const review = vi.fn<(routines: BuiltRoutine[]) => void>();
    await mount(sheet({ onSaveDraft: review }));
    expect(byTestId('coach-unavailable')).toBeNull();

    await say('build me a push routine');
    await waitFor(() => !!byTestId('coach-draft'), 'Claude\'s draft');
    expect(fake.requests.length).toBeGreaterThan(0);
    // Claude's turn is in the stored thread; the rules coach built nothing.
    expect(all('coach-entry')).toHaveLength(0);
    expect(all('coach-routine')).toHaveLength(0);
    expect(byTestId('coach-bubble')!.textContent).toContain('Draft is ready');
    await click(byTestId('coach-draft-save'));
    expect(review).toHaveBeenCalledTimes(1);
  });
});

describe('one thread', () => {
  it('shows what Claude said and the routines the rules built in the order they happened', async () => {
    clearApiKey();
    const earlier = new Date(Date.now() - 60_000).toISOString();
    await db.coachMessages.bulkPut([
      { id: 'u1', at: earlier, role: 'user', text: 'Morning' },
      { id: 'c1', at: new Date(Date.parse(earlier) + 1).toISOString(), role: 'coach', text: 'Morning. Legs today?' },
    ]);
    await mount(sheet({ onSaveDraft: () => undefined }));
    await waitFor(() => bodyText().includes('Morning. Legs today?'), 'the stored turns');

    await say('give me a chest routine');
    await waitFor(() => all('coach-routine').length === 1, 'the routine');

    const thread = byTestId('coach-thread')!;
    const html = thread.textContent!;
    expect(html.indexOf('Morning. Legs today?')).toBeLessThan(html.indexOf('give me a chest routine'));
    // The routine's entry follows the stored turns; it is not above them.
    const order = [...thread.querySelectorAll('[data-testid="coach-bubble"], [data-testid="coach-entry"]')].map((n) => n.getAttribute('data-testid'));
    expect(order).toEqual(['coach-bubble', 'coach-entry']);
  });

  it('puts a prefill in the box when the sheet opens, without sending it', async () => {
    clearApiKey();
    await mount(sheet({ prefill: 'Why did that last set feel so heavy?' }));
    await waitFor(() => input()?.value === 'Why did that last set feel so heavy?', 'the prefill');
    expect(all('coach-user-bubble')).toHaveLength(0);
    expect(await db.coachMessages.count()).toBe(0);
  });

  it('makes the first message a build when opened to draft a routine, whatever it says', async () => {
    clearApiKey();
    await mount(sheet({ build: true, onSaveDraft: () => undefined }));
    // Read as a question, it would only get the reason; as the first message of "Draft with coach" it is built.
    await say('why is my chest weak?');
    await waitFor(() => all('coach-routine').length === 1, 'the routine');
    expect(byTestId('coach-error')).toBeNull();
    // The next message is routed as usual.
    await waitFor(() => byTestId('coach-send')!.textContent === 'Send', 'the box to be idle');
    await say('why have you chosen this?');
    await waitFor(() => !!byTestId('coach-error'), 'the reason');
    expect(all('coach-routine')).toHaveLength(1);
  });

  it('offers a way into the full screen when the caller gives one', async () => {
    const full = vi.fn();
    await mount(sheet({ onFullScreen: full }));
    await click(byTestId('coach-fullscreen'));
    expect(full).toHaveBeenCalledTimes(1);
  });
});
