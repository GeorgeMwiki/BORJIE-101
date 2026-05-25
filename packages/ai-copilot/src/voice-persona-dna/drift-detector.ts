/**
 * Persona drift detector — Wave 28.
 *
 * Many quality regressions happen silently: model upgrade, prompt
 * edit, or a new few-shot slipped into the pipeline nudges the voice
 * away from its pinned DNA. No single sample looks wrong, but the
 * rolling average quietly drops below the acceptable band.
 *
 * The detector keeps an in-memory ring-buffer of the most recent
 * `windowSize` persona-fit scores per (tenantId, personaId) pair. When
 * the rolling mean dips below the configured `threshold` it emits an
 * alert.
 *
 * This module stays storage-agnostic: wire it to a durable store by
 * passing a `PersonaFitStore` (not exposed in this PR — the detector
 * keeps a Map internally so the integration path is a single
 * refactor when/if we need it).
 */

import type {
  PersonaDriftAlert,
  PersonaFitSample,
} from './types.js';

export interface PersonaDriftDetectorOptions {
  /** Size of the rolling window. Defaults to 20 samples. */
  readonly windowSize?: number;
  /** Rolling-mean threshold below which drift is flagged. 0-1. */
  readonly threshold?: number;
  /** Time source; tests inject a fake clock. */
  readonly now?: () => number;
}

interface InternalRing {
  readonly samples: PersonaFitSample[];
  lastAlertAt: number | null;
}

export interface PersonaDriftDetector {
  record(sample: PersonaFitSample): PersonaDriftAlert | null;
  getRecent(tenantId: string, personaId: string): readonly PersonaFitSample[];
  clear(tenantId?: string): void;
  readonly windowSize: number;
  readonly threshold: number;
}

const DEFAULT_WINDOW_SIZE = 20;
const DEFAULT_THRESHOLD = 0.65;
// Don't re-fire more than once per 60 seconds per (tenant, persona).
const ALERT_COOLDOWN_MS = 60_000;

export function createPersonaDriftDetector(
  opts: PersonaDriftDetectorOptions = {},
): PersonaDriftDetector {
  const windowSize = opts.windowSize ?? DEFAULT_WINDOW_SIZE;
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const now = opts.now ?? (() => Date.now());

  if (windowSize < 3) {
    throw new Error('persona-drift-detector: windowSize must be >= 3');
  }
  if (threshold <= 0 || threshold >= 1) {
    throw new Error('persona-drift-detector: threshold must be in (0, 1)');
  }

  const buffers = new Map<string, InternalRing>();

  function keyFor(tenantId: string, personaId: string): string {
    return `${tenantId}::${personaId}`;
  }

  function getOrInit(key: string): InternalRing {
    const existing = buffers.get(key);
    if (existing) return existing;
    const fresh: InternalRing = { samples: [], lastAlertAt: null };
    buffers.set(key, fresh);
    return fresh;
  }

  function record(sample: PersonaFitSample): PersonaDriftAlert | null {
    const key = keyFor(sample.tenantId, sample.personaId);
    const ring = getOrInit(key);

    // Append immutably — create a new array so callers can freely share
    // snapshots without worrying about mutation.
    const nextSamples = [...ring.samples, sample];
    while (nextSamples.length > windowSize) nextSamples.shift();
    buffers.set(key, { samples: nextSamples, lastAlertAt: ring.lastAlertAt });

    // Wait until the buffer is full before alerting — a drift signal
    // must reflect the full rolling window, not a premature partial
    // one. The first `windowSize - 1` samples therefore never trigger.
    if (nextSamples.length < windowSize) {
      return null;
    }

    const mean =
      nextSamples.reduce((acc, s) => acc + s.score, 0) / nextSamples.length;
    if (mean >= threshold) return null;

    const ts = now();
    if (
      ring.lastAlertAt !== null &&
      ts - ring.lastAlertAt < ALERT_COOLDOWN_MS
    ) {
      return null;
    }

    buffers.set(key, {
      samples: nextSamples,
      lastAlertAt: ts,
    });

    return {
      tenantId: sample.tenantId,
      personaId: sample.personaId,
      windowSize: nextSamples.length,
      averageScore: mean,
      threshold,
      triggeredAt: ts,
    };
  }

  function getRecent(
    tenantId: string,
    personaId: string,
  ): readonly PersonaFitSample[] {
    const ring = buffers.get(keyFor(tenantId, personaId));
    if (!ring) return [];
    return [...ring.samples];
  }

  function clear(tenantId?: string): void {
    if (!tenantId) {
      buffers.clear();
      return;
    }
    for (const k of Array.from(buffers.keys())) {
      if (k.startsWith(`${tenantId}::`)) buffers.delete(k);
    }
  }

  return {
    record,
    getRecent,
    clear,
    windowSize,
    threshold,
  };
}
