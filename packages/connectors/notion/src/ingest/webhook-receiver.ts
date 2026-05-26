/**
 * Notion does not (as of 2026) ship a first-party push-webhook for
 * page/block changes — the canonical approach is the /v1/search cursor
 * poll. This module is a placeholder receiver that records the seam
 * for future webhook support and returns `'unsupported'` for all
 * inputs.
 *
 * Reference: Notion — "Search"
 *   https://developers.notion.com/reference/post-search
 *   (visited 2026-05-26 — no webhook in v1 docs).
 */

import type { ConnectorLogger } from '../types.js';

export interface NotionWebhookResult {
  readonly outcome: 'unsupported';
  readonly reason: string;
}

export function receiveNotionWebhook(
  _rawBody: string,
  _signatureHeader: string | null,
  deps: { readonly logger: ConnectorLogger; readonly tenantId: string },
): NotionWebhookResult {
  deps.logger.warn('Notion webhook receiver invoked but Notion has no native webhook', {
    persona: 'Mr. Mwikila',
    connector: 'notion',
    tenantId: deps.tenantId,
  });
  return {
    outcome: 'unsupported',
    reason:
      'Notion has no native webhook in v1 of the API; use the /v1/search cursor poll instead.',
  };
}
