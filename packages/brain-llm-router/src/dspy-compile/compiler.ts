/**
 * DSPy MIPROv2-style compiler (port).
 *
 * MIPROv2 (Multi-prompt Instruction PRoposal with Optimal selection) explores
 * the space of (instruction text, few-shot demonstrations) and picks the pair
 * with the highest oracle eval score for a given model.
 *
 * This TS port is intentionally simplified:
 *   - it accepts caller-supplied candidate instructions (no on-the-fly
 *     instruction synthesis — that requires an instruction-proposer LLM
 *     beyond the scope of this module)
 *   - it accepts caller-supplied example pool (we sample k=2..4 demos)
 *   - it runs the `oracleEval` callback for each candidate, picks the
 *     highest scorer
 *
 * Compilation happens at DEPLOY time; runtime just loads the JSON file.
 */

import type { ModelTier } from '../types.js';
import type {
  CompiledPrompt,
  FewShotExample,
  Signature,
} from './signature.js';

export interface CompileOptions {
  readonly model: ModelTier;
  readonly signature: Signature;
  readonly candidateInstructions: readonly string[];
  readonly examplePool: readonly FewShotExample[];
  readonly oracleEval: (compiled: CompiledPrompt) => Promise<number> | number;
  readonly demoCount?: number; // default 2
  readonly compilerName?: string; // default 'MIPROv2-port'
}

/**
 * Compile a Signature against a target model.
 *
 * Returns the best (instruction, demos) pair scored by `oracleEval`.
 * Pure orchestrator — `oracleEval` is the only I/O entry point.
 */
export async function compileSignature(opts: CompileOptions): Promise<CompiledPrompt> {
  if (opts.candidateInstructions.length === 0) {
    throw new Error('compileSignature: candidateInstructions must be non-empty');
  }
  const demoCount = Math.min(opts.demoCount ?? 2, opts.examplePool.length);
  const candidateDemoSets = sampleDemoSets(opts.examplePool, demoCount, 3);
  const compilerName = opts.compilerName ?? 'MIPROv2-port';

  let best: CompiledPrompt | undefined;

  for (const instruction of opts.candidateInstructions) {
    for (const demos of candidateDemoSets) {
      const candidate: CompiledPrompt = {
        signatureName: opts.signature.taskName,
        signatureVersion: opts.signature.versionHash,
        model: opts.model,
        compiledSystem: formatSystem(opts.signature),
        compiledInstruction: instruction,
        demonstrations: demos,
        compiledAt: new Date().toISOString(),
        compilerScore: 0,
        compilerName,
      };
      const score = await opts.oracleEval(candidate);
      if (best === undefined || score > best.compilerScore) {
        best = { ...candidate, compilerScore: score };
      }
    }
  }
  if (best === undefined) {
    throw new Error('compileSignature: no candidates produced');
  }
  return best;
}

/** Format a Signature's objective + IO into a system prompt header. */
export function formatSystem(sig: Signature): string {
  const inputs = sig.inputs.map((f) => `<${f.name}>: ${f.description}`).join('\n');
  const outputs = sig.outputs.map((f) => `<${f.name}>: ${f.description}`).join('\n');
  return [
    `<role>Task: ${sig.taskName} (${sig.taskKind})</role>`,
    `<objective>${sig.objective}</objective>`,
    `<inputs>\n${inputs}\n</inputs>`,
    `<outputs>\n${outputs}\n</outputs>`,
  ].join('\n');
}

/**
 * Sample k example sets of size `n` from the pool, without mutation.
 * Returns up to `k` deterministically-ordered subsets via a simple round-robin
 * walk — enough variation to explore but reproducible across runs.
 */
function sampleDemoSets(
  pool: readonly FewShotExample[],
  n: number,
  k: number
): readonly (readonly FewShotExample[])[] {
  if (pool.length === 0 || n === 0) return [Object.freeze([])];
  const sets: Array<readonly FewShotExample[]> = [];
  for (let s = 0; s < k; s += 1) {
    const subset: FewShotExample[] = [];
    for (let i = 0; i < n; i += 1) {
      const idx = (s * n + i) % pool.length;
      subset.push(pool[idx]!);
    }
    sets.push(Object.freeze(subset));
  }
  return Object.freeze(sets);
}
