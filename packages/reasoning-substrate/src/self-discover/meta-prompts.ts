/**
 * Self-Discover meta-prompts — SELECT, ADAPT, IMPLEMENT.
 *
 * Verbatim shape from Zhou et al. 2024 Appendix B, adapted for
 * BORJIE's task classes. Each prompt is a pure function of the
 * library + task class + samples so the wrapper is deterministic.
 *
 * The discovered structure is cached forever (until schema-version
 * bump) so these prompts only run ONCE per (task_class, jurisdiction).
 */

import type { ReasoningPrimitive } from './module-library.js';
import type { BossnyumbaTaskClass, TaskSampleInput } from './types.js';

function renderLibrary(library: ReadonlyArray<ReasoningPrimitive>): string {
  return library
    .map((p, i) => `${i + 1}. [${p.id}] (${p.domain}) ${p.description}`)
    .join('\n');
}

function renderSamples(samples: ReadonlyArray<TaskSampleInput>): string {
  if (!samples.length) return '(no concrete samples provided — reason from the task class name alone)';
  return samples
    .map((s, i) => {
      const parts: string[] = [`Sample ${i + 1} (${s.jurisdiction ?? 'unspecified'}): ${s.description}`];
      if (s.variables) {
        parts.push(`  variables: ${JSON.stringify(s.variables)}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

// ─────────────────────────────────────────────────────────────────────
// SELECT — pick a relevant subset of primitives
// ─────────────────────────────────────────────────────────────────────

export function buildSelectPrompt(args: {
  readonly taskClass: BossnyumbaTaskClass;
  readonly jurisdiction: string;
  readonly samples: ReadonlyArray<TaskSampleInput>;
  readonly library: ReadonlyArray<ReasoningPrimitive>;
}): string {
  return [
    '## SELECT — choose relevant reasoning primitives',
    '',
    `Task class: ${args.taskClass}`,
    `Jurisdiction: ${args.jurisdiction}`,
    '',
    '## Sample task instances',
    renderSamples(args.samples),
    '',
    '## Available reasoning primitives',
    renderLibrary(args.library),
    '',
    '## Your job',
    'From the list of reasoning primitives above, SELECT the subset that is most useful for solving',
    'tasks of this class. Order matters — list them in the order you would APPLY them.',
    'Return a JSON array of primitive ids only, e.g. ["gather-relevant-facts","apply-formula"].',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// ADAPT — rephrase the selected primitives for the task class
// ─────────────────────────────────────────────────────────────────────

export function buildAdaptPrompt(args: {
  readonly taskClass: BossnyumbaTaskClass;
  readonly jurisdiction: string;
  readonly samples: ReadonlyArray<TaskSampleInput>;
  readonly selectedPrimitives: ReadonlyArray<ReasoningPrimitive>;
}): string {
  const selected = args.selectedPrimitives
    .map((p, i) => `${i + 1}. [${p.id}] ${p.description}`)
    .join('\n');
  return [
    '## ADAPT — rephrase primitives for the task class',
    '',
    `Task class: ${args.taskClass}`,
    `Jurisdiction: ${args.jurisdiction}`,
    '',
    '## Selected primitives',
    selected,
    '',
    '## Sample task instances',
    renderSamples(args.samples),
    '',
    '## Your job',
    'Rephrase each primitive in the context of THIS task class. The output is a single',
    'narrative paragraph (2-6 sentences) that explains how the primitives compose to',
    'solve the task. Cite each primitive id in square brackets, e.g.',
    '"[gather-relevant-facts] pull the tenant\'s 12-month payment history; then [apply-tz-rental-act]…"',
    'Return raw text only, no JSON.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// IMPLEMENT — emit a concrete JSON reasoning DAG
// ─────────────────────────────────────────────────────────────────────

export function buildImplementPrompt(args: {
  readonly taskClass: BossnyumbaTaskClass;
  readonly jurisdiction: string;
  readonly adaptedNarrative: string;
  readonly selectedPrimitives: ReadonlyArray<ReasoningPrimitive>;
}): string {
  return [
    '## IMPLEMENT — emit JSON reasoning structure',
    '',
    `Task class: ${args.taskClass}`,
    `Jurisdiction: ${args.jurisdiction}`,
    '',
    '## Adapted narrative',
    args.adaptedNarrative,
    '',
    '## Selected primitives (for reference)',
    args.selectedPrimitives.map((p) => `- ${p.id}`).join('\n'),
    '',
    '## Your job',
    'Emit a JSON object with this exact shape:',
    '{',
    '  "steps": [',
    '    {',
    '      "stepId": "s1",                  // stable id, "s1", "s2", ...',
    '      "primitive": "gather-relevant-facts",  // must be from the selected primitives',
    '      "dependsOn": [],                 // ids of prior steps; may be empty',
    '      "outputSchema": { ... },         // JSON-Schema-lite shape of this step\'s output',
    '      "narrative": "..."               // one sentence — what this step achieves',
    '    },',
    '    ...',
    '  ]',
    '}',
    '',
    'Constraints:',
    '- Every step\'s `primitive` MUST be one of the selected primitives above.',
    '- `dependsOn` may reference only PRIOR step ids — no cycles.',
    '- The final step\'s output is the answer.',
    '- Return raw JSON only — no markdown fences, no commentary.',
  ].join('\n');
}
