/**
 * OTel bridge for DecisionTrace.
 *
 * When the brain kernel is running inside an active OTel span (e.g.
 * the api-gateway middleware opens a span for every request and the
 * brain pipeline runs inside it), the finalised DecisionTrace is
 * attached to that span as:
 *
 *   - structured attributes (decision.*) — small scalar fields suitable
 *     for indexing in dashboards (outcome, branch count, duration).
 *   - span events (decision.branch / decision.chosen / decision.output)
 *     — large free-form payloads that exceed the 128-char attribute
 *     value cap.
 *
 * The bridge is OTel-agnostic: if `@opentelemetry/api` is not resolvable
 * at runtime, every entry point becomes a no-op so the decision path is
 * never disrupted. This is the same defensive pattern LITFIN uses for
 * its `decision-trace-otel` wrapper.
 *
 * Why dynamic resolution rather than `import`?
 *   The package.json already lists `@opentelemetry/api` as a runtime
 *   dep, so the import is normally safe. BUT consumer applications can
 *   bundle this package with tree-shaking that elides the api package
 *   (e.g. edge runtimes that ship without it). Dynamic resolution +
 *   try/catch makes the bridge resilient to those configurations.
 *
 * @module packages/observability/src/decision-trace/otel-bridge
 */

import type { DecisionTraceFinalised } from './types.js';

/**
 * Minimal structural shape of a span we need. Mirrors the subset of
 * `@opentelemetry/api`.Span the bridge actually calls.
 */
interface OtelLikeSpan {
  setAttributes(attrs: Record<string, string | number | boolean>): void;
  addEvent(name: string, attrs?: Record<string, unknown>): void;
}

/**
 * Minimal structural shape of the `trace` namespace we need.
 */
interface OtelLikeTrace {
  getActiveSpan(): OtelLikeSpan | undefined;
}

/**
 * Module-level cache for the resolved OTel api module. `null` means
 * "not yet resolved"; the `_resolved` flag distinguishes "tried and
 * failed" from "not yet attempted".
 */
let _cachedTrace: OtelLikeTrace | null = null;
let _resolved = false;

/**
 * Resolve `@opentelemetry/api` at runtime. Returns `null` if the
 * package is not installed or has an unexpected shape.
 *
 * Wrapped in try/catch so a missing dep is invisible to the decision
 * path.
 */
function resolveTrace(): OtelLikeTrace | null {
  if (_resolved) return _cachedTrace;
  _resolved = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires -- SCRUB-5f: rule-disabled because @opentelemetry/api is a soft optional peer dep loaded via a sync require seam at module-bootstrap time
    const mod = _syncRequire('@opentelemetry/api') as {
      trace?: OtelLikeTrace;
    };
    if (
      mod !== null &&
      typeof mod === 'object' &&
      'trace' in mod &&
      typeof mod.trace?.getActiveSpan === 'function'
    ) {
      _cachedTrace = mod.trace;
      return _cachedTrace;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Indirection seam — overridable in tests. Production uses Node's
 * native CommonJS require via `eval` so bundler static analysis does
 * not flag the import.
 */
let _syncRequire: (spec: string) => unknown = (spec: string) => {
  if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
    throw new Error('OpenTelemetry resolution is server-only');
  }
  // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval -- SCRUB-5f: rule-disabled because eval('require') is the documented bundler-evading sync-require seam for the optional @opentelemetry/api peer dep
  const dyn = eval('require') as (m: string) => unknown;
  return dyn(spec);
};

/**
 * Cap event-attribute string values at 16 KiB so a malformed branch
 * rationale (which could in principle contain a large LLM response)
 * does not blow up the OTel collector's payload budget.
 */
const MAX_EVENT_STR_BYTES = 16 * 1024;

function truncate(value: string): string {
  if (value.length <= MAX_EVENT_STR_BYTES) return value;
  return `${value.slice(0, MAX_EVENT_STR_BYTES)}…[truncated]`;
}

/**
 * Safe JSON.stringify — returns a placeholder on failure (e.g.
 * circular reference) rather than throwing into the decision path.
 */
function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return truncate(value);
  try {
    return truncate(JSON.stringify(value));
  } catch {
    return '<unserialisable>';
  }
}

/**
 * Attach a finalised DecisionTrace to the currently-active OTel span,
 * when one exists.
 *
 * NO-OP when:
 *   - `@opentelemetry/api` is not resolvable, OR
 *   - there is no active span on the current context (e.g. the
 *     decision was made outside any request scope, like a cron job
 *     that runs without OTel context propagation).
 *
 * Errors during attribute/event emission are swallowed: the bridge is
 * best-effort and never breaks the decision path.
 */
export function attachDecisionTraceToActiveSpan(
  trace: DecisionTraceFinalised,
): void {
  const traceApi = resolveTrace();
  if (traceApi === null) return;

  let span: OtelLikeSpan | undefined;
  try {
    span = traceApi.getActiveSpan();
  } catch {
    return;
  }
  if (span === undefined) return;

  try {
    span.setAttributes({
      'decision.trace_id': trace.traceId,
      'decision.name': trace.name,
      'decision.outcome': trace.outcome,
      'decision.duration_ms': trace.durationMs,
      'decision.branch_count': trace.branches.length,
      'decision.chosen_branch_id': trace.chosenBranchId ?? '',
      ...(trace.context.tenantId !== undefined
        ? { 'decision.tenant_id': trace.context.tenantId }
        : {}),
      ...(trace.context.userId !== undefined
        ? { 'decision.user_id': trace.context.userId }
        : {}),
      ...(trace.context.parentTraceId !== undefined
        ? { 'decision.parent_trace_id': trace.context.parentTraceId }
        : {}),
    });
  } catch {
    // Best-effort.
  }

  // Branches go as events so we don't bust the 128-char attribute cap.
  for (const branch of trace.branches) {
    try {
      span.addEvent('decision.branch', {
        'decision.branch.id': branch.id,
        'decision.branch.label': branch.label,
        'decision.branch.rationale': truncate(branch.rationale),
        ...(branch.score !== undefined
          ? { 'decision.branch.score': branch.score }
          : {}),
        ...(branch.metadata !== undefined
          ? { 'decision.branch.metadata': safeStringify(branch.metadata) }
          : {}),
      });
    } catch {
      // Best-effort per-branch.
    }
  }

  if (trace.chosenBranchId !== null) {
    try {
      span.addEvent('decision.chosen', {
        'decision.chosen.branch_id': trace.chosenBranchId,
        ...(trace.chosenRationale !== null
          ? { 'decision.chosen.rationale': truncate(trace.chosenRationale) }
          : {}),
      });
    } catch {
      // Best-effort.
    }
  }

  if (trace.output !== undefined) {
    try {
      span.addEvent('decision.output', {
        'decision.output': safeStringify(trace.output),
      });
    } catch {
      // Best-effort.
    }
  }

  if (trace.error !== null) {
    try {
      span.addEvent('decision.error', {
        'decision.error.message': truncate(trace.error),
      });
    } catch {
      // Best-effort.
    }
  }
}

/**
 * Test seam — clears cached resolution so subsequent tests can swap
 * the require indirection or simulate the package being absent.
 */
export function _resetOtelBridgeForTests(): void {
  _cachedTrace = null;
  _resolved = false;
}

/**
 * Test seam — override the synchronous `require` indirection.
 */
export function _setSyncRequireForTests(fn: (spec: string) => unknown): void {
  _syncRequire = fn;
  _cachedTrace = null;
  _resolved = false;
}

/**
 * Test seam — restore the production `eval("require")` indirection.
 */
export function _restoreSyncRequireForTests(): void {
  _syncRequire = (spec: string) => {
    if (typeof globalThis !== 'undefined' && 'window' in globalThis) {
      throw new Error('OpenTelemetry resolution is server-only');
    }
    // eslint-disable-next-line no-eval, @typescript-eslint/no-implied-eval -- SCRUB-5f: rule-disabled because eval('require') is the documented bundler-evading sync-require seam restored after test overrides
    const dyn = eval('require') as (m: string) => unknown;
    return dyn(spec);
  };
  _cachedTrace = null;
  _resolved = false;
}
