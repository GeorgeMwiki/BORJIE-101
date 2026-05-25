import { describe, expect, it } from 'vitest';
import {
  verifyGepg,
  verifyMpesa,
  verifyStripe,
  verifyTwilio,
  type TwilioCryptoPort,
} from '../webhook-signatures.js';
import type { CryptoPort, SecurityClock } from '../types.js';

const stubCrypto = (mapping: Record<string, string>): CryptoPort => ({
  hmacSha256Hex: async (_secret, data) => mapping[data] ?? 'deadbeef',
  timingSafeEqualHex: (a, b) => a === b,
});

const stubTwilio = (mapping: Record<string, { sha1: string }>): TwilioCryptoPort => ({
  hmacSha256Hex: async () => '',
  timingSafeEqualHex: (a, b) => a === b,
  hmacSha1Hex: async (_secret, data) => mapping[data]?.sha1 ?? 'cafebabe',
});

const clockAt = (sec: number): SecurityClock => ({ now: () => sec * 1000 });

describe('webhook-signatures: stripe', () => {
  it('accepts valid signature within tolerance', async () => {
    const t = 1_000;
    const body = '{"x":1}';
    const crypto = stubCrypto({ [`${t}.${body}`]: 'sig123' });
    const out = await verifyStripe(
      { rawBody: body, signatureHeader: `t=${t},v1=sig123`, secret: 'x' },
      crypto,
      clockAt(t + 10),
    );
    expect(out.ok).toBe(true);
  });

  it('rejects missing timestamp', async () => {
    const out = await verifyStripe(
      { rawBody: '', signatureHeader: 'v1=abc', secret: 'x' },
      stubCrypto({}),
      clockAt(0),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('missing-timestamp');
  });

  it('rejects missing v1', async () => {
    const out = await verifyStripe(
      { rawBody: '', signatureHeader: 't=10', secret: 'x' },
      stubCrypto({}),
      clockAt(10),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('missing-v1');
  });

  it('rejects timestamp outside tolerance', async () => {
    const t = 1_000;
    const out = await verifyStripe(
      { rawBody: '', signatureHeader: `t=${t},v1=x`, secret: 'k', toleranceSeconds: 60 },
      stubCrypto({}),
      clockAt(t + 9999),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('timestamp-out-of-tolerance');
  });

  it('rejects bad signature', async () => {
    const t = 1_000;
    const crypto = stubCrypto({ [`${t}.x`]: 'expected-sig' });
    const out = await verifyStripe(
      { rawBody: 'x', signatureHeader: `t=${t},v1=different`, secret: 'k' },
      crypto,
      clockAt(t),
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('signature-mismatch');
  });
});

describe('webhook-signatures: mpesa', () => {
  it('accepts a valid mpesa signature', async () => {
    const body = '{"ok":1}';
    const crypto = stubCrypto({ [body]: 'sig' });
    const out = await verifyMpesa(
      { rawBody: body, signatureHeader: 'sig', secret: 'k' },
      crypto,
    );
    expect(out.ok).toBe(true);
  });

  it('rejects empty signature', async () => {
    const out = await verifyMpesa(
      { rawBody: '', signatureHeader: '', secret: 'k' },
      stubCrypto({}),
    );
    expect(out.ok).toBe(false);
  });

  it('rejects bad signature', async () => {
    const out = await verifyMpesa(
      { rawBody: 'x', signatureHeader: 'no', secret: 'k' },
      stubCrypto({ x: 'yes' }),
    );
    expect(out.ok).toBe(false);
  });
});

describe('webhook-signatures: gepg', () => {
  it('accepts when base64 sig decodes to expected hex', async () => {
    const xml = '<Resp>1</Resp>';
    // 'deadbeef' as base64 = '3q2+7w==' -> hex 'deadbeef'
    const crypto = stubCrypto({ [xml]: 'deadbeef' });
    const out = await verifyGepg(
      { canonicalXml: xml, signatureBase64: '3q2+7w==', secret: 'k' },
      crypto,
    );
    expect(out.ok).toBe(true);
  });

  it('rejects empty sig', async () => {
    const out = await verifyGepg(
      { canonicalXml: '<x/>', signatureBase64: '', secret: 'k' },
      stubCrypto({}),
    );
    expect(out.ok).toBe(false);
  });

  it('rejects mismatched sig', async () => {
    const xml = '<x/>';
    const crypto = stubCrypto({ [xml]: 'aabbcc' });
    const out = await verifyGepg(
      { canonicalXml: xml, signatureBase64: '3q2+7w==', secret: 'k' },
      crypto,
    );
    expect(out.ok).toBe(false);
  });
});

describe('webhook-signatures: twilio', () => {
  it('accepts valid twilio signature', async () => {
    const url = 'https://x.example/webhook';
    const params = { A: '1', B: '2' };
    const canonical = url + 'A1B2';
    // 'deadbeef' (hex) base64 of bytes = 3q2+7w==
    const crypto = stubTwilio({ [canonical]: { sha1: 'deadbeef' } });
    const out = await verifyTwilio(
      { url, params, signatureHeader: '3q2+7w==', authToken: 'k' },
      crypto,
    );
    expect(out.ok).toBe(true);
  });

  it('sorts params before canonicalising', async () => {
    const url = 'https://x.example/webhook';
    const params = { Z: '9', A: '1' };
    const canonicalSorted = url + 'A1Z9';
    const crypto = stubTwilio({ [canonicalSorted]: { sha1: 'deadbeef' } });
    const out = await verifyTwilio(
      { url, params, signatureHeader: '3q2+7w==', authToken: 'k' },
      crypto,
    );
    expect(out.ok).toBe(true);
  });

  it('rejects bad signature', async () => {
    const out = await verifyTwilio(
      { url: 'http://x', params: {}, signatureHeader: 'wrong==', authToken: 'k' },
      stubTwilio({}),
    );
    expect(out.ok).toBe(false);
  });
});
