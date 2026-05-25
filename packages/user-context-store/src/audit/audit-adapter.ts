/**
 * WORM-audit adapter.
 *
 * Wraps the existing `wormAuditStore` (shape defined in
 * `services/api-gateway/src/composition/persistent-stores-wiring.ts`)
 * so it can satisfy our {@link ContextAuditPort}. Every fetch becomes
 * one tamper-evident WORM entry; downstream the existing chain-verify
 * job covers integrity.
 */
import type { ContextAuditPort } from '../types.js';

/**
 * Minimal shape of the wormAuditStore we depend on. Defined here to
 * avoid an import edge into `@borjie/document-studio/signing` or
 * the api-gateway composition root.
 */
export interface WormAuditStore {
  append(entry: Readonly<Record<string, unknown>>): Promise<unknown>;
}

export interface CreateWormAuditContextSinkArgs {
  readonly wormAuditStore: WormAuditStore;
  /** Optional structured logger for fire-and-forget audit-write failures. */
  readonly logger?: {
    warn?(obj: Record<string, unknown>, msg?: string): void;
  };
}

/**
 * Build a {@link ContextAuditPort} backed by the WORM audit store.
 */
export function createWormAuditContextSink(
  args: CreateWormAuditContextSinkArgs,
): ContextAuditPort {
  return {
    async recordFetch(record): Promise<void> {
      try {
        await args.wormAuditStore.append({
          kind: 'user_context_store.fetch_snippets',
          tenantId: record.tenantId,
          userId: record.userId,
          role: record.role,
          intent: record.intent,
          questionLength: record.question.length,
          snippetCount: record.snippetCount,
          citationCount: record.citations.length,
          // We persist citation shape but NOT the question text — the
          // question can contain PII; WORM keeps a fingerprint only.
          citationDigest: record.citations.map((c) => `${c.kind}:${c.id}`).join(','),
          consent: record.consent,
          timestamp: record.timestamp,
        });
      } catch (error) {
        args.logger?.warn?.(
          { err: error instanceof Error ? error.message : String(error) },
          'user-context-store: WORM audit append failed — proceeding without audit row',
        );
      }
    },
  };
}
