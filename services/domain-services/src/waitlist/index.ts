/**
 * Waitlist domain services public API.
 *
 * The legacy `PostgresWaitlistRepository` has been retired during the
 * mining hard-fork (the property-domain `unit_waitlists` /
 * `waitlist_outreach_events` tables were dropped by migration 0003).
 * The mining-domain replacement lives under
 * `@borjie/domain-services/offtake-queue` (buyers waiting for ore
 * parcels). The in-memory service + vacancy handler are kept for
 * back-compat with consumers that still bind `WaitlistService`; they
 * will return shaped-but-empty results until those callers migrate.
 */
export * from './types.js';
export * from './waitlist-service.js';
export * from './waitlist-vacancy-handler.js';
