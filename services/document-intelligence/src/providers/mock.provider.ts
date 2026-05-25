/**
 * Mock OCR provider for dev/test fallback.
 *
 * Returns fixture data from `__fixtures__/ids` so downstream code (identity
 * profile builder, badge issuance) can be exercised without a real OCR
 * vendor.
 *
 * Security posture (ProdFix-1):
 *   - The fixture corpus contains real-shaped NIDA / Kenya-ID / driving-
 *     licence / utility-bill / bank-statement output. Serving it to a
 *     real tenant is a P0 leak. Both the module-load fixture imports AND
 *     the `FixtureMockProvider` constructor refuse in production.
 *   - Module-load fail: if this file is imported with `NODE_ENV=production`
 *     it throws immediately so any accidental prod-bundle inclusion
 *     surfaces a loud crash at boot rather than silent fixture serving.
 *     Mirrors the `services/api-gateway/src/data/mock-data.ts:18-23`
 *     pattern.
 */

import type { ExtractedField, OCRProvider } from '../types/index.js';
import type { IOCRProvider } from '../services/ocr-extraction.service.js';
import type { MockProviderConfig } from './types.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error(
    'services/document-intelligence/src/providers/mock.provider.ts loaded in ' +
      'production — fixture-serving FixtureMockProvider is forbidden here. ' +
      'Set OCR_PROVIDER=aws_textract or google_vision; ensure no upstream code ' +
      'imports this module directly when NODE_ENV=production.'
  );
}

// Fixtures are only reachable when NODE_ENV !== 'production' — the throw above
// guarantees we never bundle this provider into a production artifact.
import { tanzaniaNidaFixture } from '../../__fixtures__/ids/tanzania-nida.fixture.js';
import { kenyaIdFixture } from '../../__fixtures__/ids/kenya-id.fixture.js';
import { drivingLicenceFixture } from '../../__fixtures__/ids/driving-licence.fixture.js';
import { utilityBillFixture } from '../../__fixtures__/ids/utility-bill.fixture.js';
import { bankStatementFixture } from '../../__fixtures__/ids/bank-statement.fixture.js';

const FIXTURES = {
  tanzania_nida: tanzaniaNidaFixture,
  kenya_id: kenyaIdFixture,
  driving_licence: drivingLicenceFixture,
  utility_bill: utilityBillFixture,
  bank_statement: bankStatementFixture,
} as const;

export class FixtureMockProvider implements IOCRProvider {
  readonly name: OCRProvider = 'mock';

  constructor(private readonly config: MockProviderConfig = { provider: 'mock' }) {
    // Second-line defense — even if a prod build somehow imports this
    // file (e.g. lazy-import survives tree-shake), constructing the
    // provider in production refuses outright.
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'FixtureMockProvider may not be instantiated in production — ' +
          'fixture OCR data must never be served to real tenants.'
      );
    }
  }

  async extractText(
    _buffer: Buffer,
    _mimeType: string,
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
    const fixtureKey =
      this.config.fixtureKey ??
      inferFixtureKeyFromDocumentType(options?.documentType) ??
      'tanzania_nida';

    const fixture = FIXTURES[fixtureKey];

    return {
      rawText: fixture.rawText,
      structuredData: fixture.structuredData,
      fields: [...fixture.fields],
      confidence: fixture.averageConfidence,
      language: options?.language ?? this.config.defaultLanguage ?? 'en',
      pageCount: fixture.pageCount,
    };
  }
}

function inferFixtureKeyFromDocumentType(
  documentType: string | undefined
): keyof typeof FIXTURES | null {
  switch (documentType) {
    case 'national_id':
      return 'tanzania_nida';
    case 'drivers_license':
      return 'driving_licence';
    case 'utility_bill':
      return 'utility_bill';
    case 'bank_statement':
      return 'bank_statement';
    default:
      return null;
  }
}

export function createMockProvider(
  config?: MockProviderConfig
): FixtureMockProvider {
  return new FixtureMockProvider(config ?? { provider: 'mock' });
}
