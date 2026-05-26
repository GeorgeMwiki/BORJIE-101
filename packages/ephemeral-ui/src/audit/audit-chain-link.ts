/**
 * `audit-chain-link.ts` — emits the audit-hash payload for a composition.
 *
 * The packaged shape mirrors the
 * `AuditPayload` contract of `@borjie/audit-hash-chain` (per the PO-14
 * spec): a kind tag + a canonical payload object. We do not reach into
 * the chain implementation here; the caller threads our payload through
 * the chain's `appendEntry` function.
 *
 * Pure.
 */

export interface ComposeAuditPayload {
  readonly kind: 'ephemeral_dashboard_compose';
  readonly payload: {
    readonly function_id: string;
    readonly manifest_version: number;
    readonly function_input_hash: string;
    readonly function_output_hash: string;
    readonly user_context_hash: string;
    readonly generated_recipe_hash: string;
    readonly composer_version: string;
    readonly user_id: string;
    readonly session_id: string;
    readonly tenant_id: string;
    readonly scope_kind: string;
    readonly scope_id: string;
    readonly timestamp_iso: string;
  };
}

/**
 * Builds the canonical audit payload. The caller hashes + appends to
 * the chain. Returning a frozen record prevents mutation by mistake.
 */
export function buildComposeAuditPayload(input: {
  readonly function_id: string;
  readonly manifest_version: number;
  readonly function_input_hash: string;
  readonly function_output_hash: string;
  readonly user_context_hash: string;
  readonly generated_recipe_hash: string;
  readonly composer_version: string;
  readonly user_id: string;
  readonly session_id: string;
  readonly tenant_id: string;
  readonly scope_kind: string;
  readonly scope_id: string;
  readonly timestamp_iso: string;
}): ComposeAuditPayload {
  return Object.freeze({
    kind: 'ephemeral_dashboard_compose' as const,
    payload: Object.freeze({
      function_id: input.function_id,
      manifest_version: input.manifest_version,
      function_input_hash: input.function_input_hash,
      function_output_hash: input.function_output_hash,
      user_context_hash: input.user_context_hash,
      generated_recipe_hash: input.generated_recipe_hash,
      composer_version: input.composer_version,
      user_id: input.user_id,
      session_id: input.session_id,
      tenant_id: input.tenant_id,
      scope_kind: input.scope_kind,
      scope_id: input.scope_id,
      timestamp_iso: input.timestamp_iso,
    }),
  });
}
