/**
 * @borjie/on-device-router — pre-network intent router.
 *
 * Originally Roadmap R4 / R-FUTURE-1 — shipped 2026-05-29 with a
 * research-stub runtime: real router pipeline that lazy-loads MiniLM
 * IF the ONNX bundle is on disk AND the optional `@xenova/transformers`
 * dep is installed, otherwise falls through to the server router.
 *
 * Two callable seams:
 *
 *   1. `routeOnDevice(text)` — synchronous, no-network. Preserved for
 *      callers that need a zero-await routing slot inside a render
 *      path. Behaviour is unchanged from the original stub: returns a
 *      no-op decision so the server stays canonical.
 *
 *   2. `routeOnDeviceAsync(text, opts)` — full pipeline. Falls back to
 *      server on missing files / missing dep / low confidence / error.
 *      This is the path React Native + workforce-mobile should use.
 *
 * Operator action OA-016 covers downloading the MiniLM-L6-v2 Q8 bundle
 * (~22 MB) into `~/.borjie-models/minilm-l6-v2/` — see
 * `Docs/OPS/OPERATOR_ACTION_LIST.md`.
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
 * Synchronous routing decision (legacy seam).
 *
 * STUB BEHAVIOUR: always returns `{ toolId: null, confidence: 0,
 * inferMs: 0, modelId: 'stub' }` so the server-side routing path stays
 * canonical. The async variant is the one consumers should reach for —
 * see `routeOnDeviceAsync`.
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
 * Bilingual prompt sentinel — explicit reminder that the synchronous
 * path is intentionally idle. The async path lights up MiniLM when the
 * bundle is on disk.
 */
export const ON_DEVICE_ROUTER_STATUS = Object.freeze({
  en: 'STUB. On-device routing is disabled — all decisions defer to the server.',
  sw: 'STUB. Uchaguzi wa kifaa umezimwa — maamuzi yote yanapelekwa kwenye seva.',
});

// Re-exports: the actual pipeline lives in `router.ts` so consumers
// can wire `routeOnDeviceAsync` without pulling the stub seam.
export {
  routeOnDeviceAsync,
  type AsyncRouterOptions,
  type AsyncRoutingDecision,
} from './router.js';
export {
  loadOnDeviceModel,
  isModelOnDisk,
  getModelRoot,
  resetModelCache,
  type ModelLoaderOptions,
  type OnDevicePipeline,
} from './model-loader.js';
export {
  callFallbackServer,
  type FallbackServerOptions,
  type FallbackRequest,
  type FallbackResponse,
} from './fallback-server.js';
