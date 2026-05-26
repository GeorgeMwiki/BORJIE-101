/**
 * Notion cursor-based poller.
 *
 * Calls /v1/search sorted by last_edited_time desc, paginates until we
 * hit the cursor (last seen last_edited_time). For each new/updated
 * page, fetches its block children recursively (depth-capped at 20).
 *
 * Reference: Notion — "Search"
 *   https://developers.notion.com/reference/post-search
 *   (visited 2026-05-26).
 */

import type {
  NotionPage,
  NotionBlock,
  ConnectorLogger,
} from '../types.js';
import type { NotionHttpClient } from '../client/http-client.js';
import { normalizePage, normalizeBlock, type NotionNormalizerDeps } from './normalizer.js';

const MAX_BLOCK_DEPTH = 20;

export interface NotionPollInput {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly accessToken: string;
  /** ISO cursor — fetch pages with last_edited_time > cursor. */
  readonly sinceLastEdited: string | null;
  readonly maxPages: number;
}

export interface NotionPollDeps {
  readonly client: NotionHttpClient;
  readonly logger: ConnectorLogger;
  readonly nowIso: () => string;
  readonly uuid: () => string;
}

export interface NotionPollResult {
  readonly pages: ReadonlyArray<NotionPage>;
  readonly blocks: ReadonlyArray<NotionBlock>;
  readonly nextSinceLastEdited: string;
}

export async function pollNotion(
  input: NotionPollInput,
  deps: NotionPollDeps,
): Promise<NotionPollResult> {
  const normalizerDeps: NotionNormalizerDeps = {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    nowIso: deps.nowIso,
    uuid: deps.uuid,
  };
  const pages: NotionPage[] = [];
  const blocks: NotionBlock[] = [];
  let cursor: string | null = null;
  let cap = input.maxPages;
  // Start at the existing cursor (or epoch on first sync) so the first
  // newer page advances the bookmark forward.
  let maxLastEdited = input.sinceLastEdited ?? '1970-01-01T00:00:00.000Z';

  while (cap > 0) {
    const page = await deps.client.search(input.accessToken, cursor);
    for (const upstream of page.results) {
      if (
        input.sinceLastEdited &&
        upstream.last_edited_time <= input.sinceLastEdited
      ) {
        // Reached cursor — stop draining.
        return { pages, blocks, nextSinceLastEdited: maxLastEdited };
      }
      pages.push(normalizePage(upstream, normalizerDeps));
      if (upstream.last_edited_time > maxLastEdited) {
        maxLastEdited = upstream.last_edited_time;
      }
      cap -= 1;
      // Fetch the block tree for the page.
      const collectedBlocks = await fetchBlockTree(
        input.accessToken,
        upstream.id,
        deps,
        normalizerDeps,
        0,
      );
      for (const b of collectedBlocks) blocks.push(b);
      if (cap <= 0) break;
    }
    if (!page.has_more) break;
    cursor = page.next_cursor;
    if (!cursor) break;
  }

  return { pages, blocks, nextSinceLastEdited: maxLastEdited };
}

async function fetchBlockTree(
  accessToken: string,
  parentId: string,
  deps: NotionPollDeps,
  normalizerDeps: NotionNormalizerDeps,
  depth: number,
): Promise<ReadonlyArray<NotionBlock>> {
  if (depth >= MAX_BLOCK_DEPTH) {
    deps.logger.warn('Notion block tree depth cap reached', {
      persona: 'Mr. Mwikila',
      connector: 'notion',
      tenantId: normalizerDeps.tenantId,
      parentId,
    });
    return [];
  }
  const acc: NotionBlock[] = [];
  let cursor: string | null = null;
  for (let iter = 0; iter < 100; iter += 1) {
    const response = await deps.client.listBlockChildren(
      accessToken,
      parentId,
      cursor,
    );
    for (const upstream of response.results) {
      acc.push(normalizeBlock(upstream, normalizerDeps));
      if (upstream.has_children === true) {
        const children = await fetchBlockTree(
          accessToken,
          upstream.id,
          deps,
          normalizerDeps,
          depth + 1,
        );
        for (const c of children) acc.push(c);
      }
    }
    if (!response.has_more) break;
    cursor = response.next_cursor;
    if (!cursor) break;
  }
  return acc;
}
