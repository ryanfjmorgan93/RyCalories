/**
 * A wait that gives up when the model goes quiet. Shared by the coach and by the short-session
 * sheet's "Read with assistant", neither of which may wait on a model for ever.
 */

export const NO_ANSWER = 'The model did not answer.';

/** `start`'s promise, rejected if `touch` is not called for `ms` — measured from the start and from each touch. */
export function untilQuiet<T>(ms: number, start: (touch: () => void) => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let timer = setTimeout(() => reject(new Error(NO_ANSWER)), ms);
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => reject(new Error(NO_ANSWER)), ms);
    };
    start(touch).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
