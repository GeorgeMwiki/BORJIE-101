/**
 * Normalise upstream Notion JSON into canonical `NotionPage` /
 * `NotionBlock` rows. Pure — no I/O.
 */

import { createHash } from 'node:crypto';
import type {
  NotionPage,
  NotionBlock,
  NotionBlockKind,
  NotionUpstreamPage,
  NotionUpstreamBlock,
  NotionUpstreamProperty,
} from '../types.js';
import { redactValue, looksLikePii } from '../redact/pii-redactor.js';

export interface NotionNormalizerDeps {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly nowIso: () => string;
  readonly uuid: () => string;
}

function pickParent(upstream: NotionUpstreamPage | NotionUpstreamBlock): string | null {
  const parent = upstream.parent;
  if (!parent) return null;
  if (parent.type === 'page_id') return parent.page_id;
  if (parent.type === 'database_id') return parent.database_id;
  if (parent.type === 'block_id') return parent.block_id;
  return null;
}

function extractTitle(properties: Readonly<Record<string, NotionUpstreamProperty>>): string | null {
  for (const value of Object.values(properties)) {
    if (value.type === 'title' && value.title && value.title.length > 0) {
      const joined = value.title.map((t) => t.plain_text ?? '').join('');
      return joined.length > 0 ? joined : null;
    }
  }
  return null;
}

function redactProperties(
  properties: Readonly<Record<string, NotionUpstreamProperty>>,
  tenantId: string,
): Readonly<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value.type === 'email' && value.email) {
      out[key] = {
        type: 'email',
        hash: redactValue({ tenantId, fieldPath: `properties.${key}`, value: value.email }),
      };
    } else if (value.type === 'phone_number' && value.phone_number) {
      out[key] = {
        type: 'phone_number',
        hash: redactValue({ tenantId, fieldPath: `properties.${key}`, value: value.phone_number }),
      };
    } else if (value.type === 'rich_text' && value.rich_text) {
      const joined = value.rich_text.map((t) => t.plain_text ?? '').join('');
      if (joined.length === 0) {
        out[key] = { type: 'rich_text', text: '' };
      } else if (looksLikePii(joined)) {
        out[key] = {
          type: 'rich_text',
          hash: redactValue({ tenantId, fieldPath: `properties.${key}`, value: joined }),
        };
      } else {
        out[key] = { type: 'rich_text', text: joined };
      }
    } else if (value.type === 'title' && value.title) {
      const joined = value.title.map((t) => t.plain_text ?? '').join('');
      out[key] = {
        type: 'title',
        hash: redactValue({ tenantId, fieldPath: `properties.${key}`, value: joined }),
      };
    } else {
      out[key] = { type: value.type };
    }
  }
  return out;
}

export function normalizePage(
  upstream: NotionUpstreamPage,
  deps: NotionNormalizerDeps,
): NotionPage {
  const titleRaw = upstream.properties ? extractTitle(upstream.properties) : null;
  const title =
    titleRaw === null
      ? null
      : redactValue({
          tenantId: deps.tenantId,
          fieldPath: 'title',
          value: titleRaw,
        });
  const properties = upstream.properties
    ? redactProperties(upstream.properties, deps.tenantId)
    : {};
  const canonical = `${deps.tenantId}|${deps.workspaceId}|${upstream.id}`;
  const auditHash = createHash('sha256').update(canonical).digest('hex');
  return {
    id: deps.uuid(),
    tenantId: deps.tenantId,
    workspaceId: deps.workspaceId,
    pageId: upstream.id,
    parentId: pickParent(upstream),
    title,
    properties,
    lastEditedAt: upstream.last_edited_time,
    raw: upstream as unknown as Readonly<Record<string, unknown>>,
    ingestedAt: deps.nowIso(),
    auditHash,
  };
}

function coerceBlockKind(rawType: string): NotionBlockKind {
  if (
    rawType === 'paragraph' ||
    rawType === 'callout' ||
    rawType === 'toggle' ||
    rawType === 'equation' ||
    rawType === 'to_do'
  ) {
    return 'text';
  }
  if (rawType.startsWith('heading_')) return 'heading';
  if (
    rawType === 'bulleted_list_item' ||
    rawType === 'numbered_list_item' ||
    rawType === 'table_row'
  ) {
    return 'list';
  }
  if (rawType === 'quote') return 'quote';
  if (rawType === 'code') return 'code';
  if (rawType === 'image') return 'image';
  if (rawType === 'file' || rawType === 'pdf' || rawType === 'audio' || rawType === 'video') {
    return 'file';
  }
  if (rawType === 'bookmark' || rawType === 'embed' || rawType === 'link_preview') {
    return 'embed';
  }
  if (rawType === 'comment') return 'comment';
  return 'structural';
}

export function normalizeBlock(
  upstream: NotionUpstreamBlock,
  deps: NotionNormalizerDeps,
): NotionBlock {
  const kind = coerceBlockKind(upstream.type);
  // For text-shaped blocks, attempt to pull plain_text array from the
  // type-specific field and redact if it looks like PII.
  const typeField = upstream[upstream.type] as
    | { rich_text?: ReadonlyArray<{ plain_text?: string }> }
    | undefined;
  const joinedText =
    typeField?.rich_text?.map((t) => t.plain_text ?? '').join('') ?? '';
  const contentText =
    joinedText.length === 0
      ? null
      : looksLikePii(joinedText)
        ? {
            hash: redactValue({
              tenantId: deps.tenantId,
              fieldPath: `blocks.${upstream.id}.text`,
              value: joinedText,
            }),
          }
        : { text: joinedText };
  const content: Record<string, unknown> = {
    rawType: upstream.type,
    ...(contentText ? { content: contentText } : {}),
  };
  const canonical = `${deps.tenantId}|${deps.workspaceId}|${upstream.id}`;
  const auditHash = createHash('sha256').update(canonical).digest('hex');
  return {
    id: deps.uuid(),
    tenantId: deps.tenantId,
    workspaceId: deps.workspaceId,
    blockId: upstream.id,
    parentId: pickParent(upstream),
    kind,
    content,
    lastEditedAt: upstream.last_edited_time,
    raw: upstream as unknown as Readonly<Record<string, unknown>>,
    ingestedAt: deps.nowIso(),
    auditHash,
  };
}
