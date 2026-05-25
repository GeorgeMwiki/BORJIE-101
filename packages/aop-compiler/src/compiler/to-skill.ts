/**
 * AOP -> Skill bundle. A Skill is the executable form of an AOP: a Markdown
 * document with YAML-like frontmatter that the runtime loads to populate an
 * agent's behaviour for one run.
 *
 * We intentionally produce a Markdown string (rather than writing files);
 * callers handle persistence. Keeping it pure means deterministic snapshots
 * for tests.
 */

import type { AOP, AOPStep, SkillBundle } from '../types.js';

const describeStep = (step: AOPStep): string => {
  switch (step.kind) {
    case 'tool':
      return [
        `### Step \`${step.id}\` — tool`,
        `- tool: \`${step.tool}\``,
        `- args: \`${JSON.stringify(step.args)}\``,
        step.on_success ? `- on_success: \`${step.on_success}\`` : null,
        step.on_failure ? `- on_failure: \`${step.on_failure}\`` : null,
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
    case 'monitor':
      return [
        `### Step \`${step.id}\` — monitor`,
        step.monitor.until_event ? `- until_event: \`${step.monitor.until_event}\`` : null,
        step.monitor.OR ? `- OR timer: \`${step.monitor.OR.duration}\`` : null,
        `- timeout: \`${step.monitor.timeout}\``,
        `- on_trigger: \`${step.on_trigger}\``,
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
    case 'hook':
      return [
        `### Step \`${step.id}\` — hook`,
        `- hook: \`${step.hook}\``,
        step.prompt ? `- prompt: ${JSON.stringify(step.prompt)}` : null,
        step.on_approve ? `- on_approve: \`${step.on_approve}\`` : null,
        step.on_reject ? `- on_reject: \`${step.on_reject}\`` : null,
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
    case 'loop':
      return [
        `### Step \`${step.id}\` — loop`,
        `- exit_when: \`${JSON.stringify(step.exit_when)}\``,
        `- body steps: ${step.body.map((b) => `\`${b.id}\``).join(', ')}`,
      ].join('\n');
  }
};

const yamlEscape = (s: string): string => `"${s.replace(/"/g, '\\"')}"`;

export function compileToSkill(ast: AOP): SkillBundle {
  const id = `aop.${ast.name}`;
  const frontmatter = [
    '---',
    `name: ${yamlEscape(ast.name)}`,
    `version: ${yamlEscape(ast.version)}`,
    ast.description ? `description: ${yamlEscape(ast.description)}` : null,
    `trigger: ${JSON.stringify(ast.trigger)}`,
    '---',
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const body = [
    `# Skill: ${ast.name}`,
    '',
    ast.description ?? 'Compiled from an owner-authored AOP.',
    '',
    '## Entry',
    `\`${ast.entry ?? ast.steps[0]!.id}\``,
    '',
    '## Steps',
    '',
    ast.steps.map(describeStep).join('\n\n'),
    '',
  ].join('\n');

  return {
    id,
    markdown: `${frontmatter}\n\n${body}`,
    metadata: {
      name: ast.name,
      version: ast.version,
      trigger: ast.trigger,
    },
  };
}
