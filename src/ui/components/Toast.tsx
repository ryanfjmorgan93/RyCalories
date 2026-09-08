import { create } from 'zustand';

interface ToastState {
  message: string | null;
  tone: 'neutral' | 'ok' | 'danger';
  id: number;
  show: (message: string, tone?: ToastState['tone']) => void;
  clear: () => void;
}

export const useToast = create<ToastState>((set) => ({
  message: null,
  tone: 'neutral',
  id: 0,
  show: (message, tone = 'neutral') => set((s) => ({ message, tone, id: s.id + 1 })),
  clear: () => set({ message: null }),
}));

let timer: number | undefined;

export function toast(message: string, tone: ToastState['tone'] = 'neutral'): void {
  useToast.getState().show(message, tone);
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => useToast.getState().clear(), 2200);
}

export function ToastHost() {
  const { message, tone, id } = useToast();
  if (!message) return null;
  const color = tone === 'ok' ? 'bg-ok text-ok-fg' : tone === 'danger' ? 'bg-danger text-bg' : 'bg-fg text-bg';
  return (
    <div key={id} className="toast-in pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4 pb-safe">
      <div className={`rounded-full px-4 py-2 text-sm font-bold shadow-lg ${color}`}>{message}</div>
    </div>
  );
}
