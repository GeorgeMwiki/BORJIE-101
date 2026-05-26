import { describe, expect, it } from 'vitest';

import { createConsentManager } from '../consent/consent-manager.js';
import { createKillSwitch } from '../consent/kill-switch.js';
import { createReferenceEntityExtractor } from '../extract/entity-extractor.js';
import { createReferenceIntentExtractor } from '../extract/intent-extractor.js';
import {
  clampSentiment,
  createReferenceSentimentExtractor,
} from '../extract/sentiment-light.js';
import { createListenerPipeline } from '../pipeline/listener-pipeline.js';
import {
  createPiiRedactor,
  stubHasher,
} from '../redact/pii-redactor.js';
import {
  createInMemoryAmbientCapturesRepository,
} from '../repositories/ambient-captures.js';
import {
  createInMemoryAmbientConsentsRepository,
} from '../repositories/ambient-consents.js';
import { createInMemoryAuditChain } from '../repositories/audit.js';
import {
  createInMemoryKillSwitchEventsRepository,
} from '../repositories/kill-switch-events.js';
import { createSingleSpeakerDiarise } from '../diarise/diarise-port.js';
import {
  createFailingStt,
  createFixedTranscriptStt,
} from '../stt/stt-port.js';
import { createNoopVad, createSilentVad } from '../vad/vad-port.js';
import {
  SENTIMENT_MAX,
  SENTIMENT_MIN,
  type CognitiveMemoryWriterPort,
  type MetricsPort,
  type PipelineInput,
} from '../types.js';

interface PipelineBuildOpts {
  readonly now: Date;
  readonly transcript: string;
  readonly grantConsent?: boolean;
  readonly sentiment?: boolean;
  readonly killSwitchScope?: 'org' | 'user';
  readonly vadHits?: boolean;
  readonly stt?: 'fixed' | 'failing';
  readonly cogMemoryWriter?: CognitiveMemoryWriterPort;
}

const TENANT = 't-pl-001';
const USER = '00000000-0000-0000-0000-000000000111';
const ADMIN = '00000000-0000-0000-0000-000000000999';
const SESSION = 'voice-call-session-1';

function buildPipeline(opts: PipelineBuildOpts) {
  const consentRepo = createInMemoryAmbientConsentsRepository();
  const capturesRepo = createInMemoryAmbientCapturesRepository();
  const ksRepo = createInMemoryKillSwitchEventsRepository();
  const audit = createInMemoryAuditChain({ seed: 'pipeline-test' });
  const consentManager = createConsentManager({
    repo: consentRepo,
    audit,
    clock: () => opts.now,
  });
  const killSwitch = createKillSwitch({
    repo: ksRepo,
    audit,
    clock: () => opts.now,
    idGen: (() => {
      let n = 0;
      return () => `00000000-0000-0000-0000-${(++n).toString().padStart(12, '0')}`;
    })(),
  });

  const metrics: MetricsPort & {
    counters: Record<string, number>;
  } = (() => {
    const counters: Record<string, number> = {};
    return {
      counters,
      incrementCounter(name, labels) {
        const key = labels
          ? `${name}|${Object.entries(labels)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, v]) => `${k}=${v}`)
              .join(',')}`
          : name;
        counters[key] = (counters[key] ?? 0) + 1;
      },
    };
  })();

  const pipeline = createListenerPipeline({
    consentManager,
    killSwitch,
    vad: opts.vadHits === false ? createSilentVad() : createNoopVad(),
    diarise: createSingleSpeakerDiarise(),
    stt:
      opts.stt === 'failing'
        ? createFailingStt('test-induced')
        : createFixedTranscriptStt(opts.transcript),
    redactor: createPiiRedactor({ hasher: stubHasher }),
    intentExtractor: createReferenceIntentExtractor(),
    entityExtractor: createReferenceEntityExtractor(),
    sentimentExtractor: createReferenceSentimentExtractor(),
    capturesRepo,
    audit,
    ...(opts.cogMemoryWriter ? { cogMemoryWriter: opts.cogMemoryWriter } : {}),
    metrics,
    idGen: (() => {
      let n = 0;
      return () => `cap-${(++n).toString().padStart(8, '0')}`;
    })(),
  });

  return {
    pipeline,
    consentManager,
    killSwitch,
    consentRepo,
    capturesRepo,
    ksRepo,
    audit,
    metrics,
  };
}

function buildInput(now: Date): PipelineInput {
  return {
    tenant_id: TENANT,
    user_id: USER,
    channel: 'voice_call',
    source_session_id: SESSION,
    audio: { kind: 'pcm-frame', frames: 1 },
    received_at: now,
  };
}

describe('listener-pipeline — happy path', () => {
  it('persists a capture with redacted text + intent when consent is granted', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const transcript = 'Tunaomba ukaguzi wa NEMC kwa parseli ya dhahabu.';
    const harness = buildPipeline({ now, transcript, grantConsent: true });

    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });

    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('listening');
    if (outcome.outcome !== 'listening') return; // narrow
    expect(outcome.capture.intent).toBe('book_inspection');
    expect(outcome.capture.redacted_text).toContain('NEMC');
    expect(outcome.capture.audit_hash).toMatch(/^aud[0-9a-f]+$/);
    expect(outcome.capture.prev_hash).toBeNull();

    // Entities should include parcel and mineral.
    const entityKinds = outcome.capture.entities.map((e) => e.kind);
    expect(entityKinds).toContain('parcel_id');
    expect(entityKinds).toContain('mineral');

    // Sentiment was NOT consented → null.
    expect(outcome.capture.sentiment).toBeNull();

    const stored = await harness.capturesRepo.listForUser(TENANT, USER);
    expect(stored).toHaveLength(1);
  });

  it('chains prev_hash across two captures in the same session', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'Tutakwenda kwenye mkutano wa NEMC kesho.',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });

    const first = await harness.pipeline.capture(buildInput(now));
    const second = await harness.pipeline.capture(
      buildInput(new Date('2026-05-26T08:00:05Z')),
    );

    if (first.outcome !== 'listening' || second.outcome !== 'listening') {
      throw new Error('expected both captures to be listening');
    }
    expect(second.capture.prev_hash).toBe(first.capture.audit_hash);
    expect(second.capture.audit_hash).not.toBe(first.capture.audit_hash);
  });

  it('observes into cognitive-memory with the verbatim consent_state', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const observed: Array<{ readonly consent_state: string; readonly intent: string }> = [];
    const cogMemoryWriter: CognitiveMemoryWriterPort = {
      observe(args) {
        observed.push({
          consent_state: args.consent_state,
          intent: args.intent,
        });
        return Promise.resolve();
      },
    };
    const harness = buildPipeline({
      now,
      transcript: 'Tuna tatizo la usalama hapa pitini.',
      cogMemoryWriter,
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });

    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('listening');
    expect(observed).toHaveLength(1);
    expect(observed[0]?.consent_state).toBe('granted');
    expect(observed[0]?.intent).toBe('escalate_safety');
  });
});

describe('listener-pipeline — silent disable paths', () => {
  it('NO consent row → silent disable, no capture row persisted', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'Tunaomba ukaguzi wa NEMC.',
    });
    // NO grant call.
    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('silent-disabled');
    if (outcome.outcome !== 'silent-disabled') return;
    expect(outcome.reason).toBe('consent-not-set');

    const stored = await harness.capturesRepo.listForUser(TENANT, USER);
    expect(stored).toHaveLength(0);

    // Counter should be incremented for the gap.
    const key = `ambient_silent_disables_total|reason=consent-not-set`;
    expect(harness.metrics.counters[key]).toBe(1);
  });

  it('revoked consent → silent disable', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'NEMC ukaguzi.',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });
    await harness.consentManager.revoke({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      revoked_by: ADMIN,
    });
    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('silent-disabled');
    if (outcome.outcome !== 'silent-disabled') return;
    expect(outcome.reason).toBe('consent-revoked');
  });

  it('kill switch active → silent disable even with valid consent', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'NEMC ukaguzi.',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });
    await harness.killSwitch.trigger({
      tenant_id: TENANT,
      triggered_by: ADMIN,
      reason: 'pause everything',
      scope: 'org',
    });

    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('silent-disabled');
    if (outcome.outcome !== 'silent-disabled') return;
    expect(outcome.reason).toBe('kill-switch-org');

    const stored = await harness.capturesRepo.listForUser(TENANT, USER);
    expect(stored).toHaveLength(0);
  });

  it('VAD silence → silent disable (vad-error)', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'irrelevant',
      vadHits: false,
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });
    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('silent-disabled');
    if (outcome.outcome !== 'silent-disabled') return;
    expect(outcome.reason).toBe('vad-error');
  });

  it('STT failure → silent disable (stt-error), nothing persisted', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'irrelevant',
      stt: 'failing',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });
    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('silent-disabled');
    if (outcome.outcome !== 'silent-disabled') return;
    expect(outcome.reason).toBe('stt-error');

    const stored = await harness.capturesRepo.listForUser(TENANT, USER);
    expect(stored).toHaveLength(0);
  });
});

describe('listener-pipeline — PII redaction', () => {
  it('replaces phone numbers with hashed tokens BEFORE the extractor runs', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript:
        'Nipigie kwa nambari +255712345678 nikuhusu ukaguzi wa NEMC.',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });
    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('listening');
    if (outcome.outcome !== 'listening') return;
    // The raw phone must not appear in the persisted redacted text.
    expect(outcome.capture.redacted_text).not.toContain('+255712345678');
    // The HASH token marker must.
    expect(outcome.capture.redacted_text).toMatch(/\[PHONE_HASH:[a-z0-9]+]/i);
    // Entities should include a person entity backed by a salted hash.
    const personHit = outcome.capture.entities.find((e) => e.kind === 'person');
    expect(personHit?.value_hash).toMatch(/^stub[0-9a-f]+$/);
  });
});

describe('listener-pipeline — sentiment bounded', () => {
  it('keeps sentiment in [-1, 1] when sentiment_consent=true', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'Hatari kubwa! Tunaomba okoa pitini la dhahabu — ajali.',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
      sentiment_consent: true,
    });
    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('listening');
    if (outcome.outcome !== 'listening') return;
    expect(outcome.capture.sentiment).not.toBeNull();
    const s = outcome.capture.sentiment ?? 0;
    expect(s).toBeGreaterThanOrEqual(SENTIMENT_MIN);
    expect(s).toBeLessThanOrEqual(SENTIMENT_MAX);
  });

  it('clampSentiment clips out-of-range values', () => {
    expect(clampSentiment(2)).toBe(SENTIMENT_MAX);
    expect(clampSentiment(-5)).toBe(SENTIMENT_MIN);
    expect(clampSentiment(0.5)).toBe(0.5);
    expect(clampSentiment(Number.NaN)).toBe(0);
  });
});

describe('listener-pipeline — intent + entity shapes', () => {
  it('returns one of the closed INTENT_KINDS', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'Tukutane kesho saa nne mkutano wa Tumemadini.',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: ADMIN,
    });
    const outcome = await harness.pipeline.capture(buildInput(now));
    expect(outcome.outcome).toBe('listening');
    if (outcome.outcome !== 'listening') return;
    expect(outcome.capture.intent).toBe('request_meeting');
  });

  it('falls through to "other" when no rule matches', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const harness = buildPipeline({
      now,
      transcript: 'simple unrelated remark with no domain words',
    });
    await harness.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'chat',
      granted_by: ADMIN,
    });
    const input: PipelineInput = {
      ...buildInput(now),
      channel: 'chat',
      source_session_id: 'chat-001',
    };
    const outcome = await harness.pipeline.capture(input);
    expect(outcome.outcome).toBe('listening');
    if (outcome.outcome !== 'listening') return;
    expect(outcome.capture.intent).toBe('other');
    expect(outcome.capture.entities).toEqual([]);
  });
});
