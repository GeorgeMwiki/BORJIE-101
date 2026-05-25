import { describe, expect, it } from 'vitest';
import {
  createCapturePipeline,
  createInMemoryCaptureStore,
  defaultAiInference,
  hashCapturePayload,
  parseExifGps,
  signCapture,
  verifyCapture,
  type C2paSignaturePayload,
} from '../capture/index.js';

function makeMinimalJpeg(): ArrayBuffer {
  // Smallest valid JPEG: SOI + EOI. No EXIF -> parseExifGps returns null.
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  return bytes.buffer;
}

function makeJpegWithGps(): ArrayBuffer {
  // Hand-crafted JPEG with APP1/EXIF segment containing GPS lat/lng tags.
  // Coordinates: 36° 49' 12" E, 1° 17' 13.2" S.
  // Latitude is encoded with GPSLatitudeRef = 'S'.

  // TIFF header (II + magic 0x002A + IFD0 offset 8 from TIFF start)
  // IFD0: 1 entry — GPS IFD pointer (tag 0x8825) -> offset
  // GPS IFD: 4 entries — LatRef, Lat (3 rationals), LngRef, Lng (3 rationals)
  //
  // We construct everything relative to TIFF start (offset 0 inside our
  // "tiffBody"), then prepend the JPEG SOI + APP1 markers.

  const writeUint16 = (buf: Uint8Array, off: number, val: number, little = true): void => {
    if (little) {
      buf[off] = val & 0xff;
      buf[off + 1] = (val >> 8) & 0xff;
    } else {
      buf[off] = (val >> 8) & 0xff;
      buf[off + 1] = val & 0xff;
    }
  };
  const writeUint32 = (buf: Uint8Array, off: number, val: number, little = true): void => {
    if (little) {
      buf[off] = val & 0xff;
      buf[off + 1] = (val >> 8) & 0xff;
      buf[off + 2] = (val >> 16) & 0xff;
      buf[off + 3] = (val >> 24) & 0xff;
    } else {
      buf[off] = (val >> 24) & 0xff;
      buf[off + 1] = (val >> 16) & 0xff;
      buf[off + 2] = (val >> 8) & 0xff;
      buf[off + 3] = val & 0xff;
    }
  };

  // Plan layout in TIFF body (little-endian):
  //   0..3  : byte order 'II' + 0x002A
  //   4..7  : IFD0 offset = 8
  //   8..9  : IFD0 entry count = 1
  //   10..21: entry: tag 0x8825, type 4 (LONG), count 1, value-offset (GPS IFD start)
  //   22..25: IFD0 next-offset = 0
  //   26..27: GPS IFD entry count = 4
  //   28..39: entry: LatRef tag 0x0001, type 2 (ASCII), count 2, value 'S\0' inline
  //   40..51: entry: Lat tag 0x0002, type 5 (RATIONAL), count 3, value-offset
  //   52..63: entry: LngRef tag 0x0003, type 2, count 2, value 'E\0' inline
  //   64..75: entry: Lng tag 0x0004, type 5, count 3, value-offset
  //   76..79: GPS IFD next-offset = 0
  //   80..103: Lat rational data: 1/1, 17/1, 132/10  (degrees, minutes, seconds*10)
  //   104..127: Lng rational data: 36/1, 49/1, 12/1
  const tiffBodyLen = 128;
  const tiffBody = new Uint8Array(tiffBodyLen);

  // Header
  tiffBody[0] = 0x49; // 'I'
  tiffBody[1] = 0x49;
  writeUint16(tiffBody, 2, 0x002a);
  writeUint32(tiffBody, 4, 8);

  // IFD0
  writeUint16(tiffBody, 8, 1);
  writeUint16(tiffBody, 10, 0x8825);
  writeUint16(tiffBody, 12, 4);
  writeUint32(tiffBody, 14, 1);
  writeUint32(tiffBody, 18, 26); // GPS IFD start
  writeUint32(tiffBody, 22, 0);

  // GPS IFD
  writeUint16(tiffBody, 26, 4); // count

  // LatRef = 'S\0' inline
  writeUint16(tiffBody, 28, 0x0001);
  writeUint16(tiffBody, 30, 2);
  writeUint32(tiffBody, 32, 2);
  tiffBody[36] = 0x53; // 'S'
  tiffBody[37] = 0x00;
  tiffBody[38] = 0x00;
  tiffBody[39] = 0x00;

  // Lat rational, offset 80
  writeUint16(tiffBody, 40, 0x0002);
  writeUint16(tiffBody, 42, 5);
  writeUint32(tiffBody, 44, 3);
  writeUint32(tiffBody, 48, 80);

  // LngRef = 'E\0' inline
  writeUint16(tiffBody, 52, 0x0003);
  writeUint16(tiffBody, 54, 2);
  writeUint32(tiffBody, 56, 2);
  tiffBody[60] = 0x45; // 'E'
  tiffBody[61] = 0x00;
  tiffBody[62] = 0x00;
  tiffBody[63] = 0x00;

  // Lng rational, offset 104
  writeUint16(tiffBody, 64, 0x0004);
  writeUint16(tiffBody, 66, 5);
  writeUint32(tiffBody, 68, 3);
  writeUint32(tiffBody, 72, 104);

  writeUint32(tiffBody, 76, 0);

  // Lat: 1, 17, 13.2 -> 1/1, 17/1, 132/10
  writeUint32(tiffBody, 80, 1);
  writeUint32(tiffBody, 84, 1);
  writeUint32(tiffBody, 88, 17);
  writeUint32(tiffBody, 92, 1);
  writeUint32(tiffBody, 96, 132);
  writeUint32(tiffBody, 100, 10);

  // Lng: 36, 49, 12 -> 36/1, 49/1, 12/1
  writeUint32(tiffBody, 104, 36);
  writeUint32(tiffBody, 108, 1);
  writeUint32(tiffBody, 112, 49);
  writeUint32(tiffBody, 116, 1);
  writeUint32(tiffBody, 120, 12);
  writeUint32(tiffBody, 124, 1);

  // APP1 segment: 0xFFE1 + segLen + "Exif\0\0" + tiffBody + EOI
  const exifHeader = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]); // "Exif\0\0"
  const segPayload = new Uint8Array(exifHeader.length + tiffBody.length);
  segPayload.set(exifHeader, 0);
  segPayload.set(tiffBody, exifHeader.length);

  const segLen = segPayload.length + 2; // includes length bytes themselves
  const out = new Uint8Array(2 + 2 + 2 + segPayload.length + 2);
  out[0] = 0xff; out[1] = 0xd8; // SOI
  out[2] = 0xff; out[3] = 0xe1; // APP1
  out[4] = (segLen >> 8) & 0xff;
  out[5] = segLen & 0xff;
  out.set(segPayload, 6);
  out[6 + segPayload.length] = 0xff;
  out[6 + segPayload.length + 1] = 0xd9; // EOI

  return out.buffer;
}

describe('capture — EXIF GPS', () => {
  it('returns null for non-JPEG bytes', () => {
    expect(parseExifGps(new ArrayBuffer(2))).toBeNull();
  });

  it('returns null for JPEG without EXIF', () => {
    expect(parseExifGps(makeMinimalJpeg())).toBeNull();
  });

  it('extracts GPS lat/lng from a hand-crafted JPEG', () => {
    const exif = parseExifGps(makeJpegWithGps());
    expect(exif).not.toBeNull();
    // Latitude: 1° 17' 13.2" S -> -(1 + 17/60 + 13.2/3600)
    expect(exif?.lat).toBeCloseTo(-(1 + 17 / 60 + 13.2 / 3600), 3);
    // Longitude: 36° 49' 12" E -> +36.82
    expect(exif?.lng).toBeCloseTo(36 + 49 / 60 + 12 / 3600, 3);
  });
});

describe('capture — C2PA signature roundtrip', () => {
  it('signs and verifies a payload', () => {
    const payload: C2paSignaturePayload = {
      captureId: 'cap_1',
      kind: 'photo',
      capturedAt: '2026-01-01T00:00:00Z',
      surveyorUserId: 'u1',
      tenantId: 't1',
      payloadHashHex: hashCapturePayload('hello'),
      location: { lat: -1.28, lng: 36.82 },
    };
    const sig = signCapture(payload);
    expect(verifyCapture(payload, sig)).toBe(true);
  });

  it('verification fails for tampered payload', () => {
    const payload: C2paSignaturePayload = {
      captureId: 'cap_1',
      kind: 'photo',
      capturedAt: '2026-01-01T00:00:00Z',
      surveyorUserId: 'u1',
      tenantId: 't1',
      payloadHashHex: hashCapturePayload('hello'),
    };
    const sig = signCapture(payload);
    const tampered = { ...payload, captureId: 'cap_2' };
    expect(verifyCapture(tampered, sig)).toBe(false);
  });
});

describe('capture — pipeline', () => {
  it('rejects a photo without GPS', async () => {
    const store = createInMemoryCaptureStore();
    const pipeline = createCapturePipeline({ store });
    const out = await pipeline.submitFieldCapture({
      surveyorUserId: 'u1',
      tenantId: 't1',
      captures: [{ kind: 'photo' }],
    });
    expect(out[0]?.status).toBe('rejected');
    expect((out[0]?.metadata as { rejectionReason?: string }).rejectionReason).toMatch(/GPS/);
  });

  it('accepts a photo with explicit location', async () => {
    const store = createInMemoryCaptureStore();
    const pipeline = createCapturePipeline({ store });
    const out = await pipeline.submitFieldCapture({
      surveyorUserId: 'u1',
      tenantId: 't1',
      captures: [{
        kind: 'photo',
        capturedLocation: { lat: -1.28, lng: 36.82 },
      }],
    });
    expect(out[0]?.status).toBe('processed');
    expect(out[0]?.capturedLocation?.coordinates).toEqual([36.82, -1.28]);
    expect(out[0]?.c2paSignature).toBeDefined();
  });

  it('accepts an audio capture without GPS', async () => {
    const store = createInMemoryCaptureStore();
    const pipeline = createCapturePipeline({ store });
    const out = await pipeline.submitFieldCapture({
      surveyorUserId: 'u1',
      tenantId: 't1',
      captures: [{ kind: 'audio', storageUri: 's3://...' }],
    });
    expect(out[0]?.status).toBe('processed');
  });

  it('attaches AI inferences from defaultAiInference()', async () => {
    const store = createInMemoryCaptureStore();
    const pipeline = createCapturePipeline({ store, aiInference: defaultAiInference() });
    const out = await pipeline.submitFieldCapture({
      surveyorUserId: 'u1',
      tenantId: 't1',
      captures: [{
        kind: 'photo',
        capturedLocation: { lat: -1.28, lng: 36.82 },
      }],
    });
    expect(out[0]?.aiInferences).toBeDefined();
    expect((out[0]?.aiInferences as { detectedObjects?: string[] }).detectedObjects).toContain('building');
  });

  it('store lists captures for a surveyor', async () => {
    const store = createInMemoryCaptureStore();
    const pipeline = createCapturePipeline({ store });
    await pipeline.submitFieldCapture({
      surveyorUserId: 'u1',
      tenantId: 't1',
      captures: [{ kind: 'audio' }, { kind: 'inspection' }],
    });
    const list = store.listForSurveyor('u1');
    expect(list.length).toBe(2);
  });

  it('store updates status', () => {
    const store = createInMemoryCaptureStore();
    const captureId = 'cap_x';
    store.add({
      captureId,
      tenantId: 't1',
      surveyorUserId: 'u1',
      kind: 'audio',
      capturedAt: '2026-01-01T00:00:00Z',
      status: 'queued',
      metadata: {},
      createdAt: '2026-01-01T00:00:00Z',
    });
    const updated = store.updateStatus(captureId, 'processed');
    expect(updated?.status).toBe('processed');
    expect(store.updateStatus('missing', 'processed')).toBeNull();
  });
});
