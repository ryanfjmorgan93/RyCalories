/**
 * @vitest-environment jsdom
 *
 * The two Claude screens rendered for real (React, the live Dexie queries, the real coach store and
 * SDK) in jsdom, with only the network replaced. There is no component-testing library in this repo,
 * so the DOM is driven by hand; what this proves is that the screens mount, show what they should
 * and call the right things, not how they look.
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearApiKey, setApiKey } from '@/ai/key';
import { capUsd, recordUsage, setCap } from '@/ai/spend';
import { resetMemory } from '@/ai/store';
import { db } from '@/db/db';
import { resetToSeed } from '@/db/repo';
import { fakeClaude, text, toolUse } from '@/test/fakeClaude';
import { ClaudeSettingsCard } from './ClaudeSettingsCard';
import { CoachSheet } from './CoachSheet';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = 'sk-ant-api03-UISMOKEUISMOKEUISMOKEUISMOKE1234';
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

const q = <T extends Element = HTMLElement>(selector: string): T | null => document.body.querySelector<T>(selector);
const byTestId = <T extends Element = HTMLElement>(id: string): T | null => q<T>(`[data-testid="${id}"]`);
const bodyText = (): string => document.body.textContent ?? '';

async function flush(ms = 0): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function waitFor(check: () => boolean, label: string, ms = 4000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error(`Timed out waiting for ${label}. Page text: ${bodyText().slice(0, 400)}`);
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

describe('Settings › Claude', () => {
  it('takes a key, masks it, tests it, and removes it', async () => {
    await mount(createElement(ClaudeSettingsCard));
    await waitFor(() => bodyText().includes('No key yet'), 'the empty state');

    const input = byTestId<HTMLInputElement>('claude-key-input')!;
    expect(input.type).toBe('password');
    expect((byTestId<HTMLButtonElement>('claude-key-save')!).disabled).toBe(true);

    await typeInto(input, `  ${KEY}\n`);
    await click(byTestId('claude-key-save'));
    expect(localStorage.getItem('iron.claudeKey')).toBe(KEY);
    expect(bodyText()).toContain('Key sk-ant-…1234');
    expect(bodyText()).not.toContain(KEY);
    expect(byTestId<HTMLInputElement>('claude-key-input')!.value).toBe('');

    const fake = fakeClaude({ content: [text('ready')], usage: { input_tokens: 15, output_tokens: 4 } });
    vi.stubGlobal('fetch', fake.fetch);
    await click(byTestId('claude-key-test'));
    await waitFor(() => !!byTestId('claude-test-result'), 'the test result');
    expect(byTestId('claude-test-result')!.textContent).toBe('Claude answered. The key works.');
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]!.body.model).toBe('claude-haiku-5-5');
    // The spend shows up without any refresh.
    expect(byTestId('claude-spend-amount')!.textContent).toBe('under 1p');

    await click(byTestId('claude-key-remove'));
    expect(bodyText()).toContain('Remove the key?');
    const confirm = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Remove' && b !== byTestId('claude-key-remove'));
    await click(confirm ?? null);
    expect(localStorage.getItem('iron.claudeKey')).toBeNull();
    await waitFor(() => bodyText().includes('No key yet'), 'the key to be gone');
  });

  it('says why a test failed, in one plain line', async () => {
    setApiKey(KEY);
    await mount(createElement(ClaudeSettingsCard));
    vi.stubGlobal('fetch', fakeClaude({ status: 401, error: { type: 'authentication_error', message: 'invalid x-api-key' } }).fetch);
    await click(byTestId('claude-key-test'));
    await waitFor(() => !!byTestId('claude-test-result'), 'the test result');
    expect(byTestId('claude-test-result')!.textContent).toBe("Claude didn't accept the key. Check it in Settings.");
  });

  it('shows the month\'s spend against the limit, warns from 80 percent, and takes a new limit', async () => {
    setApiKey(KEY);
    setCap(10);
    recordUsage('claude-sonnet-5-5', { input_tokens: 3_000_000, output_tokens: 0 }); // $6
    await mount(createElement(ClaudeSettingsCard));
    expect(byTestId('claude-spend-amount')!.textContent).toBe('$6.00');
    expect(bodyText()).toContain('of $10.00');
    expect(byTestId('claude-spend-bar')!.getAttribute('aria-valuenow')).toBe('60');
    expect(bodyText()).not.toContain('of the limit used');

    await act(async () => {
      recordUsage('claude-sonnet-5-5', { input_tokens: 1_000_000, output_tokens: 0 }); // $8
    });
    expect(byTestId('claude-spend-bar')!.getAttribute('aria-valuenow')).toBe('80');
    expect(bodyText()).toContain('80 % of the limit used.');

    await typeInto(byTestId<HTMLInputElement>('claude-cap'), '20');
    await click(byTestId('claude-cap-save'));
    expect(capUsd()).toBe(20);
    expect(bodyText()).toContain('of $20.00');
    expect(byTestId('claude-spend-bar')!.getAttribute('aria-valuenow')).toBe('40');

    await act(async () => {
      setCap(7);
    });
    expect(bodyText()).toContain('Paused until the 1st.');
    expect(bodyText()).toContain('PAUSED');
  });

  it('lists the coach\'s notes and deletes one after a confirmation', async () => {
    await db.coachNotes.bulkPut([
      { id: 'n1', createdAt: '2026-10-01T08:00:00.000Z', text: 'Left knee twinges on deep squats' },
      { id: 'n2', createdAt: '2026-10-05T08:00:00.000Z', text: 'Prefers cables' },
    ]);
    await mount(createElement(ClaudeSettingsCard));
    await waitFor(() => document.body.querySelectorAll('[data-testid="claude-note"]').length === 2, 'both notes');
    expect([...document.body.querySelectorAll('[data-testid="claude-note"]')].map((n) => n.textContent)).toEqual([expect.stringContaining('Prefers cables'), expect.stringContaining('Left knee twinges')]);

    await click(document.body.querySelector('[data-testid="claude-note"] button'));
    expect(bodyText()).toContain('Delete this note?');
    const del = [...document.body.querySelectorAll('button')].find((b) => b.textContent === 'Delete');
    await click(del ?? null);
    await waitFor(() => document.body.querySelectorAll('[data-testid="claude-note"]').length === 1, 'one note left');
    expect((await db.coachNotes.toArray()).map((n) => n.text)).toEqual(['Left knee twinges on deep squats']);
  });

  it('says there is nothing remembered, and never prints the key', async () => {
    setApiKey(KEY);
    await mount(createElement(ClaudeSettingsCard));
    await waitFor(() => bodyText().includes('Nothing remembered yet.'), 'the empty notes');
    expect(document.body.innerHTML).not.toContain(KEY);
  });
});

describe('the coach sheet', () => {
  it('sends a message, shows both sides of the thread live, and the lines for what the coach changed', async () => {
    setApiKey(KEY);
    const fake = fakeClaude(
      { content: [toolUse('t1', 'remember', { text: 'Prefers cables' })], stop_reason: 'tool_use' },
      { content: [text('Noted. Cables it is.')] },
    );
    vi.stubGlobal('fetch', fake.fetch);
    await mount(createElement(CoachSheet, { open: true, onClose: () => undefined }));
    await waitFor(() => bodyText().includes('Ask about training or food'), 'the empty thread');

    await typeInto(byTestId<HTMLInputElement>('coach-input'), 'I prefer cables, remember that');
    await click(byTestId('coach-send'));
    await waitFor(() => bodyText().includes('Noted. Cables it is.'), 'the coach\'s reply');

    expect(byTestId('coach-user-bubble')!.textContent).toBe('I prefer cables, remember that');
    expect(byTestId('coach-bubble')!.textContent).toContain('Noted. Cables it is.');
    expect(byTestId('coach-actions')!.textContent).toBe('Noted: Prefers cables');
    expect(byTestId<HTMLInputElement>('coach-input')!.value).toBe('');
    expect(byTestId('coach-error')).toBeNull();
    // The reply is on screen a moment before the store lets go of "busy"; wait for it rather than sample once.
    await waitFor(() => byTestId('coach-busy') === null, 'the busy marker to go');
    expect((await db.coachNotes.toArray()).map((n) => n.text)).toEqual(['Prefers cables']);
  });

  it('shows the plain reason and keeps the typed text when there is no key', async () => {
    clearApiKey();
    const fake = fakeClaude({ content: [text('never sent')] });
    vi.stubGlobal('fetch', fake.fetch);
    await mount(createElement(CoachSheet, { open: true, onClose: () => undefined }));

    await typeInto(byTestId<HTMLInputElement>('coach-input'), 'how was my week?');
    await click(byTestId('coach-send'));
    await waitFor(() => !!byTestId('coach-error'), 'the error line');
    expect(byTestId('coach-error')!.textContent).toBe('Add your Claude key in Settings to use the coach.');
    expect(byTestId<HTMLInputElement>('coach-input')!.value).toBe('how was my week?');
    expect(fake.requests).toHaveLength(0);
    expect(await db.coachMessages.count()).toBe(0);
  });

  it('offers a drafted routine with Save, and hands it to the caller without saving anything itself', async () => {
    setApiKey(KEY);
    const fake = fakeClaude(
      { content: [toolUse('t1', 'build_routine', { request: 'a 40 minute shoulder routine' })], stop_reason: 'tool_use' },
      { content: [text('Draft is ready. Save it if you like it.')] },
    );
    vi.stubGlobal('fetch', fake.fetch);
    const saved = vi.fn();
    const routinesBefore = await db.routines.count();
    await mount(createElement(CoachSheet, { open: true, onClose: () => undefined, onSaveDraft: saved }));

    await typeInto(byTestId<HTMLInputElement>('coach-input'), 'build me a shoulder routine');
    await click(byTestId('coach-send'));
    await waitFor(() => !!byTestId('coach-draft'), 'the draft card');
    expect(byTestId('coach-draft')!.textContent).toContain('Lateral Raise');
    expect(await db.routines.count()).toBe(routinesBefore);

    await click(byTestId('coach-draft-save'));
    expect(saved).toHaveBeenCalledTimes(1);
    expect(saved.mock.calls[0]![0].length).toBeGreaterThan(0);
    expect(byTestId('coach-draft')).toBeNull();
  });

  it('labels the lines the coach volunteered, and hides the microphone where there is none', async () => {
    await db.coachMessages.put({ id: 'm1', at: new Date().toISOString(), role: 'coach', text: 'Welcome back. Legs today?', moment: 'open' });
    await mount(createElement(CoachSheet, { open: true, onClose: () => undefined }));
    await waitFor(() => bodyText().includes('Welcome back. Legs today?'), 'the line');
    expect(bodyText()).toContain('On opening');
    expect(byTestId('coach-mic')).toBeNull();
  });

  it('renders nothing while closed', async () => {
    await mount(createElement(CoachSheet, { open: false, onClose: () => undefined }));
    expect(byTestId('coach-thread')).toBeNull();
  });
});
