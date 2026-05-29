/**
 * Brain-emitted tab tag pipeline (CT-3 / CT-4 / CT-5).
 *
 * Takes the parsed `<tab_spawn>` / `<tab_update>` / `<tab_remove>` /
 * `<tab_proposal>` tags from the brain reply, validates each config
 * against the per-type schema, and publishes the right cockpit-bus
 * event so:
 *
 *   - the spawning device sees an SSE chip rendered in the chat reply
 *     (via the action[] this function returns to the route handler)
 *   - every OTHER device the owner is signed in on receives the same
 *     event on the cockpit stream and reconciles its tab strip in
 *     <500 ms (via the existing `/api/v1/cockpit/stream` channel).
 *
 * Failures are SURFACED, not swallowed:
 *   - Invalid config → returns a `tab_tag_error` action so the chat
 *     reply renders a polite "that doesn't apply" chip.
 *   - Brain dropped diagnostics → logged via Pino.warn.
 *
 * The actual `owner_tabs.state` row is NOT mutated here — the FE store
 * owns the durable tab list (per the existing PUT /api/v1/owner/tabs
 * contract). The cockpit-bus event is the cross-device signal; FE
 * stores reconcile via deterministic tab ids.
 */

import type { Logger } from 'pino';

import {
  isTabProposal,
  isTabRemove,
  isTabSpawn,
  isTabUpdate,
  pickProposalReason,
  pickTagTitle,
  type TabTag,
} from '@borjie/central-intelligence';

import { publishCockpitEvent } from '../cockpit-events/bus.js';
import { validateTabConfig } from './config-validator.js';

export interface ProcessTabTagsInput {
  readonly tags: ReadonlyArray<TabTag>;
  readonly dropped: ReadonlyArray<{
    readonly tagName: string;
    readonly raw: string;
    readonly reason: string;
  }>;
  readonly tenantId: string;
  readonly userId: string;
  readonly logger: Logger;
  /**
   * Optional — emitted in the cockpit event so OTHER devices can echo-
   * filter their own pulses out. Defaults to null.
   */
  readonly originDeviceId?: string | null;
}

export interface TabAction {
  /** SSE event name the brain-teach handler writes for the spawning device. */
  readonly event:
    | 'tab_spawn'
    | 'tab_update'
    | 'tab_remove'
    | 'tab_proposal'
    | 'tab_tag_error';
  /** Renderable payload — the FE drives the chat chip / tab strip from this. */
  readonly payload: Record<string, unknown>;
}

/**
 * Deterministic tab id builder — mirrors the FE owner-tabs-store's
 * `deterministicTabId` so re-spawning the same (type, scoping context)
 * resolves to the same id on the server pulse AND the FE store. We
 * keep this in lockstep with the FE module so the cross-device pulse
 * lands on the same row.
 */
const SCOPING_KEYS = [
  'siteId',
  'licenceId',
  'employeeId',
  'counterpartyId',
  'documentId',
] as const;

const BUILTIN_TAB_KINDS = new Set([
  'chat',
  'docs',
  'drafts',
  'reminders',
  'insights',
]);

function deterministicTabId(
  kind: string,
  config: Record<string, unknown>,
): string {
  if (BUILTIN_TAB_KINDS.has(kind)) return kind;
  const parts: string[] = [kind];
  for (const key of SCOPING_KEYS) {
    const v = config[key];
    if (typeof v === 'string' && v.length > 0) {
      parts.push(`${key}:${v}`);
    }
  }
  return parts.join('|');
}

export async function processTabTagsForOwner(
  input: ProcessTabTagsInput,
): Promise<ReadonlyArray<TabAction>> {
  const { tags, dropped, tenantId, userId, logger } = input;
  const originDeviceId = input.originDeviceId ?? null;
  const emittedAt = new Date().toISOString();

  // 1 — surface diagnostics for the eval loop.
  if (dropped.length > 0) {
    for (const d of dropped) {
      logger.warn(
        {
          tenantId,
          userId,
          tagName: d.tagName,
          reason: d.reason,
          raw: d.raw.slice(0, 200),
        },
        'tab-tag dropped — brain emitted a malformed tag',
      );
    }
  }

  const actions: TabAction[] = [];

  for (const tag of tags) {
    if (isTabSpawn(tag)) {
      const validation = validateTabConfig(tag.type, tag.config ?? {});
      if (!validation.ok) {
        logger.warn(
          {
            tenantId,
            userId,
            tabType: tag.type,
            detail: validation.detail,
          },
          'tab_spawn rejected — invalid config',
        );
        actions.push({
          event: 'tab_tag_error',
          payload: {
            tagKind: 'tab_spawn',
            tabType: tag.type,
            reasonEn: validation.reasonEn,
            reasonSw: validation.reasonSw,
          },
        });
        continue;
      }
      if (validation.droppedKeys.length > 0) {
        logger.warn(
          {
            tenantId,
            userId,
            tabType: tag.type,
            droppedKeys: validation.droppedKeys,
          },
          'tab_spawn config: stripped unknown / invalid keys',
        );
      }
      const tabId = deterministicTabId(tag.type, validation.config);
      const payload = {
        tagKind: 'tab_spawn',
        tabId,
        tabType: tag.type,
        title: tag.title,
        titleEn: tag.titleEn ?? null,
        titleSw: tag.titleSw ?? null,
        config: validation.config,
        droppedKeys: validation.droppedKeys,
        source: 'brain' as const,
      };
      actions.push({ event: 'tab_spawn', payload });
      publishCockpitEvent({
        kind: 'cockpit.tab.spawned',
        tenantId,
        emittedAt,
        userId,
        tabId,
        tabType: tag.type,
        title: tag.title,
        config: validation.config,
        originDeviceId,
        source: 'brain',
      });
      continue;
    }

    if (isTabUpdate(tag)) {
      let validatedConfig: Record<string, unknown> | undefined;
      if (tag.config !== undefined) {
        // The brain may emit a partial config update without a `type`,
        // so we cannot validate against a per-type schema strictly.
        // Run the default permissive schema by passing a synthetic
        // type ("chat") whose schema is the default permissive shape.
        // The FE keeps the original type when patching, so this is safe.
        const validation = validateTabConfig('chat', tag.config);
        if (!validation.ok) {
          logger.warn(
            {
              tenantId,
              userId,
              tabId: tag.id,
              detail: validation.detail,
            },
            'tab_update rejected — invalid config patch',
          );
          actions.push({
            event: 'tab_tag_error',
            payload: {
              tagKind: 'tab_update',
              tabId: tag.id,
              reasonEn: validation.reasonEn,
              reasonSw: validation.reasonSw,
            },
          });
          continue;
        }
        validatedConfig = validation.config;
      }
      const patch: { config?: Record<string, unknown>; title?: string } = {};
      if (validatedConfig !== undefined) patch.config = validatedConfig;
      if (tag.title !== undefined) patch.title = tag.title;
      const payload = {
        tagKind: 'tab_update',
        tabId: tag.id,
        patch,
        titleEn: tag.titleEn ?? null,
        titleSw: tag.titleSw ?? null,
        source: 'brain' as const,
      };
      actions.push({ event: 'tab_update', payload });
      publishCockpitEvent({
        kind: 'cockpit.tab.updated',
        tenantId,
        emittedAt,
        userId,
        tabId: tag.id,
        patch,
        originDeviceId,
        source: 'brain',
      });
      continue;
    }

    if (isTabRemove(tag)) {
      // Pinned-tab rejection happens client-side; we still emit so the
      // initiating device renders the error chip and other devices can
      // ignore the no-op. The cockpit bus is fire-and-forget.
      const payload = {
        tagKind: 'tab_remove',
        tabId: tag.id,
        source: 'brain' as const,
      };
      actions.push({ event: 'tab_remove', payload });
      publishCockpitEvent({
        kind: 'cockpit.tab.removed',
        tenantId,
        emittedAt,
        userId,
        tabId: tag.id,
        originDeviceId,
        source: 'brain',
      });
      continue;
    }

    if (isTabProposal(tag)) {
      // Proposals carry their own evidence chain — log + emit. The
      // suggester service (CT-6) is the autonomous version of this
      // path; here the brain emits one in-stream.
      const validation = validateTabConfig(tag.type, tag.config ?? {});
      if (!validation.ok) {
        logger.warn(
          {
            tenantId,
            userId,
            tabType: tag.type,
            detail: validation.detail,
          },
          'tab_proposal rejected — invalid config',
        );
        actions.push({
          event: 'tab_tag_error',
          payload: {
            tagKind: 'tab_proposal',
            tabType: tag.type,
            reasonEn: validation.reasonEn,
            reasonSw: validation.reasonSw,
          },
        });
        continue;
      }
      const reasonEn = pickProposalReason(tag, 'en');
      const reasonSw = tag.reasonSw ?? null;
      const proposalId = `brain:${tenantId}:${userId}:${Date.now()}:${tag.type}`;
      const payload = {
        tagKind: 'tab_proposal',
        proposalId,
        tabType: tag.type,
        title: tag.title,
        titleEn: tag.titleEn ?? null,
        titleSw: tag.titleSw ?? null,
        reasonEn,
        reasonSw,
        evidenceIds: tag.evidenceIds,
        confidence: tag.confidence ?? null,
        config: validation.config,
      };
      actions.push({ event: 'tab_proposal', payload });
      // pickTagTitle expects an exact-optional shape — only forward the
      // locale overrides when the brain actually set them.
      const titleArg: {
        readonly title: string;
        readonly titleEn?: string;
        readonly titleSw?: string;
      } = {
        title: tag.title,
        ...(tag.titleEn !== undefined ? { titleEn: tag.titleEn } : {}),
        ...(tag.titleSw !== undefined ? { titleSw: tag.titleSw } : {}),
      };
      publishCockpitEvent({
        kind: 'cockpit.tab.proposed',
        tenantId,
        emittedAt,
        userId,
        proposalId,
        tabType: tag.type,
        title: pickTagTitle(titleArg, 'en'),
        reasonEn,
        reasonSw,
        evidenceIds: tag.evidenceIds,
        confidence: tag.confidence ?? null,
      });
      continue;
    }
  }

  return actions;
}
