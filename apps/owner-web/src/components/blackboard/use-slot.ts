'use client';

/**
 * use-slot — the cross-surface CRDT state-bus subscriber for the teaching
 * board (EA-05 closure, the Face half).
 *
 * Two jobs, both additive over the existing local smartboard store:
 *
 *   1. HYDRATE-ON-LOAD: on mount, fetch this tenant's persisted blackboard
 *      slots from the gateway (`GET /api/v1/blackboard/slots?slotKind=note`)
 *      and replay the `board:*` slots into the local board store. So the
 *      OUTPUT-LEVEL trend-of-thought survives a page reload (today the board
 *      is wiped on refresh — it lives only in the SSE stream of one turn).
 *
 *   2. LIVE CONVERGE: subscribe to the tenant-scoped `state-bus` Supabase
 *      Realtime channel for `slot-delta` broadcasts. When a `board:*` slot
 *      changes on ANOTHER surface/device (or a later turn on this one), apply
 *      the embedded element to the board — so the board is cross-surface, not
 *      single-screen.
 *
 * IDEMPOTENT: every apply goes through `appendBoardElement`, whose reducer
 * dedupes by element id (in-place update, never a duplicate). The board is
 * therefore safe under at-least-once realtime delivery AND a double hydrate.
 *
 * DEGRADE-SAFE: hydration works with no realtime at all; the subscription is
 * best-effort and any failure (no Supabase env, channel error, malformed
 * payload) is swallowed — the local SSE-fed board keeps working exactly as
 * before. This hook NEVER throws into render.
 */

import { useEffect, useRef, useState } from 'react';

import { API_BASE } from '@/lib/brain-api';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { appendBoardElement } from './use-blackboard-store';
import { boardElementSchema, type BoardElement } from './types';

const STATE_BUS_TOPIC = 'state-bus' as const;
const SLOT_DELTA_EVENT = 'slot-delta' as const;
const BOARD_SLOT_PREFIX = 'board:';

export interface UseSlotState {
  /** True once the initial hydrate fetch has resolved (ok or degraded). */
  readonly hydrated: boolean;
  /** Count of board elements applied from persisted slots + live deltas. */
  readonly applied: number;
  /** True while the realtime channel is subscribed. */
  readonly connected: boolean;
}

export interface UseSlotOptions {
  /** Disable the whole hook (tests / when the board panel is hidden). */
  readonly enabled?: boolean;
}

/** A persisted slot row as the gateway returns it (subset we read). */
interface SlotWire {
  readonly slotId: string;
  readonly deleted?: boolean;
  readonly value?: { kind?: string; element?: unknown } | null;
}

/** Pull the validated board element out of a `board:*` note slot, or null. */
function elementOfSlot(slot: SlotWire | null | undefined): BoardElement | null {
  if (!slot || slot.deleted) return null;
  if (!slot.slotId.startsWith(BOARD_SLOT_PREFIX)) return null;
  const value = slot.value;
  if (!value || value.kind !== 'board-element') return null;
  const parsed = boardElementSchema.safeParse(value.element);
  return parsed.success ? parsed.data : null;
}

async function getAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/** Read the tenant id from the Supabase session JWT `app_metadata`. */
async function getTenantId(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supabase = createSupabaseBrowserClient();
    const { data } = await supabase.auth.getUser();
    const meta = data.user?.app_metadata as { tenant_id?: unknown } | undefined;
    const tid = meta?.tenant_id;
    return typeof tid === 'string' && tid.length > 0 ? tid : null;
  } catch {
    return null;
  }
}

export function useSlot(options: UseSlotOptions = {}): UseSlotState {
  const { enabled = true } = options;
  const [state, setState] = useState<UseSlotState>({
    hydrated: false,
    applied: 0,
    connected: false,
  });
  // Guard against double-run (React 18 StrictMode mounts effects twice).
  const ranRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    // The Supabase channel handle; torn down on unmount.
    let channel: ReturnType<
      ReturnType<typeof createSupabaseBrowserClient>['channel']
    > | null = null;

    const applyElement = (element: BoardElement): void => {
      appendBoardElement(element, null);
      if (!cancelled) {
        setState((prev) => ({ ...prev, applied: prev.applied + 1 }));
      }
    };

    // ── 1. Hydrate on load ────────────────────────────────────────────
    const hydrate = async (): Promise<void> => {
      try {
        const token = await getAccessToken();
        if (!token) {
          if (!cancelled) setState((prev) => ({ ...prev, hydrated: true }));
          return;
        }
        const endpoint = `${API_BASE.replace(/\/+$/, '')}/api/v1/blackboard/slots?slotKind=note`;
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (!cancelled) setState((prev) => ({ ...prev, hydrated: true }));
          return;
        }
        const json = (await res.json()) as { data?: ReadonlyArray<SlotWire> };
        const slots = Array.isArray(json.data) ? json.data : [];
        for (const slot of slots) {
          if (cancelled) break;
          const element = elementOfSlot(slot);
          if (element) applyElement(element);
        }
      } catch {
        // Degrade quietly — the local SSE-fed board is unaffected.
      } finally {
        if (!cancelled) setState((prev) => ({ ...prev, hydrated: true }));
      }
    };

    // ── 2. Live converge over the state-bus ───────────────────────────
    const subscribe = async (): Promise<void> => {
      try {
        const tenantId = await getTenantId();
        if (!tenantId || cancelled) return;
        const supabase = createSupabaseBrowserClient();
        const channelName = `tenant.${tenantId}.${STATE_BUS_TOPIC}`;
        channel = supabase.channel(channelName);
        channel
          .on(
            'broadcast',
            { event: SLOT_DELTA_EVENT },
            (message: { payload?: unknown }) => {
              const payload = message.payload as
                | { slot?: SlotWire }
                | undefined;
              const element = elementOfSlot(payload?.slot);
              if (element) applyElement(element);
            },
          )
          .subscribe((status: string) => {
            if (!cancelled) {
              setState((prev) => ({
                ...prev,
                connected: status === 'SUBSCRIBED',
              }));
            }
          });
      } catch {
        // No realtime backend / channel error — hydration-only mode.
      }
    };

    void hydrate();
    void subscribe();

    return () => {
      cancelled = true;
      if (channel) {
        try {
          void createSupabaseBrowserClient().removeChannel(channel);
        } catch {
          // best-effort teardown
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return state;
}
