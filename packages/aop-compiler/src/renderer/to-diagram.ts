/**
 * Renders an AOP as a Mermaid flowchart so an owner can see the workflow
 * before approving it.
 *
 * Output shape:
 *   flowchart TD
 *     <id>["<label>"]
 *     <id> --> <target>
 *
 * Labels are escaped to preserve Mermaid validity (quotes, brackets).
 */

import type { AOP, AOPStep } from '../types.js';

const escapeLabel = (s: string): string =>
  s.replace(/"/g, '\\"').replace(/\n/g, ' ');

const nodeLine = (step: AOPStep): string => {
  switch (step.kind) {
    case 'tool':
      return `  ${step.id}["${escapeLabel(`${step.id}: tool ${step.tool}`)}"]`;
    case 'monitor': {
      const waitFor = step.monitor.until_event ?? 'timer';
      const timer = step.monitor.OR ? ` or ${step.monitor.OR.duration}` : '';
      return `  ${step.id}(["${escapeLabel(`${step.id}: wait ${waitFor}${timer}`)}"])`;
    }
    case 'hook':
      return `  ${step.id}{{"${escapeLabel(`${step.id}: ${step.hook}`)}"}}`;
    case 'loop':
      return `  ${step.id}[["${escapeLabel(`${step.id}: loop`)}"]]`;
  }
};

const edgeLines = (step: AOPStep): string[] => {
  switch (step.kind) {
    case 'tool': {
      const edges: string[] = [];
      if (step.on_success !== undefined) {
        edges.push(`  ${step.id} -->|ok| ${step.on_success}`);
      }
      if (step.on_failure !== undefined) {
        edges.push(`  ${step.id} -->|fail| ${step.on_failure}`);
      }
      return edges;
    }
    case 'monitor':
      return [`  ${step.id} --> ${step.on_trigger}`];
    case 'hook': {
      const edges: string[] = [];
      if (step.on_approve !== undefined) {
        edges.push(`  ${step.id} -->|approve| ${step.on_approve}`);
      }
      if (step.on_reject !== undefined) {
        edges.push(`  ${step.id} -->|reject| ${step.on_reject}`);
      }
      return edges;
    }
    case 'loop':
      return step.body.length > 0
        ? [`  ${step.id} --> ${step.body[0]!.id}`]
        : [];
  }
};

function* walk(steps: ReadonlyArray<AOPStep>): Generator<AOPStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === 'loop') yield* walk(step.body);
  }
}

export function renderToDiagram(ast: AOP): string {
  const lines: string[] = ['flowchart TD'];
  for (const step of walk(ast.steps)) lines.push(nodeLine(step));
  for (const step of walk(ast.steps)) lines.push(...edgeLines(step));
  return lines.join('\n');
}
