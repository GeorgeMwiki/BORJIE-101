/**
 * Diagram Builder — emits a Mermaid spec from typed employee data.
 *
 * For org charts: each employee becomes a node, the manager relation
 * becomes a directed edge `manager --> report`. Names are escaped so
 * arbitrary characters can't break out of the Mermaid syntax.
 *
 * @module features/central-command/md/presenter/diagram-builder
 */

import { buildMermaid } from "@/core/brain/generative-ui/builders";
import type { MermaidSpec } from "@/core/brain/generative-ui/types";
import type { InlineDataFetchResult } from "./types";
import { tierToBadge } from "./spec-builder";

export interface OrgChartNode {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly managerId: string | null;
}

/**
 * Escape a label for use inside a Mermaid node `[ ... ]`. Mermaid is
 * very particular about quotes / brackets — we strip them rather than
 * try to escape, since these aren't meaningful in human names/titles.
 */
function safeLabel(text: string): string {
  return text
    .replace(/[\[\]\(\)\{\}\"\`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function safeId(raw: string, fallback: string): string {
  // Mermaid identifiers must be alphanumeric/_; replace anything else.
  const cleaned = raw.replace(/[^A-Za-z0-9_]/g, "_");
  if (cleaned.length === 0) return fallback;
  // Identifiers can't start with a digit.
  if (/^[0-9]/.test(cleaned)) return `n_${cleaned}`;
  return cleaned;
}

interface DiagramInput {
  readonly nodes: ReadonlyArray<OrgChartNode>;
  readonly titleHint?: string;
  readonly tier: InlineDataFetchResult["tier"];
  readonly generatedAt: string;
}

export function buildOrgChartDiagram(input: DiagramInput): MermaidSpec {
  const idMap = new Map<string, string>();
  for (let i = 0; i < input.nodes.length; i += 1) {
    const n = input.nodes[i];
    if (!n) continue;
    idMap.set(n.id, safeId(n.id, `n${i}`));
  }

  const lines: string[] = ["flowchart TD"];

  // Declare nodes first so isolated nodes (no manager) still render.
  for (const n of input.nodes) {
    const id = idMap.get(n.id);
    if (!id) continue;
    const label = safeLabel(`${n.name} — ${n.role}`.replace(/—/g, "-"));
    lines.push(`  ${id}["${label}"]`);
  }

  // Then edges.
  for (const n of input.nodes) {
    const id = idMap.get(n.id);
    if (!id) continue;
    if (!n.managerId) continue;
    const mid = idMap.get(n.managerId);
    if (!mid) continue;
    lines.push(`  ${mid} --> ${id}`);
  }

  // Empty-data fallback: emit a single placeholder so the spec stays
  // valid (Mermaid spec requires diagram.length >= 1).
  if (input.nodes.length === 0) {
    lines.push('  empty["No employees on record"]');
  }

  return buildMermaid({
    diagram: lines.join("\n"),
    title: input.titleHint ?? "Org chart",
    ariaLabel: `Org chart with ${input.nodes.length} people`,
    source: {
      generatedAt: input.generatedAt,
      tier: tierToBadge(input.tier),
    },
  });
}
