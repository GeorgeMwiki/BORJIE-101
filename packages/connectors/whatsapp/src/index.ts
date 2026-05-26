/**
 * @borjie/connector-whatsapp — public surface.
 *
 * OMNI-P0-BATCH-2. WhatsApp Business Cloud API ingest.
 *
 * Companion spec: `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md` §3.
 *
 * Persona: Mr. Mwikila.
 */

export type {
  Provider,
  WhatsappDirection,
  WhatsappMessageKind,
  WhatsappMediaProjection,
  WhatsappContactProjection,
  WhatsappMessage,
  WhatsappWebhookEnvelope,
  WhatsappWebhookEntry,
  WhatsappWebhookChange,
  WhatsappWebhookValue,
  WhatsappInboundMessage,
  Fetcher,
  EncryptedCredentialStore,
  ConnectorLogger,
} from './types.js';
export { PROVIDER } from './types.js';

export {
  installWhatsappCredentials,
  type WhatsappInstallInput,
  type WhatsappCredentials,
} from './auth/oauth.js';

export {
  rotateWhatsappAccessToken,
  type WhatsappRotationInput,
} from './auth/token-refresh.js';

export {
  createWhatsappHttpClient,
  type WhatsappHttpClient,
  type WhatsappHttpDeps,
  type WhatsappMediaResponse,
} from './client/http-client.js';

export {
  redactValue,
  DEFAULT_WHATSAPP_PII_PATHS,
  type RedactInput,
  type WhatsappPiiPaths,
} from './redact/pii-redactor.js';

export {
  normalizeInbound,
  type NormalizerDeps,
  type NormalizedRow,
} from './ingest/normalizer.js';

export {
  verifyWhatsappSignature,
  receiveWhatsappWebhook,
  type VerifySignatureInput,
  type ReceiverDeps,
  type ReceiveResult,
} from './ingest/webhook-receiver.js';

export {
  pollWhatsappReconciliation,
  type PollerInput,
  type PollerDeps,
  type PollerResult,
} from './ingest/poller.js';

export {
  createInMemoryWhatsappRepository,
  type WhatsappRepository,
} from './repositories/in-memory.js';

export {
  createSqlWhatsappRepository,
  type WhatsappSqlDeps,
} from './repositories/sql.js';
