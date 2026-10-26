/** Receives an error the SDK cannot throw to anyone: a listener, a handler or a state callback that threw. */
export type ErrorHandler = (error: unknown) => void;

/**
 * What happens when nobody configured an `onError`: the error is logged. This is the only place in the library that
 * writes to the console; everything else reports through an `ErrorHandler`.
 */
export const defaultErrorHandler: ErrorHandler = (error) => {
  // eslint-disable-next-line no-console -- the one console call of the library
  console.error('[pokeidle-community-sdk]', error);
};

/** Hands `error` to `onError`. If the handler itself throws, the default handler gets the original error instead: reporting never throws. */
export function report(onError: ErrorHandler, error: unknown): void {
  try {
    onError(error);
  } catch {
    defaultErrorHandler(error);
  }
}

/** Runs `fn`; if it throws, the error is reported and `fn`'s caller carries on. Used wherever one failure must not stop the rest. */
export function guarded(onError: ErrorHandler, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    report(onError, error);
  }
}
