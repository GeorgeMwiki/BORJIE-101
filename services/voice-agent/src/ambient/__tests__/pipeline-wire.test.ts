import { describe, expect, it } from 'vitest';

import {
  createFailingStt,
  createFixedTranscriptStt,
} from '@borjie/ambient-listener';

import { createAmbientWiring } from '../pipeline-wire.js';

const TENANT = 'wire-tenant-1';
const USER = '00000000-0000-0000-0000-000000000001';

describe('createAmbientWiring', () => {
  it('returns a pipeline that silent-disables when consent is missing', async () => {
    const wiring = createAmbientWiring({});
    const outcome = await wiring.capture({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      source_session_id: 'sess-1',
      audio: { kind: 'pcm-frame' },
      received_at: new Date('2026-05-26T08:00:00Z'),
    });
    expect(outcome.outcome).toBe('silent-disabled');
    if (outcome.outcome !== 'silent-disabled') return;
    expect(outcome.reason).toBe('consent-not-set');
  });

  it('captures + persists after grant', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const wiring = createAmbientWiring({
      clock: () => now,
      stt: createFixedTranscriptStt(
        'Tunaomba ukaguzi wa NEMC kwa parseli ya dhahabu.',
      ),
    });
    await wiring.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: USER,
    });
    const outcome = await wiring.capture({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      source_session_id: 'sess-1',
      audio: { kind: 'pcm-frame' },
      received_at: now,
    });
    expect(outcome.outcome).toBe('listening');
    if (outcome.outcome !== 'listening') return;
    expect(outcome.capture.intent).toBe('book_inspection');

    const stored = await wiring.capturesRepo.listForUser(TENANT, USER);
    expect(stored).toHaveLength(1);
  });

  it('kill switch wins over a granted consent', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const wiring = createAmbientWiring({
      clock: () => now,
      stt: createFixedTranscriptStt('Tunaomba ukaguzi wa NEMC.'),
    });
    await wiring.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: USER,
    });
    await wiring.killSwitch.trigger({
      tenant_id: TENANT,
      triggered_by: USER,
      reason: 'pausing',
      scope: 'user',
      target_user_id: USER,
    });

    const outcome = await wiring.capture({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      source_session_id: 'sess-1',
      audio: { kind: 'pcm-frame' },
      received_at: now,
    });
    expect(outcome.outcome).toBe('silent-disabled');
    if (outcome.outcome !== 'silent-disabled') return;
    expect(outcome.reason).toBe('kill-switch-user');
  });

  it('STT failure → silent disable without persisting', async () => {
    const now = new Date('2026-05-26T08:00:00Z');
    const wiring = createAmbientWiring({
      clock: () => now,
      stt: createFailingStt('induced failure'),
    });
    await wiring.consentManager.grant({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      granted_by: USER,
    });
    const outcome = await wiring.capture({
      tenant_id: TENANT,
      user_id: USER,
      channel: 'voice_call',
      source_session_id: 'sess-1',
      audio: { kind: 'pcm-frame' },
      received_at: now,
    });
    expect(outcome.outcome).toBe('silent-disabled');
    const stored = await wiring.capturesRepo.listForUser(TENANT, USER);
    expect(stored).toHaveLength(0);
  });
});
