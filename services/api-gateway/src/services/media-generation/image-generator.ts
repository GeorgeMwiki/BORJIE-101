/**
 * AI image generator — natural-language prompts in, PNG out.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. Wraps the cross-provider dispatcher in
 * `@borjie/media-generation` when available, otherwise falls back to a
 * deterministic 1x1 PNG so callers in test / brownout still receive a
 * well-formed payload.
 *
 * The api-gateway uses this for: inline chat-image cards, draft
 * cover-page imagery, infographic background plates.
 */

export interface GenerateImageInput {
  readonly prompt: string;
  readonly size?: '512x512' | '1024x1024' | '1024x1792' | '1792x1024';
  readonly aspectRatio?: '1:1' | '16:9' | '9:16' | '4:5';
  readonly brandColors?: ReadonlyArray<string>;
  readonly intent?: string;
}

export interface GenerateImageOutput {
  /** URL is set when the underlying provider returns a hosted asset. */
  readonly url: string | null;
  readonly blob: Buffer;
  readonly durationMs: number;
  readonly providerLabel: string;
}

const FALLBACK_PNG_1X1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6360000000000500016ce8d2c70000000049454e44ae426082',
  'hex',
);

let dispatcherSingleton: unknown = null;

async function getDispatcher(): Promise<unknown> {
  if (dispatcherSingleton !== null) return dispatcherSingleton;
  try {
    // Resolve the package id dynamically so the bundler does not
    // hard-require the optional dependency at compile time.
    const pkg = '@borjie' + '/media-generation';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod: any = await import(/* @vite-ignore */ pkg).catch(() => null);
    if (mod && typeof mod.createMediaDispatcher === 'function') {
      dispatcherSingleton = mod.createMediaDispatcher();
    }
  } catch {
    dispatcherSingleton = null;
  }
  return dispatcherSingleton;
}

export async function generateImage(
  input: GenerateImageInput,
): Promise<GenerateImageOutput> {
  const start = Date.now();
  if (!input.prompt || input.prompt.trim().length === 0) {
    throw new Error('image-generator: prompt must not be empty');
  }
  const dispatcher = await getDispatcher();
  if (dispatcher && typeof dispatcher === 'object') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const run = (dispatcher as any).generate ?? (dispatcher as any).run;
      if (typeof run === 'function') {
        const out = await run({
          kind: 'image',
          prompt: input.prompt,
          size: input.size ?? '1024x1024',
          aspectRatio: input.aspectRatio ?? '1:1',
          brandColors: input.brandColors ?? [],
        });
        const buf: Buffer = out?.blob instanceof Buffer ? out.blob : FALLBACK_PNG_1X1;
        return {
          url: typeof out?.url === 'string' ? out.url : null,
          blob: buf,
          durationMs: Date.now() - start,
          providerLabel: typeof out?.provider === 'string' ? out.provider : 'unknown',
        };
      }
    } catch {
      // fall through to fallback
    }
  }
  return {
    url: null,
    blob: FALLBACK_PNG_1X1,
    durationMs: Date.now() - start,
    providerLabel: 'fallback-1x1',
  };
}
