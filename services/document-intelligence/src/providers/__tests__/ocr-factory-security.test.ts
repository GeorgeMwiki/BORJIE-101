/**
 * OCR factory — production security gates (ProdFix-1).
 *
 * Asserts the security posture introduced by the production-readiness
 * audit (`.audit/production-readiness-gaps.md` §1 CRITICAL):
 *
 *   - `OCR_PROVIDER` must be explicit outside `NODE_ENV=test`.
 *   - `OCR_PROVIDER=mock` is refused in production.
 *   - `OCR_FALLBACK_TO_MOCK=true` is refused in production.
 *   - The AWS `us-east-1` literal is gone — `tenantRegion` or
 *     `AWS_REGION` MUST be set explicitly for textract.
 *
 * These tests are intentionally separate from `ocr-providers.test.ts` so
 * the security gates can never be silently regressed alongside an
 * unrelated provider mapping change.
 */

import { describe, it, expect } from 'vitest';
import {
  getOcrProviderFromEnv,
  ProviderUnavailableError,
} from '../ocr-factory.js';

describe('OCR factory — security gates', () => {
  describe('OCR_PROVIDER unset', () => {
    it('throws ProviderUnavailableError outside NODE_ENV=test', () => {
      expect(() =>
        getOcrProviderFromEnv({ env: { NODE_ENV: 'development' } }),
      ).toThrow(ProviderUnavailableError);
    });

    it('throws even when NODE_ENV is unset entirely', () => {
      expect(() => getOcrProviderFromEnv({ env: {} })).toThrow(
        ProviderUnavailableError,
      );
    });

    it('throws in production', () => {
      expect(() =>
        getOcrProviderFromEnv({ env: { NODE_ENV: 'production' } }),
      ).toThrow(ProviderUnavailableError);
    });

    it('selects mock only when NODE_ENV=test', () => {
      const provider = getOcrProviderFromEnv({ env: { NODE_ENV: 'test' } });
      expect(provider.name).toBe('mock');
    });
  });

  describe('OCR_PROVIDER=mock', () => {
    it('is allowed in dev with explicit opt-in', () => {
      const provider = getOcrProviderFromEnv({
        env: { OCR_PROVIDER: 'mock', NODE_ENV: 'development' },
      });
      expect(provider.name).toBe('mock');
    });

    it('is refused in production even when explicit', () => {
      expect(() =>
        getOcrProviderFromEnv({
          env: { OCR_PROVIDER: 'mock', NODE_ENV: 'production' },
        }),
      ).toThrow(ProviderUnavailableError);
    });
  });

  describe('OCR_FALLBACK_TO_MOCK', () => {
    it('defaults to false everywhere (no fallback wrapping)', () => {
      const provider = getOcrProviderFromEnv({
        env: {
          OCR_PROVIDER: 'google',
          GOOGLE_PROJECT_ID: 'demo',
          NODE_ENV: 'development',
        },
      });
      // FallbackOcrProvider would re-expose the underlying provider's
      // `.name`. The new default is no-wrap — verified by checking the
      // concrete class name on the prototype chain.
      expect(provider.constructor.name).toBe('GoogleVisionProvider');
    });

    it('refuses OCR_FALLBACK_TO_MOCK=true in production', () => {
      expect(() =>
        getOcrProviderFromEnv({
          env: {
            OCR_PROVIDER: 'google',
            GOOGLE_PROJECT_ID: 'demo',
            NODE_ENV: 'production',
            OCR_FALLBACK_TO_MOCK: 'true',
          },
        }),
      ).toThrow(ProviderUnavailableError);
    });

    it('refuses fallbackToMock=true option in production', () => {
      expect(() =>
        getOcrProviderFromEnv({
          env: {
            OCR_PROVIDER: 'google',
            GOOGLE_PROJECT_ID: 'demo',
            NODE_ENV: 'production',
          },
          fallbackToMock: true,
        }),
      ).toThrow(ProviderUnavailableError);
    });

    it('honours explicit OCR_FALLBACK_TO_MOCK=true in dev', () => {
      const provider = getOcrProviderFromEnv({
        env: {
          OCR_PROVIDER: 'google',
          GOOGLE_PROJECT_ID: 'demo',
          NODE_ENV: 'development',
          OCR_FALLBACK_TO_MOCK: 'true',
        },
      });
      // FallbackOcrProvider exposes the underlying provider's name.
      expect(provider.constructor.name).toBe('FallbackOcrProvider');
    });
  });

  describe('AWS region resolution (tenantRegion)', () => {
    it('throws when neither tenantRegion nor AWS_REGION is set', () => {
      expect(() =>
        getOcrProviderFromEnv({
          env: { OCR_PROVIDER: 'aws_textract', NODE_ENV: 'production' },
        }),
      ).toThrow(ProviderUnavailableError);
    });

    it('uses tenantRegion when both tenantRegion and AWS_REGION are set', () => {
      const provider = getOcrProviderFromEnv({
        env: {
          OCR_PROVIDER: 'aws_textract',
          AWS_REGION: 'us-east-1',
          NODE_ENV: 'production',
        },
        tenantRegion: 'af-south-1',
      });
      expect(provider.name).toBe('aws_textract');
    });

    it('falls back to AWS_REGION when tenantRegion is absent', () => {
      const provider = getOcrProviderFromEnv({
        env: {
          OCR_PROVIDER: 'aws_textract',
          AWS_REGION: 'eu-west-1',
          NODE_ENV: 'production',
        },
      });
      expect(provider.name).toBe('aws_textract');
    });
  });

  describe('Unknown OCR_PROVIDER value', () => {
    it('refuses with ProviderUnavailableError', () => {
      expect(() =>
        getOcrProviderFromEnv({
          env: { OCR_PROVIDER: 'tesseract', NODE_ENV: 'development' },
        }),
      ).toThrow(ProviderUnavailableError);
    });
  });
});
