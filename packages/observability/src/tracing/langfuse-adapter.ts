/**
 * Langfuse adapter — OTel-native bridge to Langfuse.
 *
 * Langfuse 3.x ingests OpenTelemetry spans directly via its public OTLP
 * endpoint (see https://langfuse.com/docs/integrations/opentelemetry).
 * The integration in this file is intentionally minimal:
 *
 *   1. `isLangfuseEnabled()` reads `LANGFUSE_HOST` (or
 *      `LANGFUSE_BASEURL`) to decide whether the adapter is opt-in for
 *      the running process. When unset, every helper short-circuits and
 *      `emitLangfuseSpan()` falls back to a normal OTel span — no
 *      additional dependency on the `langfuse` npm package is required.
 *
 *   2. `loadLangfuseClient()` lazily `await import('langfuse')`s the
 *      optional SDK. The package is declared as an optional peer dep so
 *      it's NOT required for the observability package to build; if it
 *      isn't installed the loader returns `null` and we silently skip
 *      the direct-SDK path. This keeps the no-Langfuse default path on
 *      a small, predictable dependency surface.
 *
 *   3. `withLangfuseGeneration()` is the high-level helper most callers
 *      reach for: it wraps an LLM call so the span is tagged with all
 *      the langfuse.observation.* attributes Langfuse expects.
 *
 * The adapter never throws on a missing SDK or a missing
 * `LANGFUSE_HOST` env — operators can leave it unconfigured in dev
 * without observability blowing up.
 */

import { type Span, type Tracer } from '@opentelemetry/api';
import {
  emitLangfuseSpan,
  buildLangfuseSpanAttributes,
  mapLangfuseObservationType,
  type LangfuseObservationKind,
  type LangfuseSpanAttributes,
} from './tracer.js';

// ---------------------------------------------------------------------------
// Type-level guard against raw-text metadata keys (A2b-3 wire #2)
// ---------------------------------------------------------------------------

/** Keys that MUST NOT appear in a metadata bag — they likely contain PII. */
export const FORBIDDEN_METADATA_KEYS = Object.freeze([
  'userMessage',
  'prompt',
  'response',
  'chatText',
  'cot',
  'thoughtText',
] as const);

export type ForbiddenMetadataKey = (typeof FORBIDDEN_METADATA_KEYS)[number];

/**
 * Metadata bag with the high-risk keys excluded at the type level.
 * Passing a literal `{ userMessage: '...' }` fails the type-checker.
 */
export type SafeLangfuseMetadata = {
  readonly [K in string]: K extends ForbiddenMetadataKey ? never : unknown;
};

/**
 * Strip forbidden keys at runtime and emit a console.warn for each one
 * dropped. Defence-in-depth — the type system can't catch metadata that
 * arrives via `Record<string, unknown>` widening.
 */
export function scrubForbiddenMetadata(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!meta) return meta;
  const dropped: string[] = [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if ((FORBIDDEN_METADATA_KEYS as ReadonlyArray<string>).includes(k)) {
      dropped.push(k);
      continue;
    }
    out[k] = v;
  }
  if (dropped.length > 0) {
    console.warn(
      `[observability/langfuse] dropped forbidden metadata key(s): ${dropped.join(
        ', ',
      )} — never attach raw user text to a trace.`,
    );
  }
  return out;
}

/** Env var names checked when deciding whether Langfuse is enabled. */
const LANGFUSE_HOST_ENV = 'LANGFUSE_HOST';
const LANGFUSE_BASEURL_ENV = 'LANGFUSE_BASEURL';

/**
 * Result of attempting to load the optional `langfuse` SDK at runtime.
 * The adapter remains usable in either case — when the SDK is absent
 * we still emit OTel spans with the Langfuse attribute conventions, we
 * just skip any client-side flush calls.
 */
export interface LangfuseSdkLoadResult {
  readonly available: boolean;
  /** Loaded Langfuse module if `available === true`, else `null`. */
  readonly mod: unknown | null;
  /** Diagnostic message, set when `available === false`. */
  readonly reason?: string;
}

/**
 * Return true if the Langfuse adapter is enabled for the running
 * process. Adapter is OPT-IN: any of the recognised host env vars is
 * sufficient to flip it on.
 *
 * Pure function over `process.env` so it can be unit-tested without
 * fiddling with module-level state.
 */
export function isLangfuseEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(env[LANGFUSE_HOST_ENV] || env[LANGFUSE_BASEURL_ENV]);
}

/**
 * Lazily import the optional `langfuse` package. Returns a discriminated
 * union — never throws — so callers can branch on `available`.
 *
 * The import is performed via `Function('return import("...")')()` so the
 * TypeScript build doesn't try to resolve `langfuse` at compile time.
 * That keeps `langfuse` a true optional dep (declared under
 * `optionalDependencies` in package.json) and avoids requiring it for
 * the no-Langfuse default path used in unit tests and dev.
 */
export async function loadLangfuseClient(): Promise<LangfuseSdkLoadResult> {
  if (!isLangfuseEnabled()) {
    return {
      available: false,
      mod: null,
      reason: 'LANGFUSE_HOST / LANGFUSE_BASEURL not set',
    };
  }
  try {
    // Indirect dynamic import — keeps `langfuse` off the static dep
    // graph so tsc / vitest don't fail when the package is absent.
    // This is the intentional "dynamic-import dodge" pattern; it is
    // NOT eval of user input — the literal `return import(specifier)`
    // body is fixed at module-load time.
    // eslint-disable-next-line no-new-func -- intentional dynamic-import dodge for optional peer-dep
    const dynamicImport = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<unknown>;
    const mod = await dynamicImport('langfuse');
    return { available: true, mod };
  } catch (error) {
    return {
      available: false,
      mod: null,
      reason:
        error instanceof Error
          ? `langfuse SDK not installed: ${error.message}`
          : 'langfuse SDK not installed',
    };
  }
}

/**
 * High-level wrapper around an LLM generation. Emits a single OTel
 * span tagged with the langfuse.observation.* attributes expected for
 * a `generation` observation.
 *
 * Use this from the central-intelligence kernel + sensors when calling
 * an LLM. Tool calls and retrievals should use {@link withLangfuseSpan}
 * (kind = `'tool-call'` or `'retrieval'`) instead.
 */
export async function withLangfuseGeneration<T>(
  tracer: Tracer,
  name: string,
  attrs: Omit<LangfuseSpanAttributes, 'modelName' | 'metadata'> & {
    readonly modelName: string;
    readonly metadata?: SafeLangfuseMetadata;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  // Runtime scrub — drops `userMessage` / `prompt` / `response` etc.
  // even when the caller widens past the type-system guard.
  const safeMetadata = scrubForbiddenMetadata(
    attrs.metadata as Record<string, unknown> | undefined,
  );
  const safeAttrs: LangfuseSpanAttributes = {
    ...attrs,
    ...(safeMetadata !== undefined ? { metadata: safeMetadata } : {}),
  };
  return emitLangfuseSpan(tracer, name, 'generation', safeAttrs, fn);
}

/**
 * Generic span wrapper for non-generation observations (tool calls,
 * retrievals, generic work). Mirrors {@link withLangfuseGeneration} but
 * lets the caller pick the observation kind.
 */
export async function withLangfuseSpan<T>(
  tracer: Tracer,
  name: string,
  kind: LangfuseObservationKind,
  attrs: Omit<LangfuseSpanAttributes, 'metadata'> & {
    readonly metadata?: SafeLangfuseMetadata;
  },
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const safeMetadata = scrubForbiddenMetadata(
    attrs.metadata as Record<string, unknown> | undefined,
  );
  const safeAttrs: LangfuseSpanAttributes = {
    ...attrs,
    ...(safeMetadata !== undefined ? { metadata: safeMetadata } : {}),
  };
  return emitLangfuseSpan(tracer, name, kind, safeAttrs, fn);
}

// Re-export for convenience so downstream packages only need to depend
// on `@borjie/observability` and not pull in `tracer.js` directly.
export {
  emitLangfuseSpan,
  buildLangfuseSpanAttributes,
  mapLangfuseObservationType,
};

export type { LangfuseObservationKind, LangfuseSpanAttributes };
