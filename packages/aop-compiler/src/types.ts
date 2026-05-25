/**
 * Public type surface for the AOP compiler.
 *
 * An AOP (Agent Operating Procedure) is a structured representation of a
 * natural-language standard operating procedure that can be executed by the
 * BORJIE agent fleet as:
 *   - A Skill bundle (the brain — what to do)
 *   - Cron schedules (the clock — when to start)
 *   - Event monitors (the patience — what to wait for)
 *   - Hook chains (the guardrails — when humans approve)
 *
 * Types live alongside the Zod schemas in `parser/grammar.ts` and are derived
 * from them via `z.infer<>` so that the runtime schema is the single source
 * of truth.
 */

import type { z } from 'zod';
import type {
  AOPSchema,
  AOPStepSchema,
  AOPTriggerSchema,
  AOPMonitorSchema,
  AOPHookKindSchema,
  AOPInputSchema,
} from './parser/grammar.js';

export type AOP = z.infer<typeof AOPSchema>;
export type AOPStep = z.infer<typeof AOPStepSchema>;
export type AOPTrigger = z.infer<typeof AOPTriggerSchema>;
export type AOPMonitor = z.infer<typeof AOPMonitorSchema>;
export type AOPHookKind = z.infer<typeof AOPHookKindSchema>;
export type AOPInput = z.infer<typeof AOPInputSchema>;

/** A minimal tool registry surface the validator can introspect. */
export interface BrainToolRegistry {
  has(toolId: string): boolean;
  /** Optional: return tier metadata so the validator can enforce hook policy. */
  tier?(toolId: string): ToolTier | undefined;
}

export type ToolTier = 'read' | 'write' | 'destructive';

/** Minimal LLM router contract — the NL parser only needs `complete`. */
export interface LLMRouter {
  complete(args: { system: string; user: string }): Promise<string>;
}

export interface ValidationError {
  readonly code: string;
  readonly message: string;
  readonly path?: ReadonlyArray<string | number>;
}

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: ReadonlyArray<ValidationError>;
}

export interface SkillBundle {
  readonly id: string;
  readonly markdown: string;
  readonly metadata: {
    readonly name: string;
    readonly version: string;
    readonly trigger: AOPTrigger;
  };
}

export interface CronSpec {
  readonly schedule: string;
  readonly timezone?: string | undefined;
  readonly aopName: string;
}

export interface MonitorSpec {
  readonly stepId: string;
  readonly monitor: AOPMonitor;
}

export interface HookSpec {
  readonly stepId: string;
  readonly kind: AOPHookKind;
  readonly prompt: string | undefined;
}

export interface CompileSuccess {
  readonly ok: true;
  readonly ast: AOP;
  readonly skill: SkillBundle;
  readonly cron: CronSpec | null;
  readonly monitors: ReadonlyArray<MonitorSpec>;
  readonly hooks: ReadonlyArray<HookSpec>;
  readonly diagram: string;
  readonly prose: string;
}

export interface CompileFailure {
  readonly ok: false;
  readonly errors: ReadonlyArray<ValidationError>;
}

export type CompileResult = CompileSuccess | CompileFailure;
