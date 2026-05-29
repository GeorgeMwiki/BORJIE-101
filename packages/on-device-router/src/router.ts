/**
 * High-level on-device router. Composes `model-loader` + `fallback-server`.
 *
 * Decision tree:
 *
 *   ┌──────────────────────────┐
 *   │ routeOnDeviceAsync(text) │
 *   └──────────────────────────┘
 *           │
 *           ▼
 *   model files on disk?  ──no──▶  fallback to server (Pino warn)
 *           │ yes
 *           ▼
 *   optional dep loads? ──no──▶  fallback to server (Pino warn)
 *           │ yes
 *           ▼
 *   confidence >= threshold? ─no─▶ fallback to server (no warn)
 *           │ yes
 *           ▼
 *   on-device decision returned (RoutingDecision)
 *
 * The synchronous `routeOnDevice()` stub from the original scaffold is
 * preserved verbatim for callers that need a zero-await routing seam
 * (e.g. inside a React render). New callers should prefer
 * `routeOnDeviceAsync()` which lights up the real path.
 */

import type { RoutingDecision } from './index.js';
import {
  isModelOnDisk,
  loadOnDeviceModel,
  type ModelLoaderOptions,
} from './model-loader.js';
import {
  callFallbackServer,
  type FallbackServerOptions,
  type FallbackRequest,
} from './fallback-server.js';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.6;

export interface AsyncRouterOptions {
  /** 0..1 below which we always fall through to server. Default 0.6. */
  readonly confidenceThreshold?: number;
  /** Hand-off to the model loader (test seams, model root override). */
  readonly loader?: ModelLoaderOptions;
  /** Server fallback config — required so we know where to call. */
  readonly fallback: FallbackServerOptions;
  /** Forwarded onto the fallback request envelope. */
  readonly language?: 'sw' | 'en';
  readonly tenantId?: string;
  readonly teamId?: string;
  /** Pino-compatible logger; defaults to a no-op. */
  readonly logger?: {
    readonly warn: (obj: Record<string, unknown>, msg?: string) => void;
    readonly info: (obj: Record<string, unknown>, msg?: string) => void;
  };
}

export interface AsyncRoutingDecision extends RoutingDecision {
  /** Was the decision made on-device, or did we fall back to the server? */
  readonly path: 'on-device' | 'server-fallback' | 'server-error';
}

const NOOP_LOGGER = {
  warn: () => undefined,
  info: () => undefined,
};

/**
 * The full async on-device decision pipeline. Falls back to server on
 * (a) missing files, (b) missing optional dep, (c) low confidence,
 * (d) any error inside the model. Never throws.
 */
export async function routeOnDeviceAsync(
  promptText: string,
  options: AsyncRouterOptions,
): Promise<AsyncRoutingDecision> {
  const logger = options.logger ?? NOOP_LOGGER;
  const threshold =
    options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const started = Date.now();

  // Cheap synchronous gate — bail BEFORE the dynamic import cost.
  if (!isModelOnDisk(options.loader?.modelRoot)) {
    logger.warn(
      { reason: 'model-not-on-disk' },
      'on-device-router falling back to server',
    );
    return fallback(promptText, options, 'server-fallback', started);
  }

  const pipeline = await loadOnDeviceModel(options.loader);
  if (!pipeline) {
    logger.warn(
      { reason: 'optional-dep-missing' },
      'on-device-router falling back to server',
    );
    return fallback(promptText, options, 'server-fallback', started);
  }

  let prediction: { toolId: string | null; confidence: number };
  try {
    prediction = await pipeline.classify(promptText);
  } catch (err) {
    logger.warn(
      { error: (err as Error).message },
      'on-device-router classification failed',
    );
    return fallback(promptText, options, 'server-fallback', started);
  }

  if (prediction.confidence < threshold) {
    logger.info(
      {
        confidence: prediction.confidence,
        threshold,
        reason: 'low-confidence',
      },
      'on-device-router low-confidence fallback',
    );
    return fallbackWithHint(
      promptText,
      options,
      prediction,
      started,
    );
  }

  return Object.freeze({
    toolId: prediction.toolId,
    confidence: prediction.confidence,
    inferMs: Date.now() - started,
    modelId: pipeline.modelId,
    path: 'on-device' as const,
  });
}

async function fallback(
  promptText: string,
  options: AsyncRouterOptions,
  path: 'server-fallback' | 'server-error',
  startedAt: number,
): Promise<AsyncRoutingDecision> {
  const request: FallbackRequest = {
    prompt: promptText,
    language: options.language,
    tenantId: options.tenantId,
    teamId: options.teamId,
  };
  const res = await callFallbackServer(request, options.fallback);
  return Object.freeze({
    toolId: res.toolId,
    confidence: res.source === 'error' ? 0 : 0.5,
    inferMs: Date.now() - startedAt,
    modelId: 'server',
    path: res.source === 'error' ? 'server-error' : path,
  });
}

async function fallbackWithHint(
  promptText: string,
  options: AsyncRouterOptions,
  hint: { toolId: string | null; confidence: number },
  startedAt: number,
): Promise<AsyncRoutingDecision> {
  const request: FallbackRequest = {
    prompt: promptText,
    language: options.language,
    tenantId: options.tenantId,
    teamId: options.teamId,
    routerHint: hint,
  };
  const res = await callFallbackServer(request, options.fallback);
  return Object.freeze({
    toolId: res.toolId,
    confidence: res.source === 'error' ? 0 : 0.5,
    inferMs: Date.now() - startedAt,
    modelId: 'server',
    path: res.source === 'error' ? 'server-error' : 'server-fallback',
  });
}
