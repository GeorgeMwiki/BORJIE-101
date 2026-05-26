/**
 * SQL repository surface — production code wires this to a Drizzle
 * client over `whatsapp_messages`. The implementation is a stub; the
 * real client lives at the service layer where `db` is in scope.
 *
 * The shape matches `createInMemoryWhatsappRepository` so the
 * orchestrator can inject either.
 */

import type { WhatsappRepository } from './in-memory.js';
import type { WhatsappMessage } from '../types.js';

/**
 * Database port — kept abstract so this package does not import the
 * Drizzle client (which would pull the whole schema graph into the
 * connector). Production wires this to a `db.insert(whatsappMessages)`
 * call with onConflictDoNothing on (tenant_id, waba_id, wa_message_id).
 */
export interface WhatsappSqlDeps {
  readonly insertOnConflictDoNothing: (
    row: WhatsappMessage,
  ) => Promise<{ readonly inserted: boolean }>;
  readonly listByTenant: (
    tenantId: string,
  ) => Promise<ReadonlyArray<WhatsappMessage>>;
  readonly find: (
    tenantId: string,
    wabaId: string,
    waMessageId: string,
  ) => Promise<WhatsappMessage | null>;
}

export function createSqlWhatsappRepository(
  deps: WhatsappSqlDeps,
): WhatsappRepository {
  return {
    insert: deps.insertOnConflictDoNothing,
    listByTenant: deps.listByTenant,
    find: deps.find,
  };
}
