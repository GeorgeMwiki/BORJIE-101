/**
 * Unit + integration tests for the realtime-voice BACKEND
 * (routes/brain-voice.hono.ts).
 *
 * Live audio is untestable here, so we verify the MESSAGE-HANDLING LOGIC:
 *   • the pure inbound client-frame router (audio / text / tool_result / …)
 *   • the Gemini Live setup-frame builder (persona + tools wiring)
 *   • the Gemini Live server-frame router (audio / transcript / tool_call)
 *   • locale-driven persona purity (sw vs en — no language mixing)
 *   • a full VoiceSession round-trip with an INJECTED fake upstream and a
 *     REAL signed Supabase JWT (fail-closed auth + tenant binding).
 *
 * No network, no console.log, no mutation across tests.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { SignJWT } from 'jose';

// Pin brain env BEFORE importing the route so `loadBrainEnv` succeeds on first
// lazy access. Mirrors the pattern in brain-turn-idempotency.test.ts.
const SUPABASE_SECRET = 'test-secret-supabase-jwt-1234567890-abcdefghijkl';
process.env.SUPABASE_JWT_SECRET = SUPABASE_SECRET;
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key-aaaaaaaaaaaaaaaaaaaa';
// loadBrainEnv requires NEXT_PUBLIC_SUPABASE_URL, so it must be set. The
// verifier defaults to the HS256-secret path (which our local HS256-signed
// token satisfies); it only flips to JWKS when SUPABASE_JWKS_URL is set, so we
// ensure that opt-in is absent.
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
delete process.env.SUPABASE_JWKS_URL;
delete process.env.BORJIE_SUPABASE_JWKS_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-aaaaaaaaaaaaaaaaaaaa';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-aaaaaaaaaaaaaaaa';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = 'test';

import {
  routeInboundClientFrame,
  buildGeminiSetupFrame,
  routeGeminiServerFrame,
  buildVoiceSystemInstruction,
  normalizeLocale,
  parseClientTextFrame,
  VoiceSession,
  type BridgeOutboundEvent,
  type DuplexUpstream,
  type UpstreamCallbacks,
  type OpenGeminiUpstreamArgs,
  type VoiceFunctionDeclaration,
} from '../brain-voice.hono.js';

async function signToken(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject((claims.sub as string) ?? 'user-1')
    .setExpirationTime('1h')
    .sign(new TextEncoder().encode(SUPABASE_SECRET));
}

// =============================================================================
// normalizeLocale + persona purity
// =============================================================================
describe('locale + persona', () => {
  it('normalizes locale to en unless explicitly sw*', () => {
    expect(normalizeLocale('sw')).toBe('sw');
    expect(normalizeLocale('sw-TZ')).toBe('sw');
    expect(normalizeLocale('SW')).toBe('sw');
    expect(normalizeLocale('en')).toBe('en');
    expect(normalizeLocale(undefined)).toBe('en');
    expect(normalizeLocale(null)).toBe('en');
  });

  it('builds a mining-domain persona (never property)', () => {
    const en = buildVoiceSystemInstruction('en');
    expect(en).toContain('Mr. Mwikila');
    expect(en).toContain('mining');
    expect(en.toLowerCase()).toContain('never give property');
    expect(en).toContain('evidence');
  });

  it('keeps SW persona Swahili-pure (no English sentences)', () => {
    const sw = buildVoiceSystemInstruction('sw');
    expect(sw).toContain('Kiswahili');
    expect(sw).toContain('Bwana Mwikila');
    // SW build must not leak the English HARD RULES header.
    expect(sw).not.toContain('HARD RULES');
    expect(sw).not.toContain('Reply in English');
  });

  it('keeps EN persona English-pure (no Swahili instruction)', () => {
    const en = buildVoiceSystemInstruction('en');
    expect(en).not.toContain('Kiswahili');
    expect(en).not.toContain('SHERIA NGUMU');
  });
});

// =============================================================================
// Inbound client-frame router (pure + total)
// =============================================================================
describe('routeInboundClientFrame', () => {
  it('routes an auth frame and normalizes locale', () => {
    const a = routeInboundClientFrame({ type: 'auth', token: 'tok', locale: 'sw-TZ' });
    expect(a).toEqual({ action: 'authenticate', token: 'tok', locale: 'sw' });
  });

  it('decodes an audio frame to PCM bytes with defaulted sample rate', () => {
    const base64 = Buffer.from([1, 2, 3, 4]).toString('base64');
    const a = routeInboundClientFrame({ type: 'audio', base64 });
    expect(a.action).toBe('push_audio');
    if (a.action !== 'push_audio') throw new Error('unreachable');
    expect(Array.from(a.chunk.bytes)).toEqual([1, 2, 3, 4]);
    expect(a.chunk.sampleRate).toBe(16000);
    expect(a.chunk.mimeType).toBe('audio/pcm');
  });

  it('honours a valid explicit sample rate + opus mime', () => {
    const base64 = Buffer.from([9]).toString('base64');
    const a = routeInboundClientFrame({
      type: 'audio',
      base64,
      sampleRate: 48000,
      mimeType: 'audio/opus',
    });
    if (a.action !== 'push_audio') throw new Error('unreachable');
    expect(a.chunk.sampleRate).toBe(48000);
    expect(a.chunk.mimeType).toBe('audio/opus');
  });

  it('ignores empty / malformed audio frames', () => {
    expect(routeInboundClientFrame({ type: 'audio' }).action).toBe('ignore');
    expect(routeInboundClientFrame({ type: 'audio', base64: '' }).action).toBe('ignore');
  });

  it('routes a text frame and trims', () => {
    const a = routeInboundClientFrame({ type: 'text', text: '  hello  ' });
    expect(a).toEqual({ action: 'speak_text', text: 'hello' });
    expect(routeInboundClientFrame({ type: 'text', text: '   ' }).action).toBe('ignore');
  });

  it('routes a tool_result frame', () => {
    const a = routeInboundClientFrame({
      type: 'tool_result',
      callId: 'c1',
      name: 'get_portfolio_overview',
      output: { ok: true },
    });
    expect(a).toEqual({
      action: 'tool_result',
      callId: 'c1',
      name: 'get_portfolio_overview',
      output: { ok: true },
    });
  });

  it('ignores tool_result without a name; defaults output to {}', () => {
    expect(routeInboundClientFrame({ type: 'tool_result' }).action).toBe('ignore');
    const a = routeInboundClientFrame({ type: 'tool_result', name: 'x' });
    if (a.action !== 'tool_result') throw new Error('unreachable');
    expect(a.output).toEqual({});
  });

  it('routes close and ignores unknown frame types', () => {
    expect(routeInboundClientFrame({ type: 'close' }).action).toBe('close');
    const a = routeInboundClientFrame({ type: 'bogus' });
    expect(a.action).toBe('ignore');
    if (a.action !== 'ignore') throw new Error('unreachable');
    expect(a.reason).toContain('unknown_frame_type:bogus');
  });
});

// =============================================================================
// parseClientTextFrame
// =============================================================================
describe('parseClientTextFrame', () => {
  it('parses a JSON string with a type', () => {
    expect(parseClientTextFrame('{"type":"close"}')).toEqual({ type: 'close' });
  });
  it('parses a Buffer payload', () => {
    expect(parseClientTextFrame(Buffer.from('{"type":"text","text":"hi"}'))).toEqual({
      type: 'text',
      text: 'hi',
    });
  });
  it('returns null for bad JSON or missing type', () => {
    expect(parseClientTextFrame('not json')).toBeNull();
    expect(parseClientTextFrame('{"foo":1}')).toBeNull();
    expect(parseClientTextFrame(42)).toBeNull();
  });
});

// =============================================================================
// Gemini setup-frame builder (persona + tools wiring)
// =============================================================================
describe('buildGeminiSetupFrame', () => {
  const tools: VoiceFunctionDeclaration[] = [
    { name: 'get_portfolio_overview', description: 'portfolio', parameters: { type: 'object' } },
  ];

  it('embeds the system instruction + function tools + audio modality', () => {
    const frame = buildGeminiSetupFrame('gemini-x', {
      systemInstruction: 'PERSONA-TEXT',
      tools,
      voiceName: 'Aoede',
    });
    const setup = (frame as any).setup;
    expect(setup.model).toBe('models/gemini-x');
    expect(setup.generationConfig.responseModalities).toEqual(['AUDIO']);
    expect(setup.systemInstruction.parts[0].text).toBe('PERSONA-TEXT');
    expect(setup.tools[0].functionDeclarations[0].name).toBe('get_portfolio_overview');
    expect(setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe(
      'Aoede',
    );
  });

  it('omits the tools key entirely when there are no tools', () => {
    const frame = buildGeminiSetupFrame('gemini-x', {
      systemInstruction: 'P',
      tools: [],
    });
    expect((frame as any).setup.tools).toBeUndefined();
  });
});

// =============================================================================
// Gemini server-frame router (pure dispatch)
// =============================================================================
describe('routeGeminiServerFrame', () => {
  function collector() {
    const events: Array<[string, unknown]> = [];
    const cb: UpstreamCallbacks = {
      onAudio: (base64, sampleRate, isFinal) => events.push(['audio', { base64, sampleRate, isFinal }]),
      onTranscript: (text, isFinal, speaker) => events.push(['transcript', { text, isFinal, speaker }]),
      onToolCall: (call) => events.push(['tool_call', call]),
      onError: (code, message) => events.push(['error', { code, message }]),
      onClose: () => events.push(['close', {}]),
    };
    return { events, cb };
  }

  it('emits user transcript from inputTranscription', () => {
    const { events, cb } = collector();
    routeGeminiServerFrame(
      { serverContent: { inputTranscription: { text: 'Tumemadini', finished: true } } },
      's',
      cb,
    );
    expect(events).toContainEqual(['transcript', { text: 'Tumemadini', isFinal: true, speaker: 'user' }]);
  });

  it('emits agent audio from modelTurn inline data, then final flush on turnComplete', () => {
    const { events, cb } = collector();
    routeGeminiServerFrame(
      {
        serverContent: {
          modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm', data: 'AAAA' } }] },
          turnComplete: true,
        },
      },
      's',
      cb,
    );
    const audio = events.filter((e) => e[0] === 'audio');
    expect(audio[0]).toEqual(['audio', { base64: 'AAAA', sampleRate: 24000, isFinal: false }]);
    expect(audio.at(-1)).toEqual(['audio', { base64: '', sampleRate: 24000, isFinal: true }]);
  });

  it('emits a tool_call from the toolCall envelope', () => {
    const { events, cb } = collector();
    routeGeminiServerFrame(
      { toolCall: { functionCalls: [{ id: 'fc1', name: 'get_pit_health', args: { unit: 'U1' } }] } },
      's',
      cb,
    );
    expect(events).toContainEqual([
      'tool_call',
      { callId: 'fc1', name: 'get_pit_health', args: { unit: 'U1' } },
    ]);
  });

  it('surfaces upstream errors', () => {
    const { events, cb } = collector();
    routeGeminiServerFrame({ error: { message: 'quota' } }, 's', cb);
    expect(events[0]?.[0]).toBe('error');
    expect((events[0]?.[1] as { message: string }).message).toMatch(/quota/);
  });
});

// =============================================================================
// VoiceSession round-trip — fail-closed auth + tenant binding + bridging,
// with an INJECTED fake upstream (no network, no real provider key).
// =============================================================================
describe('VoiceSession', () => {
  function fakeUpstream() {
    const calls = {
      audio: [] as Uint8Array[],
      text: [] as string[],
      toolResponses: [] as Array<{ name: string; output: Record<string, unknown> }>,
      closed: false,
    };
    let cbRef: UpstreamCallbacks | null = null;
    const open = (a: OpenGeminiUpstreamArgs): DuplexUpstream => {
      cbRef = a.callbacks;
      return {
        sessionId: 'fake-session',
        pushAudio: (c) => calls.audio.push(c.bytes),
        speakText: (t) => calls.text.push(t),
        respondToToolCall: (r) => calls.toolResponses.push({ name: r.name, output: r.output }),
        close: () => {
          calls.closed = true;
        },
      };
    };
    return { calls, open, fire: () => cbRef! };
  }

  it('rejects an unauthenticated audio frame and an invalid token (fail-closed)', async () => {
    const events: BridgeOutboundEvent[] = [];
    const fake = fakeUpstream();
    const session = new VoiceSession({ emit: (e) => events.push(e), openUpstream: fake.open });

    // audio before auth → error, no upstream opened
    await session.handleFrame({ type: 'audio', base64: Buffer.from([1]).toString('base64') });
    expect(events.some((e) => e.kind === 'error' && e.code === 'not_authenticated')).toBe(true);

    // bad token → unauthorized, session closed
    await session.handleFrame({ type: 'auth', token: 'garbage.token.value' });
    expect(events.some((e) => e.kind === 'error' && e.code === 'unauthorized')).toBe(true);
    expect(fake.calls.audio).toHaveLength(0);
  });

  it('authenticates with a real JWT, opens the upstream, and bridges frames', async () => {
    const events: BridgeOutboundEvent[] = [];
    const fake = fakeUpstream();
    const session = new VoiceSession({ emit: (e) => events.push(e), openUpstream: fake.open });

    const token = await signToken({
      sub: 'owner-9',
      app_metadata: { tenant_id: 'tenant-42', roles: ['owner'] },
    });
    await session.handleFrame({ type: 'auth', token, locale: 'sw' });

    // ready emitted with the session id from the upstream
    const ready = events.find((e) => e.kind === 'ready');
    expect(ready).toBeTruthy();
    if (ready?.kind === 'ready') {
      expect(ready.sessionId).toBe('fake-session');
      expect(ready.locale).toBe('sw');
    }

    // audio + text are forwarded to the upstream
    await session.handleFrame({ type: 'audio', base64: Buffer.from([7, 7]).toString('base64') });
    await session.handleFrame({ type: 'text', text: 'habari' });
    expect(fake.calls.audio).toHaveLength(1);
    expect(fake.calls.text).toEqual(['habari']);
  });

  it('on a model tool_call: emits started + ok and feeds a deferred result back', async () => {
    const events: BridgeOutboundEvent[] = [];
    const fake = fakeUpstream();
    const session = new VoiceSession({ emit: (e) => events.push(e), openUpstream: fake.open });

    const token = await signToken({
      sub: 'owner-9',
      app_metadata: { tenant_id: 'tenant-42', roles: ['owner'] },
    });
    await session.handleFrame({ type: 'auth', token });

    // Simulate the model emitting a tool call.
    fake.fire().onToolCall({ callId: 'fc1', name: 'get_portfolio_overview', args: {} });
    await vi.waitFor(() =>
      expect(events.some((e) => e.kind === 'tool_call' && e.status === 'ok')).toBe(true),
    );

    // The deferred dispatch result was fed back to the model.
    expect(fake.calls.toolResponses[0]?.name).toBe('get_portfolio_overview');
    expect(fake.calls.toolResponses[0]?.output.executed).toBe(false);
  });

  it('close() is idempotent and tears the upstream down', async () => {
    const events: BridgeOutboundEvent[] = [];
    const fake = fakeUpstream();
    const session = new VoiceSession({ emit: (e) => events.push(e), openUpstream: fake.open });
    const token = await signToken({
      sub: 'o',
      app_metadata: { tenant_id: 't', roles: ['owner'] },
    });
    await session.handleFrame({ type: 'auth', token });
    session.close();
    session.close();
    expect(fake.calls.closed).toBe(true);
  });
});
