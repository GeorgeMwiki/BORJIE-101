/**
 * Debounce-throttle helper for live coaching. The host invokes
 * `coach()` on every keystroke; the throttle ensures the underlying
 * coach is called at most once per `intervalMs`. Trailing-edge
 * invocation — the LAST submitted args are the ones that run.
 *
 * Pure timer logic, no DOM bindings; works equally in Node and
 * browser. Tests fake the clock via `now`.
 */
export interface ThrottleOptions<TArgs, TResult> {
  /** Underlying function to throttle. */
  readonly fn: (args: TArgs) => Promise<TResult>;
  /** Minimum spacing between successful invocations, in ms. */
  readonly intervalMs?: number;
  /** Test seam for clock; defaults to Date.now. */
  readonly now?: () => number;
  /** Test seam for setTimeout; defaults to globalThis.setTimeout. */
  readonly schedule?: (cb: () => void, ms: number) => void;
}

export interface ThrottledCoach<TArgs, TResult> {
  /** Submit new args. Returns a promise resolving with the eventual result. */
  invoke(args: TArgs): Promise<TResult>;
  /** Cancel any pending invocation. */
  cancel(): void;
  /** Force-run the currently pending args (if any) now. */
  flush(): Promise<TResult | undefined>;
}

const DEFAULT_INTERVAL_MS = 500;

export function createThrottledCoach<TArgs, TResult>(
  options: ThrottleOptions<TArgs, TResult>,
): ThrottledCoach<TArgs, TResult> {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ??
    ((cb: () => void, ms: number) => {
      setTimeout(cb, ms);
    });

  let pendingArgs: TArgs | undefined;
  let pendingPromise: Promise<TResult> | undefined;
  let pendingResolve: ((value: TResult | PromiseLike<TResult>) => void) | undefined;
  let pendingReject: ((reason?: unknown) => void) | undefined;
  let timerScheduled = false;
  let lastInvocationAt = 0;

  function clearPending(): void {
    pendingArgs = undefined;
    pendingPromise = undefined;
    pendingResolve = undefined;
    pendingReject = undefined;
    timerScheduled = false;
  }

  async function run(): Promise<void> {
    const args = pendingArgs;
    const resolve = pendingResolve;
    const reject = pendingReject;
    clearPending();
    if (!args || !resolve) return;
    lastInvocationAt = now();
    try {
      const result = await options.fn(args);
      resolve(result);
    } catch (err) {
      reject?.(err);
    }
  }

  return {
    invoke(args: TArgs): Promise<TResult> {
      pendingArgs = args;
      if (!pendingPromise) {
        pendingPromise = new Promise<TResult>((resolve, reject) => {
          pendingResolve = resolve;
          pendingReject = reject;
        });
      }
      if (!timerScheduled) {
        timerScheduled = true;
        const elapsed = now() - lastInvocationAt;
        const wait = Math.max(0, intervalMs - elapsed);
        schedule(() => {
          void run();
        }, wait);
      }
      return pendingPromise;
    },
    cancel(): void {
      const reject = pendingReject;
      clearPending();
      reject?.(new Error('throttled-coach: cancelled'));
    },
    async flush(): Promise<TResult | undefined> {
      if (!pendingArgs) return undefined;
      const promise = pendingPromise;
      await run();
      return promise;
    },
  };
}
