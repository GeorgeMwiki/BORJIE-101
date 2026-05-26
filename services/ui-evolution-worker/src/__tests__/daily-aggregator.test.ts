import { describe, expect, it } from 'vitest';
import { aggregateRecipe, makeWindow } from '../aggregator/daily-aggregator.js';
import type { TelemetryEvent } from '../types.js';

const NOW = '2026-05-15T00:00:00.000Z';

function event(over: Partial<TelemetryEvent>): TelemetryEvent {
  return {
    id: 'e-' + (over.id ?? Math.random().toString(36).slice(2, 8)),
    tenantId: over.tenantId ?? 't1',
    tabRecipeId: over.tabRecipeId ?? 'buyer_kyb_start',
    tabRecipeVersion: over.tabRecipeVersion ?? 1,
    sessionId: over.sessionId ?? null,
    fieldId: over.fieldId ?? null,
    eventKind: over.eventKind ?? 'render',
    recordedAt: over.recordedAt ?? '2026-05-10T12:00:00.000Z',
  };
}

describe('makeWindow', () => {
  it('produces ISO bounds with start = now - days', () => {
    const w = makeWindow(NOW, 14);
    const start = new Date(w.startIso).getTime();
    const end = new Date(w.endIso).getTime();
    expect(end - start).toBeCloseTo(14 * 86_400_000, -3);
  });

  it('throws on invalid nowIso', () => {
    expect(() => makeWindow('not-a-date', 14)).toThrow();
  });
});

describe('aggregateRecipe', () => {
  it('pulls both short + long windows from the reader', async () => {
    const calls: Array<{ since: string; until: string }> = [];
    const events: TelemetryEvent[] = [
      event({ eventKind: 'render' }),
      event({ eventKind: 'submit', sessionId: 's1' }),
    ];
    const reader = {
      async readEventsForRecipe({ sinceIso, untilIso }: { sinceIso: string; untilIso: string }) {
        calls.push({ since: sinceIso, until: untilIso });
        return events;
      },
    };

    const out = await aggregateRecipe({
      tabRecipeId: 'buyer_kyb_start',
      tabRecipeVersion: 1,
      shortWindow: makeWindow(NOW, 14),
      longWindow: makeWindow(NOW, 60),
      reader,
    });

    expect(calls).toHaveLength(2);
    expect(out.shortReport).toBeDefined();
    expect(out.longReport).toBeDefined();
    expect(out.shortReport.metrics.renderCount).toBe(1);
    expect(out.longReport.metrics.renderCount).toBe(1);
  });
});
