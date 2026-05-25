/**
 * Documents MCP server — list, fetch, upload (storage-adapter), and
 * "chat with a document" RAG-style Q&A.
 */

import { z } from 'zod';
import { createMCPServer, type MCPServer, type MCPServerConfig } from '../server/server.js';
import type { AuditPort, ToolDefinition } from '../types.js';
import type { DocumentsPort } from './ports.js';

export interface DocumentsMCPServerConfig {
  readonly db: DocumentsPort;
  readonly audit?: AuditPort;
  readonly name?: string;
}

export function createDocumentsMCPServer(
  config: DocumentsMCPServerConfig,
): MCPServer {
  const { db } = config;
  const tools: Array<ToolDefinition> = [
    {
      name: 'list_documents',
      description: 'List the tenant\'s documents, optionally filtered by tag or text.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({
        tag: z.string().optional(),
        q: z.string().optional(),
      }),
      handler: async (args, ctx) => {
        const { tag, q } = args as { tag?: string; q?: string };
        const filters: { tag?: string; q?: string } = {};
        if (tag !== undefined) filters.tag = tag;
        if (q !== undefined) filters.q = q;
        const out = await db.listDocuments(ctx.tenantId, filters);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'get_document',
      description: 'Fetch metadata for a single document by ID.',
      annotations: { readOnlyHint: true, idempotentHint: true },
      inputSchema: z.object({ documentId: z.string().uuid() }),
      handler: async (args, ctx) => {
        const { documentId } = args as { documentId: string };
        const out = await db.getDocument(ctx.tenantId, documentId);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'upload_document',
      description: 'Upload a document for this tenant. Content can be a UTF-8 string or base64-encoded binary (auto-detected by mime type).',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        name: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(100),
        // Accept either raw text or base64; the adapter is responsible
        // for decoding when mimeType isn't text/*.
        content: z.string().min(1),
        tags: z.array(z.string().min(1).max(64)).max(20).optional(),
      }),
      handler: async (args, ctx) => {
        const { name, mimeType, content, tags } = args as {
          name: string; mimeType: string; content: string; tags?: ReadonlyArray<string>;
        };
        const decoded: Uint8Array | string = mimeType.startsWith('text/')
          ? content
          : Uint8Array.from(Buffer.from(content, 'base64'));
        const input: {
          name: string;
          mimeType: string;
          content: Uint8Array | string;
          tags?: ReadonlyArray<string>;
        } = { name, mimeType, content: decoded };
        if (tags !== undefined) input.tags = tags;
        const out = await db.uploadDocument(ctx.tenantId, input);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
    {
      name: 'chat_with_document',
      description: 'Ask a question grounded in a single document. Returns answer + citations.',
      annotations: { readOnlyHint: true, idempotentHint: false, openWorldHint: false },
      inputSchema: z.object({
        documentId: z.string().uuid(),
        question: z.string().min(1).max(2000),
      }),
      handler: async (args, ctx) => {
        const { documentId, question } = args as { documentId: string; question: string };
        const out = await db.chatWithDocument(ctx.tenantId, documentId, question);
        return { content: [{ type: 'text', text: JSON.stringify(out) }] };
      },
    },
  ];

  const base: MCPServerConfig = {
    name: config.name ?? 'borjie.documents',
    version: '0.1.0',
    description: 'Documents + RAG MCP server (tenant-scoped).',
    tools,
  };
  return createMCPServer(config.audit ? { ...base, audit: config.audit } : base);
}
