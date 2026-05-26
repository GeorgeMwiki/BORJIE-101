/**
 * Google Drive supports push notifications via the
 * `files.watch` resource — a separate, opt-in flow that requires a
 * verified domain to receive the channel. The OMNI-P0 spec uses the
 * change-feed poll path instead. This module is a placeholder receiver
 * that returns `'unsupported'` for the OMNI-P0 wave.
 *
 * Reference: Google — "Drive API — Push notifications"
 *   https://developers.google.com/workspace/drive/api/guides/push
 *   (visited 2026-05-26 — opt-in, requires verified domain).
 */

import type { ConnectorLogger } from '../types.js';

export interface DriveWebhookResult {
  readonly outcome: 'unsupported';
  readonly reason: string;
}

export function receiveDriveWebhook(
  _rawBody: string,
  _channelHeader: string | null,
  deps: { readonly logger: ConnectorLogger; readonly tenantId: string },
): DriveWebhookResult {
  deps.logger.warn(
    'Drive webhook receiver invoked but OMNI-P0 uses the change-feed poll',
    {
      persona: 'Mr. Mwikila',
      connector: 'google-drive',
      tenantId: deps.tenantId,
    },
  );
  return {
    outcome: 'unsupported',
    reason:
      'OMNI-P0 uses /v3/changes polling. files.watch is deferred to a later wave (requires verified-domain push channel).',
  };
}
