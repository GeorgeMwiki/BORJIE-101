/**
 * AWS Textract OCR provider — implements IOCRProvider.
 *
 * Uses @aws-sdk/client-textract. SDK is imported dynamically so the package
 * type-checks and builds even if the SDK is not yet installed in the current
 * environment.
 */

import type { ExtractedField, OCRProvider } from '../types/index.js';
import type { IOCRProvider } from '../services/ocr-extraction.service.js';
import type { AwsTextractConfig } from './types.js';
import { logger } from '../utils/logger.js';

export interface TextractExtractOptions {
  readonly language?: string;
  readonly extractStructuredData?: boolean;
  readonly documentType?: string;
}

export interface TextractExtractResult {
  rawText: string;
  structuredData: Record<string, unknown> | null;
  fields: ExtractedField[];
  confidence: number;
  language: string;
  pageCount: number;
}

/** Minimal shape of Textract Block we rely on — keeps us free of the SDK types at compile time. */
interface TextractBlock {
  Id?: string;
  BlockType?: string;
  Text?: string;
  Confidence?: number;
  EntityTypes?: ReadonlyArray<string>;
  Page?: number;
  Geometry?: {
    BoundingBox?: {
      Left?: number;
      Top?: number;
      Width?: number;
      Height?: number;
    };
  };
  Relationships?: ReadonlyArray<{
    Type?: string;
    Ids?: ReadonlyArray<string>;
  }>;
}

interface TextractResponse {
  Blocks?: ReadonlyArray<TextractBlock>;
  DocumentMetadata?: { Pages?: number };
}

/**
 * Classes of Textract errors distinguishable to callers.
 */
export class TextractAuthError extends Error {
  readonly code = 'TEXTRACT_AUTH' as const;
}
export class TextractNetworkError extends Error {
  readonly code = 'TEXTRACT_NETWORK' as const;
}
export class TextractDocumentError extends Error {
  readonly code = 'TEXTRACT_DOCUMENT' as const;
}
export class TextractSdkMissingError extends Error {
  readonly code = 'TEXTRACT_SDK_MISSING' as const;
}

type TextractClientLike = {
  send(command: unknown): Promise<TextractResponse>;
};

export class AwsTextractProvider implements IOCRProvider {
  readonly name: OCRProvider = 'aws_textract';
  private client: TextractClientLike | null = null;
  private analyzeDocumentCtor: (new (input: unknown) => unknown) | null = null;

  constructor(private readonly config: AwsTextractConfig) {
    if (!config.region) {
      throw new Error('AwsTextractProvider requires config.region');
    }
  }

  /**
   * Lazily load the SDK and build the client. Dynamic import so the service
   * package compiles even if @aws-sdk/client-textract is not yet installed.
   */
  private async getClient(): Promise<{
    client: TextractClientLike;
    AnalyzeDocumentCommand: new (input: unknown) => unknown;
  }> {
    if (this.client && this.analyzeDocumentCtor) {
      return { client: this.client, AnalyzeDocumentCommand: this.analyzeDocumentCtor };
    }

    let sdk: {
      TextractClient: new (cfg: unknown) => TextractClientLike;
      AnalyzeDocumentCommand: new (input: unknown) => unknown;
    };
    try {
      sdk = (await import('@aws-sdk/client-textract')) as unknown as typeof sdk;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TextractSdkMissingError(
        `@aws-sdk/client-textract is not installed: ${msg}`
      );
    }

    const region = this.config.region;
    const accessKeyId = this.config.accessKeyId ?? process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey =
      this.config.secretAccessKey ?? process.env.AWS_SECRET_ACCESS_KEY;

    const clientConfig: Record<string, unknown> = { region };
    if (accessKeyId && secretAccessKey) {
      clientConfig.credentials = { accessKeyId, secretAccessKey };
    }

    this.client = new sdk.TextractClient(clientConfig);
    this.analyzeDocumentCtor = sdk.AnalyzeDocumentCommand;
    return { client: this.client, AnalyzeDocumentCommand: sdk.AnalyzeDocumentCommand };
  }

  async extractText(
    buffer: Buffer,
    mimeType: string,
    options?: TextractExtractOptions
  ): Promise<TextractExtractResult> {
    logger.info('AwsTextractProvider.extractText', {
      bytes: buffer.byteLength,
      mimeType,
      region: this.config.region,
      documentType: options?.documentType,
    });

    const featureTypes = (this.config.featureTypes ?? ['FORMS', 'TABLES']) as ReadonlyArray<string>;

    let response: TextractResponse;
    try {
      const { client, AnalyzeDocumentCommand } = await this.getClient();
      const command = new AnalyzeDocumentCommand({
        Document: { Bytes: buffer },
        FeatureTypes: [...featureTypes],
      });
      response = await client.send(command);
    } catch (err) {
      if (err instanceof TextractSdkMissingError) throw err;
      throw classifyTextractError(err);
    }

    const blocks = response.Blocks ?? [];
    const fields = mapBlocksToFields(blocks);
    const rawText = buildRawText(blocks);
    const confidence = averageConfidence(fields);
    const pageCount = response.DocumentMetadata?.Pages ?? computePageCount(blocks);

    return {
      rawText,
      structuredData: {
        provider: 'aws_textract',
        documentType: options?.documentType ?? null,
        featureTypes,
      },
      fields,
      confidence,
      language: options?.language ?? this.config.defaultLanguage ?? 'en',
      pageCount,
    };
  }
}

/**
 * Walk Textract Blocks into the canonical ExtractedField[] shape used by the
 * rest of the pipeline. Handles KEY_VALUE_SET pairs plus line-level text.
 */
export function mapBlocksToFields(
  blocks: ReadonlyArray<TextractBlock>
): ExtractedField[] {
  const byId = new Map<string, TextractBlock>();
  for (const block of blocks) {
    if (block.Id) byId.set(block.Id, block);
  }

  const fields: ExtractedField[] = [];

  for (const block of blocks) {
    if (block.BlockType !== 'KEY_VALUE_SET') continue;
    if (!block.EntityTypes?.includes('KEY')) continue;

    const keyText = resolveText(block, byId);
    const valueBlockId = findRelationshipId(block, 'VALUE');
    const valueBlock = valueBlockId ? byId.get(valueBlockId) : null;
    const valueText = valueBlock ? resolveText(valueBlock, byId) : null;

    const confidence = normaliseConfidence(
      Math.min(
        block.Confidence ?? 0,
        valueBlock?.Confidence ?? block.Confidence ?? 0
      )
    );

    fields.push({
      fieldName: normaliseFieldName(keyText ?? ''),
      value: valueText && valueText.length > 0 ? valueText : null,
      confidence,
      boundingBox: toBoundingBox(valueBlock ?? block),
      normalized: false,
      validationStatus: confidence >= 0.75 ? 'valid' : 'uncertain',
    });
  }

  return fields;
}

function resolveText(
  block: TextractBlock,
  byId: Map<string, TextractBlock>
): string | null {
  const childIds = findRelationshipIds(block, 'CHILD');
  if (childIds.length === 0) return block.Text ?? null;
  const parts: string[] = [];
  for (const id of childIds) {
    const child = byId.get(id);
    if (child?.Text) parts.push(child.Text);
  }
  return parts.length > 0 ? parts.join(' ') : block.Text ?? null;
}

function findRelationshipId(block: TextractBlock, type: string): string | null {
  const rel = block.Relationships?.find((r) => r.Type === type);
  return rel?.Ids?.[0] ?? null;
}

function findRelationshipIds(block: TextractBlock, type: string): ReadonlyArray<string> {
  const rel = block.Relationships?.find((r) => r.Type === type);
  return rel?.Ids ?? [];
}

function toBoundingBox(
  block: TextractBlock | null | undefined
): ExtractedField['boundingBox'] {
  const bb = block?.Geometry?.BoundingBox;
  if (!bb) return null;
  return {
    left: bb.Left ?? 0,
    top: bb.Top ?? 0,
    width: bb.Width ?? 0,
    height: bb.Height ?? 0,
  };
}

function normaliseFieldName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown_field';
}

/** Textract returns 0-100. Our pipeline stores 0-1. */
function normaliseConfidence(n: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  if (n <= 1) return n;
  return Math.min(1, n / 100);
}

function buildRawText(blocks: ReadonlyArray<TextractBlock>): string {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.BlockType === 'LINE' && block.Text) {
      lines.push(block.Text);
    }
  }
  return lines.join('\n');
}

function averageConfidence(fields: ReadonlyArray<ExtractedField>): number {
  if (fields.length === 0) return 0;
  const total = fields.reduce((sum, f) => sum + f.confidence, 0);
  return total / fields.length;
}

function computePageCount(blocks: ReadonlyArray<TextractBlock>): number {
  let max = 0;
  for (const b of blocks) {
    if (typeof b.Page === 'number' && b.Page > max) max = b.Page;
  }
  return max || (blocks.length > 0 ? 1 : 0);
}

function classifyTextractError(err: unknown): Error {
  const name = (err as { name?: string })?.name ?? '';
  const message = err instanceof Error ? err.message : String(err);
  if (
    /credentials|unauthor|accessdenied|invalidsignature/i.test(name + ' ' + message)
  ) {
    return new TextractAuthError(`Textract auth failed: ${message}`);
  }
  if (
    /networkingerror|timeout|econnreset|enotfound|fetchfailed/i.test(
      name + ' ' + message
    )
  ) {
    return new TextractNetworkError(`Textract network error: ${message}`);
  }
  if (/unsupporteddocument|invalidparametervalue|badrequest/i.test(name + ' ' + message)) {
    return new TextractDocumentError(`Textract document error: ${message}`);
  }
  return new TextractDocumentError(`Textract error: ${message}`);
}

export function createAwsTextractProvider(
  config: AwsTextractConfig
): AwsTextractProvider {
  return new AwsTextractProvider(config);
}
