/**
 * Brain-peer adapter — represents the brain as a non-human participant
 * in a Liveblocks room. Pattern is the Liveblocks 3.0 "AI Copilots" /
 * agent-peer convention (May 2025 release): the brain has its own
 * cursor, can read room updates, and can issue mutations.
 *
 * Implementation status:
 *   - 2.x stable path: presence + broadcastEvent (works today)
 *   - 3.x stable path: native `room.agent({...})` once that surface
 *     stabilises (see the follow-up note at the bottom of this file)
 *
 * Generative-UI parts are emitted as room `customEvent`s with a
 * `kind: 'gen-ui-part'` discriminator; the chat surface listens for
 * these and mounts the matching React subtree via the chat-ui parts
 * registry (`packages/chat-ui`).
 */

import type { LiveblocksRoom } from './client.js';
import { parseRoomId } from './client.js';

/** Minimal kernel surface — the brain peer never reaches deeper. */
export interface BrainKernelHandle {
  readonly tenantId: string;
  /**
   * Emit a chat-style generative-UI part for the room's surface. The
   * `partKind` must match a registered chat-ui part; the chat surface
   * renders the registry slot.
   */
  readonly emitGenUIPart: (input: {
    readonly roomId: string;
    readonly partKind: string;
    readonly payload: Record<string, unknown>;
  }) => Promise<void> | void;
}

export interface BrainPersona {
  readonly id: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
  /** RBAC label shown beside the brain's cursor in the room. */
  readonly role: 'brain';
}

export interface CreateBrainPeerOptions {
  readonly room: LiveblocksRoom;
  readonly kernel: BrainKernelHandle;
  readonly persona: BrainPersona;
}

export interface BrainPeer {
  readonly persona: BrainPersona;
  readonly roomId: string;
  /** Detach from the room. Idempotent. */
  readonly detach: () => void;
  /**
   * Issue a room mutation (broadcast a typed `customEvent`). Returns
   * `true` if the event was queued; `false` if the room is closed.
   */
  readonly broadcast: (event: BrainPeerEvent) => boolean;
  /**
   * Send a generative-UI part. Convenience wrapper around
   * {@link BrainKernelHandle.emitGenUIPart} that scopes to this room.
   */
  readonly sendGenUIPart: (
    partKind: string,
    payload: Record<string, unknown>,
  ) => Promise<void>;
}

export type BrainPeerEventKind =
  | 'gen-ui-part'
  | 'state-mutation'
  | 'tool-result'
  | 'chat-message';

/**
 * Round-3 audit L3 — the previous emit path accepted any `kind`
 * string at the type level but silently broadcast typo'd events (e.g.
 * `'gen-ui-prt'` instead of `'gen-ui-part'`) to subscribers that did
 * not listen. The runtime validator below catches typos at the
 * `broadcast()` boundary; mis-shaped events throw with the offending
 * field so the caller sees the error instead of a silent no-op.
 */
const VALID_BRAIN_PEER_EVENT_KINDS: ReadonlySet<BrainPeerEventKind> = new Set([
  'gen-ui-part',
  'state-mutation',
  'tool-result',
  'chat-message',
]);

export interface BrainPeerEvent {
  readonly kind: BrainPeerEventKind;
  readonly payload: Record<string, unknown>;
  readonly emittedAt: string;
}

export class InvalidBrainPeerEventError extends Error {
  constructor(field: string, value: unknown) {
    super(
      `brain-peer: invalid event — field "${field}" has value ${JSON.stringify(value)}`
    );
    this.name = 'InvalidBrainPeerEventError';
  }
}

export function validateBrainPeerEvent(
  event: unknown
): asserts event is BrainPeerEvent {
  if (!event || typeof event !== 'object') {
    throw new InvalidBrainPeerEventError('event', event);
  }
  const e = event as Record<string, unknown>;
  if (typeof e.kind !== 'string' ||
    !VALID_BRAIN_PEER_EVENT_KINDS.has(e.kind as BrainPeerEventKind)) {
    throw new InvalidBrainPeerEventError('kind', e.kind);
  }
  if (!e.payload || typeof e.payload !== 'object') {
    throw new InvalidBrainPeerEventError('payload', e.payload);
  }
  if (typeof e.emittedAt !== 'string') {
    throw new InvalidBrainPeerEventError('emittedAt', e.emittedAt);
  }
  // ISO-8601 sanity check — `Date.parse` returns NaN for garbage.
  if (Number.isNaN(Date.parse(e.emittedAt))) {
    throw new InvalidBrainPeerEventError('emittedAt', e.emittedAt);
  }
}

/**
 * Liveblocks 2.x exposes `room.broadcastEvent(event)` on the public
 * client. Once 3.x's `room.agent({...})` lands, swap the `client.broadcastEvent`
 * call for the agent-peer attach. Until then we use a minimal duck-typed
 * surface so the unit tests can run without a live socket.
 */
interface BroadcastableClient {
  broadcastEvent?: (roomId: string, event: BrainPeerEvent) => void;
  leave: (roomId: string) => void;
}

export function createBrainPeer(opts: CreateBrainPeerOptions): BrainPeer {
  const { room, kernel, persona } = opts;
  if (!room?.client) {
    throw new Error('brain-peer: room.client is required');
  }
  if (!kernel?.tenantId) {
    throw new Error('brain-peer: kernel.tenantId is required');
  }
  if (persona.role !== 'brain') {
    throw new Error(
      `brain-peer: persona.role must be "brain", got "${persona.role}"`,
    );
  }

  // Round-3 audit H18 / 6.3 fix — verify that the room's tenant
  // segment matches the kernel's tenantId. Defense-in-depth on top
  // of the gateway's Liveblocks auth router: if the caller passes
  // a mismatched pair (e.g. brain configured for tenant-A attached
  // to a room belonging to tenant-B), surface it immediately instead
  // of relying solely on the gateway to refuse the token.
  const parsed = parseRoomId(room.roomId);
  if (parsed && parsed.tenantId !== kernel.tenantId) {
    throw new Error(
      `brain-peer: kernel tenantId "${kernel.tenantId}" does not match room tenantId "${parsed.tenantId}" in room "${room.roomId}"`,
    );
  }

  const client = room.client as unknown as BroadcastableClient;
  let attached = true;

  const broadcast = (event: BrainPeerEvent): boolean => {
    if (!attached) return false;
    // Round-3 audit L3 — runtime-validate the event shape so a typo
    // in `kind` (e.g. 'gen-ui-prt') throws here instead of silently
    // broadcasting an event no subscriber listens for.
    validateBrainPeerEvent(event);
    if (typeof client.broadcastEvent !== 'function') {
      // Stub client (tests). Treat as success — the test inspects via
      // the spy on the factory.
      return true;
    }
    client.broadcastEvent(room.roomId, event);
    return true;
  };

  const sendGenUIPart = async (
    partKind: string,
    payload: Record<string, unknown>,
  ): Promise<void> => {
    if (!attached) {
      throw new Error('brain-peer: cannot send gen-ui-part after detach');
    }
    await kernel.emitGenUIPart({
      roomId: room.roomId,
      partKind,
      payload,
    });
    broadcast({
      kind: 'gen-ui-part',
      payload: { partKind, ...payload },
      emittedAt: new Date().toISOString(),
    });
  };

  const detach = (): void => {
    if (!attached) return;
    attached = false;
    try {
      client.leave(room.roomId);
    } catch {
      // Detach is best-effort; a room that's already closed is fine.
    }
  };

  return {
    persona,
    roomId: room.roomId,
    detach,
    broadcast,
    sendGenUIPart,
  };
}

// Follow-up B6 follow-up (Docs/TODO_BACKLOG.md): When @liveblocks/client publishes a stable 3.x
// agent-peer surface (currently in preview as `room.agent({...})`),
// switch `broadcastEvent`/`leave` for the native attach so the brain
// shows up with its own cursor in the Liveblocks-managed presence
// channel rather than as a synthetic peer.
