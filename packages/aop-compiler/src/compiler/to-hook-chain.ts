/**
 * Walks the AOP and emits a flat list of hook specs that the approval kernel
 * needs to register at deploy time. Loop bodies are descended into.
 */

import type { AOP, AOPStep, HookSpec } from '../types.js';

function* walk(steps: ReadonlyArray<AOPStep>): Generator<AOPStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === 'loop') yield* walk(step.body);
  }
}

export function compileToHookChain(ast: AOP): ReadonlyArray<HookSpec> {
  const out: HookSpec[] = [];
  for (const step of walk(ast.steps)) {
    if (step.kind === 'hook') {
      out.push({ stepId: step.id, kind: step.hook, prompt: step.prompt });
    }
  }
  return out;
}
