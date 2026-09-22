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
  const tint = tone === 'ok' ? 'glass-fixed-ok text-ok' : tone === 'danger' ? 'glass-fixed-danger text-danger' : 'text-fg';
  return (
    <div key={id} className="toast-in bottom-toast pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4">
      <div className={`glass-fixed rounded-pill border px-4 py-2 text-sm font-bold ${tint}`}>{message}</div>
    </div>
  );
}
