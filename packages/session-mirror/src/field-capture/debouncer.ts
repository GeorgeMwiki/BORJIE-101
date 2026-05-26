/**
 * Generic debouncer + flush controller — extracted from the
 * `useFieldCapture` hook so the timing + flush-on-blur contract can
 * be unit-tested without a React harness.
 *
 * Contract:
 *   - `schedule(value)` resets the timer; the value is held pending
 *     until the timer fires or `flush()` is called.
 *   - `flush()` returns the pending value (and clears it) so the
 *     caller can dispatch synchronously.
 *   - `cancel()` clears the timer and drops the pending value.
 *
 * Lifecycle is owned by the caller — the debouncer does not start
 * timers eagerly. This keeps it test-friendly with fake timers.
 */

const DEFAULT_DEBOUNCE_MS = 500;

export interface DebouncerOptions<TValue> {
  readonly debounceMs?: number;
  readonly onFire: (value: TValue) => void | Promise<void>;
}

export class Debouncer<TValue> {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: { value: TValue } | null = null;
  private readonly debounceMs: number;
  private readonly onFire: (value: TValue) => void | Promise<void>;

  constructor(options: DebouncerOptions<TValue>) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.onFire = options.onFire;
  }

  schedule(value: TValue): void {
    this.pending = { value };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      void this.flush();
    }, this.debounceMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.pending) return;
    const { value } = this.pending;
    this.pending = null;
    try {
      await this.onFire(value);
    } catch (err) {
      console.warn('[session-mirror] debouncer.flush onFire failed:', err);
    }
  }

  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.pending = null;
  }

  /** Test helper — read pending value without firing. */
  __pending(): TValue | null {
    return this.pending?.value ?? null;
  }
}
