import { describe, it, expect } from 'vitest';
import {
  createInMemoryFingerprintStore,
  hashHeaderText,
  canonicaliseHeaderText,
  computePerceptualHash,
  matchFingerprint,
  registerFingerprint,
} from './issuer-fingerprint.js';
import { extractMpesaSms, parseOneMessage } from './extractors/mpesa-sms.js';
import { extractEml } from './extractors/eml.js';
import { extractMsg, MsgUnsupportedError, type MsgReaderPort } from './extractors/msg.js';
import { crossVerifyQr, decodeAndCrossVerify, type QrDecoderPort } from './extractors/qr.js';

// ----------------------------------------------------------------------------
// Issuer fingerprint
// ----------------------------------------------------------------------------

describe('issuer fingerprint', () => {
  it('canonicalises + hashes deterministically', () => {
    expect(canonicaliseHeaderText('  Geita  MINING Co.!! ')).toBe('geita mining co');
    expect(hashHeaderText('Geita Mining Co')).toBe(hashHeaderText('geita   mining co'));
    expect(hashHeaderText('A')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('registers + matches by header hash', async () => {
    const store = createInMemoryFingerprintStore();
    await registerFingerprint(
      { issuerId: 'BORJIE_ISSUER_001', displayLabel: 'Issuer 001', headerText: 'Mining Authority Receipt' },
      store,
    );
    const hit = await matchFingerprint({ headerText: 'mining authority receipt' }, store);
    expect(hit?.issuerId).toBe('BORJIE_ISSUER_001');
  });

  it('rejects a non-numbered issuer id and a real brand label', async () => {
    const store = createInMemoryFingerprintStore();
    await expect(
      registerFingerprint({ issuerId: 'badid', displayLabel: 'X', headerText: 'h' }, store),
    ).rejects.toThrow();
    await expect(
      registerFingerprint({ issuerId: 'BORJIE_ISSUER_002', displayLabel: 'CRDB Bank', headerText: 'h' }, store),
    ).rejects.toThrow();
  });

  it('matches by perceptual hash within Hamming distance', async () => {
    const store = createInMemoryFingerprintStore();
    const bytes = new Uint8Array(Array.from({ length: 128 }, (_, i) => (i * 7) % 256));
    await registerFingerprint(
      { issuerId: 'BORJIE_ISSUER_003', displayLabel: 'Issuer 003', headerText: 'unique header three', imageBytes: bytes },
      store,
    );
    // Same bytes -> identical phash -> distance 0 -> match even with no header.
    const hit = await matchFingerprint({ imageBytes: bytes }, store);
    expect(hit?.issuerId).toBe('BORJIE_ISSUER_003');
    expect(computePerceptualHash(bytes)).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ----------------------------------------------------------------------------
// M-PESA SMS
// ----------------------------------------------------------------------------

describe('M-PESA SMS extractor', () => {
  it('parses an English sent confirmation', () => {
    const rec = parseOneMessage(
      'AB12C3D4E5 Confirmed. You have sent Tsh 50,000 to JOHN on 3/6/26 at 2:15 PM. New M-PESA balance is Tsh 120,500.',
    );
    expect(rec?.referenceId).toBe('AB12C3D4E5');
    expect(rec?.amount).toBe(50000);
    expect(rec?.direction).toBe('sent');
    expect(rec?.balance).toBe(120500);
    expect(rec?.occurredAt).toContain('2026-06-03T14:15');
  });

  it('parses a Swahili received confirmation', () => {
    const rec = parseOneMessage('XY98Z76543 Imethibitishwa. Umepokea Tsh 1,200,000 kutoka ASHA tarehe 1/6/26.');
    expect(rec?.direction).toBe('received');
    expect(rec?.amount).toBe(1200000);
  });

  it('batches multiple messages and collects unparsed lines', async () => {
    const input = [
      'AB12C3D4E5 Confirmed. You have sent Tsh 50,000 to JOHN on 3/6/26.',
      '',
      'this is not an mpesa message at all',
    ].join('\n');
    const result = await extractMpesaSms(input);
    expect(result.records).toHaveLength(1);
    expect(result.unparsedLines).toHaveLength(1);
  });

  it('uses the injected LLM fallback for an unparseable line', async () => {
    const result = await extractMpesaSms('garbled forward fragment', {
      normalise: async () => ({ referenceId: 'LLM1', amount: 1000, direction: 'unknown', rawText: 'x' }),
    });
    expect(result.records[0]?.referenceId).toBe('LLM1');
  });
});

// ----------------------------------------------------------------------------
// EML
// ----------------------------------------------------------------------------

describe('EML extractor', () => {
  it('parses a simple text email', () => {
    const eml = ['From: owner@mine.example', 'To: ops@borjie.example', 'Subject: Assay results', '', 'Body line one.'].join('\r\n');
    const result = extractEml(new TextEncoder().encode(eml));
    expect(result.subject).toBe('Assay results');
    expect(result.from).toContain('owner@mine.example');
    expect(result.to).toContain('ops@borjie.example');
    expect(result.bodyText).toContain('Body line one');
  });

  it('extracts a base64 attachment from a multipart message', () => {
    const boundary = 'XBOUND';
    const payload = Buffer.from('hello-pdf-bytes').toString('base64');
    const eml = [
      'From: a@b.example',
      'Subject: doc',
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain',
      '',
      'see attached',
      `--${boundary}`,
      'Content-Type: application/pdf',
      'Content-Disposition: attachment; name="cert.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      payload,
      `--${boundary}--`,
    ].join('\r\n');
    const result = extractEml(new TextEncoder().encode(eml));
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]?.filename).toBe('cert.pdf');
    expect(new TextDecoder().decode(result.attachments[0]?.bytes)).toBe('hello-pdf-bytes');
  });

  it('strips HTML to text when no plain part exists', () => {
    const eml = ['Subject: x', 'Content-Type: text/html', '', '<p>Hello <b>world</b></p>'].join('\r\n');
    const result = extractEml(new TextEncoder().encode(eml));
    expect(result.bodyText).toContain('Hello');
    expect(result.bodyText).not.toContain('<b>');
  });
});

// ----------------------------------------------------------------------------
// MSG
// ----------------------------------------------------------------------------

describe('MSG extractor', () => {
  it('throws MsgUnsupportedError when no reader is wired', async () => {
    await expect(extractMsg(new Uint8Array([1, 2, 3]))).rejects.toBeInstanceOf(MsgUnsupportedError);
  });

  it('uses an injected reader port', async () => {
    const reader: MsgReaderPort = {
      read: async () => ({ subject: 'Hi', senderEmail: 's@e.example', bodyText: 'body' }),
    };
    const result = await extractMsg(new Uint8Array([1]), reader);
    expect(result.subject).toBe('Hi');
    expect(result.senderEmail).toBe('s@e.example');
  });
});

// ----------------------------------------------------------------------------
// QR
// ----------------------------------------------------------------------------

describe('QR cross-verify', () => {
  it('matches identical normalised ids', () => {
    expect(crossVerifyQr({ qrPayload: '1990-0510', ocrCandidate: '19900510' }).matched).toBe(true);
  });
  it('tolerates a single-char OCR transposition', () => {
    const r = crossVerifyQr({ qrPayload: 'ABC123', ocrCandidate: 'ABC1Z3' });
    expect(r.matched).toBe(true);
    expect(r.score).toBeGreaterThan(0.8);
  });
  it('rejects clearly different ids', () => {
    expect(crossVerifyQr({ qrPayload: 'ABC123', ocrCandidate: 'ZZZ999' }).matched).toBe(false);
  });
  it('decodeAndCrossVerify is fail-soft when the decoder throws', async () => {
    const decoder: QrDecoderPort = {
      decode: async () => {
        throw new Error('jsqr boom');
      },
    };
    const r = await decodeAndCrossVerify(
      { luminance: new Uint8ClampedArray(4), width: 2, height: 2 },
      '19900510',
      decoder,
    );
    expect(r.matched).toBe(false);
  });
});
