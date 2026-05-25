/**
 * Liveblocks client factory + room-id conventions.
 *
 * Central Command Phase B B6 — humans + brain as first-class peers in
 * Liveblocks rooms (Liveblocks 3.0 AI-Agents pattern; we design around
 * the stable 2.x public API and flag the 3.0-upgrade path below).
 *
 * Room-id convention (NEVER assemble these strings ad-hoc — go through
 * {@link buildRoomId}):
 *
 *   borjie:lease-editing:${tenantId}:${leaseId}
 *   borjie:maintenance-thread:${tenantId}:${ticketId}
 *
 * The `tenantId` segment is the load-bearing security boundary. The
 * gateway's Liveblocks auth router (`services/api-gateway/src/routes/
 * liveblocks-auth.router.ts`) ENFORCES the regex
 * `^borjie:[a-z-]+:${callerTenantId}:.+$`. A token minted for tenant
 * A is structurally incapable of unlocking a room belonging to tenant B
 * because Liveblocks's `prepareSession` only grants what's in the
 * `userInfo.permissions` map.
 *
 * Upgrade path to Liveblocks 3.0 agent peers:
 *   - When `@liveblocks/client` 3.x publishes a stable `agent` API, the
 *     {@link BrainPeer} module switches from the 2.x `broadcastEvent`
 *     pattern to the native agent-peer attach. The {@link createLiveblocksRoom}
 *     surface stays unchanged.
 */

// We import the public type-only surface; runtime adapter is loaded
// through {@link RoomFactory} so tests can inject a stub without pulling
// @liveblocks/client into the test harness.
type LiveblocksClient = {
  enterRoom: (roomId: string, opts?: unknown) => unknown;
  leave: (roomId: string) => void;
};

export interface CreateLiveblocksRoomOptions {
  /** Stable room id minted via {@link buildRoomId}. */
  readonly roomId: string;
  /**
   * URL the client POSTs to mint a session token. Body shape is the
   * Liveblocks default: `{ room: string }` with `Authorization: Bearer`.
   * Maps 1:1 to {@link liveblocksAuthRouter}.
   */
  readonly authEndpoint: string;
  /**
   * Caller's logical identity. Echoed into the room's presence so the
   * brain knows whose mouse is whose. NEVER trust this client-side
   * value for authorisation — the gateway re-derives `tenantId` from
   * the JWT before minting tokens.
   */
  readonly userInfo: {
    readonly id: string;
    readonly tenantId: string;
    readonly displayName: string;
    readonly avatarUrl?: string;
    readonly role?: string;
  };
}

export interface LiveblocksRoom {
  readonly roomId: string;
  readonly client: LiveblocksClient;
  readonly disconnect: () => void;
}

/** Injectable factory — production wires `@liveblocks/client`; tests pass a stub. */
export type LiveblocksClientFactory = (opts: {
  authEndpoint: string;
}) => LiveblocksClient;

/**
 * Room-kind discriminator. Adding a kind = audit it in
 * {@link liveblocksAuthRouter}'s allow-list FIRST, then ship the client.
 */
export type RoomKind = 'lease-editing' | 'maintenance-thread';

const VALID_KINDS: ReadonlyArray<RoomKind> = [
  'lease-editing',
  'maintenance-thread',
];

const ROOM_ID_RE = /^borjie:(lease-editing|maintenance-thread):[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/;

/**
 * Build a canonical Liveblocks room id. Throws on malformed inputs so
 * callers can never produce a token-bypass collision (e.g. a `:` in a
 * synthetic tenant id).
 */
export function buildRoomId(
  kind: RoomKind,
  tenantId: string,
  resourceId: string,
): string {
  if (!VALID_KINDS.includes(kind)) {
    throw new Error(`realtime-rooms: unknown room kind "${kind}"`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(tenantId)) {
    throw new Error(
      `realtime-rooms: tenantId "${tenantId}" must match [a-zA-Z0-9_-]+`,
    );
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(resourceId)) {
    throw new Error(
      `realtime-rooms: resourceId "${resourceId}" must match [a-zA-Z0-9_-]+`,
    );
  }
  return `borjie:${kind}:${tenantId}:${resourceId}`;
}

/** True iff `roomId` matches the canonical pattern. */
export function isCanonicalRoomId(roomId: string): boolean {
  return ROOM_ID_RE.test(roomId);
}

/**
 * Parse a canonical room id into its parts. Returns `null` for malformed
 * inputs — callers MUST handle this rather than throw because room ids
 * arrive from clients and untrusted contexts.
 */
export function parseRoomId(roomId: string): {
  readonly kind: RoomKind;
  readonly tenantId: string;
  readonly resourceId: string;
} | null {
  const match = ROOM_ID_RE.exec(roomId);
  if (!match) return null;
  const [, kind, tenantId, resourceId] = roomId.split(':');
  if (!kind || !tenantId || !resourceId) return null;
  return {
    kind: kind as RoomKind,
    tenantId,
    resourceId,
  };
}

/**
 * Stub factory — overridden by host apps via {@link configureLiveblocksFactory}.
 * Until configured, attempting to create a room throws a descriptive
 * error rather than silently no-op.
 */
let configuredFactory: LiveblocksClientFactory | null = null;

export function configureLiveblocksFactory(
  factory: LiveblocksClientFactory,
): void {
  configuredFactory = factory;
}

/** Test-only — reset the factory between specs. */
export function __resetLiveblocksFactory(): void {
  configuredFactory = null;
}

/**
 * Round-3 audit H17 fix — scrub `displayName` before it's broadcast
 * via Liveblocks presence. `userInfo.displayName` is gossiped to every
 * peer in the room; if it carries PII (e.g. `John Doe (+254712345678)`),
 * the phone number leaks to every concurrent peer.
 *
 * Patterns mirror the AI-copilot PII scrubber but kept minimal here —
 * the realtime package must not depend on the AI package.
 */
const PRESENCE_PII_PATTERNS: readonly RegExp[] = [
  // E.164 international phone (any country)
  /\+\d{1,3}[\s.-]?\(?\d{2,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}/g,
  // Kenya local format starting 07XX...
  /\b0?7\d{8}\b/g,
  // Email
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  // Generic 9+ digit run (catches obfuscated phone numbers in tail)
  /\b\d{9,}\b/g,
];

export function scrubPresenceDisplayName(value: string): string {
  let out = value;
  for (const rx of PRESENCE_PII_PATTERNS) {
    out = out.replace(rx, '[redacted]');
  }
  return out.trim();
}

/**
 * Construct a Liveblocks room handle. The handle exposes the underlying
 * client (for advanced wiring — useDocumentBinding, BrainPeer, etc.)
 * plus a `disconnect()` that releases the connection cleanly.
 */
export function createLiveblocksRoom(
  opts: CreateLiveblocksRoomOptions,
): LiveblocksRoom {
  if (!opts.roomId) {
    throw new Error('realtime-rooms: roomId is required');
  }
  if (!isCanonicalRoomId(opts.roomId)) {
    throw new Error(
      `realtime-rooms: roomId "${opts.roomId}" does not match the canonical pattern`,
    );
  }
  if (!opts.authEndpoint) {
    throw new Error('realtime-rooms: authEndpoint is required');
  }
  if (!opts.userInfo?.id || !opts.userInfo?.tenantId) {
    throw new Error(
      'realtime-rooms: userInfo.id and userInfo.tenantId are required',
    );
  }

  // Round-3 audit 6.3 — defense-in-depth: verify the room's tenant
  // segment matches the caller's userInfo.tenantId. Liveblocks's
  // gateway is the real auth gate, but a mismatching pair indicates
  // a programming error worth surfacing immediately.
  const parsed = parseRoomId(opts.roomId);
  if (parsed && parsed.tenantId !== opts.userInfo.tenantId) {
    throw new Error(
      `realtime-rooms: room tenantId "${parsed.tenantId}" does not match userInfo.tenantId "${opts.userInfo.tenantId}"`,
    );
  }

  if (!configuredFactory) {
    throw new Error(
      'realtime-rooms: no Liveblocks factory configured. Call configureLiveblocksFactory({...}) at portal bootstrap.',
    );
  }

  // Round-3 audit H17 fix — scrub PII out of displayName before
  // broadcasting via presence. The original value is dropped on
  // entry so it can never leak to other peers.
  const scrubbedUserInfo = {
    ...opts.userInfo,
    displayName: scrubPresenceDisplayName(opts.userInfo.displayName),
  };

  const client = configuredFactory({ authEndpoint: opts.authEndpoint });
  client.enterRoom(opts.roomId, { userInfo: scrubbedUserInfo });

  return {
    roomId: opts.roomId,
    client,
    disconnect: () => client.leave(opts.roomId),
  };
}
