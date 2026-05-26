import { describe, it, expect } from 'vitest';
import { normalizePage, normalizeBlock } from '../ingest/normalizer.js';
import { redactValue } from '../redact/pii-redactor.js';
import type {
  NotionUpstreamPage,
  NotionUpstreamBlock,
  NotionUpstreamProperty,
} from '../types.js';

const deps = {
  tenantId: 'tenant_a',
  workspaceId: 'ws_1',
  nowIso: () => '2026-05-26T10:00:00.000Z',
  uuid: () => 'uuid-1',
};

describe('normalizePage', () => {
  it('extracts and redacts the title', () => {
    const upstream: NotionUpstreamPage = {
      object: 'page',
      id: 'page-1',
      last_edited_time: '2026-05-25T08:00:00.000Z',
      parent: { type: 'workspace', workspace: true },
      properties: {
        Name: {
          type: 'title',
          title: [{ plain_text: 'Geology Survey 2026' }],
        } satisfies NotionUpstreamProperty,
      },
    };
    const row = normalizePage(upstream, deps);
    expect(row.title).toBe(
      redactValue({ tenantId: 'tenant_a', fieldPath: 'title', value: 'Geology Survey 2026' }),
    );
  });

  it('redacts email/phone-typed properties', () => {
    const upstream: NotionUpstreamPage = {
      object: 'page',
      id: 'page-2',
      last_edited_time: '2026-05-25T08:00:00.000Z',
      properties: {
        Contact: { type: 'email', email: 'george@borjie.test' },
        Phone: { type: 'phone_number', phone_number: '+255700000000' },
      },
    };
    const row = normalizePage(upstream, deps);
    const props = row.properties as Record<string, { type: string; hash?: string }>;
    expect(props.Contact?.type).toBe('email');
    expect(props.Contact?.hash).toBe(
      redactValue({ tenantId: 'tenant_a', fieldPath: 'properties.Contact', value: 'george@borjie.test' }),
    );
    expect(props.Phone?.hash).toBe(
      redactValue({ tenantId: 'tenant_a', fieldPath: 'properties.Phone', value: '+255700000000' }),
    );
  });

  it('falls back to null parent if upstream parent is workspace-level', () => {
    const upstream: NotionUpstreamPage = {
      object: 'page',
      id: 'page-3',
      last_edited_time: '2026-05-25T08:00:00.000Z',
      parent: { type: 'workspace', workspace: true },
    };
    expect(normalizePage(upstream, deps).parentId).toBeNull();
  });
});

describe('normalizeBlock', () => {
  it('collapses paragraph and heading_1 into text + heading kinds', () => {
    const paragraph: NotionUpstreamBlock = {
      object: 'block',
      id: 'b-1',
      type: 'paragraph',
      last_edited_time: '2026-05-25T08:00:00.000Z',
      paragraph: { rich_text: [{ plain_text: 'A field note' }] },
    };
    const heading: NotionUpstreamBlock = {
      object: 'block',
      id: 'b-2',
      type: 'heading_1',
      last_edited_time: '2026-05-25T08:00:00.000Z',
      heading_1: { rich_text: [{ plain_text: 'Title' }] },
    };
    expect(normalizeBlock(paragraph, deps).kind).toBe('text');
    expect(normalizeBlock(heading, deps).kind).toBe('heading');
  });

  it('flags comment blocks with kind=comment', () => {
    const comment: NotionUpstreamBlock = {
      object: 'block',
      id: 'b-3',
      type: 'comment',
      last_edited_time: '2026-05-25T08:00:00.000Z',
    };
    expect(normalizeBlock(comment, deps).kind).toBe('comment');
  });

  it('hashes the content text when it looks like PII', () => {
    const block: NotionUpstreamBlock = {
      object: 'block',
      id: 'b-4',
      type: 'paragraph',
      last_edited_time: '2026-05-25T08:00:00.000Z',
      paragraph: { rich_text: [{ plain_text: '+255700123456' }] },
    };
    const row = normalizeBlock(block, deps);
    const content = row.content as { content?: { hash?: string; text?: string } };
    expect(content.content?.hash).toBeDefined();
    expect(content.content?.text).toBeUndefined();
  });
});
