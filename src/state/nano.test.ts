/**
 * @vitest-environment jsdom
 *
 * jsdom (not the default `node` environment) because NanoWeb reads the global `window` for the
 * Playwright test hook (`window.__ironNanoFake`) — see nano.ts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Nano, describeAnalyzeMealError, type NanoAnalyzeOptions } from './nano';

function setFake(fake: unknown) {
  (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake = fake;
}

afterEach(() => {
  delete (window as unknown as { __ironNanoFake?: unknown }).__ironNanoFake;
});

const opts: NanoAnalyzeOptions = {
  path: 'file:///cache/meal-photos/a.jpg',
  system: 'Name the ingredients.',
  prompt: 'What is in this meal?',
};

describe('Nano.analyzeMeal (web)', () => {
  it('throws when no test fake is installed — analyzeMeal is Android-only', async () => {
    await expect(Nano.analyzeMeal(opts)).rejects.toThrow('Only on the Android app.');
  });

  it('throws when a fake is installed but does not implement analyzeMeal', async () => {
    setFake({ status: { state: 'ready', detail: 'AVAILABLE' }, generate: async () => ({ text: '' }) });

    await expect(Nano.analyzeMeal(opts)).rejects.toThrow('Only on the Android app.');
  });

  it('delegates to window.__ironNanoFake.analyzeMeal when present, passing the options through unchanged', async () => {
    let received: NanoAnalyzeOptions | undefined;
    setFake({
      status: { state: 'ready', detail: 'AVAILABLE' },
      generate: async () => ({ text: '' }),
      analyzeMeal: async (o: NanoAnalyzeOptions) => {
        received = o;
        return { text: '{"dish":"Omelette","ingredients":["egg","cheddar","bacon"]}' };
      },
    });

    const result = await Nano.analyzeMeal(opts);

    expect(result).toEqual({ text: '{"dish":"Omelette","ingredients":["egg","cheddar","bacon"]}' });
    expect(received).toEqual(opts);
  });
});

describe('describeAnalyzeMealError', () => {
  it('returns the ML Kit error name from data.genAiError when the plugin supplied one', () => {
    const rejection = Object.assign(new Error('analyze_failed: image was not decodable'), {
      code: 'analyze_failed',
      data: { genAiErrorCode: -102, genAiError: 'INVALID_INPUT_IMAGE' },
    });

    expect(describeAnalyzeMealError(rejection)).toBe('INVALID_INPUT_IMAGE');
  });

  it('prefers data.genAiError over the message even when both are present', () => {
    const rejection = { message: 'generate_failed: boom', data: { genAiError: 'BUSY' } };

    expect(describeAnalyzeMealError(rejection)).toBe('BUSY');
  });

  it('falls back to the message when there is no genAiError data (bad_request / decode_failed rejects)', () => {
    const rejection = Object.assign(new Error('bad_request: path is required'), { code: 'bad_request' });

    expect(describeAnalyzeMealError(rejection)).toBe('bad_request: path is required');
  });

  it('falls back to the message when data.genAiError is present but not a usable string', () => {
    const rejection = Object.assign(new Error('decode_failed: could not decode image'), {
      data: { genAiErrorCode: undefined, genAiError: '' },
    });

    expect(describeAnalyzeMealError(rejection)).toBe('decode_failed: could not decode image');
  });

  it('falls back to a plain Error message when there is no data at all', () => {
    expect(describeAnalyzeMealError(new Error('Only on the Android app.'))).toBe('Only on the Android app.');
  });

  it('returns a thrown string as-is', () => {
    expect(describeAnalyzeMealError('binder died')).toBe('binder died');
  });

  it('stringifies a non-Error, non-string, dataless value rather than discarding it', () => {
    expect(describeAnalyzeMealError(404)).toBe('404');
    expect(describeAnalyzeMealError(null)).toBe('null');
    expect(describeAnalyzeMealError(undefined)).toBe('undefined');
  });
});
