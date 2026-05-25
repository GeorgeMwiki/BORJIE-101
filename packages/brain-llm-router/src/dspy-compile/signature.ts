/**
 * DSPy-style Signature — the declarative I/O contract for a brain task.
 *
 * A `Signature` describes WHAT the LLM should do (inputs/outputs + objective)
 * without saying HOW. The MIPROv2-style compiler then explores a search space
 * of prompts + few-shot demonstrations and produces a `CompiledPrompt` tuned
 * for one (signature, model) pair.
 *
 * Critically — at RUNTIME we never re-compile. We load the cached
 * CompiledPrompt and use its tuned text + demonstrations directly.
 */

import type { ModelTier, TaskKind } from '../types.js';

export interface SignatureField {
  readonly name: string;
  readonly description: string;
  readonly type: 'string' | 'number' | 'boolean' | 'object';
}

export interface Signature {
  readonly taskName: string;
  readonly taskKind: TaskKind;
  readonly objective: string;
  readonly inputs: readonly SignatureField[];
  readonly outputs: readonly SignatureField[];
  /** Hash of the signature shape — invalidates cache when signature changes. */
  readonly versionHash: string;
}

export interface FewShotExample {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<Record<string, unknown>>;
  /** Optional rationale chain for chain-of-thought style demos. */
  readonly rationale?: string;
}

export interface CompiledPrompt {
  readonly signatureName: string;
  readonly signatureVersion: string;
  readonly model: ModelTier;
  readonly compiledSystem: string;
  readonly compiledInstruction: string;
  readonly demonstrations: readonly FewShotExample[];
  readonly compiledAt: string; // ISO timestamp
  readonly compilerScore: number; // oracle eval score [0..1]
  readonly compilerName: string; // 'MIPROv2-port' | 'baseline-passthrough'
}

/** Stable hash of a signature definition (FNV-1a 32-bit, no deps). */
export function hashSignature(sig: Omit<Signature, 'versionHash'>): string {
  const json = JSON.stringify({
    n: sig.taskName,
    k: sig.taskKind,
    o: sig.objective,
    i: sig.inputs.map((f) => [f.name, f.type, f.description]),
    out: sig.outputs.map((f) => [f.name, f.type, f.description]),
  });
  let hash = 2166136261;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

/** Build a Signature from a partial spec (fills versionHash). */
export function defineSignature(spec: Omit<Signature, 'versionHash'>): Signature {
  return Object.freeze({ ...spec, versionHash: hashSignature(spec) });
}
