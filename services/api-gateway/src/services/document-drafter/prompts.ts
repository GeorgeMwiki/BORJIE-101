/**
 * LLM prompts used by the document drafter when expanding the
 * `{{semantic:*}}` placeholder blocks. The brain calls these via the
 * `composer` so the drafter remains a pure template engine when no
 * LLM provider is configured.
 *
 * Each prompt is keyed by the placeholder name (e.g. `scopeOfWork`,
 * `executiveSummary`). The composer passes the surrounding draft
 * context to the prompt so the LLM can stay faithful to the
 * structured fill-vars.
 */

import type { DraftKind, DraftLanguage } from '@borjie/database';

export interface SemanticPrompt {
  /** Placeholder key (without the `semantic:` prefix). */
  readonly key: string;
  /** System prompt — sets persona + language constraints. */
  readonly system: (lang: DraftLanguage) => string;
  /** User-message template referencing context fields. */
  readonly user: (
    kind: DraftKind,
    context: Record<string, unknown>,
    lang: DraftLanguage,
  ) => string;
}

const swahiliFirstSystem = (lang: DraftLanguage): string => {
  const langInstr =
    lang === 'sw'
      ? 'Andika kwa Kiswahili rasmi cha biashara. Tumia heshima na uwazi.'
      : lang === 'en'
      ? 'Write in formal business English. Be concise and precise.'
      : 'Write bilingually: Swahili first, then a clear English mirror. Maintain professional tone in both.';
  return [
    'You are a Borjie document drafting assistant for the Tanzanian mining sector.',
    'Persona: Mr. Mwikila — founder, single source of authority.',
    'You produce paragraph-level prose to fill specific placeholders inside legal / commercial documents.',
    'Hard rules:',
    '- Never invent counterparties, amounts, dates, or licence numbers — only use the values provided.',
    '- Cite the source field name in brackets if a value is missing (e.g. [amount].',
    '- Keep paragraphs short (2–4 sentences).',
    langInstr,
  ].join('\n');
};

export const SEMANTIC_PROMPTS: Record<string, SemanticPrompt> = {
  scopeOfWork: {
    key: 'scopeOfWork',
    system: swahiliFirstSystem,
    user: (kind, ctx, lang) =>
      `Draft a "Scope of Work" paragraph for a ${kind}. Context fields: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  executiveSummary: {
    key: 'executiveSummary',
    system: swahiliFirstSystem,
    user: (kind, ctx, lang) =>
      `Draft a 3–4 sentence executive summary for the ${kind} cover. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  technicalApproach: {
    key: 'technicalApproach',
    system: swahiliFirstSystem,
    user: (kind, ctx, lang) =>
      `Draft a technical approach section (4–6 sentences). Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  companyProfile: {
    key: 'companyProfile',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Draft a short company profile paragraph in ${lang}. Use only the fields in: ${JSON.stringify(
        ctx,
      )}.`,
  },
  openingParagraph: {
    key: 'openingParagraph',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Draft a formal opening paragraph for a regulator/bank letter. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  bodyParagraph: {
    key: 'bodyParagraph',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Draft the body paragraph(s) of the letter (3–6 sentences). Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  requestedActions: {
    key: 'requestedActions',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `List 2–4 requested actions as a numbered list. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  mitigationMeasures: {
    key: 'mitigationMeasures',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `List environmental mitigation measures as a numbered list (3–6 items). Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  investigationFindings: {
    key: 'investigationFindings',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Summarise investigation findings into a community grievance. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  correctiveActions: {
    key: 'correctiveActions',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `List corrective actions (3–6 items, numbered) the company commits to. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  proposedTerms: {
    key: 'proposedTerms',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Outline proposed lease-renewal terms in 4–6 lines. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  changesSinceOriginal: {
    key: 'changesSinceOriginal',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Describe material changes since the original agreement (3–5 sentences). Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  purpose: {
    key: 'purpose',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Write a 2–3 sentence purpose statement for an internal memo. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  currentState: {
    key: 'currentState',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Describe the current operational state in 3–5 sentences. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  recommendation: {
    key: 'recommendation',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `Make a clear recommendation in 2–4 sentences. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
  requestedAction: {
    key: 'requestedAction',
    system: swahiliFirstSystem,
    user: (_kind, ctx, lang) =>
      `State the requested decision-maker action in 1–2 sentences. Context: ${JSON.stringify(
        ctx,
      )}. Language: ${lang}.`,
  },
};

/**
 * Revision prompt — used when `revise_draft` is invoked.
 */
export function buildRevisionPrompt(
  language: DraftLanguage,
  originalContent: string,
  revisionInstruction: string,
): { readonly system: string; readonly user: string } {
  return {
    system: swahiliFirstSystem(language),
    user: [
      'Revise the following document per the instruction.',
      'Preserve structure, headings, and unaltered sections verbatim.',
      'Apply the instruction conservatively — only change what was asked.',
      '',
      `INSTRUCTION:\n${revisionInstruction}`,
      '',
      'ORIGINAL DOCUMENT:',
      originalContent,
    ].join('\n'),
  };
}
