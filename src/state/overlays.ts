/**
 * What "back" means right now, in one place, for the Android back gesture and for Escape.
 *
 * - Open sheets form a stack. Back (and Escape) closes the topmost one only — a Confirm stacked
 *   on an editor closes, the editor stays. Before this, every sheet listened for Escape itself,
 *   so one press closed both.
 * - With no sheet open, back does what the screen's own back arrow does. The TopBar registers
 *   its arrow here, guard and all (an unsaved meal asks first), so the gesture and the arrow can
 *   never disagree.
 * - With neither, `handleBack` reports 'none' and the caller minimises the app, as Android does
 *   on a root screen.
 *
 * Entries are boxes whose `close` / `run` field the owner refreshes every render, so a stale
 * closure from an earlier render is never what runs.
 */

export interface SheetHandle {
  close: () => void;
}

export interface BackAction {
  run: () => void;
}

const sheets: SheetHandle[] = [];
const backActions: BackAction[] = [];

export function pushSheet(handle: SheetHandle): void {
  ensureEscapeListener();
  sheets.push(handle);
}

export function popSheet(handle: SheetHandle): void {
  const i = sheets.lastIndexOf(handle);
  if (i !== -1) sheets.splice(i, 1);
}

export function openSheetCount(): number {
  return sheets.length;
}

/** Closes the topmost open sheet. False when none is open. */
export function closeTopSheet(): boolean {
  const top = sheets[sheets.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function pushBackAction(action: BackAction): void {
  backActions.push(action);
}

export function popBackAction(action: BackAction): void {
  const i = backActions.lastIndexOf(action);
  if (i !== -1) backActions.splice(i, 1);
}

/** Runs the current screen's back arrow. False when the screen has none (a tab's root). */
export function runBackAction(): boolean {
  const top = backActions[backActions.length - 1];
  if (!top) return false;
  top.run();
  return true;
}

/** One press of back: the top sheet, else the screen's back arrow, else nothing here to do. */
export function handleBack(): 'sheet' | 'screen' | 'none' {
  if (closeTopSheet()) return 'sheet';
  if (runBackAction()) return 'screen';
  return 'none';
}

let escapeListening = false;
function ensureEscapeListener(): void {
  if (escapeListening || typeof window === 'undefined') return;
  escapeListening = true;
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !e.defaultPrevented) closeTopSheet();
  });
}
