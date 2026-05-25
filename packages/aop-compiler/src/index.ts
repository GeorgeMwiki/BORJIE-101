/**
 * Public entry point for the AOP compiler.
 *
 * Two main APIs:
 *   - compileAOP(naturalLanguageInput, deps) — NL -> AST -> validated -> emit
 *   - compileAST(ast, deps)                  — skip parsing for callers that
 *                                              already hold a structured AST
 *                                              (e.g. YAML fixture loaders).
 */

import type {
  AOP,
  BrainToolRegistry,
  CompileResult,
  LLMRouter,
} from './types.js';
import { parseNL } from './parser/nl-parser.js';
import { validate } from './validator/index.js';
import { compileToSkill } from './compiler/to-skill.js';
import { compileToCron } from './compiler/to-cron.js';
import { compileToMonitors } from './compiler/to-monitor.js';
import { compileToHookChain } from './compiler/to-hook-chain.js';
import { renderToDiagram } from './renderer/to-diagram.js';
import { renderToProse } from './renderer/to-prose.js';

export interface CompileDeps {
  readonly llm: LLMRouter;
  readonly toolRegistry: BrainToolRegistry;
}

export interface CompileASTDeps {
  readonly toolRegistry: BrainToolRegistry;
}

export async function compileAOP(
  naturalLanguageInput: string,
  deps: CompileDeps,
): Promise<CompileResult> {
  const parsed = await parseNL(naturalLanguageInput, deps.llm);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return compileAST(parsed.ast, deps);
}

export function compileAST(ast: AOP, deps: CompileASTDeps): CompileResult {
  const validation = validate(ast, deps.toolRegistry);
  if (!validation.ok) return { ok: false, errors: validation.errors };

  return {
    ok: true,
    ast,
    skill: compileToSkill(ast),
    cron: compileToCron(ast),
    monitors: compileToMonitors(ast),
    hooks: compileToHookChain(ast),
    diagram: renderToDiagram(ast),
    prose: renderToProse(ast),
  };
}

export { parseNL, parseAST } from './parser/nl-parser.js';
export { AOPSchema, AOPStepSchema } from './parser/grammar.js';
export { validate, validateSchema, validateTools, validateInvariants, validatePermissions } from './validator/index.js';
export { compileToSkill } from './compiler/to-skill.js';
export { compileToCron } from './compiler/to-cron.js';
export { compileToMonitors } from './compiler/to-monitor.js';
export { compileToHookChain } from './compiler/to-hook-chain.js';
export { renderToDiagram } from './renderer/to-diagram.js';
export { renderToProse } from './renderer/to-prose.js';
export type {
  AOP,
  AOPStep,
  AOPTrigger,
  AOPMonitor,
  AOPHookKind,
  AOPInput,
  BrainToolRegistry,
  LLMRouter,
  ToolTier,
  ValidationError,
  ValidationResult,
  SkillBundle,
  CronSpec,
  MonitorSpec,
  HookSpec,
  CompileResult,
  CompileSuccess,
  CompileFailure,
} from './types.js';
