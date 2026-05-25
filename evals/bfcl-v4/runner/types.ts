/**
 * BFCL v4 runner types — the small ADT the runner/adapters/scorers
 * share. Kept dependency-free so the runner builds even when the
 * upstream dataset is unavailable.
 */

export type BfclCategory =
  | 'simple'
  | 'multiple'
  | 'parallel'
  | 'parallel_multiple'
  | 'irrelevant'
  | 'multi_turn'
  | 'live_relevance'
  | 'python_complex'
  | 'java_complex'
  | 'chat_able';

export interface BfclToolSchema {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema fragment
}

export interface BfclTask {
  readonly id: string;
  readonly category: BfclCategory;
  readonly prompt: string;
  /** Tools the model is allowed to see for this task. */
  readonly tools: ReadonlyArray<BfclToolSchema>;
  /** Ground-truth expected call(s). */
  readonly groundTruth: BfclGroundTruth;
}

export type BfclGroundTruth =
  | {
      readonly kind: 'expected-call';
      readonly toolName: string;
      readonly args: Record<string, unknown>;
    }
  | {
      readonly kind: 'expected-calls';
      readonly calls: ReadonlyArray<{ readonly toolName: string; readonly args: Record<string, unknown> }>;
    }
  | {
      readonly kind: 'no-call';
      readonly rationaleHint: string;
    }
  | {
      readonly kind: 'multi-turn-trace';
      readonly turns: ReadonlyArray<{
        readonly toolName: string;
        readonly args: Record<string, unknown>;
        readonly response: unknown;
      }>;
    };

export interface BfclAttempt {
  readonly taskId: string;
  readonly category: BfclCategory;
  /** What the model actually produced. */
  readonly producedCall:
    | { readonly toolName: string; readonly args: Record<string, unknown> }
    | { readonly toolName: string; readonly args: Record<string, unknown> }[]
    | null;
  readonly latencyMs: number;
  readonly raw: string;
}

export interface BfclScore {
  readonly taskId: string;
  readonly category: BfclCategory;
  readonly pass: boolean;
  readonly score: number; // [0, 1]
  readonly detail: string;
}

export interface BfclReport {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly tasksAttempted: number;
  readonly tasksPassed: number;
  readonly perCategory: ReadonlyArray<{
    readonly category: BfclCategory;
    readonly attempts: number;
    readonly passes: number;
    readonly meanScore: number;
  }>;
  readonly scores: ReadonlyArray<BfclScore>;
}
