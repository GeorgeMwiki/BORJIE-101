import { describe, it, expect } from 'vitest';
import { pollNotion } from '../ingest/poller.js';
import type {
  ConnectorLogger,
  NotionUpstreamBlock,
  NotionUpstreamPage,
} from '../types.js';
import type { NotionHttpClient } from '../client/http-client.js';

const noopLogger: ConnectorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function makeClient(opts: {
  pages: ReadonlyArray<NotionUpstreamPage>;
  blocks: ReadonlyArray<NotionUpstreamBlock>;
}): NotionHttpClient {
  return {
    async search() {
      return { results: opts.pages, has_more: false, next_cursor: null };
    },
    async listBlockChildren() {
      return { results: opts.blocks, has_more: false, next_cursor: null };
    },
  };
}

describe('pollNotion', () => {
  it('returns normalised pages + blocks and advances the cursor', async () => {
    let counter = 0;
    const client = makeClient({
      pages: [
        {
          object: 'page',
          id: 'page-A',
          last_edited_time: '2026-05-25T09:00:00.000Z',
          properties: {
            Name: { type: 'title', title: [{ plain_text: 'Note' }] },
          },
        },
      ],
      blocks: [
        {
          object: 'block',
          id: 'block-X',
          type: 'paragraph',
          last_edited_time: '2026-05-25T09:00:00.000Z',
          paragraph: { rich_text: [{ plain_text: 'inside' }] },
        },
      ],
    });
    const result = await pollNotion(
      {
        tenantId: 'tenant_a',
        workspaceId: 'ws_1',
        accessToken: 'tok',
        sinceLastEdited: null,
        maxPages: 10,
      },
      {
        client,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => `uuid-${++counter}`,
      },
    );
    expect(result.pages.length).toBe(1);
    expect(result.blocks.length).toBe(1);
    expect(result.nextSinceLastEdited).toBe('2026-05-25T09:00:00.000Z');
  });

  it('stops draining when it hits the cursor', async () => {
    const client = makeClient({
      pages: [
        {
          object: 'page',
          id: 'page-OLD',
          last_edited_time: '2026-05-20T09:00:00.000Z',
        },
      ],
      blocks: [],
    });
    const result = await pollNotion(
      {
        tenantId: 'tenant_a',
        workspaceId: 'ws_1',
        accessToken: 'tok',
        sinceLastEdited: '2026-05-22T00:00:00.000Z',
        maxPages: 10,
      },
      {
        client,
        logger: noopLogger,
        nowIso: () => '2026-05-26T10:00:00.000Z',
        uuid: () => 'uuid',
      },
    );
    expect(result.pages.length).toBe(0);
  });
});
