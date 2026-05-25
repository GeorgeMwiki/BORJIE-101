/**
 * Shared types for Agent PhL's AI-native capabilities.
 *
 * Lives in `phl-common/` to avoid colliding with `shared.ts` (Agent PhG).
 * The two agent cohorts compose via the ai-native/index.ts namespace exports.
 */

export interface Citation {
  readonly kind:
    | 'market_signal'
    | 'occupancy_rollup'
    | 'churn_prediction'
    | 'inspection_finding'
    | 'statute'
    | 'document_span'
    | 'seasonality'
    | 'other';
  readonly ref: string;
  readonly note?: string;
}

export interface BudgetContext {
  readonly tenantId: string;
  readonly operation: string;
  readonly correlationId?: string;
}

export type NotConfigured = {
  readonly success: false;
  readonly code:
    | 'VOICE_NOT_CONFIGURED'
    | 'LLM_NOT_CONFIGURED'
    | 'ADAPTER_NOT_CONFIGURED';
  readonly message: string;
};

export type AiNativeResult<T> =
  | { readonly success: true; readonly data: T }
  | NotConfigured
  | {
      readonly success: false;
      readonly code:
        | 'BUDGET_EXCEEDED'
        | 'VALIDATION'
        | 'GUARDRAIL_VIOLATION'
        | 'UPSTREAM_ERROR';
      readonly message: string;
    };

/**
 * djb2-style stable hash — no crypto dependency. Collision risk acceptable
 * for a content fingerprint (not a security primitive).
 */
export function promptHashDjb2(prompt: string): string {
  let hash = 5381;
  for (let i = 0; i < prompt.length; i += 1) {
    hash = ((hash << 5) + hash + prompt.charCodeAt(i)) | 0;
  }
  return `ph_${(hash >>> 0).toString(16)}`;
}

export function generateId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}_${Date.now()}_${rand}`;
}
