/**
 * @borjie/omnidata — public surface.
 *
 * Pillar 1 of the capability-boost vision. The connector framework
 * that lets Mr. Mwikila ingest every external source the org uses —
 * Slack, Gmail / Outlook, Notion, WhatsApp, Drive, Salesforce, social,
 * regulator portals — into a single typed substrate.
 *
 * The package ships the abstraction layer only: types, the connector
 * contract, the auth broker, the sync scheduler, the boundary PII
 * redactor, the provenance stamper, the registry, and one example
 * skeleton connector. Concrete connectors land per source in
 * follow-up waves.
 *
 * Cross-spec: see `Docs/DESIGN/OMNIDATA_CONNECTOR_INVENTORY.md`.
 */

export type {
  OmnidataSourceKind,
  RefreshPolicy,
  OmnidataAuthContext,
  ConsentScope,
  VolumeClass,
  ConnectorPhase,
  OmnidataConnectorMetadata,
  OmnidataSyncRequest,
  OmnidataSyncResult,
  OmnidataIngestedItem,
  OmnidataConnector,
  PIIRedactor,
  AuditChainPort,
  ConsentRegistryPort,
  ClockPort,
  UuidPort,
} from './types.js';

export {
  assertConnectorMetadata,
  type ConnectorConstructionAssertion,
  createAuthBroker,
  type AuthBroker,
  type AuthBrokerDeps,
  type AuthStoragePort,
  type OAuth2Refresher,
  type OAuth2RefreshResult,
  type StoredOAuth2Credential,
  decideSchedule,
  type ScheduleDecision,
  type ScheduleInput,
  createDefaultPIIRedactor,
  DEFAULT_BOUNDARY_PII_FIELDS,
  createProvenanceStamper,
  type ProvenanceStamper,
  type ProvenanceStamperDeps,
  type StampParams,
} from './connector-base/index.js';

export {
  createConnectorRegistry,
  DEFAULT_REGISTRY_ENTRIES,
  type ConnectorRegistry,
} from './registry/index.js';

export {
  createAuditLink,
  type AuditLink,
  type SyncAuditEvent,
} from './audit/index.js';

export {
  createSlackExampleConnector,
  type SlackExampleConnectorDeps,
  type SlackMessagePayload,
} from './examples/slack-example.js';
