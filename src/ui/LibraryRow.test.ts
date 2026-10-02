// @vitest-environment jsdom
import { act, createElement, useCallback, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExerciseListRow } from '@/domain/library';
import type { Exercise } from '@/domain/types';
import { LibraryRow } from './LibraryRow';

// What a row draws first is its picture, so how many times the pictures are asked to draw is how many
// times rows were drawn. The real component runs; only its one expensive child is counted.
const thumbs = vi.hoisted(() => ({ draws: 0 }));
vi.mock('./DemoThumb', () => ({
  DemoThumb: () => {
    thumbs.draws++;
    return null;
  },
}));

const globals = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

function libraryRow(n: number): ExerciseListRow {
  return { key: `lib-${n}`, name: `Library ${n}`, muscleGroup: 'chest', muscleLabel: 'chest', equipment: 'cable', owned: false, pictureKey: `lib-${n}` };
}
function ownedRow(n: number): ExerciseListRow {
  const exercise: Exercise = { id: `own-${n}`, name: `Owned ${n}`, kind: 'reps', muscleGroup: 'chest', isCompound: false, isLowerBody: false, defaultRestSec: 75, defaultIncrement: 2.5, unilateral: false, createdAt: '2026-01-01T00:00:00.000Z' };
  return { key: exercise.id, name: exercise.name, muscleGroup: 'chest', muscleLabel: 'chest', equipment: '', owned: true, exercise, pictureKey: undefined };
}

/** The screen's own shape: a parent with state of its own (the preview opening, a keystroke) and stable handlers. */
let setUnrelated: (n: number) => void = () => undefined;
function Screen({ rows, stableHandlers = true }: { rows: ExerciseListRow[]; stableHandlers?: boolean }) {
  const [, setN] = useState(0);
  setUnrelated = setN;
  const stableOpen = useCallback((_id: string) => undefined, []);
  const stablePreview = useCallback((_row: ExerciseListRow) => undefined, []);
  return createElement(
    'div',
    null,
    rows.map((row, i) =>
      createElement(LibraryRow, {
        key: row.key,
        row,
        first: i === 0,
        onOpenOwned: stableHandlers ? stableOpen : (_id: string) => undefined,
        onPreview: stableHandlers ? stablePreview : (_row: ExerciseListRow) => undefined,
      }),
    ),
  );
}

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  thumbs.draws = 0;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('LibraryRow', () => {
  const rows = [ownedRow(1), ownedRow(2), ...Array.from({ length: 40 }, (_, i) => libraryRow(i))];

  it('is drawn once per row, and again for none of them when the screen has a state change of its own', () => {
    act(() => root.render(createElement(Screen, { rows })));
    expect(thumbs.draws).toBe(rows.length);
    expect(host.querySelectorAll('[data-testid^="exercise-row-"]')).toHaveLength(rows.length);

    // The preview opening, a keystroke, a scope toggle: the parent draws again, the rows do not.
    for (let i = 1; i <= 3; i++) act(() => setUnrelated(i));
    expect(thumbs.draws).toBe(rows.length);
  });

  it('draws again only the row that changed', () => {
    act(() => root.render(createElement(Screen, { rows })));
    thumbs.draws = 0;
    const next = [...rows];
    next[10] = { ...rows[10]!, name: 'Renamed in place' };
    act(() => root.render(createElement(Screen, { rows: next })));
    expect(thumbs.draws).toBe(1);
    expect(host.textContent).toContain('Renamed in place');
  });

  it('draws every row again when its handlers are new each time: the screen must keep them stable', () => {
    act(() => root.render(createElement(Screen, { rows, stableHandlers: false })));
    thumbs.draws = 0;
    act(() => setUnrelated(1));
    expect(thumbs.draws).toBe(rows.length);
  });

  it('puts a divider above every row but the first, and labels the library\'s rows only', () => {
    act(() => root.render(createElement(Screen, { rows: [libraryRow(1), ownedRow(2), libraryRow(3)] })));
    const dividers = Array.from(host.querySelectorAll('.bg-line'));
    expect(dividers).toHaveLength(2);
    // The first divider comes after the first row, never before it.
    const firstRow = host.querySelector('[data-testid="exercise-row-lib-1"]')!;
    expect(firstRow.compareDocumentPosition(dividers[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(host.querySelectorAll('[data-testid="library-label"]')).toHaveLength(2);
  });

  it('opens the owner\'s exercise by id and a library row by itself, each through its own handler', () => {
    const opened: string[] = [];
    const previewed: string[] = [];
    act(() =>
      root.render(
        createElement('div', null, [
          createElement(LibraryRow, { key: 'a', row: ownedRow(1), first: true, onOpenOwned: (id: string) => opened.push(id), onPreview: (r: ExerciseListRow) => previewed.push(r.key) }),
          createElement(LibraryRow, { key: 'b', row: libraryRow(2), first: false, onOpenOwned: (id: string) => opened.push(id), onPreview: (r: ExerciseListRow) => previewed.push(r.key) }),
        ]),
      ),
    );
    act(() => (host.querySelector('[data-testid="exercise-row-own-1"]') as HTMLElement).click());
    act(() => (host.querySelector('[data-testid="exercise-row-lib-2"]') as HTMLElement).click());
    expect(opened).toEqual(['own-1']);
    expect(previewed).toEqual(['lib-2']);
  });
});
