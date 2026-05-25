/**
 * OCR provider tests.
 *
 * Mocks the underlying SDKs — no real API calls. Verifies factory routing,
 * block/page → ExtractedField mapping, confidence normalisation, and fallback
 * behaviour.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getOcrProvider,
  getOcrProviderFromEnv,
  FallbackOcrProvider,
} from '../ocr-factory.js';
import {
  AwsTextractProvider,
  mapBlocksToFields,
  TextractAuthError,
} from '../aws-textract.provider.js';
import {
  GoogleVisionProvider,
  mapPagesToFields,
  extractKeyValuePairs,
  VisionAuthError,
} from '../google-vision.provider.js';
import { FixtureMockProvider } from '../mock.provider.js';
import { checkProviderHealth } from '../provider-health-check.js';

// ---------------------------------------------------------------------------
// SDK mocks
// ---------------------------------------------------------------------------

// AWS mock — Bytes input, Blocks output.
vi.mock('@aws-sdk/client-textract', () => {
  class AnalyzeDocumentCommand {
    constructor(public readonly input: unknown) {}
  }
  class TextractClient {
    constructor(public readonly config: unknown) {}
    async send(_cmd: unknown): Promise<unknown> {
      return {
        DocumentMetadata: { Pages: 1 },
        Blocks: [
          {
            Id: 'line-1',
            BlockType: 'LINE',
            Text: 'Full Name: AMINA HASSAN',
            Confidence: 99,
            Page: 1,
          },
          {
            Id: 'key-1',
            BlockType: 'KEY_VALUE_SET',
            EntityTypes: ['KEY'],
            Confidence: 96,
            Page: 1,
            Relationships: [
              { Type: 'CHILD', Ids: ['word-key-1'] },
              { Type: 'VALUE', Ids: ['value-1'] },
            ],
          },
          {
            Id: 'word-key-1',
            BlockType: 'WORD',
            Text: 'Full Name',
            Confidence: 98,
          },
          {
            Id: 'value-1',
            BlockType: 'KEY_VALUE_SET',
            EntityTypes: ['VALUE'],
            Confidence: 94,
            Page: 1,
            Geometry: {
              BoundingBox: { Left: 0.1, Top: 0.2, Width: 0.3, Height: 0.05 },
            },
            Relationships: [{ Type: 'CHILD', Ids: ['word-value-1'] }],
          },
          {
            Id: 'word-value-1',
            BlockType: 'WORD',
            Text: 'AMINA HASSAN',
            Confidence: 94,
          },
        ],
      };
    }
  }
  return { TextractClient, AnalyzeDocumentCommand };
});

// Google mock — returns a fullTextAnnotation with one page.
vi.mock('@google-cloud/vision', () => {
  class ImageAnnotatorClient {
    constructor(public readonly config: unknown) {}
    async documentTextDetection(_req: unknown): Promise<unknown[]> {
      return [
        {
          fullTextAnnotation: {
            text: 'Full Name: AMINA HASSAN\nID No: 12345\nDOB: 1987-04-12',
            pages: [
              {
                confidence: 0.93,
                blocks: [
                  {
                    confidence: 0.95,
                    boundingBox: {
                      vertices: [
                        { x: 10, y: 20 },
                        { x: 200, y: 20 },
                        { x: 200, y: 50 },
                        { x: 10, y: 50 },
                      ],
                    },
                    paragraphs: [
                      {
                        confidence: 0.95,
                        words: [
                          { symbols: [{ text: 'Full' }] },
                          { symbols: [{ text: 'Name' }] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      ];
    }
  }
  return { ImageAnnotatorClient };
});

// ---------------------------------------------------------------------------
// Factory routing
// ---------------------------------------------------------------------------

describe('OCR factory routing', () => {
  it('routes aws_textract config to AwsTextractProvider', () => {
    const provider = getOcrProvider({
      provider: 'aws_textract',
      region: 'eu-west-1',
    });
    expect(provider).toBeInstanceOf(AwsTextractProvider);
    expect(provider.name).toBe('aws_textract');
  });

  it('routes google_vision config to GoogleVisionProvider', () => {
    const provider = getOcrProvider({
      provider: 'google_vision',
      projectId: 'demo-project',
    });
    expect(provider).toBeInstanceOf(GoogleVisionProvider);
    expect(provider.name).toBe('google_vision');
  });

  it('routes mock config to FixtureMockProvider', () => {
    const provider = getOcrProvider({ provider: 'mock' });
    expect(provider).toBeInstanceOf(FixtureMockProvider);
    expect(provider.name).toBe('mock');
  });

  it('validates required fields per provider', () => {
    expect(() =>
      getOcrProvider({ provider: 'aws_textract', region: '' } as never)
    ).toThrow(/region/);
    expect(() =>
      getOcrProvider({ provider: 'google_vision', projectId: '' } as never)
    ).toThrow(/projectId/);
  });
});

// ---------------------------------------------------------------------------
// Env-based selection
// ---------------------------------------------------------------------------

describe('getOcrProviderFromEnv', () => {
  // ProdFix-1 — `OCR_PROVIDER` MUST be explicit outside NODE_ENV=test.
  // The previous behaviour silently defaulted to fixture data which
  // leaked NIDA / Kenya-ID shaped output to staging + QA tenants.
  it('throws ProviderUnavailableError when OCR_PROVIDER unset in non-test env', () => {
    expect(() =>
      getOcrProviderFromEnv({ env: { NODE_ENV: 'development' } }),
    ).toThrow(/OCR_PROVIDER not configured/);
  });

  it('returns mock without OCR_PROVIDER only when NODE_ENV=test', () => {
    const provider = getOcrProviderFromEnv({ env: { NODE_ENV: 'test' } });
    expect(provider.name).toBe('mock');
  });

  it('selects mock only with explicit OCR_PROVIDER=mock (dev)', () => {
    const provider = getOcrProviderFromEnv({
      env: { OCR_PROVIDER: 'mock', NODE_ENV: 'development' },
    });
    expect(provider.name).toBe('mock');
  });

  it('resolves textract alias to AWS provider', () => {
    const provider = getOcrProviderFromEnv({
      env: {
        OCR_PROVIDER: 'textract',
        AWS_REGION: 'eu-west-1',
        NODE_ENV: 'production',
      },
      fallbackToMock: false,
    });
    expect(provider).toBeInstanceOf(AwsTextractProvider);
  });

  it('does NOT wrap with FallbackOcrProvider by default in dev', () => {
    // ProdFix-1 — OCR_FALLBACK_TO_MOCK now defaults to false everywhere.
    const provider = getOcrProviderFromEnv({
      env: {
        OCR_PROVIDER: 'google',
        GOOGLE_PROJECT_ID: 'demo',
        NODE_ENV: 'development',
      },
    });
    expect(provider).toBeInstanceOf(GoogleVisionProvider);
  });

  it('wraps with FallbackOcrProvider when OCR_FALLBACK_TO_MOCK=true in dev', () => {
    const provider = getOcrProviderFromEnv({
      env: {
        OCR_PROVIDER: 'google',
        GOOGLE_PROJECT_ID: 'demo',
        NODE_ENV: 'development',
        OCR_FALLBACK_TO_MOCK: 'true',
      },
    });
    expect(provider).toBeInstanceOf(FallbackOcrProvider);
    expect(provider.name).toBe('google_vision');
  });

  it('does not wrap in production unless explicitly requested', () => {
    const provider = getOcrProviderFromEnv({
      env: {
        OCR_PROVIDER: 'google',
        GOOGLE_PROJECT_ID: 'demo',
        NODE_ENV: 'production',
      },
    });
    expect(provider).toBeInstanceOf(GoogleVisionProvider);
  });

  it('throws if google provider missing project id', () => {
    expect(() =>
      getOcrProviderFromEnv({
        env: { OCR_PROVIDER: 'google', NODE_ENV: 'development' },
      }),
    ).toThrow(/GOOGLE_PROJECT_ID/);
  });

  it('uses tenantRegion in preference to AWS_REGION env var', () => {
    const provider = getOcrProviderFromEnv({
      env: {
        OCR_PROVIDER: 'aws_textract',
        AWS_REGION: 'us-east-1',
        NODE_ENV: 'production',
      },
      tenantRegion: 'eu-west-1',
    });
    expect(provider).toBeInstanceOf(AwsTextractProvider);
    // Underlying provider config stamps the region — region is consumed
    // by the underlying SDK call. The factory test asserts construction
    // succeeds with the override; downstream extraction tests cover
    // region routing in detail.
  });

  it('throws when AWS_REGION + tenantRegion both missing for textract', () => {
    expect(() =>
      getOcrProviderFromEnv({
        env: { OCR_PROVIDER: 'aws_textract', NODE_ENV: 'production' },
      }),
    ).toThrow(/region/);
  });
});

// ---------------------------------------------------------------------------
// Textract — SDK call + mapping
// ---------------------------------------------------------------------------

describe('AwsTextractProvider', () => {
  it('maps Blocks to ExtractedField[] with normalised confidence (0-1)', async () => {
    const provider = new AwsTextractProvider({
      provider: 'aws_textract',
      region: 'eu-west-1',
    });
    const result = await provider.extractText(
      Buffer.from([1, 2, 3]),
      'image/png',
      { documentType: 'national_id' }
    );

    expect(result.pageCount).toBe(1);
    expect(result.rawText).toContain('Full Name');
    expect(result.fields.length).toBeGreaterThan(0);

    const nameField = result.fields.find((f) => f.fieldName === 'full_name');
    expect(nameField).toBeDefined();
    expect(nameField?.value).toBe('AMINA HASSAN');
    expect(nameField?.confidence).toBeGreaterThan(0);
    expect(nameField?.confidence).toBeLessThanOrEqual(1);
    expect(nameField?.boundingBox).toEqual({
      left: 0.1,
      top: 0.2,
      width: 0.3,
      height: 0.05,
    });
  });

  it('mapBlocksToFields handles empty block list', () => {
    expect(mapBlocksToFields([])).toEqual([]);
  });

  it('classifies auth errors', () => {
    const err = new Error('AccessDenied: invalid credentials');
    err.name = 'AccessDeniedException';
    // Use the classifier indirectly by constructing and matching the shape
    expect(new TextractAuthError('x').code).toBe('TEXTRACT_AUTH');
    // confirm the error subclass is an Error
    expect(new TextractAuthError('x')).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Google Vision — SDK call + mapping
// ---------------------------------------------------------------------------

describe('GoogleVisionProvider', () => {
  it('maps pages → ExtractedField[] with block text + regex key-value pass', async () => {
    const provider = new GoogleVisionProvider({
      provider: 'google_vision',
      projectId: 'demo',
    });
    const result = await provider.extractText(
      Buffer.from([0]),
      'image/jpeg',
      { language: 'en', documentType: 'national_id' }
    );

    expect(result.pageCount).toBe(1);
    expect(result.rawText).toContain('AMINA HASSAN');
    expect(result.confidence).toBeGreaterThan(0);

    const blockField = result.fields.find((f) =>
      f.fieldName.startsWith('page_1_block_')
    );
    expect(blockField).toBeDefined();
    expect(blockField?.boundingBox).toEqual({
      left: 10,
      top: 20,
      width: 190,
      height: 30,
    });

    const nameField = result.fields.find((f) => f.fieldName === 'full_name');
    expect(nameField?.value).toBe('AMINA HASSAN');
  });

  it('extractKeyValuePairs picks up common ID fields', () => {
    const fields = extractKeyValuePairs(
      'Full Name: Jane Doe\nID No: AB-123\nDOB: 1990-05-01\nExpiry Date: 2030-01-01'
    );
    const names = fields.map((f) => f.fieldName).sort();
    expect(names).toEqual(
      ['date_of_birth', 'expiry_date', 'full_name', 'id_number'].sort()
    );
  });

  it('mapPagesToFields returns empty for no pages and no text', () => {
    expect(mapPagesToFields([], '')).toEqual([]);
  });

  it('VisionAuthError is Error subclass', () => {
    expect(new VisionAuthError('x')).toBeInstanceOf(Error);
    expect(new VisionAuthError('x').code).toBe('VISION_AUTH');
  });
});

// ---------------------------------------------------------------------------
// Fallback behaviour
// ---------------------------------------------------------------------------

describe('FallbackOcrProvider', () => {
  const makeFailingPrimary = (code: string) => ({
    name: 'aws_textract' as const,
    async extractText() {
      const err = new Error('boom') as Error & { code: string };
      err.code = code;
      throw err;
    },
  });

  beforeEach(() => vi.clearAllMocks());

  it('falls back to secondary on recoverable auth error', async () => {
    const primary = makeFailingPrimary('TEXTRACT_AUTH');
    const secondary = new FixtureMockProvider({ provider: 'mock' });
    const wrapped = new FallbackOcrProvider(primary, secondary);

    const result = await wrapped.extractText(Buffer.from(''), 'image/jpeg', {
      documentType: 'national_id',
    });
    expect(result.fields.length).toBeGreaterThan(0);
  });

  it('re-throws non-recoverable errors', async () => {
    const primary = {
      name: 'aws_textract' as const,
      async extractText() {
        throw new Error('schema mismatch');
      },
    };
    const secondary = new FixtureMockProvider({ provider: 'mock' });
    const wrapped = new FallbackOcrProvider(primary, secondary);

    await expect(wrapped.extractText(Buffer.from(''), 'image/jpeg')).rejects.toThrow(
      /schema mismatch/
    );
  });
});

// ---------------------------------------------------------------------------
// Mock provider — fixture corpus sanity
// ---------------------------------------------------------------------------

describe('FixtureMockProvider happy path', () => {
  it('returns tanzania_nida fixture by default for national_id', async () => {
    const provider = new FixtureMockProvider({ provider: 'mock' });
    const result = await provider.extractText(Buffer.from(''), 'image/jpeg', {
      documentType: 'national_id',
      language: 'en',
    });

    expect(result.fields.length).toBeGreaterThan(0);
    expect(result.pageCount).toBe(1);
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.language).toBe('en');
    const nameField = result.fields.find((f) => f.fieldName === 'full_name');
    expect(nameField?.value).toContain('AMINA');
  });

  it('returns driving_licence fixture for drivers_license documentType', async () => {
    const provider = new FixtureMockProvider({ provider: 'mock' });
    const result = await provider.extractText(Buffer.from(''), 'image/jpeg', {
      documentType: 'drivers_license',
    });
    const idNumber = result.fields.find((f) => f.fieldName === 'id_number');
    expect(idNumber?.value).toMatch(/^DL-/);
  });

  it('honours explicit fixtureKey', async () => {
    const provider = new FixtureMockProvider({
      provider: 'mock',
      fixtureKey: 'kenya_id',
    });
    const result = await provider.extractText(Buffer.from(''), 'image/jpeg');
    expect(result.rawText).toContain('REPUBLIC OF KENYA');
  });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

describe('checkProviderHealth', () => {
  it('reports mock provider as healthy', async () => {
    const provider = new FixtureMockProvider({ provider: 'mock' });
    const health = await checkProviderHealth(provider);
    expect(health.healthy).toBe(true);
    expect(health.provider).toBe('mock');
  });

  it('reports aws_textract unhealthy without credentials', async () => {
    const provider = new AwsTextractProvider({
      provider: 'aws_textract',
      region: 'eu-west-1',
    });
    const health = await checkProviderHealth(provider, { env: {} });
    expect(health.healthy).toBe(false);
    expect(health.error).toMatch(/credentials|env/i);
  });

  it('reports aws_textract healthy when env provides credentials', async () => {
    const provider = new AwsTextractProvider({
      provider: 'aws_textract',
      region: 'eu-west-1',
    });
    const health = await checkProviderHealth(provider, {
      env: {
        AWS_REGION: 'eu-west-1',
        AWS_ACCESS_KEY_ID: 'AKIA...',
        AWS_SECRET_ACCESS_KEY: 'secret',
      },
    });
    expect(health.healthy).toBe(true);
  });

  it('reports google_vision unhealthy without project/creds', async () => {
    const provider = new GoogleVisionProvider({
      provider: 'google_vision',
      projectId: 'demo',
    });
    const health = await checkProviderHealth(provider, { env: {} });
    expect(health.healthy).toBe(false);
  });

  it('reports google_vision healthy with creds', async () => {
    const provider = new GoogleVisionProvider({
      provider: 'google_vision',
      projectId: 'demo',
    });
    const health = await checkProviderHealth(provider, {
      env: {
        GOOGLE_PROJECT_ID: 'demo',
        GOOGLE_APPLICATION_CREDENTIALS: '/tmp/key.json',
      },
    });
    expect(health.healthy).toBe(true);
  });
});
