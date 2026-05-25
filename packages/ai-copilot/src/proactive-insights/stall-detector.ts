/**
 * Stall detector
 *
 * Watches a rolling window of session activity. If the user stops interacting
 * for longer than the stall threshold, we emit a \"workflow stalled\" signal
 * that the insight engine uses to fire the `workflow_unblock` rule.
 */

export interface StallDetectorConfig {
  readonly thresholdMs: number;
  readonly quietHoursStart?: number;
  readonly quietHoursEnd?: number;
}

export interface ActivitySignal {
  readonly tenantId: string;
  readonly userId: string;
  readonly at: string;
  readonly kind: 'click' | 'keypress' | 'scroll' | 'navigation' | 'submit';
}

export interface StallState {
  readonly tenantId: string;
  readonly userId: string;
  readonly lastActivityAt: string;
  readonly stalled: boolean;
  readonly stallStartedAt?: string;
}

const DEFAULT_THRESHOLD_MS = 45_000;

export class StallDetector {
  private readonly states = new Map<string, StallState>();
  private readonly config: Required<
    Pick<StallDetectorConfig, 'thresholdMs'>
  > & {
    quietHoursStart?: number;
    quietHoursEnd?: number;
  };

  constructor(config: Partial<StallDetectorConfig> = {}) {
    this.config = {
      thresholdMs: config.thresholdMs ?? DEFAULT_THRESHOLD_MS,
      quietHoursStart: config.quietHoursStart,
      quietHoursEnd: config.quietHoursEnd,
    };
  }

  record(signal: ActivitySignal): StallState {
    const key = this.key(signal.tenantId, signal.userId);
    const next: StallState = {
      tenantId: signal.tenantId,
      userId: signal.userId,
      lastActivityAt: signal.at,
      stalled: false,
    };
    this.states.set(key, next);
    return next;
  }

  check(
    tenantId: string,
    userId: string,
    now: Date = new Date(),
  ): StallState | null {
    const key = this.key(tenantId, userId);
    const prev = this.states.get(key);
    if (!prev) return null;
    const age = now.getTime() - new Date(prev.lastActivityAt).getTime();
    if (age <= this.config.thresholdMs) {
      const refreshed: StallState = { ...prev, stalled: false };
      this.states.set(key, refreshed);
      return refreshed;
    }
    if (this.isQuietHours(now)) {
      return { ...prev, stalled: false };
    }
    const stallStartedAt = prev.stalled
      ? prev.stallStartedAt
      : new Date(
          new Date(prev.lastActivityAt).getTime() + this.config.thresholdMs,
        ).toISOString();
    const next: StallState = {
      ...prev,
      stalled: true,
      stallStartedAt,
    };
    this.states.set(key, next);
    return next;
  }

  clear(tenantId: string, userId: string): void {
    this.states.delete(this.key(tenantId, userId));
  }

  private key(tenantId: string, userId: string): string {
    return `${tenantId}::${userId}`;
  }

  private isQuietHours(now: Date): boolean {
    const start = this.config.quietHoursStart;
    const end = this.config.quietHoursEnd;
    if (start === undefined || end === undefined) return false;
    const h = now.getHours();
    if (start < end) return h >= start && h < end;
    return h >= start || h < end;
  }
}
