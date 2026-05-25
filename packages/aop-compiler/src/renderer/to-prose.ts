/**
 * Renders an AOP as plain English so the owner can confirm the compiler
 * understood them before any cron or hook is registered.
 *
 * Style: short imperative sentences. No code-y artefacts. Maps each step
 * kind to a human phrase.
 */

import type { AOP, AOPStep, AOPTrigger } from '../types.js';

const proseTrigger = (t: AOPTrigger): string => {
  switch (t.kind) {
    case 'cron':
      return `Runs on schedule \`${t.schedule}\`${t.timezone ? ` (${t.timezone})` : ''}.`;
    case 'event':
      return `Runs whenever the \`${t.event}\` event fires.`;
    case 'manual':
      return `Runs only when an owner triggers it${t.title ? ` ("${t.title}")` : ''}.`;
  }
};

const proseStep = (step: AOPStep): string => {
  switch (step.kind) {
    case 'tool': {
      const next = step.on_success ? ` Then go to \`${step.on_success}\`.` : '';
      const fail = step.on_failure ? ` On failure, go to \`${step.on_failure}\`.` : '';
      return `Call tool \`${step.tool}\`.${next}${fail}`;
    }
    case 'monitor': {
      const evt = step.monitor.until_event ? `event \`${step.monitor.until_event}\`` : 'a timer';
      const tmr = step.monitor.OR ? ` or after \`${step.monitor.OR.duration}\`` : '';
      return `Wait for ${evt}${tmr} (timeout \`${step.monitor.timeout}\`). Then go to \`${step.on_trigger}\`.`;
    }
    case 'hook': {
      const promptLine = step.prompt ? ` Ask: "${step.prompt}".` : '';
      const approve = step.on_approve ? ` On approve go to \`${step.on_approve}\`.` : '';
      const reject = step.on_reject ? ` On reject go to \`${step.on_reject}\`.` : '';
      return `Pause for human (${step.hook}).${promptLine}${approve}${reject}`;
    }
    case 'loop': {
      const exit =
        step.exit_when.kind === 'count'
          ? `at most ${step.exit_when.max} iterations`
          : `until \`${step.exit_when.event}\` fires`;
      return `Repeat ${step.body.length} inner step(s) — ${exit}.`;
    }
  }
};

export function renderToProse(ast: AOP): string {
  const lines: string[] = [];
  lines.push(`AOP: ${ast.name} (v${ast.version}).`);
  if (ast.description) lines.push(ast.description);
  lines.push(proseTrigger(ast.trigger));
  lines.push('');
  let n = 1;
  for (const step of ast.steps) {
    lines.push(`${n}. [${step.id}] ${proseStep(step)}`);
    n += 1;
  }
  return lines.join('\n');
}
