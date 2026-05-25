/**
 * OTel tracer — explicit `consolidation.stage.N` spans.
 *
 * B4 Phase B — Progressive Intelligence. The 8-stage sleep-time cycle
 * was running with structured logs only; this module wires real OTel
 * spans so the cycle is visible in the same Phoenix / Langfuse fabric
 * that watches the live kernel.
 *
 * Span layout:
 *
 *   consolidation.tick                 (root)
 *     └── consolidation.stage.01-ingest
 *     └── consolidation.stage.02-cluster
 *     └── ...
 *
 * Soft dependency: `@opentelemetry/api` is a workspace dependency of
 * api-gateway / packages/observability but NOT of consolidation-worker.
 * We resolve it via dynamic-import so the worker compiles + runs
 * whether the package is present or not. When missing, the tracer is
 * a no-op pass-through — every stage still runs, just without span
 * emission. This lets us roll out OTel without forcing every service
 * to depend on it.
 */

export interface StageTracer {
  /**
   * Wrap the root tick. The callback receives a callable that wraps
   * individual stage executions.
   */
  startTick<T>(
    tickId: string,
    fn: (stage: StageSpanRunner) => Promise<T>,
  ): Promise<T>;
}

export type StageSpanRunner = <T>(
  stageId: string,
  fn: () => Promise<T>,
) => Promise<T>;

const SERVICE_NAME = 'borjie.consolidation-worker';

interface OTelApi {
  trace: {
    getTracer(name: string): {
      startActiveSpan: <T>(
        name: string,
        fn: (span: OTelSpan) => Promise<T>,
      ) => Promise<T>;
    };
  };
  SpanStatusCode: { OK: number; ERROR: number };
}

interface OTelSpan {
  setAttribute(key: string, value: unknown): void;
  recordException(error: unknown): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

/**
 * Resolve `@opentelemetry/api` if available. Returns `null` when the
 * package is not installed in the running service — caller falls back
 * to the no-op tracer.
 */
async function loadOtelApi(): Promise<OTelApi | null> {
  try {
    // Dynamic import — the bundler should NOT statically resolve this.
    // We use Function('return import(...)') to avoid bundler attempting
    // to resolve at build time; tsx + node will resolve at runtime if
    // the package exists in node_modules. The `new Function` indirection
    // is INTENTIONAL — `@opentelemetry/api` is an optional peer dep and
    // a static `import()` would force every consumer to install it. Lint
    // flags `new Function` as eval-equivalent; in this controlled site
    // (no user input ever flows through `spec`) the dodge is safe.
    // eslint-disable-next-line no-new-func
    const dynamicImport = new Function(
      'spec',
      'return import(spec)',
    ) as (spec: string) => Promise<unknown>;
    const mod = (await dynamicImport('@opentelemetry/api')) as Record<
      string,
      unknown
    >;
    if (!mod || typeof mod !== 'object') return null;
    const trace = mod.trace as OTelApi['trace'] | undefined;
    const SpanStatusCode = mod.SpanStatusCode as OTelApi['SpanStatusCode'] | undefined;
    if (!trace || !SpanStatusCode) return null;
    return { trace, SpanStatusCode };
  } catch {
    return null;
  }
}

/**
 * Build a real OTel-backed tracer when the dependency is present;
 * otherwise return a no-op tracer that runs the callback transparently.
 *
 * Caller invokes this at composition root once and passes the resulting
 * tracer to the orchestrator. The async load happens ONCE — every
 * subsequent tick uses the cached tracer.
 */
export async function createStageTracer(options: {
  readonly serviceName?: string;
  readonly forceDisabled?: boolean;
} = {}): Promise<StageTracer> {
  if (options.forceDisabled) {
    return createNoopTracer();
  }
  const api = await loadOtelApi();
  if (!api) return createNoopTracer();
  return createRealTracer(api, options.serviceName ?? SERVICE_NAME);
}

/**
 * Synchronous no-op tracer for paths that haven't awaited createStageTracer
 * yet (e.g. tests that don't want to wait on the dynamic import).
 */
export function createNoopTracer(): StageTracer {
  return {
    async startTick(_tickId, fn) {
      return fn(async (_stageId, stageFn) => stageFn());
    },
  };
}

function createRealTracer(api: OTelApi, serviceName: string): StageTracer {
  const tracer = api.trace.getTracer(serviceName);
  return {
    async startTick(tickId, fn) {
      return tracer.startActiveSpan(
        'consolidation.tick',
        async (rootSpan: OTelSpan) => {
          rootSpan.setAttribute('consolidation.tick_id', tickId);
          rootSpan.setAttribute('service.name', serviceName);
          try {
            const runner: StageSpanRunner = async <T>(
              stageId: string,
              stageFn: () => Promise<T>,
            ): Promise<T> => {
              return tracer.startActiveSpan(
                `consolidation.stage.${stageId}`,
                async (span: OTelSpan) => {
                  span.setAttribute('consolidation.stage_id', stageId);
                  try {
                    const out = await stageFn();
                    span.setStatus({ code: api.SpanStatusCode.OK });
                    return out;
                  } catch (error) {
                    span.recordException(error);
                    span.setStatus({
                      code: api.SpanStatusCode.ERROR,
                      message:
                        error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                  } finally {
                    span.end();
                  }
                },
              );
            };
            const out = await fn(runner);
            rootSpan.setStatus({ code: api.SpanStatusCode.OK });
            return out;
          } catch (error) {
            rootSpan.recordException(error);
            rootSpan.setStatus({
              code: api.SpanStatusCode.ERROR,
              message: error instanceof Error ? error.message : String(error),
            });
            throw error;
          } finally {
            rootSpan.end();
          }
        },
      );
    },
  };
}
