/**
 * Tesseract.js adapter — wraps the WASM engine with `eng + swa` traineddata.
 *
 * The dep is `optionalDependencies`, so we lazy-import inside the function.
 * Callers that don't need OCR (born-digital path) never pay the WASM cost.
 *
 * On environments where `tesseract.js` is not installed (CI for unit tests,
 * lightweight Lambda), this throws a typed `TesseractUnavailable` error so
 * callers can fall back to a cloud-OCR provider or surface a friendly error.
 */

export class TesseractUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TesseractUnavailableError';
  }
}

export interface TesseractOptions {
  /** ISO-639 language codes, joined as Tesseract expects ('eng+swa'). */
  readonly languages?: ReadonlyArray<'eng' | 'swa'>;
  /** Optional progress callback (0-1 float). */
  readonly onProgress?: (fraction: number) => void;
}

export interface TesseractWord {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: { x0: number; y0: number; x1: number; y1: number };
}

export interface TesseractRunResult {
  readonly text: string;
  readonly confidence: number;
  readonly words: ReadonlyArray<TesseractWord>;
  readonly language: string;
}

/**
 * Run Tesseract.js OCR on an image buffer. Throws if tesseract.js is not
 * installed in the host environment.
 */
export async function runTesseract(
  buffer: Buffer,
  options: TesseractOptions = {},
): Promise<TesseractRunResult> {
  const languages = options.languages?.length
    ? options.languages.join('+')
    : 'eng+swa';

  let mod: unknown;
  try {
    // Dynamic import so the dep is genuinely optional.
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- SCRUB-5f: rule-disabled because some bundler transforms convert dynamic import() to require() and tesseract.js is a soft optional dep
    mod = await import(/* @vite-ignore */ 'tesseract.js');
  } catch (err) {
    throw new TesseractUnavailableError(
      `tesseract.js not installed in this environment: ${(err as Error).message}. ` +
        `Add it via 'pnpm add tesseract.js' or fall back to a cloud OCR provider.`,
    );
  }

  // tesseract.js v5 exports `recognize` and a `createWorker` factory. We
  // use the high-level `recognize` for simplicity; high-volume callers
  // should switch to the worker pool.
  const modShape = mod as {
    recognize?: unknown;
    default?: { recognize?: unknown };
  };
  const recognize = (modShape.recognize ?? modShape.default?.recognize) as (
    image: Buffer,
    langs: string,
    opts?: { logger?: (m: { status: string; progress: number }) => void },
  ) => Promise<{
    data: {
      text: string;
      confidence: number;
      words?: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    };
  }>;

  if (typeof recognize !== 'function') {
    throw new TesseractUnavailableError(
      'tesseract.js loaded but `recognize` is not a function — unsupported version?',
    );
  }

  const out = await recognize(buffer, languages, {
    logger: options.onProgress
      ? (m): void => {
          if (m.status === 'recognizing text') {
            options.onProgress?.(m.progress);
          }
        }
      : undefined,
  });

  const words: TesseractWord[] = (out.data.words ?? []).map((w) => ({
    text: w.text,
    confidence: Math.max(0, Math.min(100, w.confidence)) / 100,
    bbox: w.bbox,
  }));

  return {
    text: out.data.text ?? '',
    confidence: Math.max(0, Math.min(100, out.data.confidence ?? 0)) / 100,
    words,
    language: languages,
  };
}
