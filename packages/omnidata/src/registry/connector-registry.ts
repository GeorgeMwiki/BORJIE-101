/**
 * Connector registry — the catalogue of every supported source. The
 * registry is the single read surface the owner-facing install UI, the
 * orchestrator, and the meta-learning conductor (for
 * `install_connector` proposals) all consult.
 *
 * The registry holds metadata only — no live connectors. Concrete
 * `OmnidataConnector` instances are constructed on-demand via the
 * connector factory pattern that lands in the per-source waves.
 */

import type { OmnidataConnectorMetadata, OmnidataSourceKind, ConnectorPhase } from '../types.js';

const ENTRIES: ReadonlyArray<OmnidataConnectorMetadata> = [
  // ---- P0 — Critical ----
  {
    id: 'slack:default',
    sourceKind: 'slack',
    displayName: 'Slack',
    description: 'Slack workspace + Enterprise Grid. Channels, threads, files, app events.',
    phase: 'P0',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'realtime', webhookSecret: '<from-env>' },
    requiresConsentScope: 'channel',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'gmail:default',
    sourceKind: 'gmail',
    displayName: 'Gmail',
    description: 'Gmail mailbox via Gmail API + Pub/Sub watch.',
    phase: 'P0',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'pushed', subscriptionToken: '<from-env>' },
    requiresConsentScope: 'mailbox',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'outlook_mail:default',
    sourceKind: 'outlook_mail',
    displayName: 'Outlook Mail',
    description: 'Outlook mailbox via Microsoft Graph + webhook subscriptions.',
    phase: 'P0',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'pushed', subscriptionToken: '<from-env>' },
    requiresConsentScope: 'mailbox',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'google_calendar:default',
    sourceKind: 'google_calendar',
    displayName: 'Google Calendar',
    description: 'Google Calendar events + attendees.',
    phase: 'P0',
    volumeClass: 'light',
    refreshPolicy: { kind: 'pushed', subscriptionToken: '<from-env>' },
    requiresConsentScope: 'mailbox',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'outlook_calendar:default',
    sourceKind: 'outlook_calendar',
    displayName: 'Outlook Calendar',
    description: 'Outlook Calendar events via Microsoft Graph.',
    phase: 'P0',
    volumeClass: 'light',
    refreshPolicy: { kind: 'pushed', subscriptionToken: '<from-env>' },
    requiresConsentScope: 'mailbox',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'whatsapp_business:default',
    sourceKind: 'whatsapp_business',
    displayName: 'WhatsApp Business',
    description: 'WhatsApp Business Cloud API messages + media.',
    phase: 'P0',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'realtime', webhookSecret: '<from-env>' },
    requiresConsentScope: 'per-user-dm',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'notion:default',
    sourceKind: 'notion',
    displayName: 'Notion',
    description: 'Notion pages, blocks, databases.',
    phase: 'P0',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'cron', cron: '0 */2 * * *', maxRowsPerRun: 5000 },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'google_drive:default',
    sourceKind: 'google_drive',
    displayName: 'Google Drive',
    description: 'Google Drive files (folder-opt-in).',
    phase: 'P0',
    volumeClass: 'heavy',
    refreshPolicy: { kind: 'pushed', subscriptionToken: '<from-env>' },
    requiresConsentScope: 'folder',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'onedrive:default',
    sourceKind: 'onedrive',
    displayName: 'OneDrive',
    description: 'OneDrive files via Microsoft Graph.',
    phase: 'P0',
    volumeClass: 'heavy',
    refreshPolicy: { kind: 'pushed', subscriptionToken: '<from-env>' },
    requiresConsentScope: 'folder',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'dropbox:default',
    sourceKind: 'dropbox',
    displayName: 'Dropbox',
    description: 'Dropbox files via Dropbox API.',
    phase: 'P0',
    volumeClass: 'heavy',
    refreshPolicy: { kind: 'cron', cron: '0 */1 * * *', maxRowsPerRun: 1000 },
    requiresConsentScope: 'folder',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },

  // ---- P1 — High-value ----
  {
    id: 'microsoft_teams:default',
    sourceKind: 'microsoft_teams',
    displayName: 'Microsoft Teams',
    description: 'Teams messages, chats, meetings.',
    phase: 'P1',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'realtime', webhookSecret: '<from-env>' },
    requiresConsentScope: 'channel',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'salesforce:default',
    sourceKind: 'salesforce',
    displayName: 'Salesforce',
    description: 'Salesforce Accounts, Contacts, Opportunities, Activities.',
    phase: 'P1',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'pushed', subscriptionToken: '<from-env>' },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'hubspot:default',
    sourceKind: 'hubspot',
    displayName: 'HubSpot',
    description: 'HubSpot CRM Contacts, Companies, Deals, Engagements.',
    phase: 'P1',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'realtime', webhookSecret: '<from-env>' },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'linear:default',
    sourceKind: 'linear',
    displayName: 'Linear',
    description: 'Linear issues + comments via GraphQL + webhooks.',
    phase: 'P1',
    volumeClass: 'light',
    refreshPolicy: { kind: 'realtime', webhookSecret: '<from-env>' },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },
  {
    id: 'github:default',
    sourceKind: 'github',
    displayName: 'GitHub',
    description: 'GitHub PRs, commits, issues (repo-opt-in).',
    phase: 'P1',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'realtime', webhookSecret: '<from-env>' },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },

  // ---- P2 — Public social ----
  {
    id: 'instagram_business:default',
    sourceKind: 'instagram_business',
    displayName: 'Instagram Business',
    description: 'Instagram Business DMs, comments, posts via Meta Graph.',
    phase: 'P2',
    volumeClass: 'medium',
    refreshPolicy: { kind: 'realtime', webhookSecret: '<from-env>' },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'yes',
    authKind: 'oauth2',
  },

  // ---- P3 — Specialised (Borjie-regulator) ----
  {
    id: 'tra_portal:default',
    sourceKind: 'tra_portal',
    displayName: 'TRA Portal',
    description: 'Tanzania Revenue Authority filings via mcp-server-tra (already shipped).',
    phase: 'P3',
    volumeClass: 'light',
    refreshPolicy: { kind: 'cron', cron: '0 6 * * *', maxRowsPerRun: 200 },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'already_shipped',
    authKind: 'api-key',
  },
  {
    id: 'tumemadini_portal:default',
    sourceKind: 'tumemadini_portal',
    displayName: 'Tumemadini Portal',
    description: 'Tanzania Mining Commission portal via mcp-server-tumemadini (already shipped).',
    phase: 'P3',
    volumeClass: 'light',
    refreshPolicy: { kind: 'cron', cron: '0 6 * * *', maxRowsPerRun: 200 },
    requiresConsentScope: 'workspace',
    mcpServerOpportunity: 'already_shipped',
    authKind: 'api-key',
  },
];

export interface ConnectorRegistry {
  readonly all: () => ReadonlyArray<OmnidataConnectorMetadata>;
  readonly byPhase: (phase: ConnectorPhase) => ReadonlyArray<OmnidataConnectorMetadata>;
  readonly byKind: (kind: OmnidataSourceKind) => OmnidataConnectorMetadata | undefined;
  readonly byId: (id: string) => OmnidataConnectorMetadata | undefined;
}

/**
 * Pure factory; no side effects. Callers pass a custom entries list
 * for tests; production uses the default exported `ENTRIES`.
 */
export function createConnectorRegistry(
  entries: ReadonlyArray<OmnidataConnectorMetadata> = ENTRIES,
): ConnectorRegistry {
  return {
    all: () => entries,
    byPhase: (phase: ConnectorPhase) => entries.filter((e) => e.phase === phase),
    byKind: (kind: OmnidataSourceKind) => entries.find((e) => e.sourceKind === kind),
    byId: (id: string) => entries.find((e) => e.id === id),
  };
}

export { ENTRIES as DEFAULT_REGISTRY_ENTRIES };
