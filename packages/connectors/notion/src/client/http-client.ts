/**
 * Thin HTTP client for the Notion REST API.
 *
 * Every call goes through an injected `Fetcher` port. Production wires
 * `globalThis.fetch`.
 *
 * Reference: Notion — "Working with the Notion API"
 *   https://developers.notion.com/reference
 *   (visited 2026-05-26).
 */

import type {
  Fetcher,
  NotionBlocksResponse,
  NotionSearchResponse,
} from '../types.js';

const BASE = 'https://api.notion.com/v1';
const NOTION_VERSION = '2022-06-28';

export interface NotionHttpClient {
  readonly search: (
    accessToken: string,
    cursor: string | null,
  ) => Promise<NotionSearchResponse>;
  readonly listBlockChildren: (
    accessToken: string,
    blockId: string,
    cursor: string | null,
  ) => Promise<NotionBlocksResponse>;
}

export interface NotionHttpDeps {
  readonly fetcher: Fetcher;
  readonly baseUrl?: string;
}

function headers(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

export function createNotionHttpClient(deps: NotionHttpDeps): NotionHttpClient {
  const base = deps.baseUrl ?? BASE;
  return {
    async search(accessToken, cursor) {
      const body = JSON.stringify({
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        ...(cursor ? { start_cursor: cursor } : {}),
        page_size: 50,
      });
      const req = new Request(`${base}/search`, {
        method: 'POST',
        headers: headers(accessToken),
        body,
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`Notion search failed: ${res.status}`);
      }
      return (await res.json()) as NotionSearchResponse;
    },
    async listBlockChildren(accessToken, blockId, cursor) {
      const url = new URL(`${base}/blocks/${encodeURIComponent(blockId)}/children`);
      if (cursor) url.searchParams.set('start_cursor', cursor);
      url.searchParams.set('page_size', '100');
      const req = new Request(url.toString(), {
        method: 'GET',
        headers: headers(accessToken),
      });
      const res = await deps.fetcher(req);
      if (!res.ok) {
        throw new Error(`Notion listBlockChildren failed: ${res.status}`);
      }
      return (await res.json()) as NotionBlocksResponse;
    },
  };
}
