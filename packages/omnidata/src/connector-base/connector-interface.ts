/**
 * Connector interface helpers. Pure type re-exports + a small assertion
 * helper that concrete connector implementations call to validate their
 * own metadata at construction time. No I/O.
 */

import type {
  OmnidataConnector,
  OmnidataConnectorMetadata,
  OmnidataSourceKind,
  ConnectorPhase,
  VolumeClass,
  RefreshPolicy,
} from '../types.js';

export type { OmnidataConnector, OmnidataConnectorMetadata };

/**
 * Sentinel — connectors that are partially implemented (still in design)
 * can mark themselves as unconfigured at runtime so the orchestrator
 * skips them gracefully.
 */
export interface ConnectorConstructionAssertion {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<string>;
}

const VALID_SOURCE_KINDS: ReadonlyArray<OmnidataSourceKind> = [
  'slack',
  'gmail',
  'outlook_mail',
  'google_calendar',
  'outlook_calendar',
  'whatsapp_business',
  'notion',
  'google_drive',
  'onedrive',
  'dropbox',
  'microsoft_teams',
  'salesforce',
  'hubspot',
  'linear',
  'jira',
  'asana',
  'github',
  'gitlab',
  'zoom_recording',
  'meet_recording',
  'vapi_call',
  'retell_call',
  'twilio_call',
  'instagram_business',
  'facebook_page',
  'tiktok_business',
  'twitter',
  'linkedin_page',
  'youtube_channel',
  'mpesa_statement',
  'nbc_statement',
  'crdb_statement',
  'quickbooks',
  'xero',
  'tumemadini_portal',
  'nemc_portal',
  'tra_portal',
  'bot_portal',
];

const VALID_PHASES: ReadonlyArray<ConnectorPhase> = ['P0', 'P1', 'P2', 'P3'];
const VALID_VOLUMES: ReadonlyArray<VolumeClass> = ['light', 'medium', 'heavy'];

function refreshPolicyOk(p: RefreshPolicy): boolean {
  switch (p.kind) {
    case 'realtime':
      return p.webhookSecret.length > 0;
    case 'pushed':
      return p.subscriptionToken.length > 0;
    case 'cron':
      return p.cron.length > 0 && p.maxRowsPerRun > 0;
    case 'on-demand':
      return true;
  }
}

/**
 * Validates connector metadata at construction. Concrete connectors
 * should throw on `ok === false`. Pure function — testable.
 */
export function assertConnectorMetadata(meta: OmnidataConnectorMetadata): ConnectorConstructionAssertion {
  const issues: string[] = [];
  if (meta.id.length === 0) issues.push('id must be non-empty');
  if (!VALID_SOURCE_KINDS.includes(meta.sourceKind)) issues.push('sourceKind not in catalogue');
  if (meta.displayName.length === 0) issues.push('displayName must be non-empty');
  if (!VALID_PHASES.includes(meta.phase)) issues.push('phase must be one of P0/P1/P2/P3');
  if (!VALID_VOLUMES.includes(meta.volumeClass)) issues.push('volumeClass must be light/medium/heavy');
  if (!refreshPolicyOk(meta.refreshPolicy)) issues.push('refreshPolicy is invalid for its kind');
  return { ok: issues.length === 0, issues };
}
