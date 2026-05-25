/**
 * Verifies that every `kind: 'tool'` step in the AOP references an id that
 * exists in the BrainToolRegistry.
 *
 * The registry is injected so that tests can pass a deterministic set of
 * fake tools without depending on `@borjie/central-intelligence`.
 */

import type {
  AOP,
  AOPStep,
  BrainToolRegistry,
  ValidationError,
  ValidationResult,
} from '../types.js';

function* walk(steps: ReadonlyArray<AOPStep>): Generator<AOPStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === 'loop') {
      yield* walk(step.body);
    }
  }
}

export function validateTools(
  ast: AOP,
  registry: BrainToolRegistry,
): ValidationResult {
  const errors: ValidationError[] = [];

  for (const step of walk(ast.steps)) {
    if (step.kind !== 'tool') continue;
    if (!registry.has(step.tool)) {
      errors.push({
        code: 'unknown-tool',
        message: `Step "${step.id}" references unknown tool "${step.tool}"`,
        path: ['steps', step.id, 'tool'],
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
