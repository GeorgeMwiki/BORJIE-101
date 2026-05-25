/**
 * OCR Provider configuration types.
 *
 * SCAFFOLDED 13 — providers sit behind `IOCRProvider` (see
 * `services/ocr-extraction.service.ts`). The factory (`ocr-factory.ts`)
 * routes config.provider to the concrete adapter. Cloud SDK wiring is
 * deferred (see KI-014) so the package builds without
 * @aws-sdk/client-textract or @google-cloud/vision being installed.
 * See Docs/KNOWN_ISSUES.md#ki-014.
 */

import type { OCRProvider } from '../types/index.js';

/** Shared options — lets callers control language and structured extraction. */
export interface OcrProviderBaseConfig {
  readonly provider: OCRProvider;
  readonly defaultLanguage?: string;
}

export interface AwsTextractConfig extends OcrProviderBaseConfig {
  readonly provider: 'aws_textract';
  readonly region: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  /** ANALYZE_DOCUMENT feature list. Defaults to ['FORMS']. */
  readonly featureTypes?: ReadonlyArray<'FORMS' | 'TABLES' | 'QUERIES' | 'SIGNATURES'>;
}

export interface GoogleVisionConfig extends OcrProviderBaseConfig {
  readonly provider: 'google_vision';
  readonly projectId: string;
  /** Service account JSON path, OR provide credentials inline. */
  readonly keyFilename?: string;
  readonly credentials?: {
    readonly client_email: string;
    readonly private_key: string;
  };
  /** Use DOCUMENT_TEXT_DETECTION (structured) vs TEXT_DETECTION. */
  readonly useDocumentDetection?: boolean;
}

export interface MockProviderConfig extends OcrProviderBaseConfig {
  readonly provider: 'mock';
  /** Optional fixture key to load from __fixtures__/ids. */
  readonly fixtureKey?:
    | 'tanzania_nida'
    | 'kenya_id'
    | 'driving_licence'
    | 'utility_bill'
    | 'bank_statement';
}

export type OcrProviderConfig =
  | AwsTextractConfig
  | GoogleVisionConfig
  | MockProviderConfig;
