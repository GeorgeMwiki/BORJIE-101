/**
 * Free-form drafter — composes documents from a natural-language intent
 * without requiring a pre-shipped template slug.
 *
 * Wave UNIVERSAL-DOC-DRAFTER. The owner says "draft me a letter to TRA
 * explaining the late February royalty filing" and the brain assembles
 * a warm, professional document from scratch. Sections are inferred
 * from the intent; citations are tracked.
 *
 * This module is composition-root-agnostic: it depends only on the
 * `SemanticBlockGenerator` port (the existing brain-backed expander)
 * plus optional context resolvers. The brain itself is wired in
 * `services/api-gateway/src/index.ts` via the drafter brain-tools.
 *
 * The composer is intentionally LLM-friendly but degrades gracefully:
 * when the supplied generator is the deterministic placeholder, a
 * skeleton document with clearly-labelled placeholders is returned so
 * reviewers can still inspect structure.
 */

import type { DraftKind, DraftLanguage } from '@borjie/database/schemas';
import {
  placeholderSemanticGenerator,
  type SemanticBlockGenerator,
} from './composer.js';

export interface FreeFormContextDoc {
  /** Stable id (corpus chunk id, owner doc id, peer cohort report id). */
  readonly id: string;
  /** Display label for citation rendering. */
  readonly label: string;
  /** Source kind matching the draft_citations.source_kind enum. */
  readonly sourceKind:
    | 'corpus_chunk'
    | 'owner_doc'
    | 'external_benchmark'
    | 'peer_cohort'
    | 'manual';
  /** Snippet excerpt the brain may quote (kept short for prompt budget). */
  readonly snippet?: string;
}

export interface FreeFormSection {
  readonly heading: string;
  readonly body: string;
}

export interface FreeFormCitation {
  readonly sourceKind: FreeFormContextDoc['sourceKind'];
  readonly sourceRef: string;
  readonly snippetUsed?: string;
}

export interface FreeFormComposeInput {
  readonly tenantId: string;
  readonly ownerId: string;
  readonly intent: string;
  readonly contextDocs?: ReadonlyArray<FreeFormContextDoc>;
  readonly targetFormat?: 'md' | 'pdf' | 'docx' | 'pptx' | 'html';
  readonly brandStyle?: 'corporate' | 'warm' | 'regulator';
  readonly language?: DraftLanguage;
  readonly citationMode?: 'inline' | 'footnote' | 'none';
  readonly generator?: SemanticBlockGenerator;
}

export interface FreeFormComposeOutput {
  readonly markdown: string;
  readonly sections: ReadonlyArray<FreeFormSection>;
  readonly citations: ReadonlyArray<FreeFormCitation>;
  readonly inferredTitle: string;
  readonly inferredKind: DraftKind;
}

const KIND_KEYWORD_RULES: ReadonlyArray<{
  readonly kind: DraftKind;
  readonly keywords: ReadonlyArray<string>;
}> = [
  { kind: 'letter', keywords: ['letter', 'barua', 'tra', 'nemc', 'bot', 'tumemadini', 'cda'] },
  { kind: 'memo', keywords: ['memo', 'memorandum', 'internal', 'note to'] },
  { kind: 'rfp', keywords: ['rfp', 'request for proposal', 'tender invitation'] },
  { kind: 'rfp_response', keywords: ['rfp response', 'tender response', 'bid'] },
  { kind: 'notice', keywords: ['notice', 'tangazo', 'lease renewal', 'announcement'] },
  { kind: 'contract', keywords: ['contract', 'mkataba', 'mou', 'deed', 'agreement', 'partnership'] },
];

export function inferKindFromIntent(intent: string): DraftKind {
  const lower = intent.toLowerCase();
  for (const rule of KIND_KEYWORD_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) return rule.kind;
    }
  }
  // Default to memo — the most neutral document kind.
  return 'memo';
}

export function inferTitleFromIntent(intent: string): string {
  const trimmed = intent.trim().replace(/\s+/g, ' ');
  if (trimmed.length <= 80) return capitalizeFirst(trimmed);
  return capitalizeFirst(trimmed.slice(0, 77).trimEnd() + '...');
}

function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const DEFAULT_SECTIONS: ReadonlyArray<{
  readonly id: string;
  readonly heading: { readonly sw: string; readonly en: string };
}> = [
  { id: 'opening', heading: { sw: 'Utangulizi', en: 'Opening' } },
  { id: 'context', heading: { sw: 'Mazingira', en: 'Context' } },
  { id: 'body', heading: { sw: 'Maelezo Makuu', en: 'Main Body' } },
  { id: 'actions', heading: { sw: 'Hatua Zinazoombwa', en: 'Requested Actions' } },
  { id: 'closing', heading: { sw: 'Hitimisho', en: 'Closing' } },
];

/**
 * Compose a free-form document. The generator (typically the brain
 * ladder) is invoked once per section; when degraded the deterministic
 * fallback returns scaffolding the reviewer can inspect.
 */
export async function composeFreeForm(
  input: FreeFormComposeInput,
): Promise<FreeFormComposeOutput> {
  if (!input.intent || input.intent.trim().length === 0) {
    throw new Error('free-form-composer: intent must not be empty');
  }
  const generator = input.generator ?? placeholderSemanticGenerator;
  const language = input.language ?? 'en';
  const inferredKind = inferKindFromIntent(input.intent);
  const inferredTitle = inferTitleFromIntent(input.intent);

  const sections: FreeFormSection[] = [];
  for (const section of DEFAULT_SECTIONS) {
    const heading = language === 'sw' ? section.heading.sw : section.heading.en;
    const body = await generator.generate({
      kind: inferredKind,
      language,
      key: `freeform.${section.id}`,
      context: {
        intent: input.intent,
        contextDocs: input.contextDocs ?? [],
        ownerId: input.ownerId,
        tenantId: input.tenantId,
        section: section.id,
      },
      systemPrompt: buildFreeFormSystemPrompt(language, input.brandStyle),
      userPrompt: buildFreeFormUserPrompt(
        input.intent,
        section.id,
        language,
        input.contextDocs ?? [],
      ),
    });
    sections.push({ heading, body });
  }

  const citations: FreeFormCitation[] = (input.contextDocs ?? []).map((doc) => ({
    sourceKind: doc.sourceKind,
    sourceRef: doc.id,
    ...(doc.snippet !== undefined ? { snippetUsed: doc.snippet } : {}),
  }));

  const markdown = renderMarkdown(
    inferredTitle,
    sections,
    citations,
    input.citationMode ?? 'footnote',
    language,
  );

  return {
    markdown,
    sections,
    citations,
    inferredTitle,
    inferredKind,
  };
}

function buildFreeFormSystemPrompt(
  language: DraftLanguage,
  brandStyle: FreeFormComposeInput['brandStyle'],
): string {
  const langInstr =
    language === 'sw'
      ? 'Andika kwa Kiswahili rasmi cha biashara.'
      : language === 'en'
      ? 'Write in formal business English.'
      : 'Write bilingually, Swahili first followed by an English mirror.';
  const tone =
    brandStyle === 'warm'
      ? 'Tone: warm, supportive, founder-to-stakeholder.'
      : brandStyle === 'regulator'
      ? 'Tone: precise, regulator-formal, no jargon.'
      : 'Tone: confident corporate, plain language.';
  return [
    'You are the Borjie document drafter assisting Tanzanian mining estate owners.',
    'You compose ONE section of a free-form document per call (the user prompt names which section).',
    'Hard rules:',
    '- Stay strictly within the section the user asked for.',
    '- Never invent counterparties, amounts, dates, or licence numbers; ask for them if missing.',
    '- Keep paragraphs short (2-4 sentences). No em-dashes.',
    '- Cite the source field name in brackets when a value is missing.',
    tone,
    langInstr,
  ].join('\n');
}

function buildFreeFormUserPrompt(
  intent: string,
  sectionId: string,
  language: DraftLanguage,
  contextDocs: ReadonlyArray<FreeFormContextDoc>,
): string {
  const docs = contextDocs
    .slice(0, 6)
    .map((d) => `- [${d.sourceKind}] ${d.id} (${d.label}): ${d.snippet ?? ''}`)
    .join('\n');
  return [
    `Owner intent: ${intent}`,
    `Section to draft: ${sectionId}`,
    `Language: ${language}`,
    contextDocs.length > 0 ? `Context sources (cite where useful):\n${docs}` : 'No context sources supplied.',
    'Return only the prose for this section. No heading, no bullet preamble.',
  ].join('\n');
}

function renderMarkdown(
  title: string,
  sections: ReadonlyArray<FreeFormSection>,
  citations: ReadonlyArray<FreeFormCitation>,
  citationMode: NonNullable<FreeFormComposeInput['citationMode']>,
  language: DraftLanguage,
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  for (const section of sections) {
    lines.push(`## ${section.heading}`);
    lines.push('');
    lines.push(section.body.trim());
    lines.push('');
  }
  if (citationMode !== 'none' && citations.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push(language === 'sw' ? '## Vyanzo' : '## Sources');
    lines.push('');
    citations.forEach((cite, idx) => {
      const label = `[${cite.sourceKind}] ${cite.sourceRef}`;
      const snippet = cite.snippetUsed ? ` — ${cite.snippetUsed.slice(0, 140)}` : '';
      lines.push(`${idx + 1}. ${label}${snippet}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}
