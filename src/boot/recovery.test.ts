/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { renderRecovery } from './recovery';

describe('boot recovery screen', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('replaces a blank page with an actionable screen naming the failure', () => {
    renderRecovery(new Error('UpgradeError: migration failed'), 2);
    const root = document.getElementById('root')!;
    expect(root.textContent).toContain('Iron could not start');
    expect(root.textContent).toContain('Your data has not been changed');
    const pre = root.querySelector('pre')!;
    expect(pre.textContent).toContain('Database: iron');
    expect(pre.textContent).toContain('Attempted version: 2');
    expect(pre.textContent).toContain('UpgradeError: migration failed');
  });

  it('offers a rescue path and a way to report the error', () => {
    renderRecovery(new Error('boom'), 2);
    const labels = [...document.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toContain('Export raw backup');
    expect(labels).toContain('Copy error details');
  });

  it('survives a non-Error rejection without throwing', () => {
    expect(() => renderRecovery('a bare string', 2)).not.toThrow();
    expect(document.getElementById('root')!.textContent).toContain('a bare string');
  });

  it('does nothing when there is no root element to render into', () => {
    document.body.innerHTML = '';
    expect(() => renderRecovery(new Error('x'), 2)).not.toThrow();
  });
});
