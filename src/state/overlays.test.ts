import { afterEach, describe, expect, it } from 'vitest';
import {
  closeTopSheet,
  handleBack,
  openSheetCount,
  popBackAction,
  popSheet,
  pushBackAction,
  pushSheet,
  runBackAction,
  type BackAction,
  type SheetHandle,
} from './overlays';

const opened: SheetHandle[] = [];
const actions: BackAction[] = [];

function open(log: string[], name: string): SheetHandle {
  const h = { close: () => log.push(name) };
  pushSheet(h);
  opened.push(h);
  return h;
}

function arrow(log: string[], name: string): BackAction {
  const a = { run: () => log.push(name) };
  pushBackAction(a);
  actions.push(a);
  return a;
}

afterEach(() => {
  opened.splice(0).forEach(popSheet);
  actions.splice(0).forEach(popBackAction);
});

describe('sheet stack', () => {
  it('closes only the topmost sheet', () => {
    const log: string[] = [];
    open(log, 'editor');
    open(log, 'confirm');
    expect(closeTopSheet()).toBe(true);
    expect(log).toEqual(['confirm']);
  });

  it('reports false with nothing open', () => {
    expect(openSheetCount()).toBe(0);
    expect(closeTopSheet()).toBe(false);
  });

  it('a sheet leaving from the middle keeps the order of the rest', () => {
    const log: string[] = [];
    open(log, 'a');
    const b = open(log, 'b');
    open(log, 'c');
    popSheet(b);
    closeTopSheet();
    expect(log).toEqual(['c']);
    popSheet(opened[2]!);
    closeTopSheet();
    expect(log).toEqual(['c', 'a']);
  });

  it('runs the close the owner holds now, not the one it was pushed with', () => {
    const log: string[] = [];
    const h = open(log, 'first render');
    h.close = () => log.push('latest render');
    closeTopSheet();
    expect(log).toEqual(['latest render']);
  });

  it('popping a handle that is not open changes nothing', () => {
    const log: string[] = [];
    open(log, 'a');
    popSheet({ close: () => log.push('stranger') });
    expect(openSheetCount()).toBe(1);
  });
});

describe('back actions', () => {
  it('runs the newest screen back arrow', () => {
    const log: string[] = [];
    arrow(log, 'old screen');
    arrow(log, 'new screen');
    expect(runBackAction()).toBe(true);
    expect(log).toEqual(['new screen']);
  });

  it('reports false on a screen with no back arrow', () => {
    expect(runBackAction()).toBe(false);
  });
});

describe('handleBack', () => {
  it('a sheet comes before the screen', () => {
    const log: string[] = [];
    arrow(log, 'screen');
    open(log, 'sheet');
    expect(handleBack()).toBe('sheet');
    expect(log).toEqual(['sheet']);
  });

  it('with no sheet open, the screen back arrow runs', () => {
    const log: string[] = [];
    arrow(log, 'screen');
    expect(handleBack()).toBe('screen');
    expect(log).toEqual(['screen']);
  });

  it('nothing to do on a root screen with no sheet', () => {
    expect(handleBack()).toBe('none');
  });
});
