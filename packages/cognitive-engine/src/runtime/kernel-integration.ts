/**
 * Kernel integration shim — read-only wrapper for the kernel
 * composition root.
 *
 * This module exports a single function `wrapWithCognitiveEngine` that
 * the kernel composition root (in `packages/ai-copilot`) invokes to
 * route every `compose_anything_v1` call through the cognitive engine.
 * The shim does NOT modify the kernel — it only provides the wrapper
 * function.
 *
 * Composition contract: kernel passes the user-facing dispatcher; the
 * shim wraps it so the loop runs BEFORE dispatch and the post-dispatch
 * validators (cite + confidence) run AFTER.
 *
 * @module @borjie/cognitive-engine/runtime/kernel-integration
 */

import type {
  ClockPort,
  CognitiveLlmPort,
  CognitiveTurnInput,
  CognitiveTurnOutput,
  EvidenceItem,
} from '../types.js';
import {
  runCognitiveLoop,
  type CognitiveLoopDeps,
  type CognitiveLoopInput,
  type ComposeAnythingDispatcherPort,
} from './cognitive-loop.js';

export interface ComposeAnythingDispatcher extends ComposeAnythingDispatcherPort {
  readonly version: string;
}

export interface WrapInput {
  readonly turn: CognitiveTurnInput;
  readonly candidate_evidence: ReadonlyArray<{
    readonly kind: EvidenceItem['kind'];
    readonly ref_id: string;
    readonly relevance: number;
    readonly quality: number;
    readonly summary?: string;
  }>;
  readonly required_evidence_kinds: ReadonlyArray<EvidenceItem['kind']>;
  readonly owner_override_just_do_it: boolean;
  readonly questions_asked_this_turn: number;
}

export interface WrapDeps {
  readonly dispatcher: ComposeAnythingDispatcher;
  readonly llm?: CognitiveLlmPort;
  readonly clock?: ClockPort;
}

/** Run the engine. Returns the turn output; the kernel persists the
 *  turn row + audit hash. */
export async function wrapWithCognitiveEngine(
  input: WrapInput,
  deps: WrapDeps,
): Promise<CognitiveTurnOutput> {
  const loopInput: CognitiveLoopInput = {
    turn: input.turn,
    candidate_evidence: input.candidate_evidence,
    required_evidence_kinds: input.required_evidence_kinds,
    owner_override_just_do_it: input.owner_override_just_do_it,
    questions_asked_this_turn: input.questions_asked_this_turn,
  };
  const loopDeps: CognitiveLoopDeps = {
    dispatcher: deps.dispatcher,
    ...(deps.llm !== undefined ? { llm: deps.llm } : {}),
    ...(deps.clock !== undefined ? { clock: deps.clock } : {}),
  };
  return runCognitiveLoop(loopInput, loopDeps);
}
