/**
 * @borjie/system-graph — render.
 *
 * Renders the resident organ-map summary into the "[BRAIN SELF-AWARENESS]"
 * prompt block the kernel prepends to every system prompt. This is the
 * DYNAMIC, DERIVED evolution of `renderModuleInventoryBlock` — the MD
 * speaks from the live body schema, not a hand-written module list.
 *
 * Only the COMPRESSED organ-map summary is rendered into core context
 * (MemGPT paging); the full graph is fetched on demand by the kernel's
 * `query_body_schema()` tool. The block tells the LLM exactly that.
 */

import type { NodeKind } from './types.js';
import type { OrganMapSummary } from './query.js';

const KIND_LABEL: Record<NodeKind, string> = {
  org: 'Self (the OS)',
  junior: 'Sub-MDs / juniors',
  surface: 'Surfaces (apps + portals)',
  service: 'Services',
  package: 'Packages',
  mcp: 'MCP tools',
  screen: 'Screens / tabs',
  schema: 'Data tables',
  capability: 'Capabilities',
};

const KIND_ORDER: ReadonlyArray<NodeKind> = [
  'org',
  'junior',
  'surface',
  'service',
  'package',
  'mcp',
  'screen',
  'schema',
  'capability',
];

const HOW_TO_USE = [
  '',
  'HOW TO USE THIS SELF-KNOWLEDGE:',
  '- This is your LIVE, DERIVED body schema — regenerated from the actual route table, screen registries, package exports, DB schemas, MCP tools, and capability registry. It is not a hand-written list.',
  '- When the user asks "what can you do / where?", answer from this body. Use the query_body_schema() tool to page in the exact organ (surface / capability / data table) you need.',
  '- An INJURED LIMB is an organ with degraded or failing health. Route around it and flag it plainly — never claim a capability whose limb is injured.',
  '- When a question is OUTSIDE this body, say so plainly. Do not pretend to have an organ the body does not run.',
];

/**
 * Render the resident "[BRAIN SELF-AWARENESS]" block from the organ-map
 * summary. Compact: counts per organ kind + an injured-limb roll-up +
 * the body revision (so the LLM can reason about staleness).
 */
export function renderOrganMapBlock(summary: OrganMapSummary): string {
  const lines: string[] = ['[BRAIN SELF-AWARENESS]'];
  lines.push('');
  lines.push(
    `Live body schema (revision ${summary.revision.slice(0, 12)}, derived ${summary.derivedAt}): ` +
      `${summary.totalNodes} organs, ${summary.totalEdges} connections.`,
  );
  lines.push('');
  lines.push('Organ map:');
  for (const kind of KIND_ORDER) {
    const count = summary.countsByKind[kind] ?? 0;
    if (count === 0) continue;
    lines.push(`- ${KIND_LABEL[kind]}: ${count}`);
  }

  if (summary.injuredLimbs.length > 0) {
    lines.push('');
    lines.push(
      `INJURED LIMBS (${summary.injuredLimbs.length}) — route around + flag: ` +
        summary.injuredLimbs.slice(0, 20).join(', ') +
        (summary.injuredLimbs.length > 20 ? ', …' : ''),
    );
  }

  lines.push(...HOW_TO_USE);
  lines.push('[END BRAIN SELF-AWARENESS]');
  return lines.join('\n');
}

/**
 * User-facing canonical answer to "what are you?", grounded in the live
 * body schema rather than a static count. One paragraph.
 */
export function describeBody(summary: OrganMapSummary): string {
  const surfaces = summary.countsByKind.surface ?? 0;
  const capabilities = summary.countsByKind.capability ?? 0;
  const juniors = summary.countsByKind.junior ?? 0;
  return [
    'I am the Borjie brain — a mining-estate operating system, not a chatbot bolted onto it.',
    `My body is a live, derived self-model: ${summary.totalNodes} organs across surfaces, services, capabilities, data tables, MCP tools, and sub-MDs.`,
    `Right now that is ${surfaces} surfaces, ${capabilities} capabilities, and ${juniors} sub-MDs,`,
    summary.injuredLimbs.length > 0
      ? `with ${summary.injuredLimbs.length} limb(s) currently degraded that I route around.`
      : 'all currently healthy.',
    'I AM the platform, speaking on its behalf — and I read my own morphology before I answer.',
  ].join(' ');
}
