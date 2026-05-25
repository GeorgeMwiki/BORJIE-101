import { describe, it, expect } from 'vitest';
import {
  parseWhatsAppVoiceMessage,
  downloadAudio,
  convertOpusToWav,
  extractOpusFromWav,
} from '../index.js';
import type { MetaWebhookPayload } from '../index.js';

describe('parseWhatsAppVoiceMessage', () => {
  const validPayload: MetaWebhookPayload = {
    entry: [
      {
        changes: [
          {
            value: {
              messaging_product: 'whatsapp',
              messages: [
                {
                  from: '255700123456',
                  id: 'wamid.xyz',
                  timestamp: '1716620000',
                  type: 'audio',
                  audio: {
                    id: 'media-abc',
                    mime_type: 'audio/ogg; codecs=opus',
                    voice: true,
                    transcription: 'Habari, mwenye nyumba',
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it('extracts a voice message from a well-formed payload', () => {
    const msgs = parseWhatsAppVoiceMessage(validPayload, { tenantId: 'tenant-1' });
    expect(msgs.length).toBe(1);
    const m = msgs[0]!;
    expect(m.messageId).toBe('wamid.xyz');
    expect(m.waPhoneNumberE164).toBe('+255700123456');
    expect(m.mediaId).toBe('media-abc');
    expect(m.mimeType).toBe('audio/ogg');
    expect(m.autoTranscript).toBe('Habari, mwenye nyumba');
    expect(m.tenantId).toBe('tenant-1');
    expect(m.receivedAtIso).toMatch(/^2024-/);
  });

  it('returns empty array for non-audio messages', () => {
    const payload: MetaWebhookPayload = {
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  { from: '1', id: 'wamid.text', timestamp: '0', type: 'text' },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(parseWhatsAppVoiceMessage(payload)).toHaveLength(0);
  });

  it('ignores messages with missing media id', () => {
    const broken = JSON.parse(JSON.stringify(validPayload)) as MetaWebhookPayload;
    delete (broken.entry![0]!.changes![0]!.value!.messages![0]! as any).audio.id;
    expect(parseWhatsAppVoiceMessage(broken)).toHaveLength(0);
  });

  it('throws on a non-object payload', () => {
    expect(() => parseWhatsAppVoiceMessage(null as unknown as MetaWebhookPayload)).toThrow(
      /payload/,
    );
  });

  it('normalises a leading-zero international phone number', () => {
    const p: MetaWebhookPayload = {
      entry: [
        {
          changes: [
            {
              value: {
                messaging_product: 'whatsapp',
                messages: [
                  {
                    from: '0255700111222',
                    id: 'wamid.zero',
                    timestamp: '1716620000',
                    type: 'audio',
                    audio: { id: 'm-zero', mime_type: 'audio/ogg' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const msgs = parseWhatsAppVoiceMessage(p);
    expect(msgs[0]?.waPhoneNumberE164).toBe('+255700111222');
  });
});

describe('convertOpusToWav / extractOpusFromWav', () => {
  it('wraps opus bytes in a 44-byte WAV header and round-trips', () => {
    const opus = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const wav = convertOpusToWav(opus);
    expect(wav.length).toBe(44 + opus.length);
    // RIFF + WAVE magic
    expect(wav[0]).toBe(0x52);
    expect(wav[8]).toBe(0x57);

    const extracted = extractOpusFromWav(wav);
    expect(extracted.length).toBe(opus.length);
    expect(Array.from(extracted)).toEqual(Array.from(opus));
  });

  it('throws on empty opus payload', () => {
    expect(() => convertOpusToWav(new Uint8Array())).toThrow(/empty/);
  });

  it('returns the original bytes when extracting from non-WAV input', () => {
    const not_wav = Uint8Array.from([9, 9, 9, 9, 9]);
    expect(Array.from(extractOpusFromWav(not_wav))).toEqual([9, 9, 9, 9, 9]);
  });

  it('honors sample-rate and channel options', () => {
    const opus = Uint8Array.from([10, 20, 30]);
    const wav = convertOpusToWav(opus, { sampleRate: 24000, channels: 2 });
    // bytes 24..27 hold sampleRate little-endian
    const view = new DataView(wav.buffer);
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(22, true)).toBe(2);
  });
});

describe('downloadAudio', () => {
  it('does the two-step Meta media fetch when supplied with a stub fetch', async () => {
    let step = 0;
    const fakeFetch = (async (url: string) => {
      step++;
      if (step === 1) {
        expect(url).toContain('/media-abc');
        return new Response(
          JSON.stringify({ url: 'https://signed.example/media', mime_type: 'audio/ogg' }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      expect(url).toBe('https://signed.example/media');
      return new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/ogg' },
      });
    }) as typeof fetch;

    const result = await downloadAudio({
      mediaId: 'media-abc',
      accessToken: 'tok',
      fetchImpl: fakeFetch,
    });
    expect(result.audio.length).toBe(3);
    expect(result.mimeType).toBe('audio/ogg');
  });

  it('throws when the metadata response lacks a url', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    await expect(
      downloadAudio({ mediaId: 'm', accessToken: 't', fetchImpl: fakeFetch }),
    ).rejects.toThrow(/missing url/);
  });

  it('throws on missing arguments', async () => {
    await expect(downloadAudio({ mediaId: '', accessToken: 't' })).rejects.toThrow(/mediaId/);
    await expect(downloadAudio({ mediaId: 'm', accessToken: '' })).rejects.toThrow(
      /accessToken/,
    );
  });
});
