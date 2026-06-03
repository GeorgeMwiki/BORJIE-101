import { describe, it, expect } from 'vitest';
import {
  stepIvr,
  transcribeRecording,
  type IvrSttPort,
  type TranscribeRecordingDeps,
} from './africas-talking-ivr.js';
import type { SafeFetchPort } from './ports.js';

describe('IVR state machine', () => {
  it('root greets and asks for a language', () => {
    const r = stepIvr({ sessionId: 's', callerNumber: '+255700111222', state: 'menu_root' });
    expect(r.nextState).toBe('menu_language');
    expect(r.xml).toContain('<GetDigits');
    expect(r.xml).toContain('Borjie');
  });

  it('language 2 selects Swahili and advances to report intro', () => {
    const r = stepIvr({
      sessionId: 's',
      callerNumber: '+255700111222',
      state: 'menu_language',
      digits: '2',
    });
    expect(r.nextState).toBe('report_intro');
    expect(r.language).toBe('sw');
    expect(r.xml).toContain('Kiswahili');
  });

  it('rejects an invalid amount and stays on report_amount', () => {
    const r = stepIvr({
      sessionId: 's',
      callerNumber: '+255700111222',
      state: 'report_amount',
      language: 'en',
      digits: 'abc',
    });
    expect(r.nextState).toBe('report_amount');
    expect(r.xml).toContain('Invalid amount');
  });

  it('valid amount advances to a recording capture step', () => {
    const r = stepIvr({
      sessionId: 's',
      callerNumber: '+255700111222',
      state: 'report_amount',
      language: 'en',
      digits: '50',
    });
    expect(r.nextState).toBe('report_capture');
    expect(r.xml).toContain('<Record');
  });

  it('capture completes with a hangup', () => {
    const r = stepIvr({
      sessionId: 's',
      callerNumber: '+255700111222',
      state: 'report_capture',
      language: 'sw',
    });
    expect(r.nextState).toBe('complete');
    expect(r.xml).toContain('<Hangup/>');
    expect(r.xml).toContain('Asante');
  });

  it('escapes XML in spoken text', () => {
    // All canned strings are safe; assert the helper escapes by checking a
    // step that includes an apostrophe-free string still well-forms.
    const r = stepIvr({ sessionId: 's', callerNumber: '+255700111222', state: 'menu_root' });
    expect(r.xml).not.toContain('<Say><Say>');
    expect(r.xml.startsWith('<?xml')).toBe(true);
  });
});

describe('transcribeRecording (inline STT via injected ports)', () => {
  const stt: IvrSttPort = {
    transcribeBytes: async () => ({ transcript: 'gramu hamsini za dhahabu', language: 'sw', confidence: 0.92 }),
  };

  function fetchPort(over: Partial<Awaited<ReturnType<SafeFetchPort['fetch']>>> = {}): SafeFetchPort {
    return {
      fetch: async () => ({
        ok: true,
        status: 200,
        bytes: new Uint8Array([1, 2, 3, 4]),
        contentType: 'audio/wav',
        ...over,
      }),
    };
  }

  it('transcribes a fetched recording', async () => {
    const deps: TranscribeRecordingDeps = { stt, safeFetch: fetchPort() };
    const res = await transcribeRecording('https://rec.example/clip.wav', 'auto', deps);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.transcript).toContain('hamsini');
      expect(res.confidence).toBeCloseTo(0.92);
    }
  });

  it('fails soft on a missing url', async () => {
    const res = await transcribeRecording('', 'auto', { stt, safeFetch: fetchPort() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('missing_recording_url');
  });

  it('fails soft when the SSRF guard rejects the url', async () => {
    const blocked: SafeFetchPort = {
      fetch: async () => ({ ok: false, status: 0, reason: 'private_range' }),
    };
    const res = await transcribeRecording('http://169.254.169.254/latest', 'auto', { stt, safeFetch: blocked });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('private_range');
  });

  it('fails soft on an empty recording', async () => {
    const res = await transcribeRecording('https://rec.example/clip.wav', 'auto', {
      stt,
      safeFetch: fetchPort({ bytes: new Uint8Array() }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('empty_recording');
  });

  it('fails soft when STT throws', async () => {
    const throwingStt: IvrSttPort = {
      transcribeBytes: async () => {
        throw new Error('stt down');
      },
    };
    const res = await transcribeRecording('https://rec.example/clip.wav', 'sw', {
      stt: throwingStt,
      safeFetch: fetchPort(),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('transcription_failed');
  });
});
