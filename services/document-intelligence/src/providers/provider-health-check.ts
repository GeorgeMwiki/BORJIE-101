/**
 * Lightweight provider health checks.
 *
 * Used by the gateway's /healthz endpoint to verify that OCR provider
 * credentials are present and the underlying SDK can instantiate. We avoid
 * burning quota: for real providers we only confirm client construction and
 * credential presence; the actual extract call is skipped.
 */

import type { IOCRProvider } from '../services/ocr-extraction.service.js';
import type { OcrProviderConfig } from './types.js';

export interface ProviderHealth {
  readonly provider: string;
  readonly healthy: boolean;
  readonly checkedAt: string;
  readonly latencyMs: number;
  readonly error?: string;
  readonly details?: Record<string, unknown>;
}

export interface HealthCheckOptions {
  /** Override for process.env — useful for tests. */
  readonly env?: NodeJS.ProcessEnv;
  /** Probe with a tiny synthetic buffer. Defaults to false to save quota. */
  readonly probeExtract?: boolean;
}

/**
 * Verify a provider is ready to serve extract calls.
 *
 * Mock provider → always healthy.
 * AWS Textract → credentials present + SDK loadable.
 * Google Vision → credentials / key file present + SDK loadable.
 */
export async function checkProviderHealth(
  provider: IOCRProvider,
  options: HealthCheckOptions = {}
): Promise<ProviderHealth> {
  const env = options.env ?? process.env;
  const startedAt = Date.now();
  const checkedAt = new Date().toISOString();

  try {
    switch (provider.name) {
      case 'mock':
        return {
          provider: 'mock',
          healthy: true,
          checkedAt,
          latencyMs: Date.now() - startedAt,
        };

      case 'aws_textract': {
        const missing = missingEnv(env, ['AWS_REGION']);
        const hasCreds =
          (!!env.AWS_ACCESS_KEY_ID && !!env.AWS_SECRET_ACCESS_KEY) ||
          !!env.AWS_PROFILE ||
          !!env.AWS_WEB_IDENTITY_TOKEN_FILE;
        if (missing.length > 0 || !hasCreds) {
          return {
            provider: provider.name,
            healthy: false,
            checkedAt,
            latencyMs: Date.now() - startedAt,
            error:
              missing.length > 0
                ? `Missing env: ${missing.join(', ')}`
                : 'No AWS credentials available',
          };
        }
        try {
          await import('@aws-sdk/client-textract');
        } catch (err) {
          return {
            provider: provider.name,
            healthy: false,
            checkedAt,
            latencyMs: Date.now() - startedAt,
            error: `SDK load failed: ${errMessage(err)}`,
          };
        }
        if (options.probeExtract) {
          await probe(provider);
        }
        return {
          provider: provider.name,
          healthy: true,
          checkedAt,
          latencyMs: Date.now() - startedAt,
        };
      }

      case 'google_vision': {
        const hasProject = !!env.GOOGLE_PROJECT_ID || !!env.GCLOUD_PROJECT;
        const hasCreds =
          !!env.GOOGLE_APPLICATION_CREDENTIALS ||
          !!env.GOOGLE_CREDENTIALS_JSON;
        if (!hasProject || !hasCreds) {
          return {
            provider: provider.name,
            healthy: false,
            checkedAt,
            latencyMs: Date.now() - startedAt,
            error:
              !hasProject
                ? 'GOOGLE_PROJECT_ID / GCLOUD_PROJECT not set'
                : 'GOOGLE_APPLICATION_CREDENTIALS not set',
          };
        }
        try {
          await import('@google-cloud/vision');
        } catch (err) {
          return {
            provider: provider.name,
            healthy: false,
            checkedAt,
            latencyMs: Date.now() - startedAt,
            error: `SDK load failed: ${errMessage(err)}`,
          };
        }
        if (options.probeExtract) {
          await probe(provider);
        }
        return {
          provider: provider.name,
          healthy: true,
          checkedAt,
          latencyMs: Date.now() - startedAt,
        };
      }

      default:
        return {
          provider: provider.name,
          healthy: false,
          checkedAt,
          latencyMs: Date.now() - startedAt,
          error: `Unknown provider: ${provider.name}`,
        };
    }
  } catch (err) {
    return {
      provider: provider.name,
      healthy: false,
      checkedAt,
      latencyMs: Date.now() - startedAt,
      error: errMessage(err),
    };
  }
}

/**
 * Convenience: check health directly from a config object.
 */
export async function checkProviderHealthFromConfig(
  config: OcrProviderConfig,
  options: HealthCheckOptions = {}
): Promise<ProviderHealth> {
  const { getOcrProvider } = await import('./ocr-factory.js');
  const provider = getOcrProvider(config);
  return checkProviderHealth(provider, options);
}

async function probe(provider: IOCRProvider): Promise<void> {
  // 1x1 PNG — smallest valid payload so we do not burn meaningful OCR quota.
  const TINY_PNG = Buffer.from(
    '89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4' +
      '890000000D4944415478DA63000100000005000100A6E0D7E20000000049454E' +
      '44AE426082',
    'hex'
  );
  await provider.extractText(TINY_PNG, 'image/png');
}

function missingEnv(env: NodeJS.ProcessEnv, keys: ReadonlyArray<string>): string[] {
  return keys.filter((k) => !env[k]);
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
