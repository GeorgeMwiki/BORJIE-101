/**
 * Persona-drift cron tests (Phase D D7).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createPersonaDriftCron,
  type PersonaVectorObservation,
  type PersonaVectorSampleSource,
  type PersonaDriftAssessor,
  type PersonaDriftSinkPort,
  type PersonaDriftVerdict,
} from '../persona-drift-cron.js';
import type { PersonaVector } from '@borjie/central-intelligence';

function fakeVector(): PersonaVector {
  return {
    warmth: 0.5,
    directness: 0.5,
    brevity: 0.5,
    hedging_rate: 0.5,
    jargon_density: 0.5,
    no_em_dash: 1,
    no_filler: 1,
    no_buzzwords: 1,
    first_person_singular: 0.5,
    first_person_plural: 0.5,
    no_ai_dodge: 1,
    numerical_discipline: 0.5,
    currency_explicitness: 0.5,
    regulatory_citation_discipline: 0.5,
    no_eviction_promise: 1,
    no_market_prediction: 1,
    bilingual_responsiveness: 0.5,
    brand_name_preservation: 1,
    citation_per_claim: 0.5,
    imperative_tone: 0.5,
    question_to_user_ratio: 0.5,
    apology_rate: 0.1,
    fabrication_pressure: 0.1,
    pushback_willingness: 0.5,
  };
}

function obs(over: Partial<PersonaVectorObservation> = {}): PersonaVectorObservation {
  return {
    tenantId: 't1',
    personaId: 'tenant-resident',
    thoughtId: 'th-1',
    capturedAt: '2026-05-15T10:00:00Z',
    vector: fakeVector(),
    ...over,
  };
}

function source(items: ReadonlyArray<PersonaVectorObservation>): PersonaVectorSampleSource {
  return { async listRecent() { return items; } };
}

function recordingSink() {
  const events: Array<Parameters<PersonaDriftSinkPort['record']>[0]> = [];
  const sink: PersonaDriftSinkPort = {
    async record(e) {
      events.push(e);
    },
  };
  return { sink, events };
}

const passVerdict: PersonaDriftVerdict = {
  breached: false,
  worstDim: 'warmth',
  worstDimDrift: 0.05,
  aggregateDrift: 0.02,
  severity: 'low',
  reasons: [],
};

const breachVerdict: PersonaDriftVerdict = {
  breached: true,
  worstDim: 'no_filler',
  worstDimDrift: 0.4,
  aggregateDrift: 0.2,
  severity: 'high',
  reasons: ['dim no_filler drifted by 0.400'],
};

describe('Phase D D7 — persona-drift cron', () => {
  it('tick() emits one alert per breached observation', async () => {
    const { sink, events } = recordingSink();
    const assess: PersonaDriftAssessor = () => breachVerdict;
    const cron = createPersonaDriftCron({
      sampleSource: source([obs()]),
      assess,
      sink,
      now: () => Date.parse('2026-05-15T11:00:00Z'),
    });
    const n = await cron.tick();
    expect(n).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0].severity).toBe('high');
    expect(events[0].personaId).toBe('tenant-resident');
  });

  it('tick() does NOT emit when assessor passes', async () => {
    const { sink, events } = recordingSink();
    const cron = createPersonaDriftCron({
      sampleSource: source([obs()]),
      assess: () => passVerdict,
      sink,
    });
    const n = await cron.tick();
    expect(n).toBe(0);
    expect(events).toHaveLength(0);
  });

  it('does not double-emit for the same (tenant, persona, day) within a tick window', async () => {
    const { sink, events } = recordingSink();
    const cron = createPersonaDriftCron({
      sampleSource: source([obs(), obs({ thoughtId: 'th-2' })]),
      assess: () => breachVerdict,
      sink,
      now: () => Date.parse('2026-05-15T11:00:00Z'),
    });
    const n = await cron.tick();
    expect(n).toBe(1);
    expect(events).toHaveLength(1);
  });

  it('swallows assess() throws and continues with the next observation', async () => {
    const { sink, events } = recordingSink();
    let calls = 0;
    const assess: PersonaDriftAssessor = () => {
      calls += 1;
      if (calls === 1) throw new Error('assess boom');
      return breachVerdict;
    };
    const cron = createPersonaDriftCron({
      sampleSource: source([obs(), obs({ tenantId: 't2', thoughtId: 'th-2' })]),
      assess,
      sink,
    });
    const n = await cron.tick();
    expect(n).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ thoughtId: 'th-2' });
  });

  it('swallows source throws and returns 0', async () => {
    const { sink } = recordingSink();
    const sourceErr: PersonaVectorSampleSource = {
      async listRecent() {
        throw new Error('source boom');
      },
    };
    const cron = createPersonaDriftCron({
      sampleSource: sourceErr,
      assess: () => breachVerdict,
      sink,
    });
    const n = await cron.tick();
    expect(n).toBe(0);
  });

  it('start()/stop() are idempotent and respect intervalMs', () => {
    vi.useFakeTimers();
    const { sink } = recordingSink();
    const cron = createPersonaDriftCron({
      sampleSource: source([]),
      assess: () => passVerdict,
      sink,
      intervalMs: 1000,
    });
    cron.start();
    cron.start(); // no-op
    cron.stop();
    cron.stop(); // no-op
    vi.useRealTimers();
  });
});
