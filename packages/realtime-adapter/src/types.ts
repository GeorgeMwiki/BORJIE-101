/**
 * RealtimePort: the single interface adapters implement.
 *
 * Channel naming convention: `tenant.<tenantId>.<topic>`. Topics are
 * a fixed set so the Supabase RLS policy on the realtime schema can
 * pattern-match against `realtime.channel` and only authorize members
 * of the tenant to subscribe.
 */

export const REALTIME_TOPICS = [
  'leases',
  'maintenance',
  'payments',
  'applications',
  'tabs-updated',
  'reports-generated',
  'field-captures',
] as const;

export type RealtimeTopic = (typeof REALTIME_TOPICS)[number];

/**
 * Compose a tenant-scoped channel name. Always prefer this over manual
 * concatenation so the RLS pattern stays consistent.
 */
export function tenantChannelName(
  tenantId: string,
  topic: RealtimeTopic,
): string {
  if (!tenantId || tenantId.includes('.')) {
    throw new Error(
      `Invalid tenantId for channel: '${tenantId}' — must be non-empty and contain no '.'`,
    );
  }
  return `tenant.${tenantId}.${topic}`;
}

/**
 * Parse a tenant-scoped channel name. Returns null if the name does not
 * match the convention.
 */
export function parseTenantChannel(
  name: string,
): { tenantId: string; topic: RealtimeTopic } | null {
  const parts = name.split('.');
  if (parts.length !== 3) return null;
  if (parts[0] !== 'tenant') return null;
  const topic = parts[2] as RealtimeTopic;
  if (!REALTIME_TOPICS.includes(topic)) return null;
  return { tenantId: parts[1] ?? '', topic };
}

/**
 * Event payload — opaque to the port. Adapters serialize.
 */
export type RealtimePayload = Record<string, unknown>;

/**
 * Event delivered to subscribers.
 */
export interface RealtimeEvent {
  readonly channel: string;
  readonly event: string;
  readonly payload: RealtimePayload;
  readonly timestamp: Date;
}

/**
 * Handle returned from `subscribe`. Caller passes it to `unsubscribe`.
 */
export interface RealtimeSubscriptionHandle {
  readonly id: string;
  readonly channel: string;
  readonly event: string | '*';
}

export interface SubscribeFilter {
  /** Filter by event name. `'*'` (or undefined) subscribes to all events. */
  readonly event?: string | '*';
}

export type RealtimeListener = (event: RealtimeEvent) => void | Promise<void>;

/**
 * The realtime port. Adapters implement this; consumers depend on it.
 */
export interface RealtimePort {
  /** Subscribe to a channel; returns a handle to use with unsubscribe(). */
  subscribe(
    channelName: string,
    filter: SubscribeFilter,
    onEvent: RealtimeListener,
  ): Promise<RealtimeSubscriptionHandle>;

  /** Tear down a subscription. Idempotent. */
  unsubscribe(handle: RealtimeSubscriptionHandle): Promise<void>;

  /** Broadcast an event to all subscribers of a channel. */
  broadcast(
    channelName: string,
    event: string,
    payload: RealtimePayload,
  ): Promise<void>;
}

export class RealtimeAdapterError extends Error {
  readonly kind = 'RealtimeAdapterError' as const;
  override readonly cause: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'RealtimeAdapterError';
    this.cause = cause;
  }
}
