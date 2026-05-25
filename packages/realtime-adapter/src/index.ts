/**
 * `@borjie/realtime-adapter` — public surface.
 */

export {
  REALTIME_TOPICS,
  type RealtimeTopic,
  tenantChannelName,
  parseTenantChannel,
  type RealtimeEvent,
  type RealtimeListener,
  type RealtimePayload,
  type RealtimePort,
  type RealtimeSubscriptionHandle,
  type SubscribeFilter,
  RealtimeAdapterError,
} from './types.js';

export { createInMemoryRealtime } from './in-memory.js';

export {
  createSupabaseRealtime,
  type SupabaseRealtimeOptions,
} from './supabase.js';
