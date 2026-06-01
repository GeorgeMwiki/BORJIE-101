/**
 * Brain → portal-genui bridge (the "spawn bridge", seam #3).
 *
 * When the owner talks to Mr. Mwikila and the message carries a high-
 * confidence tab-AUTHORING intent ("we need to track our staff payroll"),
 * we route it to the portal-genui engine, GENERATE the real `PortalTab`
 * (sections of typed fields + widgets), and emit it as a `tab_proposal`
 * chip — so the chip PREVIEWS the actual fields the MD would get BEFORE
 * anything persists. Clicking the chip in owner-web then calls
 * `POST /api/v1/portal-genui/generate { persist: true }` (or `/tabs`) to
 * commit it.
 *
 * Why preview-then-persist
 * ------------------------
 * The engine zod-validates the tab on `generate`, but generation is NOT a
 * write here — we deliberately do NOT call `engine.persist`. The owner
 * confirms first (mirrors the existing `tab_proposal` "confirmation chip,
 * never auto-approval" contract in brain-teach.hono.ts).
 *
 * Additive + fail-soft: any failure (engine missing, no intent, generation
 * error) returns `null` so the teaching reply streams unaffected. Pino logs
 * the decision; never throws into the SSE stream.
 *
 * Bilingual: the proposal carries a short reason in the active locale only
 * (en|sw) — the toggle is absolute per CLAUDE.md (no mixing).
 */

import type { Logger } from 'pino';
import type { GenUIEngine, PortalTab } from '@borjie/portal-genui';

/**
 * Confidence floor for surfacing a generated-tab proposal. Below this the
 * detector's signal is too weak to spend an LLM generation call + show the
 * owner a chip; the brain's own in-stream `<tab_proposal>` tags still cover
 * the softer cases.
 */
export const GENUI_PROPOSAL_MIN_CONFIDENCE = 0.7;

export interface GenuiTabProposalInput {
  readonly engine: GenUIEngine;
  readonly message: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly language: 'en' | 'sw';
  /** Existing tab keys so the detector can downgrade duplicates. */
  readonly currentTabKeys?: ReadonlyArray<string>;
  /** Chat conversation/thread id for the tab's audit provenance. */
  readonly sourceConversationId?: string;
  readonly logger: Logger;
}

/** Compact per-section summary the chip renders so the owner sees the shape. */
export interface GenuiTabSectionSummary {
  readonly key: string;
  readonly title: string;
  readonly fieldCount: number;
  readonly widgetCount: number;
  /** First few field labels so the chip can show "Name, Salary, Start date…". */
  readonly fieldLabels: ReadonlyArray<string>;
}

/**
 * The `tab_proposal` payload. Intentionally shaped to slot alongside the
 * existing CT brain tab_proposal payloads (tagKind: 'tab_proposal') so the
 * owner-web `tab-sse-parser` renders it with the same chip family, plus a
 * `genuiTab` preview block the GenUITabHost can hydrate on accept.
 */
export interface GenuiTabProposalPayload {
  readonly tagKind: 'tab_proposal';
  /** Discriminator so the FE knows this proposal carries a full PortalTab. */
  readonly source: 'portal-genui';
  readonly proposalId: string;
  readonly tabId: string;
  readonly tabKey: string;
  readonly title: string;
  readonly description: string;
  readonly domain: PortalTab['domain'];
  readonly icon: string;
  readonly reason: string;
  readonly confidence: number;
  /** How the engine produced the tab — surfaced for transparency. */
  readonly generationSource: 'llm' | 'fallback' | 'cache';
  /** Counts + a per-section field/widget summary for the preview chip. */
  readonly summary: {
    readonly sectionCount: number;
    readonly fieldCount: number;
    readonly widgetCount: number;
    readonly sections: ReadonlyArray<GenuiTabSectionSummary>;
  };
  /**
   * The full validated PortalTab. Lets the FE render an exact preview AND
   * persist it verbatim on accept (the gateway re-validates + re-scopes
   * tenant server-side). The engine already zod-validated it.
   */
  readonly tab: PortalTab;
}

function summarise(tab: PortalTab): GenuiTabProposalPayload['summary'] {
  let fieldCount = 0;
  let widgetCount = 0;
  const sections: GenuiTabSectionSummary[] = [];
  for (const section of tab.sections) {
    fieldCount += section.fields.length;
    widgetCount += section.widgets.length;
    sections.push({
      key: section.key,
      title: section.title,
      fieldCount: section.fields.length,
      widgetCount: section.widgets.length,
      fieldLabels: section.fields.slice(0, 5).map((f) => f.label),
    });
  }
  return {
    sectionCount: tab.sections.length,
    fieldCount,
    widgetCount,
    sections,
  };
}

function buildReason(tab: PortalTab, language: 'en' | 'sw'): string {
  const fieldCount = tab.sections.reduce((n, s) => n + s.fields.length, 0);
  if (language === 'sw') {
    return `Nimeandaa kichupo kipya cha "${tab.title}" chenye sehemu ${tab.sections.length} na sehemu za kujaza ${fieldCount}. Bofya kukikagua kabla ya kukihifadhi.`;
  }
  return `I drafted a new "${tab.title}" tab with ${tab.sections.length} section${tab.sections.length === 1 ? '' : 's'} and ${fieldCount} field${fieldCount === 1 ? '' : 's'}. Review it before saving.`;
}

/**
 * Detect a high-confidence tab-authoring intent and, if present, GENERATE
 * (preview-only, no persist) a PortalTab proposal payload. Returns `null`
 * when there's no qualifying intent or anything fails — the caller streams
 * the teaching reply regardless.
 */
export async function buildGenuiTabProposal(
  input: GenuiTabProposalInput,
): Promise<GenuiTabProposalPayload | null> {
  const { engine, message, tenantId, userId, language, logger } = input;

  let intent: Awaited<ReturnType<GenUIEngine['detectIntent']>>;
  try {
    intent = await engine.detectIntent({
      message,
      ...(input.currentTabKeys !== undefined
        ? { currentTabKeys: input.currentTabKeys }
        : {}),
    });
  } catch (err) {
    logger.warn(
      { tenantId, userId, err: err instanceof Error ? err.message : String(err) },
      'portal-genui bridge: intent detection failed — skipping tab proposal',
    );
    return null;
  }

  if (!intent || intent.confidence < GENUI_PROPOSAL_MIN_CONFIDENCE) {
    return null;
  }

  let tab: PortalTab;
  let generationSource: 'llm' | 'fallback' | 'cache';
  try {
    const result = await engine.generate({
      intent,
      tenantId,
      userId,
      actorId: userId,
      ...(input.sourceConversationId !== undefined
        ? { sourceConversationId: input.sourceConversationId }
        : {}),
    });
    tab = result.tab;
    generationSource = result.source;
  } catch (err) {
    logger.warn(
      { tenantId, userId, err: err instanceof Error ? err.message : String(err) },
      'portal-genui bridge: generation failed — skipping tab proposal',
    );
    return null;
  }

  const proposalId = `genui:${tenantId}:${userId}:${tab.id}`;
  logger.info(
    {
      tenantId,
      userId,
      tabKey: tab.tabKey,
      domain: tab.domain,
      confidence: intent.confidence,
      generationSource,
    },
    'portal-genui bridge: emitting tab proposal preview',
  );

  return {
    tagKind: 'tab_proposal',
    source: 'portal-genui',
    proposalId,
    tabId: tab.id,
    tabKey: tab.tabKey,
    title: tab.title,
    description: tab.description,
    domain: tab.domain,
    icon: tab.icon,
    reason: buildReason(tab, language),
    confidence: intent.confidence,
    generationSource,
    summary: summarise(tab),
    tab,
  };
}
