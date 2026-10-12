import { create } from 'zustand';

/** A button on a toast — "Undo". Tapping it runs `onClick` and dismisses the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastState {
  message: string | null;
  tone: 'neutral' | 'ok' | 'danger';
  id: number;
  action: ToastAction | null;
  show: (message: string, tone?: ToastState['tone'], action?: ToastAction) => void;
  clear: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'neutral',
  id: 0,
  action: null,
  show: (message, tone = 'neutral', action) => set((s) => ({ message, tone, id: s.id + 1, action: action ?? null })),
  clear: () => set({ message: null, action: null }),
}));

let timer: number | undefined;

/** A plain toast lives this long; one with an action lives longer, because it has to be reached. */
const TOAST_MS = 2200;
const ACTION_TOAST_MS = 7000;

export function toast(message: string, tone: ToastState['tone'] = 'neutral', action?: ToastAction): void {
  useToast.getState().show(message, tone, action);
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => useToast.getState().clear(), action ? ACTION_TOAST_MS : TOAST_MS);
}

export function ToastHost() {
  const { message, tone, id, action } = useToast();
  if (!message) return null;
  const tint = tone === 'ok' ? 'glass-fixed-ok text-ok' : tone === 'danger' ? 'glass-fixed-danger text-danger' : 'text-fg';
  return (
    <div key={id} className="toast-in bottom-toast pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4" data-testid="toast">
      <div className={`glass-fixed flex items-center gap-1 rounded-pill border text-sm font-bold ${action ? 'pointer-events-auto py-0.5 pl-4 pr-1' : 'px-4 py-2'} ${tint}`}>
        <span>{message}</span>
        {action && (
          // A 44 px target: the toast is only on screen for seconds, and a missed Undo is a logged
          // food the owner did not want.
          <button
            type="button"
            data-testid="toast-action"
            onClick={() => {
              useToast.getState().clear();
              action.onClick();
            }}
            className="ml-2 inline-flex h-11 min-w-11 items-center justify-center rounded-pill px-3 text-accent active:bg-surface-2"
          >
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
