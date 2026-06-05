import { describe, it, expect } from 'vitest';
import { createChannelGateway, type ChannelGatewayDeps } from './gateway.js';
import type { SignatureVerifier, TierResolver, Clock } from './ports.js';
import type { ActorTier } from './types.js';

const passVerifier: SignatureVerifier = { verify: () => true };
const failVerifier: SignatureVerifier = { verify: () => false };

function tierResolver(tier: ActorTier): TierResolver {
  return {
    resolve: async () => ({
      tenantId: tier === 'anonymous' ? null : 'tenant-1',
      actorId: tier === 'anonymous' ? null : 'actor-1',
      tier,
    }),
  };
}

const fixedClock: Clock = { now: () => new Date('2026-06-03T10:00:00.000Z') };

function deps(verifier: SignatureVerifier, tier: ActorTier = 'owner'): ChannelGatewayDeps {
  return { signature: verifier, tier: tierResolver(tier), clock: fixedClock };
}

describe('signature gate', () => {
  it('rejects when the signature fails — before resolving anything', async () => {
    const gw = createChannelGateway(deps(failVerifier));
    const res = await gw.canonicalize({
      channel: 'whatsapp',
      rawBody: '{}',
      headers: {},
      payload: { from: '255700111222', type: 'text', text: { body: 'hi' } },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_invalid');
  });

  it('treats a thrown verifier as fail-closed', async () => {
    const throwing: SignatureVerifier = {
      verify: () => {
        throw new Error('hmac boom');
      },
    };
    const gw = createChannelGateway(deps(throwing));
    const res = await gw.canonicalize({
      channel: 'sms',
      rawBody: 'x',
      headers: {},
      payload: { from: '255700111222', text: 'hi' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('signature_invalid');
  });
});

describe('canonicalization across channels', () => {
  it('whatsapp text + audio media id', async () => {
    const gw = createChannelGateway(deps(passVerifier, 'manager'));
    const res = await gw.canonicalize({
      channel: 'whatsapp',
      rawBody: '{}',
      headers: {},
      payload: {
        id: 'wamid.123',
        from: '+255 700 111 222',
        type: 'audio',
        audio: { id: 'media-9', mime_type: 'audio/ogg; codecs=opus' },
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.channel).toBe('whatsapp');
      expect(res.event.eventId).toBe('wamid.123');
      expect(res.event.sender.raw.phone).toBe('+255700111222');
      expect(res.event.sender.tier).toBe('manager');
      expect(res.event.metadata.waMediaId).toBe('media-9');
      expect(res.event.signatureVerified).toBe(true);
    }
  });

  it('email prepends subject and keeps the thread id + attachments', async () => {
    const gw = createChannelGateway(deps(passVerifier));
    const res = await gw.canonicalize({
      channel: 'email',
      rawBody: 'x',
      headers: {},
      payload: {
        messageId: 'm-1',
        from: 'Owner@Mine.example',
        subject: 'Assay results',
        bodyText: 'See attached.',
        threadId: 't-1',
        attachments: [{ url: 'https://media.example/a.pdf', mimeType: 'application/pdf', filename: 'a.pdf' }],
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.text.startsWith('Assay results')).toBe(true);
      expect(res.event.sender.raw.email).toBe('owner@mine.example');
      expect(res.event.attachments[0]?.kind).toBe('document');
      expect(res.event.metadata.threadId).toBe('t-1');
    }
  });

  it('voice surfaces transcript + recording attachment', async () => {
    const gw = createChannelGateway(deps(passVerifier, 'employee'));
    const res = await gw.canonicalize({
      channel: 'voice',
      rawBody: 'x',
      headers: {},
      payload: {
        sessionId: 'call-1',
        callerNumber: '0700111222',
        transcript: 'nataka kuripoti gramu hamsini',
        recordingUrl: 'https://rec.example/clip.wav',
        durationSeconds: 12,
      },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.text).toContain('hamsini');
      expect(res.event.attachments[0]?.kind).toBe('audio');
      expect(res.event.metadata.durationSeconds).toBe(12);
    }
  });

  it('ussd + sms + web map cleanly', async () => {
    const gw = createChannelGateway(deps(passVerifier));
    const ussd = await gw.canonicalize({
      channel: 'ussd',
      rawBody: 'x',
      headers: {},
      payload: { sessionId: 'u1', serviceCode: '*123#', phoneNumber: '255700111222', text: '1*2' },
    });
    expect(ussd.ok).toBe(true);
    if (ussd.ok) expect(ussd.event.metadata.serviceCode).toBe('*123#');

    const web = await gw.canonicalize({
      channel: 'web',
      rawBody: 'x',
      headers: {},
      payload: { messageId: 'w1', userId: 'user-42', text: 'hello' },
    });
    expect(web.ok).toBe(true);
    if (web.ok) expect(web.event.sender.raw.webUserId).toBe('user-42');
  });
});

describe('rejections', () => {
  it('rejects an empty/status webhook with no sender or content', async () => {
    const gw = createChannelGateway(deps(passVerifier));
    const res = await gw.canonicalize({
      channel: 'whatsapp',
      rawBody: '{}',
      headers: {},
      payload: { type: 'status' },
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('malformed');
  });

  it('falls back to anonymous when the tier resolver throws', async () => {
    const throwingTier: TierResolver = {
      resolve: async () => {
        throw new Error('directory down');
      },
    };
    const gw = createChannelGateway({ signature: passVerifier, tier: throwingTier, clock: fixedClock });
    const res = await gw.canonicalize({
      channel: 'sms',
      rawBody: 'x',
      headers: {},
      payload: { from: '255700111222', text: 'hi' },
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.event.sender.tier).toBe('anonymous');
      expect(res.event.sender.tenantId).toBeNull();
    }
  });
});
