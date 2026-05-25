/**
 * Nano Banana Imagery Renderer
 *
 * IMPORTANT — SCOPE GUARDRAIL:
 *   Per Docs/analysis/RESEARCH_ANSWERS.md Q8, Nano Banana is reserved for
 *   MARKETING IMAGERY ONLY (announcement covers, promo visuals).
 *   It MUST NOT be used to generate legal, financial, or tenant-facing
 *   documents — use docxtemplater/Typst/react-pdf for those.
 *
 * This renderer deliberately emits `image/png` / `image/jpeg` ONLY and
 * does not register for any document mime type.
 *
 * Configuration:
 *   NANO_BANANA_API_KEY   — required to call the real service.
 *   NANO_BANANA_API_URL   — optional override; defaults to the
 *                           production endpoint.
 *
 * Graceful degradation: when no API key is configured the renderer emits
 * a placeholder PNG (single grey 1x1 pixel) so downstream callers can
 * still complete their pipeline without a hard failure, and the result
 * metadata carries `mode: 'placeholder'` so operators can detect it.
 */

import type {
  IDocumentRenderer,
  RenderResult,
  RenderTemplate,
  RenderedMimeType,
} from './renderer-interface.js';
import { RendererError } from './renderer-interface.js';

export interface NanoBananaImageryTemplateInput {
  readonly prompt: string;
  readonly style?: 'photo' | 'illustration' | 'poster' | 'flyer';
  readonly width?: number;
  readonly height?: number;
  readonly brandPalette?: readonly string[];
}

export interface NanoBananaRendererOptions {
  /** Override the default API URL (e.g. for staging / self-hosted). */
  readonly apiUrl?: string;
  /** Injection seam for tests. */
  readonly fetchImpl?: typeof fetch;
}

const DEFAULT_API_URL = 'https://api.nano-banana.app/v1/images/generate';

// Minimal opaque 1x1 grey PNG — used as the placeholder when no API key
// is configured so the pipeline does not break in development.
/* eslint-disable no-secrets/no-secrets -- base64 PNG bytes, not a secret */
const PLACEHOLDER_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
/* eslint-enable no-secrets/no-secrets */

export class NanoBananaImageryRenderer implements IDocumentRenderer {
  readonly kind = 'nano-banana' as const;
  readonly supportedMimeTypes: readonly RenderedMimeType[] = ['image/png', 'image/jpeg'];
  /** Hard flag enforced at the factory layer so it's never selected for docs. */
  readonly isImageryOnly = true;

  private readonly apiUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: NanoBananaRendererOptions = {}) {
    this.apiUrl = options.apiUrl ?? process.env.NANO_BANANA_API_URL?.trim() ?? DEFAULT_API_URL;
    // Node 18+ provides a global `fetch`; tests may inject their own.
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as typeof fetch);
  }

  async render<TInput = Record<string, unknown>>(
    template: RenderTemplate<TInput>,
    inputs: TInput
  ): Promise<RenderResult> {
    const input = this.normalizeInput(inputs);

    const apiKey = process.env.NANO_BANANA_API_KEY?.trim();
    if (!apiKey) {
      // Structured degradation — emit a placeholder image so callers can
      // finish their workflow, and stamp the meta so operators notice.
      return {
        buffer: Buffer.from(PLACEHOLDER_PNG_B64, 'base64'),
        mimeType: 'image/png',
        meta: {
          engine: 'nano-banana',
          templateId: template.id,
          mode: 'placeholder',
          reason: 'NANO_BANANA_API_KEY unset',
        },
      };
    }

    if (!this.fetchImpl) {
      throw new RendererError(
        'RENDER_FAILED',
        'NanoBanana: no fetch implementation available at runtime'
      );
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          prompt: input.prompt,
          style: input.style ?? 'poster',
          width: input.width ?? 1080,
          height: input.height ?? 1080,
          palette: input.brandPalette ?? [],
          templateId: template.id,
        }),
      });
    } catch (err) {
      throw new RendererError(
        'RENDER_FAILED',
        `NanoBanana fetch failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new RendererError(
        'RENDER_FAILED',
        `NanoBanana ${response.status}: ${errText.slice(0, 400)}`
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const mimeType = ((response.headers.get('content-type') ?? 'image/png') as RenderedMimeType);
    return {
      buffer,
      mimeType,
      meta: {
        engine: 'nano-banana',
        templateId: template.id,
        mode: 'live',
      },
    };
  }

  private normalizeInput<TInput>(inputs: TInput): NanoBananaImageryTemplateInput {
    if (!inputs || typeof inputs !== 'object') {
      throw new RendererError(
        'INVALID_INPUT',
        'NanoBanana inputs must be an object with a `prompt` field.'
      );
    }
    const obj = inputs as unknown as Record<string, unknown>;
    const prompt = obj.prompt;
    if (typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new RendererError('INVALID_INPUT', 'NanoBanana requires a non-empty `prompt`.');
    }
    return {
      prompt,
      style: (obj.style as NanoBananaImageryTemplateInput['style']) ?? undefined,
      width: typeof obj.width === 'number' ? obj.width : undefined,
      height: typeof obj.height === 'number' ? obj.height : undefined,
      brandPalette: Array.isArray(obj.brandPalette)
        ? (obj.brandPalette as readonly string[])
        : undefined,
    };
  }
}
