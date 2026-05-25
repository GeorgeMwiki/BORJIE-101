/**
 * Voice-agent tests (Agent PhL).
 *
 *   1. Happy: STT transcribes French audio → brain responds in French →
 *      TTS synthesizes audio. Turn persists with latency + provenance.
 *   2. VOICE_NOT_CONFIGURED: audio provided but no STT adapter wired →
 *      service returns the structured VOICE_NOT_CONFIGURED code.
 *   3. Degraded: inline transcript, no TTS → turn still succeeds,
 *      degradedMode=true, responseAudioRef=null.
 */

import { describe, it, expect } from 'vitest';
import { createVoiceAgent } from '../voice-agent/agent.js';
import type {
  CustomerResolverPort,
  VoiceBrainPort,
  VoiceSttPort,
  VoiceTtsPort,
  VoiceTurnRepository,
  VoiceTurnRow,
} from '../voice-agent/types.js';

function makeRepo() {
  const rows: VoiceTurnRow[] = [];
  const repo: VoiceTurnRepository = {
    async insert(row) {
      rows.push(row);
      return row;
    },
    async countBySession(tenantId, sessionId) {
      return rows.filter(
        (r) => r.tenantId === tenantId && r.sessionId === sessionId,
      ).length;
    },
    async list(tenantId, sessionId) {
      return rows
        .filter((r) => r.tenantId === tenantId && r.sessionId === sessionId)
        .slice();
    },
  };
  return { repo, rows };
}

describe('VoiceAgent', () => {
  it('happy path: STT + brain + TTS round-trips in detected language', async () => {
    const { repo, rows } = makeRepo();

    const stt: VoiceSttPort = {
      async transcribe() {
        return {
          transcript: 'Bonjour, je voudrais verifier mon solde.',
          detectedLanguage: 'fr',
          confidence: 0.92,
        };
      },
    };
    const tts: VoiceTtsPort = {
      async synthesize(input) {
        return { audioRef: `tts://${input.languageCode}/audio.mp3` };
      },
    };
    const resolver: CustomerResolverPort = {
      async resolve() {
        return { customerId: 'cus_99' };
      },
    };
    const brain: VoiceBrainPort = {
      async turn(input) {
        expect(input.languageCode).toBe('fr');
        expect(input.customerId).toBe('cus_99');
        return {
          text: 'Bonjour! Votre solde est de 150 dollars.',
          toolCalls: [
            {
              name: 'get_balance',
              arguments: { customerId: 'cus_99' },
              result: { balance: 150 },
            },
          ],
          modelVersion: 'test-brain-1',
          inputTokens: 80,
          outputTokens: 30,
          costUsdMicro: 900,
        };
      },
    };

    const agent = createVoiceAgent({
      stt,
      tts,
      resolveCustomer: resolver,
      brain,
      repo,
    });

    const res = await agent.turn({
      tenantId: 'tnt_1',
      sessionId: 'ses_1',
      audioUrl: 'https://storage/audio.mp3',
      callerPhone: '+33123456789',
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.detectedLanguage).toBe('fr');
    expect(res.data.responseText).toContain('Votre solde');
    expect(res.data.responseAudioRef).toBe('tts://fr/audio.mp3');
    expect(res.data.degradedMode).toBe(false);
    expect(res.data.toolCalls).toHaveLength(1);
    expect(res.data.customerId).toBe('cus_99');
    expect(rows).toHaveLength(1);
    expect(rows[0].promptHash).toMatch(/^ph_/);
  });

  it('VOICE_NOT_CONFIGURED: audio provided, no STT adapter', async () => {
    const { repo } = makeRepo();
    const brain: VoiceBrainPort = {
      async turn() {
        throw new Error('brain should never be called when STT missing');
      },
    };

    const agent = createVoiceAgent({ stt: null, brain, repo });

    const res = await agent.turn({
      tenantId: 'tnt_1',
      sessionId: 'ses_2',
      audioUrl: 'https://storage/audio.mp3',
    });

    expect(res.success).toBe(false);
    if (res.success) return;
    expect(res.code).toBe('VOICE_NOT_CONFIGURED');
  });

  it('degraded: inline transcript, no TTS → still returns text, degradedMode=true', async () => {
    const { repo, rows } = makeRepo();
    const brain: VoiceBrainPort = {
      async turn() {
        return {
          text: 'Habari! Hivi karibuni.',
          toolCalls: [],
          modelVersion: 'test-brain-1',
          inputTokens: 40,
          outputTokens: 20,
          costUsdMicro: 500,
        };
      },
    };

    const agent = createVoiceAgent({
      // No STT, no TTS.
      brain,
      repo,
    });

    const res = await agent.turn({
      tenantId: 'tnt_1',
      sessionId: 'ses_3',
      transcript: 'Habari, nyumba yangu ina tatizo.',
    });

    expect(res.success).toBe(true);
    if (!res.success) return;
    expect(res.data.detectedLanguage).toBe('sw'); // heuristic picks sw
    expect(res.data.responseAudioRef).toBeNull();
    expect(res.data.degradedMode).toBe(true);
    expect(rows).toHaveLength(1);
  });
});
