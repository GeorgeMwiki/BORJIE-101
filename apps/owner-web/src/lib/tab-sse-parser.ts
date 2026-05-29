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

export const tabTagErrorPayloadSchema = z.object({
  tagKind: z.enum(['tab_spawn', 'tab_update', 'tab_remove', 'tab_proposal']),
  tabType: z.string().min(1).max(40).optional(),
  tabId: z.string().min(1).max(160).optional(),
  reasonEn: z.string().min(1).max(200),
  reasonSw: z.string().min(1).max(200),
});
export type TabTagErrorPayload = z.infer<typeof tabTagErrorPayloadSchema>;

// ─── Dispatch handler interface ─────────────────────────────────────

export interface TabSseHandlers {
  onSpawn?(payload: TabSpawnPayload): void;
  onUpdate?(payload: TabUpdatePayload): void;
  onRemove?(payload: TabRemovePayload): void;
  onProposal?(payload: TabProposalPayload): void;
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
      const parsed = tabProposalPayloadSchema.safeParse(payload);
      if (!parsed.success) return false;
      args.handlers.onProposal?.(parsed.data);
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
