/**
 * Step-flow invariants:
 *   I1. Step ids are unique across the whole AOP (loop bodies included).
 *   I2. Every transition reference (on_success, on_failure, on_trigger,
 *       on_approve, on_reject) resolves to a real step id.
 *   I3. The graph has no cycles unless the cycle is bounded by an explicit
 *       `loop` block.
 *   I4. At least one step is terminal (no outgoing transitions) OR every
 *       cyclic path is contained inside a `loop`.
 *   I5. The `entry` id (or steps[0].id) exists.
 *   I6. Every monitor has a `timeout` (Zod enforces this but we re-check
 *       in case the AST was constructed manually).
 */

import type {
  AOP,
  AOPStep,
  ValidationError,
  ValidationResult,
} from '../types.js';

interface StepIndex {
  readonly byId: ReadonlyMap<string, AOPStep>;
  readonly loopOwners: ReadonlyMap<string, string>;
}

function indexSteps(steps: ReadonlyArray<AOPStep>): StepIndex {
  const byId = new Map<string, AOPStep>();
  const loopOwners = new Map<string, string>();

  const recurse = (list: ReadonlyArray<AOPStep>, owner: string | null): void => {
    for (const step of list) {
      byId.set(step.id, step);
      if (owner !== null) loopOwners.set(step.id, owner);
      if (step.kind === 'loop') recurse(step.body, step.id);
    }
  };

  recurse(steps, null);
  return { byId, loopOwners };
}

const transitionTargets = (step: AOPStep): ReadonlyArray<string> => {
  switch (step.kind) {
    case 'tool': {
      const targets: string[] = [];
      if (step.on_success !== undefined) targets.push(step.on_success);
      if (step.on_failure !== undefined) targets.push(step.on_failure);
      return targets;
    }
    case 'monitor':
      return [step.on_trigger];
    case 'hook': {
      const targets: string[] = [];
      if (step.on_approve !== undefined) targets.push(step.on_approve);
      if (step.on_reject !== undefined) targets.push(step.on_reject);
      return targets;
    }
    case 'loop':
      return step.body.length > 0 ? [step.body[0]!.id] : [];
  }
};

function detectDuplicateIds(steps: ReadonlyArray<AOPStep>): ValidationError[] {
  const errors: ValidationError[] = [];
  const seen = new Set<string>();
  const visit = (list: ReadonlyArray<AOPStep>): void => {
    for (const step of list) {
      if (seen.has(step.id)) {
        errors.push({
          code: 'duplicate-step-id',
          message: `Duplicate step id "${step.id}"`,
          path: ['steps', step.id],
        });
      }
      seen.add(step.id);
      if (step.kind === 'loop') visit(step.body);
    }
  };
  visit(steps);
  return errors;
}

function detectOrphanRefs(index: StepIndex): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const step of index.byId.values()) {
    for (const target of transitionTargets(step)) {
      if (!index.byId.has(target)) {
        errors.push({
          code: 'orphan-ref',
          message: `Step "${step.id}" references unknown step "${target}"`,
          path: ['steps', step.id],
        });
      }
    }
  }
  return errors;
}

/**
 * Cycle detection that is "loop-aware":
 *   - We walk the transition graph from the entry node.
 *   - Edges that cross OUT of a loop body to a step ALSO inside the same
 *     loop are considered bounded and OK.
 *   - Edges from a non-loop step back to one of its ancestors are reported.
 */
function detectUnboundedCycles(
  ast: AOP,
  index: StepIndex,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const entryId = ast.entry ?? ast.steps[0]?.id;
  if (entryId === undefined || !index.byId.has(entryId)) return errors;

  const visiting = new Set<string>();
  const visited = new Set<string>();

  const sameLoop = (a: string, b: string): boolean => {
    const ownerA = index.loopOwners.get(a);
    const ownerB = index.loopOwners.get(b);
    return ownerA !== undefined && ownerA === ownerB;
  };

  const dfs = (id: string, stack: ReadonlyArray<string>): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      // Cycle. Determine if it's contained in a loop body.
      const cycleStart = stack.indexOf(id);
      const cycleNodes = cycleStart >= 0 ? stack.slice(cycleStart) : [id];
      const allInSameLoop = cycleNodes.every((n) => sameLoop(n, id));
      if (!allInSameLoop) {
        errors.push({
          code: 'unbounded-cycle',
          message: `Cycle through [${cycleNodes.concat(id).join(' -> ')}] is not bounded by a loop block`,
          path: ['steps', id],
        });
      }
      return;
    }
    visiting.add(id);
    const step = index.byId.get(id);
    if (step !== undefined) {
      for (const target of transitionTargets(step)) {
        dfs(target, [...stack, id]);
      }
    }
    visiting.delete(id);
    visited.add(id);
  };

  dfs(entryId, []);
  return errors;
}

function detectTerminal(ast: AOP, index: StepIndex): ValidationError[] {
  // The AOP must have at least one reachable terminal step (no outgoing
  // transitions) or a loop with a bounded exit. We do a reachability sweep
  // from the entry; if every reachable node has outgoing transitions and
  // none of them are inside a loop with an `exit_when`, fail.
  const errors: ValidationError[] = [];
  const entryId = ast.entry ?? ast.steps[0]?.id;
  if (entryId === undefined) return errors;

  const reachable = new Set<string>();
  const stack: string[] = [entryId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    const step = index.byId.get(id);
    if (step === undefined) continue;
    for (const t of transitionTargets(step)) stack.push(t);
  }

  const hasTerminal = Array.from(reachable).some((id) => {
    const step = index.byId.get(id);
    if (step === undefined) return false;
    if (step.kind === 'loop') return true; // loop counts as terminal-bounded
    return transitionTargets(step).length === 0;
  });

  if (!hasTerminal) {
    errors.push({
      code: 'no-terminal-step',
      message:
        'AOP has no reachable terminal step (every step transitions to another step with no loop bound)',
    });
  }

  return errors;
}

function detectMissingMonitorTimeouts(
  ast: AOP,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const walk = (list: ReadonlyArray<AOPStep>): void => {
    for (const step of list) {
      if (step.kind === 'monitor') {
        if (!step.monitor.timeout) {
          errors.push({
            code: 'missing-monitor-timeout',
            message: `Monitor step "${step.id}" is missing a timeout`,
            path: ['steps', step.id, 'monitor', 'timeout'],
          });
        }
        if (!step.monitor.until_event && !step.monitor.OR) {
          errors.push({
            code: 'monitor-no-trigger',
            message: `Monitor step "${step.id}" has neither until_event nor OR timer`,
            path: ['steps', step.id, 'monitor'],
          });
        }
      }
      if (step.kind === 'loop') walk(step.body);
    }
  };
  walk(ast.steps);
  return errors;
}

function detectMissingEntry(ast: AOP, index: StepIndex): ValidationError[] {
  if (ast.entry === undefined) return [];
  if (index.byId.has(ast.entry)) return [];
  return [
    {
      code: 'unknown-entry',
      message: `Declared entry "${ast.entry}" is not a defined step`,
      path: ['entry'],
    },
  ];
}

export function validateInvariants(ast: AOP): ValidationResult {
  const duplicates = detectDuplicateIds(ast.steps);
  const index = indexSteps(ast.steps);
  const errors: ValidationError[] = [
    ...duplicates,
    ...detectMissingEntry(ast, index),
    ...detectOrphanRefs(index),
    ...detectUnboundedCycles(ast, index),
    ...detectTerminal(ast, index),
    ...detectMissingMonitorTimeouts(ast),
  ];
  return { ok: errors.length === 0, errors };
}
