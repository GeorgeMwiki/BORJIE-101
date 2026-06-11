/**
 * Modality proposal — the UI INVARIANT enforcement seam.
 *
 * Owner directive (MASTER_GAP_REGISTER §"UI / Modality Invariant"):
 *
 *   1. Infinite UI, not a catalog. portal-genui SYNTHESIZES whatever UI the
 *      need calls for; forecast / media / document are ARTIFACTS that flow
 *      into a dynamically-composed surface.
 *   2. Change ONLY upon reasoned need (tau + evidence + goal). A plain chat
 *      turn proposes no UI change.
 *   3. User approval GATES the mutation. A proposed UI change never
 *      self-applies — it surfaces as a proposal (ambient notice + Open/Undo)
 *      and mutates only on approval. Default = propose-and-approve; auto-spawn
 *      ONLY for a flow the user explicitly set to auto, always reversible.
 *   4. Chat-customizable. The proposal is a starting point; the user chats to
 *      refine and genui re-synthesizes from the amended spec.
 *
 * This module is PURE: it turns an artifact + a reasoned-need signal into a
 * `ModalityProposal` whose `payload` reuses the EXISTING
 * `GenuiTabProposalPayload` shape so owner-web's `tab_proposal` → GenUITabHost
 * path renders it as the ambient "Opened X from your chat" notice with
 * Open/Undo. It NEVER persists a tab and NEVER mutates a surface — the
 * caller routes `payload` out via the portal-genui proposal channel.
 *
 * @module composition/modality-capability/modality-proposal
 */

import type { GenuiTabProposalPayload } from '../../services/brain/genui-tab-proposal.js';
import type { PortalTab } from '@borjie/portal-genui';

/** The artifact modalities a proposal can carry. */
export type ModalityArtifactKind = 'forecast' | 'media' | 'document';

/** Map an artifact modality onto a PortalTab domain bucket (best-fit). */
const DOMAIN_BY_KIND: Readonly<Record<ModalityArtifactKind, PortalTab['domain']>> = {
  forecast: 'finance',
  media: 'marketing',
  document: 'compliance',
};

const ICON_BY_KIND: Readonly<Record<ModalityArtifactKind, string>> = {
  forecast: 'trending-up',
  media: 'image',
  document: 'file-text',
};

/**
 * The reasoned-need signal — the AUT-14 half of the arbiter verdict. A
 * proposal is only emitted when `warranted` is true (tau cleared + evidence
 * non-empty). A plain chat turn never sets this, so it never proposes.
 */
export interface ReasonedNeed {
  /** Whether a UI change is warranted (tau cleared + evidence present). */
  readonly warranted: boolean;
  /** The Tier-1 cosine / confidence score that cleared tau (telemetry). */
  readonly score: number;
  /** Evidence ids grounding the need (≥1 required for `warranted`). */
  readonly evidenceIds: ReadonlyArray<string>;
  /** Single-language reason (EN/SW purity — no mixing). */
  readonly reason: string;
  /**
   * Autonomy posture for THIS proposal. `propose` (default) surfaces the
   * ambient notice and waits for approval; `auto` spawns ambiently but
   * reversibly (only when the flow was explicitly set to auto + the rail
   * allowed it). NEVER `auto` for money / licence / deletion.
   */
  readonly posture: 'propose' | 'auto';
}

/** The synthesized proposal the caller routes through the approval gate. */
export interface ModalityProposal {
  /** The artifact modality. */
  readonly artifactKind: ModalityArtifactKind;
  /**
   * The owner-web-renderable payload (the EXISTING `tab_proposal` shape) —
   * the genui-synthesized UI spec as a PortalTab preview + reason + evidence.
   * NOT persisted; the FE persists verbatim only on approval.
   */
  readonly payload: GenuiTabProposalPayload;
  /** The autonomy posture (propose-and-approve vs explicit-auto, reversible). */
  readonly posture: 'propose' | 'auto';
  /** The raw artifact (forecast envelope / media artifact / doc) for the route. */
  readonly artifact: Readonly<Record<string, unknown>>;
}

const NOW = (): string => new Date().toISOString();

/** Stable, deterministic tab key from the kind + a discriminator. */
function tabKeyFor(kind: ModalityArtifactKind, discriminator: string): string {
  const slug = discriminator
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return `genui_${kind}_${slug || 'artifact'}`;
}

/**
 * Build a minimal, VALID synthesized PortalTab that PREVIEWS the artifact.
 * This is the "genui-synthesized UI spec" — a single section describing the
 * artifact. It is a preview only; the FE re-validates + re-scopes on persist.
 */
function synthesizeTab(args: {
  readonly kind: ModalityArtifactKind;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly title: string;
  readonly description: string;
  readonly fieldLabels: ReadonlyArray<string>;
}): PortalTab {
  const at = NOW();
  const tabKey = tabKeyFor(args.kind, args.title);
  return {
    id: `genui:${args.tenantId}:${args.kind}:${tabKey}`,
    version: 1,
    tenantId: args.tenantId,
    userId: args.userId,
    tabKey,
    title: args.title,
    description: args.description.slice(0, 500),
    icon: ICON_BY_KIND[args.kind],
    domain: DOMAIN_BY_KIND[args.kind],
    sections: [
      {
        key: `${args.kind}_summary`,
        title: args.title,
        fields:
          args.fieldLabels.length > 0
            ? args.fieldLabels.slice(0, 8).map((label, i) => ({
                key: `f_${i}`,
                label,
                kind: 'text' as const,
                readonly: true,
              }))
            : [
                {
                  key: 'f_0',
                  label: args.title,
                  kind: 'text' as const,
                  readonly: true,
                },
              ],
        widgets: [],
      },
    ],
    permissions: {
      visibleToPersonas: ['owner', 'estate_manager'],
      ownerOnlyEdits: true,
    },
    audit: {
      createdBy: args.userId ?? 'mr-mwikila',
      updatedBy: args.userId ?? 'mr-mwikila',
      history: [],
    },
    createdAt: at,
    updatedAt: at,
  } as PortalTab;
}

/** Summarise a synthesized tab into the proposal payload `summary` block. */
function summarise(tab: PortalTab): GenuiTabProposalPayload['summary'] {
  let fieldCount = 0;
  let widgetCount = 0;
  const sections = tab.sections.map((s) => {
    fieldCount += s.fields.length;
    widgetCount += s.widgets.length;
    return {
      key: s.key,
      title: s.title,
      fieldCount: s.fields.length,
      widgetCount: s.widgets.length,
      fieldLabels: s.fields.slice(0, 5).map((f) => f.label),
    };
  });
  return { sectionCount: tab.sections.length, fieldCount, widgetCount, sections };
}

export interface BuildModalityProposalArgs {
  readonly artifactKind: ModalityArtifactKind;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly need: ReasonedNeed;
  /** Display title for the synthesized surface. */
  readonly title: string;
  /** One-line description. */
  readonly description: string;
  /** Field labels describing the artifact (rendered in the preview). */
  readonly fieldLabels: ReadonlyArray<string>;
  /** The raw artifact carried for the surfaced UI + the artifact route. */
  readonly artifact: Readonly<Record<string, unknown>>;
}

/**
 * Build a `ModalityProposal` from an artifact + a reasoned-need signal.
 *
 * Returns `null` when the need is NOT warranted (invariant rule 2: a plain
 * chat turn proposes nothing) OR when the evidence chain is empty (the
 * Auditor would reject an evidence-free proposal). When it returns a
 * proposal, the proposal NEVER self-applies — the caller routes it through
 * the approval gate (rule 3).
 *
 * Pure — no I/O, no persistence, no mutation.
 */
export function buildModalityProposal(
  args: BuildModalityProposalArgs,
): ModalityProposal | null {
  // INVARIANT rule 2 — change only upon reasoned need.
  if (!args.need.warranted) return null;
  // Evidence-required — an empty chain is never surfaced.
  if (args.need.evidenceIds.length === 0) return null;

  const tab = synthesizeTab({
    kind: args.artifactKind,
    tenantId: args.tenantId,
    userId: args.userId,
    title: args.title,
    description: args.description,
    fieldLabels: args.fieldLabels,
  });

  const payload: GenuiTabProposalPayload = {
    tagKind: 'tab_proposal',
    source: 'portal-genui',
    proposalId: `modality:${args.tenantId}:${args.artifactKind}:${tab.id}`,
    tabId: tab.id,
    tabKey: tab.tabKey,
    title: tab.title,
    description: tab.description,
    domain: tab.domain,
    icon: tab.icon,
    reason: args.need.reason,
    confidence: args.need.score,
    generationSource: 'llm',
    summary: summarise(tab),
    tab,
  };

  return {
    artifactKind: args.artifactKind,
    payload,
    posture: args.need.posture,
    artifact: args.artifact,
  };
}
