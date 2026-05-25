/**
 * Shared composer machinery.
 *
 * Every report-type composer reuses the same pattern:
 *
 *   1. Build the BRAIN system prompt = persona + report-type-specific
 *      framing notes.
 *   2. Build the BRAIN user prompt = a tightly-structured rendering of
 *      the EvidencePack (fragments + a citation key the brain must use).
 *   3. Invoke brain.synthesize(...). DEEP-mode prompts engage the
 *      multi-LLM synthesizer.
 *   4. Parse the brain's structured response into ReportSection[] using
 *      a stable section delimiter the persona is bound to emit.
 *   5. Assemble the StrategicReport from the sections + the
 *      composer-declared executive summary + composer-declared action plan.
 *
 * The structured-output parser is deliberately tolerant — when the brain
 * drifts from the requested section labels, we fall back to a single
 * synthesized section so the renderer never produces an empty report.
 */

import type {
  BrainPort,
  BrainSynthesizeResult,
  Citation,
  ComposerContext,
  EvidencePack,
  ReportSection,
  StrategicReport,
} from '../types.js';

export interface SectionBlueprint {
  readonly id: string;
  readonly title: string;
  readonly heading: 1 | 2 | 3;
  /**
   * Which fragment ids feed this section. The composer narrows the
   * brain's evidence window to just these fragments so the brain
   * cannot cross-pollinate evidence between sections.
   */
  readonly fragmentPrefixes: ReadonlyArray<string>;
  /** Optional table/chart ids attached when the gatherer produces them. */
  readonly tableIds?: ReadonlyArray<string>;
  readonly chartIds?: ReadonlyArray<string>;
}

export interface ComposerBlueprint {
  readonly title: (ctx: ComposerContext) => string;
  readonly sectionBlueprints: ReadonlyArray<SectionBlueprint>;
  readonly executiveSummary: (ctx: ComposerContext) => string;
  readonly actionPlan: (ctx: ComposerContext) => ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly owner: string;
    readonly dueDateIso: string;
    readonly priority: 'p0' | 'p1' | 'p2' | 'p3';
    readonly successCriterion: string;
    readonly citationIds: ReadonlyArray<string>;
  }>;
  /**
   * Composer instructions appended to the persona system prompt. These
   * tell the brain exactly which sections to emit and in what order.
   */
  readonly composerSystemNote: string;
}

export interface RunComposerArgs {
  readonly ctx: ComposerContext;
  readonly brain: BrainPort;
  readonly blueprint: ComposerBlueprint;
  /** Synthesis mode. Defaults to 'merge' for DEEP reports. */
  readonly mode?: 'merge' | 'jury' | 'race-verify';
}

/**
 * Run the full compose pipeline for a single report type. Returns the
 * StrategicReport ready for citation verification + render.
 */
export async function runComposer(args: RunComposerArgs): Promise<StrategicReport> {
  const { ctx, brain, blueprint } = args;
  const { evidence, persona, spec } = ctx;

  const systemPrompt = `${persona}\n\n${blueprint.composerSystemNote}`;
  const userPrompt = buildUserPrompt(evidence, blueprint);
  const mode = args.mode ?? 'merge';

  const brainResult: BrainSynthesizeResult = await brain.synthesize({
    systemPrompt,
    userPrompt,
    mode,
  });

  const parsedSections = parseSections(brainResult.content, blueprint, evidence);
  const citations = buildCitations(evidence);
  const executiveSummary = blueprint.executiveSummary(ctx);
  const actionPlan = blueprint.actionPlan(ctx);

  return Object.freeze({
    type: spec.type,
    spec,
    title: blueprint.title(ctx),
    executiveSummary,
    sections: parsedSections,
    citations: Object.freeze(citations),
    charts: evidence.charts,
    tables: evidence.tables,
    actionPlan: Object.freeze(actionPlan),
    appendices: Object.freeze([]),
    synthesis: {
      agreement: brainResult.agreement,
      escalate: brainResult.escalate,
      proposerIds: brainResult.proposerIds,
      synthesizerId: brainResult.synthesizerId,
      mode: brainResult.mode,
    },
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Brain prompt builder — turns the EvidencePack into a tightly structured
// user prompt the brain (or multi-LLM synthesizer) can ground on.
// ────────────────────────────────────────────────────────────────────────────

export function buildUserPrompt(evidence: EvidencePack, blueprint: ComposerBlueprint): string {
  const fragmentBlock = evidence.fragments
    .map((f) => `[${f.id}] ${f.summary} (source: ${f.source.kind}/${f.source.ref})`)
    .join('\n');
  const sectionBlock = blueprint.sectionBlueprints
    .map((s) => `## ${s.title} (id=${s.id})\n  - Use only fragments with id matching prefix(es): ${s.fragmentPrefixes.join(', ')}\n  - Close with a single sentence beginning "Verdict:".`)
    .join('\n\n');
  const userText = evidence.spec.prompt?.trim() ?? '(no caller-supplied prompt)';

  return [
    `# Caller request`,
    userText,
    ``,
    `# Citation key (every quantitative claim cites one of these)`,
    fragmentBlock,
    ``,
    `# Required sections (emit in this order, marker '### {id}' on the opening line)`,
    sectionBlock,
    ``,
    `# Output format`,
    `Emit each section in markdown, prefixed by a line of the exact form '### section-id:<id>'.`,
    `Then a heading line '#### <title>'.`,
    `Then the section body. End each section with the verdict line.`,
  ].join('\n');
}

// ────────────────────────────────────────────────────────────────────────────
// Structured output parser — tolerant. Fragment-prefix → section mapping
// is the ground truth even if the brain misses a label.
// ────────────────────────────────────────────────────────────────────────────

export function parseSections(
  brainContent: string,
  blueprint: ComposerBlueprint,
  evidence: EvidencePack,
): ReadonlyArray<ReportSection> {
  const sections: ReportSection[] = [];

  // Split the brain output by the section delimiter we asked for.
  const parts = splitBrainContent(brainContent);
  const partById = new Map(parts.map((p) => [p.sectionId, p.body] as const));

  for (const blueprintSection of blueprint.sectionBlueprints) {
    const body = partById.get(blueprintSection.id);
    const matchingTables = (blueprintSection.tableIds ?? [])
      .map((id) => evidence.tables.find((t) => t.id === id))
      .filter((t): t is NonNullable<typeof t> => t !== undefined);
    const matchingCharts = (blueprintSection.chartIds ?? [])
      .map((id) => evidence.charts.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => c !== undefined);

    if (body === undefined || body.trim().length === 0) {
      // Evidence-or-narrative unavailable — surface explicitly rather than
      // dropping the section silently. The renderer turns this into an
      // "Evidence unavailable — see appendix" stub in the rendered doc.
      sections.push({
        id: blueprintSection.id,
        title: blueprintSection.title,
        heading: blueprintSection.heading,
        body: '',
        charts: Object.freeze(matchingCharts),
        tables: Object.freeze(matchingTables),
        evidenceUnavailable: true,
      });
      continue;
    }
    sections.push({
      id: blueprintSection.id,
      title: blueprintSection.title,
      heading: blueprintSection.heading,
      body,
      charts: Object.freeze(matchingCharts),
      tables: Object.freeze(matchingTables),
    });
  }

  return Object.freeze(sections);
}

interface ParsedSection {
  readonly sectionId: string;
  readonly body: string;
}

function splitBrainContent(content: string): ReadonlyArray<ParsedSection> {
  const out: ParsedSection[] = [];
  const lines = content.split(/\r?\n/);
  let current: { sectionId: string; bodyLines: string[] } | null = null;

  const DELIM_RE = /^###\s+section-id:([\w-]+)\s*$/i;

  for (const line of lines) {
    const match = DELIM_RE.exec(line);
    if (match) {
      if (current) out.push({ sectionId: current.sectionId, body: current.bodyLines.join('\n').trim() });
      current = { sectionId: match[1]!, bodyLines: [] };
      continue;
    }
    if (current) current.bodyLines.push(line);
  }
  if (current) out.push({ sectionId: current.sectionId, body: current.bodyLines.join('\n').trim() });
  return Object.freeze(out);
}

// ────────────────────────────────────────────────────────────────────────────
// Citations builder — every fragment becomes a Citation. Composers may
// re-derive specialised citations later (e.g. to attach a confidence band).
// ────────────────────────────────────────────────────────────────────────────

export function buildCitations(evidence: EvidencePack): ReadonlyArray<Citation> {
  return evidence.fragments.map((f) => ({
    id: f.id,
    claim: f.summary,
    source: f.source,
  }));
}
