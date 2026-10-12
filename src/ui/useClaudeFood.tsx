import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { blockedReason } from '@/ai/client';
import { undoLoggedItems } from '@/db/foodRepo';
import { addDays } from '@/domain/dates';
import { fmtDayKey } from '@/domain/format';
import type { LabelNutrition } from '@/domain/products';
import { blockedLine, logMealPhoto, logMealText, readFailureLine, readLabel, type Cancelled, type FoodReadKind, type ReadLogged } from '@/state/claudeFood';
import { clearMealMoment, noteMealLogged } from '@/state/mealMoment';
import type { AddFoodContext } from './AddFoodSheet';
import { DescribeSheet, LoggedBar, ReadingSheet } from './ClaudeFoodSheets';
import { toast } from './components/Toast';
import { useToday } from './hooks';

export interface UseClaudeFoodOptions {
  /** Open the Add food sheet again where it was left, after a cancel or a failure. */
  reopen: (ctx: AddFoodContext) => void;
  /** A label was read: carry on in the Add food sheet's amount step. */
  onLabel: (ctx: AddFoodContext, label: LabelNutrition) => void;
}

export interface ClaudeFood {
  /** The three handlers `AddFoodSheet` takes. Each returns false when Claude cannot be asked, after saying why. */
  onPhoto: (ctx: AddFoodContext) => void | false;
  onDescribe: (ctx: AddFoodContext) => void | false;
  onSnapLabel: (ctx: AddFoodContext & { barcode?: string }) => void | false;
  /** Everything the handlers render: the camera inputs, the reading and describe sheets, the Undo bar. Mount once. */
  host: ReactNode;
}

/** The job in flight: set to cancelled by the owner backing out, and what to bring back when it ends badly. */
interface Job {
  cancelled: boolean;
  resume: () => void;
}

const READING: Record<FoodReadKind, string> = {
  photo: 'Reading your photo…',
  describe: 'Reading what you ate…',
  label: 'Reading the label…',
};

/**
 * Claude doing the typing for the Add food sheet. A photo of the meal, a sentence about it or a
 * photo of a label is read and the food goes straight onto the day (a label carries on to the amount
 * step instead, since only the owner knows how much of the pack they ate). The owner sees "Reading
 * your photo…" with a Cancel, then an Undo bar with Adjust; nothing asks to be confirmed.
 *
 * The camera is a plain file input with `capture`, which opens the camera in the Android WebView
 * and takes a file in a browser. It is clicked inside the tap that chose Camera, which is what lets
 * the browser allow it, so the input lives in `host`, outside the sheet that closes.
 */
export function useClaudeFood({ reopen, onLabel }: UseClaudeFoodOptions): ClaudeFood {
  const nav = useNavigate();
  const today = useToday();
  const photoInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const photoCtx = useRef<AddFoodContext | null>(null);
  const labelCtx = useRef<(AddFoodContext & { barcode?: string }) | null>(null);
  const job = useRef<Job | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [describing, setDescribing] = useState<{ ctx: AddFoodContext; text: string } | null>(null);
  const [bar, setBar] = useState<ReadLogged | null>(null);

  // Leaving the screen mid-read is a cancel: nothing is logged behind the owner's back.
  useEffect(
    () => () => {
      if (job.current) job.current.cancelled = true;
    },
    [],
  );

  // Backing out of the camera (where the browser says so) brings the Add food sheet back.
  const reopenRef = useRef(reopen);
  useEffect(() => {
    reopenRef.current = reopen;
  });
  useEffect(() => {
    const photo = photoInput.current;
    const label = labelInput.current;
    const onPhotoCancel = () => photoCtx.current && reopenRef.current(photoCtx.current);
    const onLabelCancel = () => labelCtx.current && reopenRef.current(labelCtx.current);
    photo?.addEventListener('cancel', onPhotoCancel);
    label?.addEventListener('cancel', onLabelCancel);
    return () => {
      photo?.removeEventListener('cancel', onPhotoCancel);
      label?.removeEventListener('cancel', onLabelCancel);
    };
  }, []);

  /** Say why Claude cannot be asked, instead of opening a camera that would lead nowhere. */
  const explained = (what: FoodReadKind): boolean => {
    const line = blockedLine(what);
    if (!line) return false;
    toast(line, 'neutral', blockedReason() === 'no_key' ? { label: 'Settings', onClick: () => nav('/settings') } : undefined);
    return true;
  };

  /** Run a reading behind the "Reading…" sheet. `work` resolves null when it saw the cancel. */
  const run = async <T,>(
    what: FoodReadKind,
    resume: () => void,
    work: (cancelled: Cancelled) => Promise<T | null>,
    finish: (result: T) => void,
    discard?: (result: T) => Promise<void>,
  ): Promise<void> => {
    const token: Job = { cancelled: false, resume };
    job.current = token;
    setBusy(READING[what]);
    try {
      const result = await work(() => token.cancelled);
      if (result === null) return;
      if (token.cancelled) {
        // The cancel landed while the food was being written: take it back out.
        await discard?.(result);
        return;
      }
      finish(result);
    } catch (e) {
      if (token.cancelled) return;
      toast(readFailureLine(e, what), 'danger');
      resume();
    } finally {
      if (job.current === token) {
        job.current = null;
        setBusy(null);
      }
    }
  };

  const cancel = () => {
    const token = job.current;
    if (!token) return;
    token.cancelled = true;
    job.current = null;
    setBusy(null);
    token.resume();
  };

  const logged = (result: ReadLogged) => {
    setBar(result);
    noteMealLogged({ mealId: result.logged.mealId, itemIds: result.logged.itemIds });
  };
  const takeBack = (result: ReadLogged) => undoLoggedItems(result.logged);

  const onPhoto = (ctx: AddFoodContext): void | false => {
    if (explained('photo')) return false;
    photoCtx.current = ctx;
    photoInput.current?.click();
  };

  const onDescribe = (ctx: AddFoodContext): void | false => {
    if (explained('describe')) return false;
    setDescribing({ ctx, text: '' });
  };

  const onSnapLabel = (ctx: AddFoodContext & { barcode?: string }): void | false => {
    if (explained('label')) return false;
    labelCtx.current = ctx;
    labelInput.current?.click();
  };

  const photoPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // the same photo taken again must still fire change
    const ctx = photoCtx.current;
    if (!file || !ctx) return;
    void run('photo', () => reopen(ctx), (cancelled) => logMealPhoto(file, ctx, cancelled), logged, takeBack);
  };

  const labelPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const ctx = labelCtx.current;
    if (!file || !ctx) return;
    void run('label', () => reopen(ctx), (cancelled) => readLabel(file, ctx.barcode, cancelled), (label) => onLabel(ctx, label));
  };

  const submitDescription = () => {
    const d = describing;
    if (!d || !d.text.trim()) return;
    setDescribing(null);
    void run('describe', () => setDescribing(d), (cancelled) => logMealText(d.text, d.ctx, cancelled), logged, takeBack);
  };

  const undo = () => {
    const log = bar;
    setBar(null);
    if (!log) return;
    clearMealMoment();
    undoLoggedItems(log.logged)
      .then(() => toast('Removed'))
      .catch(() => toast('Could not undo', 'danger'));
  };

  const adjust = () => {
    const log = bar;
    setBar(null);
    if (log) nav(`/food/${log.logged.mealId}`);
  };

  const host = (
    <>
      <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={photoPicked} data-testid="claude-photo-input" aria-label="Photo of your meal" />
      <input ref={labelInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={labelPicked} data-testid="claude-label-input" aria-label="Photo of the label" />
      {busy && <ReadingSheet text={busy} onCancel={cancel} />}
      {describing && (
        <DescribeSheet
          where={`${describing.ctx.slot[0]!.toUpperCase()}${describing.ctx.slot.slice(1)} · ${fmtDayKey(describing.ctx.date, today, addDays(today, -1))}`}
          text={describing.text}
          onText={(text) => setDescribing((d) => (d ? { ...d, text } : d))}
          onSubmit={submitDescription}
          onClose={() => setDescribing(null)}
        />
      )}
      {bar && <LoggedBar log={bar} onUndo={undo} onAdjust={adjust} onDone={() => setBar(null)} />}
    </>
  );

  return { onPhoto, onDescribe, onSnapLabel, host };
}
