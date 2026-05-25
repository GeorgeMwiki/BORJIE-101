/**
 * Walks the AOP and emits a flat list of monitor specs the event bus needs
 * to register at deploy time. Loop bodies are descended into.
 */

import type { AOP, AOPStep, MonitorSpec } from '../types.js';

function* walk(steps: ReadonlyArray<AOPStep>): Generator<AOPStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === 'loop') yield* walk(step.body);
  }
}

export function compileToMonitors(ast: AOP): ReadonlyArray<MonitorSpec> {
  const out: MonitorSpec[] = [];
  for (const step of walk(ast.steps)) {
    if (step.kind === 'monitor') {
      out.push({ stepId: step.id, monitor: step.monitor });
    }
  }
  return out;
}
