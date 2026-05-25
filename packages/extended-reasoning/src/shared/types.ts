/**
 * Shared types for the extended-reasoning package.
 *
 * Keeping these in `shared/` avoids cyclic imports between sibling modules
 * (got, lats, tot, prm-substrate, sot) and gives the composition example a
 * single place to import from.
 */

/**
 * Minimal model adapter. Callers inject a real Anthropic/OpenAI adapter in
 * production; tests inject a deterministic stub that returns fixture strings.
 *
 * The signature is intentionally lean — no streaming, no tool calls — so
 * unit tests stay fast and deterministic. Streaming integration lives in
 * the chat-ui / api-gateway layer, not here.
 */
export type ModelAdapter = (input: ModelInput) => Promise<string>;

export interface ModelInput {
  readonly system?: string;
  readonly prompt: string;
  readonly temperature?: number;
  /** Speed/cost tier hint. SoT uses 'fast' for skeleton + synthesis. */
  readonly tier?: 'fast' | 'quality';
  /** Optional cancellation. */
  readonly signal?: AbortSignal;
}

/**
 * Generic JSON-safe value. Keeps every result serialisable for J1 emission
 * (PRM training data) and for replay/debug in tests.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [k: string]: JsonValue };

/**
 * Outcome label used by PRM substrate. Matches the K-D Reflexion store's
 * categorical outcome so we can join training samples with reflections.
 */
export type Outcome = 'success' | 'partial' | 'failure';

/**
 * Step-level scoring result from PRM. `unscored` is the legitimate
 * "no PRM loaded" state — see PRM substrate README for the drop-in contract.
 */
export type StepScore =
  | { readonly kind: 'scored'; readonly value: number; readonly modelId: string }
  | { readonly kind: 'unscored'; readonly reason: 'no-model-loaded' | 'disabled' };
