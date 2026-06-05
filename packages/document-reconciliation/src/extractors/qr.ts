/**
 * QR decode + cross-verify (LP-26).
 *
 * Most NIDA cards and TRA/licence certificates carry a QR encoding the
 * canonical identifier. Comparing the decoded payload against the OCR string
 * is the cheapest cross-check we have against tampering.
 *
 * The decode step is an injected port (the host binds it to `jsqr` or a
 * vision model); the cross-verify step is PURE and always available, so the
 * cross-check works the moment a payload exists from any source.
 *
 * @module @borjie/document-reconciliation/extractors/qr
 */

export interface QrDecodeInput {
  readonly luminance: Uint8ClampedArray;
  readonly width: number;
  readonly height: number;
}

/** Injected QR decoder (jsqr-shaped). Returns the payload or null. */
export interface QrDecoderPort {
  decode(input: QrDecodeInput): Promise<string | null>;
}

export interface QrCrossVerifyResult {
  readonly matched: boolean;
  /** Normalised OCR identifier compared against. */
  readonly ocrCandidate: string;
  /** Normalised QR payload. */
  readonly qrPayload: string;
  /** 0..1 score (1 = exact match). */
  readonly score: number;
}

/**
 * Cross-verify a decoded QR payload against an OCR-extracted identifier.
 * Allows a single-character OCR transposition (e.g. 0 vs O). Pure, never
 * throws.
 */
export function crossVerifyQr(args: {
  readonly qrPayload: string | null;
  readonly ocrCandidate: string;
}): QrCrossVerifyResult {
  const qr = normaliseId(args.qrPayload ?? '');
  const ocr = normaliseId(args.ocrCandidate);
  if (!qr || !ocr) {
    return { matched: false, score: 0, qrPayload: qr, ocrCandidate: ocr };
  }
  if (qr === ocr) {
    return { matched: true, score: 1, qrPayload: qr, ocrCandidate: ocr };
  }
  const distance = editDistance(qr, ocr);
  const len = Math.max(qr.length, ocr.length);
  const score = len === 0 ? 0 : Math.max(0, 1 - distance / len);
  return { matched: distance <= 1, score: Number(score.toFixed(3)), qrPayload: qr, ocrCandidate: ocr };
}

/**
 * Decode + cross-verify in one step using the injected decoder. Fail-soft:
 * a decoder throw or a null payload yields a non-match rather than an error.
 */
export async function decodeAndCrossVerify(
  input: QrDecodeInput,
  ocrCandidate: string,
  decoder: QrDecoderPort,
): Promise<QrCrossVerifyResult> {
  let payload: string | null = null;
  try {
    payload = await decoder.decode(input);
  } catch {
    payload = null;
  }
  return crossVerifyQr({ qrPayload: payload, ocrCandidate });
}

function normaliseId(input: string): string {
  return input.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
}

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev: number[] = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let i = 1; i <= b.length; i += 1) {
    const next: number[] = new Array(a.length + 1);
    next[0] = i;
    for (let j = 1; j <= a.length; j += 1) {
      const cost = a.charCodeAt(j - 1) === b.charCodeAt(i - 1) ? 0 : 1;
      next[j] = Math.min((next[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = next;
  }
  return prev[a.length] ?? 0;
}
