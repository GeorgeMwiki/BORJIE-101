/**
 * Shared brain tools — every persona inherits this catalog.
 *
 * Four tools that the brain can always reach for, regardless of which
 * persona slug owns the current turn:
 *
 *   - `borjie.ask`          recursive sub-task hand-off
 *   - `borjie.cite`         evidence-id citation lookup
 *   - `documents.upload`    thin wrapper around DOC-Intelligence's
 *                           presigned-upload URL
 *   - `documents.search`    keyword/semantic search over the tenant's
 *                           uploaded documents
 *
 * Read-only by default — `documents.upload` returns a presigned URL
 * but never persists the file itself.
 */

import { z } from 'zod';
import { PERSONA_SLUGS, type PersonaToolDescriptor } from './types';

const ALL_PERSONAS = PERSONA_SLUGS;

const AskInput = z.object({
  question: z.string().min(1).max(2000),
  sourcePersona: z.string().optional(),
});
const AskOutput = z.object({
  answer: z.string(),
  evidenceIds: z.array(z.string()).default([]),
});

const CiteInput = z.object({
  evidenceIds: z.array(z.string()).min(1).max(20),
});
const CiteOutput = z.object({
  citations: z.array(
    z.object({
      evidenceId: z.string(),
      title: z.string(),
      excerpt: z.string(),
      sourceUri: z.string().optional(),
    }),
  ),
});

const DocumentUploadInput = z.object({
  fileName: z.string().min(1).max(256),
  contentType: z.string().min(1),
  byteSize: z.number().int().positive().max(50_000_000),
});
const DocumentUploadOutput = z.object({
  uploadUrl: z.string().url(),
  documentId: z.string(),
  expiresAt: z.string(),
});

const DocumentSearchInput = z.object({
  query: z.string().min(1).max(500),
  limit: z.number().int().positive().max(50).default(10),
});
const DocumentSearchOutput = z.object({
  hits: z.array(
    z.object({
      documentId: z.string(),
      title: z.string(),
      snippet: z.string(),
      score: z.number(),
    }),
  ),
  totalHits: z.number().int().nonnegative(),
});

export const borjieAskTool: PersonaToolDescriptor<typeof AskInput, typeof AskOutput> = {
  id: 'borjie.ask',
  name: 'Ask Borjie a sub-question',
  description:
    'Recursive hand-off: ask the brain a clarifying sub-question and receive the answer ' +
    'with linked evidence IDs. Use sparingly — only when the current turn cannot be ' +
    'answered without first resolving a narrower fact.',
  personaSlugs: ALL_PERSONAS,
  inputSchema: AskInput,
  outputSchema: AskOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { answer: input.question, evidenceIds: [] };
    }
    return client.post<{ answer: string; evidenceIds?: string[] }>(
      '/internal/brain/ask',
      { question: input.question, tenantId: ctx.tenantId },
    ).then((res) => ({
      answer: res.answer,
      evidenceIds: res.evidenceIds ?? [],
    }));
  },
};

export const borjieCiteTool: PersonaToolDescriptor<
  typeof CiteInput,
  typeof CiteOutput
> = {
  id: 'borjie.cite',
  name: 'Resolve evidence IDs into citations',
  description:
    'Resolve a list of evidence IDs (from LMBM or the intelligence corpus) into ' +
    'human-readable citations. Use to satisfy the Auditor Agent evidence-chain rule.',
  personaSlugs: ALL_PERSONAS,
  inputSchema: CiteInput,
  outputSchema: CiteOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        citations: input.evidenceIds.map((id) => ({
          evidenceId: id,
          title: 'unknown',
          excerpt: '',
        })),
      };
    }
    return client.post<{ citations: Array<{ evidenceId: string; title: string; excerpt: string; sourceUri?: string }> }>(
      '/internal/brain/cite',
      { evidenceIds: input.evidenceIds, tenantId: ctx.tenantId },
    );
  },
};

export const documentsUploadTool: PersonaToolDescriptor<
  typeof DocumentUploadInput,
  typeof DocumentUploadOutput
> = {
  id: 'documents.upload',
  name: 'Request a presigned upload URL',
  description:
    'Returns a presigned upload URL plus a draft document id. The file itself is ' +
    'persisted only after the client PUTs to the URL. The follow-up indexing pipeline ' +
    'lives in DOC-Intelligence.',
  personaSlugs: ALL_PERSONAS,
  inputSchema: DocumentUploadInput,
  outputSchema: DocumentUploadOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      throw new Error('document upload requires httpClient');
    }
    return client.post<{ uploadUrl: string; documentId: string; expiresAt: string }>(
      '/internal/documents/upload-url',
      {
        tenantId: ctx.tenantId,
        actorId: ctx.actorId,
        fileName: input.fileName,
        contentType: input.contentType,
        byteSize: input.byteSize,
      },
    );
  },
};

export const documentsSearchTool: PersonaToolDescriptor<
  typeof DocumentSearchInput,
  typeof DocumentSearchOutput
> = {
  id: 'documents.search',
  name: 'Search uploaded documents',
  description:
    'Keyword / semantic search across the tenant\'s uploaded documents. Returns up to ' +
    '`limit` ranked hits with snippets.',
  personaSlugs: ALL_PERSONAS,
  inputSchema: DocumentSearchInput,
  outputSchema: DocumentSearchOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { hits: [], totalHits: 0 };
    }
    return client.get<{ hits: Array<{ documentId: string; title: string; snippet: string; score: number }>; totalHits: number }>(
      '/internal/documents/search',
      { query: { q: input.query, limit: input.limit, tenant: ctx.tenantId } },
    );
  },
};

export const SHARED_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  borjieAskTool,
  borjieCiteTool,
  documentsUploadTool,
  documentsSearchTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
