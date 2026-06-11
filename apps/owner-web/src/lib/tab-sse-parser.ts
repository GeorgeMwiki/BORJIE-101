/**
 * Owner-web tab SSE parser (CT-3).
 *
 * The brain-teach stream emits five new SSE events alongside the
 * existing `message_chunk` / `spawn_tabs` / `ui_*` envelopes:
 *
 *   - tab_spawn       → spawn-or-augment in the FE store; tab pulses
 *                       on the strip; toast "Opened {title}".
 *   - tab_update      → patch context/title on an existing tabId.
 *   - tab_remove      → close (refuses pinned tabs).
 *   - tab_proposal    → render an accept/dismiss chip in chat; accept
 *                       binds to spawn-or-augment.
 *   - tab_tag_error   → render a polite "that doesn't apply" chip.
 *
 * This module is the SINGLE SEAM between the brain SSE stream and the
 * `useOwnerTabs()` store. The HomeChatTeach component imports
 * `handleTabSseFrame(...)` and dispatches; no React state lives here
 * (zero-React module so it can be unit-tested with vitest-node).
 *
 * Multi-device sync (CT-5):
 *   The SAME store handlers fire when the cockpit SSE bus delivers a
 *   `cockpit.tab.spawned` / `.updated` / `.removed` event from ANOTHER
 *   device. `applyTabActionToStore()` is idempotent — re-applying a
 *   spawn for an existing deterministic tabId augments instead of
 *   duplicating.
 *
 * The parser is intentionally tolerant: malformed payloads are dropped
 * with a console-free no-op (we cannot Pino on the client). Pino-side
 * diagnostics live on the gateway.
 */

import { z } from 'zod';

import type { OwnerTabKind, OwnerTab } from './owner-tabs-store';

// ─── Public payload schemas ─────────────────────────────────────────

const tabSourceSchema = z.enum(['brain', 'owner']);

export const tabSpawnPayloadSchema = z.object({
  tagKind: z.literal('tab_spawn'),
  tabId: z.string().min(1).max(160),
  tabType: z.string().min(1).max(40),
  title: z.string().min(1).max(60),
  titleEn: z.string().min(1).max(60).nullable().optional(),
  titleSw: z.string().min(1).max(60).nullable().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
  droppedKeys: z.array(z.string()).default([]),
  source: tabSourceSchema,
});
export type TabSpawnPayload = z.infer<typeof tabSpawnPayloadSchema>;

export const tabUpdatePayloadSchema = z.object({
  tagKind: z.literal('tab_update'),
  tabId: z.string().min(1).max(160),
  patch: z.object({
    config: z.record(z.string(), z.unknown()).optional(),
    title: z.string().min(1).max(60).optional(),
  }),
  titleEn: z.string().min(1).max(60).nullable().optional(),
  titleSw: z.string().min(1).max(60).nullable().optional(),
  source: tabSourceSchema,
});
export type TabUpdatePayload = z.infer<typeof tabUpdatePayloadSchema>;

export const tabRemovePayloadSchema = z.object({
  tagKind: z.literal('tab_remove'),
  tabId: z.string().min(1).max(160),
  source: tabSourceSchema,
});
export type TabRemovePayload = z.infer<typeof tabRemovePayloadSchema>;

export const tabProposalPayloadSchema = z.object({
  tagKind: z.literal('tab_proposal'),
  proposalId: z.string().min(1).max(200),
  tabType: z.string().min(1).max(40),
  title: z.string().min(1).max(60),
  titleEn: z.string().min(1).max(60).nullable().optional(),
  titleSw: z.string().min(1).max(60).nullable().optional(),
  reasonEn: z.string().min(1).max(200),
  reasonSw: z.string().min(1).max(200).nullable().optional(),
  evidenceIds: z.array(z.string().min(1)).min(1).max(5),
  confidence: z.number().min(0).max(1).nullable().optional(),
  config: z.record(z.string(), z.unknown()).default({}),
});
export type TabProposalPayload = z.infer<typeof tabProposalPayloadSchema>;

/**
 * The portal-genui proposal family. Shares the `tab_proposal` SSE event
 * name with the static-registry proposal above but is discriminated by
 * `source: 'portal-genui'` and carries a FULL generated `PortalTab` (the
 * MD-authored dynamic tab). This is the payload `buildGenuiTabProposal`
 * emits on the brain-teach stream. The `tab` is left loose here (record)
 * — `GenUITabHost` re-validates it with `safeParsePortalTab` before
 * rendering, so a server/client shape drift degrades to an empty state
 * rather than a crash.
 */
const genuiSectionSummarySchema = z.object({
  key: z.string(),
  title: z.string(),
  fieldCount: z.number().int().nonnegative(),
  widgetCount: z.number().int().nonnegative(),
  fieldLabels: z.array(z.string()).default([]),
});

export const genuiTabProposalPayloadSchema = z.object({
  tagKind: z.literal('tab_proposal'),
  source: z.literal('portal-genui'),
  proposalId: z.string().min(1).max(200),
  tabId: z.string().min(1).max(200),
  tabKey: z.string().min(1).max(160),
  title: z.string().min(1).max(160),
  description: z.string().max(600).default(''),
  domain: z.string().min(1).max(40),
  icon: z.string().max(80).default(''),
  reason: z.string().min(1).max(600),
  confidence: z.number().min(0).max(1),
  generationSource: z.enum(['llm', 'fallback', 'cache']),
  summary: z.object({
    sectionCount: z.number().int().nonnegative(),
    fieldCount: z.number().int().nonnegative(),
    widgetCount: z.number().int().nonnegative(),
    sections: z.array(genuiSectionSummarySchema).default([]),
  }),
  tab: z.record(z.string(), z.unknown()),
});
export type GenuiTabProposalPayload = z.infer<
  typeof genuiTabProposalPayloadSchema
>;

export const tabTagErrorPayloadSchema = z.object({
  tagKind: z.enum(['tab_spawn', 'tab_update', 'tab_remove', 'tab_proposal']),
  tabType: z.string().min(1).max(40).optional(),
  tabId: z.string().min(1).max(160).optional(),
  reasonEn: z.string().min(1).max(200),
  reasonSw: z.string().min(1).max(200),
});
export type TabTagErrorPayload = z.infer<typeof tabTagErrorPayloadSchema>;

/**
 * The modality ARTIFACT-proposal family (closure Wave 8 — the brain-proposal →
 * artifact-render seam). The brain's modality arbiter surfaces a forecast /
 * document / media artifact whose UI it SYNTHESIZES (not a catalog tab). It
 * rides the dedicated `artifact_proposal` SSE event AND, as a fallback, a
 * `tab_proposal` discriminated by `source: 'modality-arbiter'` with a
 * `genui_<kind>` tabType (the shape the gateway's `proposal-sink` + the
 * `cockpit.tab.proposed` bus emit).
 *
 * The payload carries ONLY the IDENTITY of the artifact — never the artifact
 * body. The resolver hook fetches the EGRESS-MEMBRANE-PROJECTED descriptor from
 * `GET /api/v1/modality-artifacts/:proposalId` (the allow-listed, scrubbed
 * shape, safe to render). Carrying only the identity here keeps the
 * un-projected blob off the stream by construction.
 */
export const ARTIFACT_KINDS = ['forecast', 'document', 'media'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** Coerce a `genui_<kind>` tabType (or a bare kind) onto an ArtifactKind. */
function artifactKindFrom(value: unknown): ArtifactKind | null {
  if (typeof value !== 'string') return null;
  const bare = value.startsWith('genui_') ? value.slice('genui_'.length) : value;
  return (ARTIFACT_KINDS as ReadonlyArray<string>).includes(bare)
    ? (bare as ArtifactKind)
    : null;
}

export const artifactProposalPayloadSchema = z.object({
  proposalId: z.string().min(1).max(200),
  artifactKind: z.enum(ARTIFACT_KINDS),
  title: z.string().min(1).max(160),
  reasonEn: z.string().max(600).default(''),
  reasonSw: z.string().max(600).nullable().optional(),
  evidenceIds: z.array(z.string().min(1)).min(1).max(8),
  confidence: z.number().min(0).max(1).nullable().optional(),
  /** propose-and-approve (default) vs explicit, reversible auto. */
  posture: z.enum(['propose', 'auto']).default('propose'),
});
export type ArtifactProposalPayload = z.infer<
  typeof artifactProposalPayloadSchema
>;

/**
 * Best-effort coercion of a raw modality-proposal frame (either the dedicated
 * `artifact_proposal` event or a `source:'modality-arbiter'` `tab_proposal` /
 * `cockpit.tab.proposed` envelope) into a typed `ArtifactProposalPayload`.
 * Returns null when the frame is not a recognisable artifact proposal so the
 * caller drops it cleanly (degrade-safe — never throws).
 */
function coerceArtifactProposal(
  payload: Record<string, unknown>,
): ArtifactProposalPayload | null {
  const artifactKind =
    artifactKindFrom(payload.artifactKind) ?? artifactKindFrom(payload.tabType);
  if (!artifactKind) return null;
  const proposalId =
    typeof payload.proposalId === 'string' ? payload.proposalId : null;
  if (!proposalId) return null;
  const evidenceIds = Array.isArray(payload.evidenceIds)
    ? payload.evidenceIds
    : Array.isArray(payload.evidence_ids)
      ? payload.evidence_ids
      : [];
  const reasonEn =
    typeof payload.reasonEn === 'string'
      ? payload.reasonEn
      : typeof payload.reason === 'string'
        ? payload.reason
        : '';
  const candidate = {
    proposalId,
    artifactKind,
    title: typeof payload.title === 'string' ? payload.title : artifactKind,
    reasonEn,
    reasonSw:
      typeof payload.reasonSw === 'string' ? payload.reasonSw : null,
    evidenceIds,
    confidence:
      typeof payload.confidence === 'number' ? payload.confidence : null,
    posture: payload.posture === 'auto' ? 'auto' : 'propose',
  };
  const parsed = artifactProposalPayloadSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

// ─── Dispatch handler interface ─────────────────────────────────────

export interface TabSseHandlers {
  onSpawn?(payload: TabSpawnPayload): void;
  onUpdate?(payload: TabUpdatePayload): void;
  onRemove?(payload: TabRemovePayload): void;
  onProposal?(payload: TabProposalPayload): void;
  /** A portal-genui proposal carrying a full generated PortalTab. */
  onGenuiProposal?(payload: GenuiTabProposalPayload): void;
  /**
   * A modality artifact proposal (forecast / document / media). The handler
   * fetches the membrane-projected descriptor + routes it to the renderer.
   */
  onArtifactProposal?(payload: ArtifactProposalPayload): void;
  onError?(payload: TabTagErrorPayload): void;
}

/**
 * Recognised SSE event names. Exported so callers can short-circuit
 * the routing without parsing the data when the event is irrelevant.
 */
export const TAB_SSE_EVENTS = [
  'tab_spawn',
  'tab_update',
  'tab_remove',
  'tab_proposal',
  'tab_tag_error',
  // Closure Wave 8 — the brain-proposal → artifact-render seam. The brain's
  // modality arbiter emits these for synthesized forecast / document / media
  // surfaces; they were previously DROPPED (not in this allow-list).
  'artifact_proposal',
  'cockpit.tab.proposed',
] as const;
export type TabSseEvent = (typeof TAB_SSE_EVENTS)[number];

export function isTabSseEvent(eventName: string): eventName is TabSseEvent {
  return (TAB_SSE_EVENTS as ReadonlyArray<string>).includes(eventName);
}

/**
 * Parse one SSE frame's data + dispatch to the right handler. Returns
 * `true` when the event was a tab event AND parsed successfully (so
 * the caller can decide whether to also feed it to other parsers).
 *
 * Frame shape: `{ "payload": {...}, "at": "..." }` — matches the
 * gateway's brain-teach envelope.
 */
export function handleTabSseFrame(args: {
  readonly eventName: string;
  readonly rawData: string;
  readonly handlers: TabSseHandlers;
}): boolean {
  if (!isTabSseEvent(args.eventName)) return false;
  let raw: unknown;
  try {
    raw = JSON.parse(args.rawData);
  } catch {
    return false;
  }
  if (!raw || typeof raw !== 'object') return false;
  const payload = (raw as { payload?: unknown }).payload ?? raw;

  switch (args.eventName) {
    case 'tab_spawn': {
      const parsed = tabSpawnPayloadSchema.safeParse(payload);
      if (!parsed.success) return false;
      args.handlers.onSpawn?.(parsed.data);
      return true;
    }
    case 'tab_update': {
      const parsed = tabUpdatePayloadSchema.safeParse(payload);
      if (!parsed.success) return false;
      args.handlers.onUpdate?.(parsed.data);
      return true;
    }
    case 'tab_remove': {
      const parsed = tabRemovePayloadSchema.safeParse(payload);
      if (!parsed.success) return false;
      args.handlers.onRemove?.(parsed.data);
      return true;
    }
    case 'tab_proposal': {
      // Three proposal families ride this event.
      //  1. modality-arbiter — a synthesized forecast/document/media artifact
      //     (discriminated by `source:'modality-arbiter'` or a `genui_<kind>`
      //     tabType) → onArtifactProposal (fetch + render the projected
      //     descriptor).
      //  2. portal-genui — a full generated PortalTab → onGenuiProposal.
      //  3. static-registry — tabType + evidenceIds → onProposal.
      if (payload && typeof payload === 'object') {
        const source = (payload as { source?: unknown }).source;
        if (source === 'modality-arbiter') {
          const artifact = coerceArtifactProposal(
            payload as Record<string, unknown>,
          );
          if (!artifact) return false;
          args.handlers.onArtifactProposal?.(artifact);
          return true;
        }
        if (source === 'portal-genui') {
          const parsedGenui = genuiTabProposalPayloadSchema.safeParse(payload);
          if (!parsedGenui.success) return false;
          args.handlers.onGenuiProposal?.(parsedGenui.data);
          return true;
        }
      }
      const parsed = tabProposalPayloadSchema.safeParse(payload);
      if (!parsed.success) return false;
      args.handlers.onProposal?.(parsed.data);
      return true;
    }
    case 'artifact_proposal':
    case 'cockpit.tab.proposed': {
      // A modality artifact proposal on its dedicated event (or the cockpit
      // bus envelope). The frame carries only the artifact identity; the
      // resolver fetches the membrane-projected descriptor by proposalId.
      if (!payload || typeof payload !== 'object') return false;
      const artifact = coerceArtifactProposal(
        payload as Record<string, unknown>,
      );
      if (!artifact) return false;
      args.handlers.onArtifactProposal?.(artifact);
      return true;
    }
    case 'tab_tag_error': {
      const parsed = tabTagErrorPayloadSchema.safeParse(payload);
      if (!parsed.success) return false;
      args.handlers.onError?.(parsed.data);
      return true;
    }
    default:
      return false;
  }
}

// ─── Store reconciliation helpers ───────────────────────────────────
//
// These are pure functions that produce the action payload the
// `useOwnerTabs()` hook needs. The hook itself stays out of this
// module so we can unit-test the reconciliation logic without React.

const TAB_KINDS: ReadonlySet<OwnerTabKind> = new Set<OwnerTabKind>([
  'chat',
  'docs',
  'drafts',
  'reminders',
  'insights',
  'doc-context',
  'hr',
  'ops',
  'finance',
  'accounting',
  'risk',
  'compliance',
  'workforce',
  'procurement',
  'audit',
  'legal',
  'esg',
  'geology',
  'treasury',
  'marketplace',
  'licences',
  'sites',
  'safety',
  'reports',
  'artifact',
]);

export function isKnownTabKind(s: string): s is OwnerTabKind {
  return TAB_KINDS.has(s as OwnerTabKind);
}

/**
 * Build an OwnerTab object from a brain-emitted `tab_spawn` payload.
 * Returns null when the tabType is not in the owner-web's known set.
 *
 * Choice of locale-correct title:
 *   - When `language === 'sw'` and `titleSw` exists, use it.
 *   - When `language === 'en'` and `titleEn` exists, use it.
 *   - Otherwise fall back to `title`.
 */
export function spawnPayloadToTab(
  payload: TabSpawnPayload,
  language: 'sw' | 'en',
): OwnerTab | null {
  if (!isKnownTabKind(payload.tabType)) return null;
  const title =
    (language === 'sw' && payload.titleSw) ||
    (language === 'en' && payload.titleEn) ||
    payload.title;
  return {
    id: payload.tabId,
    kind: payload.tabType,
    title,
    context: payload.config,
  };
}

/**
 * Merge an `tab_update` patch onto an existing tab. Returns a new tab
 * object — mutation is forbidden per the Borjie coding-style rule.
 */
export function applyUpdatePatch(
  existing: OwnerTab,
  payload: TabUpdatePayload,
  language: 'sw' | 'en',
): OwnerTab {
  const titleOverride =
    (language === 'sw' && payload.titleSw) ||
    (language === 'en' && payload.titleEn) ||
    payload.patch.title;
  const next: OwnerTab = {
    ...existing,
    ...(titleOverride !== undefined && titleOverride !== null
      ? { title: titleOverride }
      : {}),
    ...(payload.patch.config
      ? {
          context: {
            ...(existing.context ?? {}),
            ...payload.patch.config,
          },
        }
      : {}),
  };
  return next;
}
