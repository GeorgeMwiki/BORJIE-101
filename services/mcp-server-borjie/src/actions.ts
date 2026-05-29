/**
 * Computer-use-style semantic actions.
 *
 * Beyond raw tools, the Borjie public MCP surface exposes four high-
 * level "actions" that mirror what Mr. Mwikila does in the owner
 * cockpit — agents drive the owner's UI the way Claude Computer Use
 * drives a browser:
 *
 *   actions/navigate  — push the owner to a specific tab / route
 *   actions/prefill   — populate a form on owner's current screen
 *   actions/share     — generate a share link to an entity
 *   actions/undo      — pop the last undo-journal entry
 *
 * Each is a first-class JSON-RPC method (not just a tool). The
 * dispatcher delegates to an `ActionsHandler` that proxies to the
 * api-gateway primitives — same hash-chain audit, same RLS scoping.
 *
 * Bilingual sw/en messages by default. The handler returns the same
 * provenance envelope as a tool call so external clients can render
 * a uniform card.
 */

import { z } from 'zod';
import type { BorjieMcpProvenance } from './types.js';

export const navigateSchema = z.object({
  target: z.string().min(1).max(200),
  params: z.record(z.string(), z.unknown()).optional(),
  locale: z.enum(['sw', 'en']).optional(),
});

export const prefillSchema = z.object({
  formId: z.string().min(1).max(120),
  values: z.record(z.string(), z.unknown()),
  locale: z.enum(['sw', 'en']).optional(),
});

export const shareSchema = z.object({
  entityRef: z.string().min(1).max(200),
  hours: z.number().int().positive().max(720).optional(),
  recipientEmail: z.string().email().optional(),
  locale: z.enum(['sw', 'en']).optional(),
});

export const undoSchema = z.object({
  reason: z.string().min(1).max(280).optional(),
  locale: z.enum(['sw', 'en']).optional(),
});

export type NavigateInput = z.infer<typeof navigateSchema>;
export type PrefillInput = z.infer<typeof prefillSchema>;
export type ShareInput = z.infer<typeof shareSchema>;
export type UndoInput = z.infer<typeof undoSchema>;

export interface ActionResult {
  readonly ok: true;
  readonly action: 'navigate' | 'prefill' | 'share' | 'undo';
  readonly summary: string;
  readonly summarySw: string;
  readonly payload: unknown;
  readonly provenance: BorjieMcpProvenance;
}

export interface ActionsHandler {
  navigate(input: NavigateInput): Promise<unknown>;
  prefill(input: PrefillInput): Promise<unknown>;
  share(input: ShareInput): Promise<unknown>;
  undo(input: UndoInput): Promise<unknown>;
}

/** Test handler that echoes the inputs. */
export function createEchoActionsHandler(): ActionsHandler {
  const handler: ActionsHandler = {
    async navigate(input: NavigateInput): Promise<unknown> {
      return { navigatedTo: input.target, params: input.params ?? {} };
    },
    async prefill(input: PrefillInput): Promise<unknown> {
      return { formId: input.formId, prefilled: Object.keys(input.values).length };
    },
    async share(input: ShareInput): Promise<unknown> {
      return {
        entityRef: input.entityRef,
        url: `https://share.borjie.app/${encodeURIComponent(input.entityRef)}`,
        expiresInHours: input.hours ?? 24,
      };
    },
    async undo(_input: UndoInput): Promise<unknown> {
      return { undone: true };
    },
  };
  return Object.freeze(handler);
}

/** Bilingual summary strings for the four actions. */
export function summariseAction(
  action: 'navigate' | 'prefill' | 'share' | 'undo',
  payload: unknown,
): { en: string; sw: string } {
  switch (action) {
    case 'navigate': {
      const t =
        payload && typeof payload === 'object'
          ? String((payload as Record<string, unknown>)['navigatedTo'] ?? '')
          : '';
      return {
        en: `Navigated owner cockpit to ${t}`,
        sw: `Nimekupeleka kwenye ${t} kwenye cockpit`,
      };
    }
    case 'prefill': {
      const n =
        payload && typeof payload === 'object'
          ? Number((payload as Record<string, unknown>)['prefilled'] ?? 0)
          : 0;
      return {
        en: `Prefilled ${n} fields on the active form`,
        sw: `Nimejaza vipengele ${n} kwenye fomu`,
      };
    }
    case 'share': {
      const url =
        payload && typeof payload === 'object'
          ? String((payload as Record<string, unknown>)['url'] ?? '')
          : '';
      return {
        en: `Created share link: ${url}`,
        sw: `Nimetengeneza kiungo cha kushiriki: ${url}`,
      };
    }
    case 'undo':
      return { en: 'Undid the last action', sw: 'Nimefuta tendo la mwisho' };
  }
}
