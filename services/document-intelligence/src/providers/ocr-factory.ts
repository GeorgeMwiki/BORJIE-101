/**
 * OCR factory — returns an IOCRProvider implementation based on config.
 *
 * Also exposes env-based selection + a fallback wrapper so callers can keep
 * mock as a safety net in dev/test while raising in production.
 *
 * Security posture (ProdFix-1):
 *   - `OCR_PROVIDER` MUST be explicit in any non-test environment. Defaulting
 *     to `'mock'` silently shipped fixture NIDA / Kenya-ID data to staging
 *     and QA tenants — this factory now throws `ProviderUnavailableError`
 *     instead.
 *   - `OCR_FALLBACK_TO_MOCK` defaults `false` everywhere. Opt-in must be
 *     explicit (`OCR_FALLBACK_TO_MOCK=true`) and is rejected outright in
 *     production.
 *   - The factory accepts a `tenantRegion` parameter so per-tenant OCR
 *     calls route to the tenant's home AWS region (TZ PDPA + KE DPA
 *     data-residency). The legacy default-US-region literal is gone.
 */

import type { IOCRProvider } from '../services/ocr-extraction.service.js';
import type {
  AwsTextractConfig,
  GoogleVisionConfig,
  MockProviderConfig,
  OcrProviderConfig,
} from './types.js';
import { createAwsTextractProvider } from './aws-textract.provider.js';
import { createGoogleVisionProvider } from './google-vision.provider.js';
import { createMockProvider } from './mock.provider.js';
import { logger } from '../utils/logger.js';
import type { ExtractedField, OCRProvider } from '../types/index.js';

/**
 * Surfaced when callers try to construct an OCR provider without enough
 * config to do so safely. Loud refusal — mirrors the
 * `services/api-gateway/src/data/mock-data.ts` hard-fail pattern.
 */
export class ProviderUnavailableError extends Error {
  readonly code = 'OCR_PROVIDER_UNAVAILABLE';
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export function getOcrProvider(config: OcrProviderConfig): IOCRProvider {
  switch (config.provider) {
    case 'aws_textract':
      return createAwsTextractProvider(config);
    case 'google_vision':
      return createGoogleVisionProvider(config);
    case 'mock':
      return createMockProvider(config);
    default: {
      const exhaustive: never = config;
      throw new Error(
        `Unknown OCR provider: ${(exhaustive as { provider: string }).provider}`
      );
    }
  }
}

export interface EnvProviderOptions {
  /** Override for process.env — useful for tests. */
  readonly env?: NodeJS.ProcessEnv;
  /** When true, fall back to mock provider on auth/network/sdk errors. */
  readonly fallbackToMock?: boolean;
  /**
   * Per-tenant AWS region (read from `tenants.region`, migration 0158).
   * When supplied, overrides `env.AWS_REGION` so each tenant's OCR call
   * stays in their home region — required for TZ PDPA + KE DPA
   * data-residency. The legacy default-US-region literal fallback is
   * gone; if neither `tenantRegion` nor `env.AWS_REGION` is set the
   * factory refuses (throws `ProviderUnavailableError`) so no TZ/KE
   * tenant silently gets routed to a US bucket.
   */
  readonly tenantRegion?: string;
}

/**
 * Build an OCR provider from environment variables.
 * Reads `OCR_PROVIDER` (textract | google | mock).
 *
 * Security gates (ProdFix-1):
 *   - `OCR_PROVIDER` MUST be set explicitly except in test runs
 *     (`NODE_ENV === 'test'`). Anything else throws
 *     `ProviderUnavailableError`.
 *   - `OCR_FALLBACK_TO_MOCK` defaults `false`; opt-in must be explicit
 *     and is rejected in production.
 *   - `tenantRegion` (from `tenants.region`) overrides `AWS_REGION`.
 */
export function getOcrProviderFromEnv(
  options: EnvProviderOptions = {}
): IOCRProvider {
  const env = options.env ?? process.env;
  const nodeEnv = env.NODE_ENV ?? '';
  const rawProvider = env.OCR_PROVIDER?.trim().toLowerCase();

  if (!rawProvider) {
    if (nodeEnv !== 'test') {
      throw new ProviderUnavailableError(
        // eslint-disable-next-line no-secrets/no-secrets -- documented enum values, not a secret
        'OCR_PROVIDER not configured — set OCR_PROVIDER=mock|aws_textract|google_vision. ' +
          'Mock fixtures are only allowed in NODE_ENV=test; staging / QA / production ' +
          'must point at a real OCR vendor.'
      );
    }
    // Test runs without an explicit provider get the deterministic mock —
    // the only place fixture data is ever served.
    return getOcrProvider({ provider: 'mock' });
  }

  let primaryConfig: OcrProviderConfig;
  switch (rawProvider) {
    case 'textract':
    case 'aws_textract':
    case 'aws': {
      const region = options.tenantRegion?.trim() || env.AWS_REGION?.trim();
      if (!region) {
        throw new ProviderUnavailableError(
          'OCR_PROVIDER=aws_textract requires a region — pass `tenantRegion` ' +
            '(from tenants.region) or set AWS_REGION. No default region literal ' +
            'is used so TZ/KE tenants never get silently routed to a US region.'
        );
      }
      const textractConfig: AwsTextractConfig = {
        provider: 'aws_textract',
        region,
        accessKeyId: env.AWS_ACCESS_KEY_ID,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
        defaultLanguage: env.OCR_DEFAULT_LANGUAGE,
      };
      primaryConfig = textractConfig;
      break;
    }
    case 'google':
    case 'google_vision':
    case 'gcv': {
      const projectId = env.GOOGLE_PROJECT_ID ?? env.GCLOUD_PROJECT;
      if (!projectId) {
        throw new Error(
          'OCR_PROVIDER=google requires GOOGLE_PROJECT_ID or GCLOUD_PROJECT'
        );
      }
      const googleConfig: GoogleVisionConfig = {
        provider: 'google_vision',
        projectId,
        keyFilename: env.GOOGLE_APPLICATION_CREDENTIALS,
        defaultLanguage: env.OCR_DEFAULT_LANGUAGE,
      };
      primaryConfig = googleConfig;
      break;
    }
    case 'mock': {
      // Production refuses to construct the mock provider — fixture data
      // serving real users is a P0. Staging / QA must opt-in deliberately.
      if (nodeEnv === 'production') {
        throw new ProviderUnavailableError(
          'OCR_PROVIDER=mock is forbidden in production. Mock fixtures only ship ' +
            'real ID data — set OCR_PROVIDER=aws_textract or google_vision.'
        );
      }
      const mockConfig: MockProviderConfig = {
        provider: 'mock',
        defaultLanguage: env.OCR_DEFAULT_LANGUAGE,
      };
      primaryConfig = mockConfig;
      break;
    }
    default:
      throw new ProviderUnavailableError(
        `OCR_PROVIDER=${rawProvider} is not recognised. ` +
          'Valid values: aws_textract | google_vision | mock (mock = test/dev only).'
      );
  }

  const primary = getOcrProvider(primaryConfig);

  // `OCR_FALLBACK_TO_MOCK` is OPT-IN. Refuses in production outright — even
  // the explicit opt-in is rejected when NODE_ENV=production so a real OCR
  // outage surfaces a real error rather than silent fixture data.
  const explicitFallbackOptIn =
    options.fallbackToMock === true || env.OCR_FALLBACK_TO_MOCK === 'true';

  if (explicitFallbackOptIn && nodeEnv === 'production') {
    throw new ProviderUnavailableError(
      'OCR_FALLBACK_TO_MOCK=true is forbidden in production. Fixture data must ' +
        'never serve real tenants. A real-vendor outage must surface a real error.'
    );
  }

  const fallbackToMock = explicitFallbackOptIn && nodeEnv !== 'production';

  if (primary.name === 'mock' || !fallbackToMock) {
    return primary;
  }

  const fallback = createMockProvider({ provider: 'mock' });
  return new FallbackOcrProvider(primary, fallback);
}

/**
 * Provider wrapper — runs the primary, falls back to secondary on auth /
 * network / SDK-missing errors. In production, fallbackToMock should be false
 * so errors surface rather than being masked by fixture data.
 */
export class FallbackOcrProvider implements IOCRProvider {
  readonly name: OCRProvider;

  constructor(
    private readonly primary: IOCRProvider,
    private readonly secondary: IOCRProvider
  ) {
    this.name = primary.name;
  }

  async extractText(
    buffer: Buffer,
    mimeType: string,
    options?: {
      language?: string;
      extractStructuredData?: boolean;
      documentType?: string;
    }
  ): Promise<{
    rawText: string;
    structuredData: Record<string, unknown> | null;
    fields: ExtractedField[];
    confidence: number;
    language: string;
    pageCount: number;
  }> {
    try {
      return await this.primary.extractText(buffer, mimeType, options);
    } catch (err) {
      if (!isRecoverable(err)) throw err;
      logger.warn('OCR primary provider failed, falling back', {
        primary: this.primary.name,
        secondary: this.secondary.name,
        error: err instanceof Error ? err.message : String(err),
      });
      return this.secondary.extractText(buffer, mimeType, options);
    }
  }
}

function isRecoverable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  if (typeof code !== 'string') return false;
  return [
    'TEXTRACT_AUTH',
    'TEXTRACT_NETWORK',
    'TEXTRACT_SDK_MISSING',
    'VISION_AUTH',
    'VISION_NETWORK',
    'VISION_SDK_MISSING',
  ].includes(code);
}
