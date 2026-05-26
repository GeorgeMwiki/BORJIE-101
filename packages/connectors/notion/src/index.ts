/**
 * @borjie/connector-notion — public surface.
 *
 * OMNI-P0-BATCH-2. Notion (pages / blocks / comments) ingest.
 *
 * Companion spec: `Docs/DESIGN/OMNI_P0_BATCH2_CONNECTORS_SPEC.md` §4.
 *
 * Persona: Mr. Mwikila.
 */

export type {
  Provider,
  NotionBlockKind,
  NotionPage,
  NotionBlock,
  NotionUpstreamPage,
  NotionUpstreamBlock,
  NotionUpstreamProperty,
  NotionSearchResponse,
  NotionBlocksResponse,
  Fetcher,
  EncryptedCredentialStore,
  ConnectorLogger,
} from './types.js';
export { PROVIDER } from './types.js';

export {
  exchangeNotionAuthCode,
  type NotionOAuthExchangeInput,
  type NotionTokenResponse,
  type NotionCredentials,
  type NotionInstallDeps,
} from './auth/oauth.js';

export {
  rotateNotionAccessToken,
  type NotionRotationInput,
} from './auth/token-refresh.js';

export {
  createNotionHttpClient,
  type NotionHttpClient,
  type NotionHttpDeps,
} from './client/http-client.js';

export {
  redactValue,
  looksLikePii,
  type RedactInput,
} from './redact/pii-redactor.js';

export {
  normalizePage,
  normalizeBlock,
  type NotionNormalizerDeps,
} from './ingest/normalizer.js';

export {
  pollNotion,
  type NotionPollInput,
  type NotionPollDeps,
  type NotionPollResult,
} from './ingest/poller.js';

export {
  receiveNotionWebhook,
  type NotionWebhookResult,
} from './ingest/webhook-receiver.js';

export {
  createInMemoryNotionPageRepository,
  createInMemoryNotionBlockRepository,
  type NotionPageRepository,
  type NotionBlockRepository,
} from './repositories/in-memory.js';

export {
  createSqlNotionPageRepository,
  createSqlNotionBlockRepository,
  type NotionSqlPageDeps,
  type NotionSqlBlockDeps,
} from './repositories/sql.js';
