/**
 * measure-async — lightweight instrumentation wrappers.
 *
 * Each wrapper times a function, records latency + success/failure counters
 * against a named metric, and returns the original value (or rethrows).
 * Zero external deps — uses perf.now() and console-backed fallbacks when
 * a real metrics sink isn't wired yet.
 */

export interface MetricsSink {
  readonly recordHistogram: (name: string, value: number, labels?: Record<string, string>) => void;
  readonly incrementCounter: (name: string, labels?: Record<string, string>) => void;
}

export const noopMetricsSink: MetricsSink = {
  recordHistogram: () => {},
  incrementCounter: () => {},
};

let activeSink: MetricsSink = noopMetricsSink;

export function setMetricsSink(sink: MetricsSink): void {
  activeSink = sink;
}

export function getMetricsSink(): MetricsSink {
  return activeSink;
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

/**
 * Time an async function, record latency histogram + success/failure counters.
 * Returns the original value; rethrows errors after recording.
 */
export async function measureAsync<T>(
  metricName: string,
  fn: () => Promise<T>,
  labels: Record<string, string> = {}
): Promise<T> {
  const start = nowMs();
  try {
    const result = await fn();
    activeSink.recordHistogram(`${metricName}.latency_ms`, nowMs() - start, labels);
    activeSink.incrementCounter(`${metricName}.success`, labels);
    return result;
  } catch (err) {
    activeSink.recordHistogram(`${metricName}.latency_ms`, nowMs() - start, { ...labels, outcome: 'error' });
    activeSink.incrementCounter(`${metricName}.error`, {
      ...labels,
      errorName: (err as Error).name ?? 'Error',
    });
    throw err;
  }
}

/**
 * Specialized for DB operations — adds common labels and uses a standard
 * metric namespace so dashboards can slice across queries.
 */
export async function measureDb<T>(
  operation: string,
  fn: () => Promise<T>,
  labels: Record<string, string> = {}
): Promise<T> {
  return measureAsync('db', fn, { operation, ...labels });
}

/**
 * Specialized for LLM calls — records tokens + model as labels.
 */
export async function measureLlm<T>(
  model: string,
  fn: () => Promise<T & { usage?: { input_tokens?: number; output_tokens?: number } }>,
  labels: Record<string, string> = {}
): Promise<T> {
  const start = nowMs();
  try {
    const result = await fn();
    activeSink.recordHistogram('llm.latency_ms', nowMs() - start, { model, ...labels });
    activeSink.incrementCounter('llm.calls', { model, ...labels });
    if (result?.usage) {
      if (typeof result.usage.input_tokens === 'number') {
        activeSink.recordHistogram('llm.input_tokens', result.usage.input_tokens, { model, ...labels });
      }
      if (typeof result.usage.output_tokens === 'number') {
        activeSink.recordHistogram('llm.output_tokens', result.usage.output_tokens, { model, ...labels });
      }
    }
    return result;
  } catch (err) {
    activeSink.recordHistogram('llm.latency_ms', nowMs() - start, { model, outcome: 'error', ...labels });
    activeSink.incrementCounter('llm.errors', { model, errorName: (err as Error).name ?? 'Error', ...labels });
    throw err;
  }
}
