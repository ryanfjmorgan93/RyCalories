import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button';

/** Bottom sheet. Tap the scrim or swipe-handle area to close. Locks body scroll while open. */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="sheet-in relative max-h-[92dvh] rounded-t-3xl bg-surface border-t border-line flex flex-col">
        <button type="button" aria-label="Close" onClick={onClose} className="flex w-full justify-center pt-2 pb-1">
          <span className="h-1.5 w-12 rounded-full bg-line" />
        </button>
        {title && <div className="px-5 pb-2 pt-1 text-lg font-bold">{title}</div>}
        <div className="overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="border-t border-line px-5 pt-3 pb-safe">{footer}<div className="h-3" /></div>}
        {!footer && <div className="pb-safe" />}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmProps {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({ open, title, body, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger, onConfirm, onCancel }: ConfirmProps) {
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      {body && <div className="text-muted">{body}</div>}
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Button size="lg" variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button size="lg" variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Sheet>
  );
}
