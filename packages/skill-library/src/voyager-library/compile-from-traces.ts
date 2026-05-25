/**
 * "Learn by example" — compile a new skill from 1-3 manual traces.
 *
 * In the Voyager paper, the automatic curriculum proposes new tasks and
 * the LLM emits code to solve them. For BORJIE we invert: the OPERATOR
 * shows the system 1-3 examples of doing a task manually, and the LLM
 * compiles those into a reusable code skill.
 *
 * This module defines the compilation CONTRACT — the actual LLM call is
 * injected so production can wire it to Claude and tests can use a
 * deterministic stub. No runtime dependency on @anthropic-ai/sdk.
 */

import type { CodeSkill, SkillTrace } from './types.js';

export interface SkillCompilationRequest {
  /** NL description of what the skill should do. */
  readonly description: string;
  /** Operator-supplied input/output examples. 1-3 recommended. */
  readonly traces: ReadonlyArray<SkillTrace>;
  /** Suggested skill id (slug). */
  readonly proposed_id: string;
  /** Jurisdiction the skill is scoped to. */
  readonly jurisdiction: 'platform' | string;
  /** Embedding for the description, computed by the caller. */
  readonly description_embedding: ReadonlyArray<number>;
}

export interface CompiledSkillProposal {
  readonly skill: CodeSkill;
  /**
   * Confidence the compiler has in its output. The orchestrator can gate
   * registration on this (e.g. require operator review if < 0.7).
   */
  readonly confidence: number;
  /** Human-readable summary of how the skill was assembled. */
  readonly rationale: string;
}

/**
 * Pluggable LLM-driven compiler. Production wires this to a Claude
 * Anthropic-SDK call; tests use a deterministic stub.
 */
export interface SkillCompiler {
  compile(request: SkillCompilationRequest): Promise<CompiledSkillProposal>;
}

/**
 * Validate a compilation request. Throws on contract violations. Pure.
 */
export function validateCompilationRequest(req: SkillCompilationRequest): void {
  if (!req.proposed_id || !/^[a-z][a-z0-9_-]{0,63}$/.test(req.proposed_id)) {
    throw new Error(
      `[skill-compile] proposed_id "${req.proposed_id}" must be a slug matching /^[a-z][a-z0-9_-]{0,63}$/`
    );
  }
  if (req.traces.length === 0 || req.traces.length > 3) {
    throw new Error(
      `[skill-compile] traces must contain 1-3 examples (got ${req.traces.length})`
    );
  }
  if (!req.description.trim()) {
    throw new Error('[skill-compile] description cannot be empty');
  }
  if (req.description_embedding.length === 0) {
    throw new Error('[skill-compile] description_embedding cannot be empty');
  }
}

/**
 * Deterministic stub compiler — returns a no-op skill that echoes its
 * input. Used by tests; production wires a real LLM-backed compiler.
 */
export class EchoSkillCompiler implements SkillCompiler {
  async compile(request: SkillCompilationRequest): Promise<CompiledSkillProposal> {
    validateCompilationRequest(request);
    const skill: CodeSkill = {
      id: request.proposed_id,
      name: request.proposed_id,
      description: request.description,
      embedding: request.description_embedding,
      jurisdiction: request.jurisdiction,
      success_count: 0,
      failure_count: 0,
      consecutive_failures: 0,
      quarantined: false,
      code: {
        source: `// Auto-compiled echo skill\nasync function run(_ctx, input) {\n  return { echoed: input };\n}`,
        input_schema: { type: 'object', additionalProperties: true },
        output_schema: {
          type: 'object',
          properties: { echoed: { type: 'object' } },
        },
        run: async (_ctx, input) => ({ echoed: input }) as unknown,
      },
    };
    return {
      skill,
      confidence: 0.5,
      rationale: `Echo compiler returned passthrough for ${request.traces.length} trace(s).`,
    };
  }
}
