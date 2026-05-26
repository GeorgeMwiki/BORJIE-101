/**
 * MCP response → kernel `McpToolResult` envelope.
 *
 * The SDK returns `CallToolResult { content: ContentBlock[], isError? }`
 * where each `ContentBlock` is `{ type: 'text', text }` or
 * `{ type: 'resource', … }` etc. The kernel wants a canonical
 * `McpToolResult` (see `types.ts`): `{ ok, content[], errorMessage? }`.
 *
 * Spec: `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` §2.
 */

import type { McpResultContent, McpToolResult } from '../types.js';

/** Shape we accept from the SDK — kept loose to avoid SDK type coupling. */
export interface RawMcpCallResult {
  readonly content?: ReadonlyArray<unknown>;
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
}

/** Map an SDK response into the kernel envelope. Pure / no IO. */
export function mapMcpResult(raw: RawMcpCallResult): McpToolResult {
  const content: McpResultContent[] = [];
  const rawContent = raw.content ?? [];
  for (const block of rawContent) {
    const mapped = mapBlock(block);
    if (mapped) content.push(mapped);
  }
  if (raw.structuredContent !== undefined) {
    content.push({ type: 'json', value: raw.structuredContent });
  }

  if (raw.isError === true) {
    const message = extractFirstText(content) ?? 'MCP server returned isError';
    return Object.freeze({
      ok: false,
      content: Object.freeze(content),
      errorMessage: message,
    });
  }

  return Object.freeze({
    ok: true,
    content: Object.freeze(content),
  });
}

function mapBlock(block: unknown): McpResultContent | null {
  if (!isPlainObject(block)) return null;
  const type = block['type'];
  if (type === 'text') {
    const text = block['text'];
    if (typeof text === 'string') {
      return { type: 'text', text };
    }
    return null;
  }
  if (type === 'json' || type === 'resource' || type === 'image') {
    return { type: 'json', value: block };
  }
  return null;
}

function extractFirstText(
  content: ReadonlyArray<McpResultContent>,
): string | null {
  for (const block of content) {
    if (block.type === 'text') return block.text;
  }
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
