/**
 * @borjie/on-device-router — pre-network intent router stub.
 *
 * Roadmap R4 — explicit 2027+ work per
 * `Docs/research/ON_DEVICE_MINILM_ROUTER.md`. DO NOT BUILD UNTIL Q4 2026.
 *
 * Today this package exposes a no-op `routeOnDevice()` that always
 * proxies the decision to the server (returns `{ toolId: null,
 * confidence: 0 }`). The signature is committed now so callers can
 * wire the routing slot without behaviour change; when the real ONNX
 * runtime ships the implementation swap is a single function body.
 *
 * Reasoning model selection at that point (per the research doc):
 *   - MiniLM-L6-v2 Q8 (22 MB) downloaded on first launch.
 *   - Fall-through to server routing on low confidence (<0.6).
 *   - `routerHint` field on `/brain/turn` carries the suggestion.
 */

export interface RoutingDecision {
  /** Which brain tool the on-device router believes this prompt maps to. */
  readonly toolId: string | null;
  /** 0..1 — how confident the on-device router is in `toolId`. */
  readonly confidence: number;
  /** Wall-clock ms spent in on-device inference. */
  readonly inferMs: number;
  /** When the real runtime ships this is the model name; today it is "stub". */
  readonly modelId: string;
}

export interface RouterOptions {
  /**
   * Caller can override the model name string for telemetry.
   * Stays `'stub'` until the ONNX path lands.
   */
  readonly modelId?: string;
  /** Test seam — return a fixed decision instead of the default no-op. */
  readonly fixedDecision?: RoutingDecision;
}

/**
 * Synchronous routing decision.
 *
 * STUB BEHAVIOUR: always returns `{ toolId: null, confidence: 0,
 * inferMs: 0, modelId: 'stub' }` so the server-side routing path
 * stays canonical. Replace with the ONNX-runtime call when the
 * package graduates.
 */
export function routeOnDevice(
  promptText: string,
  options: RouterOptions = {},
): RoutingDecision {
  if (options.fixedDecision) return options.fixedDecision;
  // The stub does NOT inspect `promptText`. The variable is referenced
  // here to keep the compiler honest about the eventual signature.
  void promptText;
  return Object.freeze({
    toolId: null,
    confidence: 0,
    inferMs: 0,
    modelId: options.modelId ?? 'stub',
  });
}

/**
 * Bilingual prompt sentinel — explicit reminder that the package is
 * intentionally idle today.
 */
export const ON_DEVICE_ROUTER_STATUS = Object.freeze({
  en: 'STUB. On-device routing is disabled — all decisions defer to the server.',
  sw: 'STUB. Uchaguzi wa kifaa umezimwa — maamuzi yote yanapelekwa kwenye seva.',
});
