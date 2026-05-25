/**
 * Activation probe — "is the agent doing something different than usual?".
 *
 * Where the defection-probe catches voice / persona slips, the
 * activation probe catches *behavioural* anomalies: response shape,
 * length, latency, tool-call usage, refusal rate. The signal is
 * advisory — it travels into the decision-trace so an operator can
 * spot the moment when an agent's behaviour distribution starts
 * shifting (e.g. fine-tune drift, jailbreak success, model swap).
 *
 * The probe is stateless; the caller threads a rolling baseline (mean
 * + std-dev of recent turns) and the probe returns a z-score-style
 * signal. Production wires the baseline to a Redis or in-memory
 * accumulator keyed on `(tenantId, persona, surface)`.
 */

export interface ActivationBaseline {
  /** Rolling-window mean of output length in characters. */
  readonly meanLength: number;
  /** Rolling-window stddev of output length. Floor at 1. */
  readonly stddevLength: number;
  /** Mean tool calls per turn. */
  readonly meanToolCalls: number;
  /** Mean latency in milliseconds. */
  readonly meanLatencyMs: number;
  /** Stddev of latency. Floor at 1. */
  readonly stddevLatencyMs: number;
  /** Number of observations in the rolling window. */
  readonly sampleSize: number;
}

export interface ActivationSample {
  readonly outputLength: number;
  readonly toolCallCount: number;
  readonly latencyMs: number;
  readonly refusalEmitted: boolean;
}

export interface ActivationSignal {
  /** Aggregate anomaly score ∈ [0, 1]. */
  readonly score: number;
  /** Component breakdown for operator inspection. */
  readonly components: {
    readonly lengthZ: number;
    readonly latencyZ: number;
    readonly toolCallDelta: number;
    readonly refusalAnomaly: number;
  };
  /** Human-readable reasons emitted when the score breaches 0.5. */
  readonly reasons: ReadonlyArray<string>;
}

export interface ActivationProbe {
  observe(args: {
    readonly baseline: ActivationBaseline | null;
    readonly sample: ActivationSample;
  }): ActivationSignal;
}

const MIN_SAMPLE_SIZE = 10;
const ANOMALY_THRESHOLD = 0.5;
const Z_THRESHOLD = 2.5;

/**
 * Sigmoid-style mapping from a z-score to [0, 1].
 * |z| > 2.5 ≈ 0.71; |z| > 4 ≈ 0.88.
 */
function zToScore(z: number): number {
  const abs = Math.abs(z);
  return 1 - 1 / (1 + abs / 3.5);
}

export function createActivationProbe(): ActivationProbe {
  return {
    observe(args) {
      const sample = args.sample;
      const baseline = args.baseline;

      if (!baseline || baseline.sampleSize < MIN_SAMPLE_SIZE) {
        // Not enough history — return a neutral signal. The caller
        // still records the sample so the baseline catches up.
        return {
          score: 0,
          components: {
            lengthZ: 0,
            latencyZ: 0,
            toolCallDelta: 0,
            refusalAnomaly: 0,
          },
          reasons: [],
        };
      }

      const lengthStddev = Math.max(baseline.stddevLength, 1);
      const latencyStddev = Math.max(baseline.stddevLatencyMs, 1);
      const lengthZ = (sample.outputLength - baseline.meanLength) / lengthStddev;
      const latencyZ = (sample.latencyMs - baseline.meanLatencyMs) / latencyStddev;
      const toolCallDelta = sample.toolCallCount - baseline.meanToolCalls;

      const lengthScore = zToScore(lengthZ);
      const latencyScore = zToScore(latencyZ);
      const toolCallScore = zToScore(toolCallDelta);
      const refusalAnomaly = sample.refusalEmitted ? 0.4 : 0;

      const score = Math.min(
        1,
        Math.max(lengthScore, latencyScore, toolCallScore, refusalAnomaly),
      );

      const reasons: string[] = [];
      if (Math.abs(lengthZ) > Z_THRESHOLD) {
        reasons.push(
          `output-length-anomaly z=${lengthZ.toFixed(2)} sample=${sample.outputLength} mean=${baseline.meanLength.toFixed(0)}`,
        );
      }
      if (Math.abs(latencyZ) > Z_THRESHOLD) {
        reasons.push(
          `latency-anomaly z=${latencyZ.toFixed(2)} sample=${sample.latencyMs}ms mean=${baseline.meanLatencyMs.toFixed(0)}ms`,
        );
      }
      if (Math.abs(toolCallDelta) > 3) {
        reasons.push(
          `tool-call-anomaly delta=${toolCallDelta.toFixed(2)} sample=${sample.toolCallCount}`,
        );
      }
      if (sample.refusalEmitted && baseline.sampleSize >= MIN_SAMPLE_SIZE) {
        reasons.push('refusal-emitted');
      }

      return {
        score,
        components: {
          lengthZ,
          latencyZ,
          toolCallDelta,
          refusalAnomaly,
        },
        reasons,
      };
    },
  };
}

export const ACTIVATION_PROBE_THRESHOLDS = {
  anomaly: ANOMALY_THRESHOLD,
  zScore: Z_THRESHOLD,
  minSampleSize: MIN_SAMPLE_SIZE,
} as const;
