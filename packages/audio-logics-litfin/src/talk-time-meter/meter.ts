/**
 * Per-minute talk-time meter for outcomes-metering billing.
 *
 * Observe pattern: callers feed each VAD-validated chunk into
 * `observe()`; the meter accumulates per-tenant talk-seconds. `bill()`
 * returns the period totals in a frozen `TalkTimeReading`.
 *
 * Pure-in-memory; instances are immutable from the consumer perspective
 * (each `observe()` returns the new state — never mutates).
 */

import {
  AudioLogicsLitfinError,
  type TalkTimeObservation,
  type TalkTimeReading,
} from '../types.js';

interface MeterTotals {
  readonly tenantTalkSeconds: number;
  readonly agentTalkSeconds: number;
  readonly silenceSeconds: number;
  readonly totalSeconds: number;
}

const EMPTY: MeterTotals = Object.freeze({
  tenantTalkSeconds: 0,
  agentTalkSeconds: 0,
  silenceSeconds: 0,
  totalSeconds: 0,
});

export class TalkTimeMeter {
  private readonly state: Map<string, MeterTotals>;
  private periodStartIso: string;

  constructor(opts: { readonly nowIso?: string } = {}) {
    this.state = new Map();
    this.periodStartIso = opts.nowIso ?? new Date().toISOString();
  }

  /**
   * Record one observation. Returns the *new* totals for the tenant so
   * callers can stream them downstream without re-reading.
   */
  observe(obs: TalkTimeObservation): MeterTotals {
    if (obs.audioMs < 0) {
      throw new AudioLogicsLitfinError(
        `audioMs must be >= 0; got ${obs.audioMs}`,
        'talk-time-bad-audio-ms',
      );
    }
    const seconds = obs.audioMs / 1000;
    const prev = this.state.get(obs.tenantId) ?? EMPTY;

    const next: MeterTotals = {
      tenantTalkSeconds:
        prev.tenantTalkSeconds + (obs.isSpeech && obs.speaker === 'tenant' ? seconds : 0),
      agentTalkSeconds:
        prev.agentTalkSeconds + (obs.isSpeech && obs.speaker === 'agent' ? seconds : 0),
      silenceSeconds: prev.silenceSeconds + (obs.isSpeech ? 0 : seconds),
      totalSeconds: prev.totalSeconds + seconds,
    };
    this.state.set(obs.tenantId, Object.freeze(next));
    return next;
  }

  /**
   * Snapshot the totals for one tenant within the current period.
   * Returns zero-filled reading when the tenant has never been observed.
   */
  bill(tenantId: string, opts: { readonly nowIso?: string } = {}): TalkTimeReading {
    const totals = this.state.get(tenantId) ?? EMPTY;
    return Object.freeze({
      tenantId,
      tenantTalkSeconds: totals.tenantTalkSeconds,
      agentTalkSeconds: totals.agentTalkSeconds,
      silenceSeconds: totals.silenceSeconds,
      totalSeconds: totals.totalSeconds,
      periodStartIso: this.periodStartIso,
      periodEndIso: opts.nowIso ?? new Date().toISOString(),
    });
  }

  /** Reset all counters and start a new period. */
  reset(opts: { readonly nowIso?: string } = {}): void {
    this.state.clear();
    this.periodStartIso = opts.nowIso ?? new Date().toISOString();
  }

  /** List every tenant we have observed in the current period. */
  listObservedTenants(): ReadonlyArray<string> {
    return Object.freeze(Array.from(this.state.keys()));
  }
}
