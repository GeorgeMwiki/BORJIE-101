/**
 * Connector base — re-exports the constructable primitives that
 * concrete `OmnidataConnector` implementations compose.
 */

export {
  assertConnectorMetadata,
  type ConnectorConstructionAssertion,
} from './connector-interface.js';

export {
  createAuthBroker,
  type AuthBroker,
  type AuthBrokerDeps,
  type AuthStoragePort,
  type OAuth2Refresher,
  type OAuth2RefreshResult,
  type StoredOAuth2Credential,
} from './auth-broker.js';

export { decideSchedule, type ScheduleDecision, type ScheduleInput } from './sync-scheduler.js';

export {
  createDefaultPIIRedactor,
  DEFAULT_BOUNDARY_PII_FIELDS,
} from './pii-redactor.js';

export {
  createProvenanceStamper,
  type ProvenanceStamper,
  type ProvenanceStamperDeps,
  type StampParams,
} from './provenance-stamper.js';
