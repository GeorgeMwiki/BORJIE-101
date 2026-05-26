/**
 * Gamification module.
 *
 * The legacy `PostgresGamificationRepository` was retired during the
 * mining hard-fork (the property-domain `reward_policies`,
 * `tenant_gamification_profile`, `reward_events` tables were dropped
 * by migration 0003). The mining-domain replacement lives under
 * `@borjie/domain-services/worker-incentives` (safety badges,
 * productivity rewards). The pure service + reward-policy types are
 * kept here for back-compat with consumers still typed against them.
 */
export * from './reward-policy.js';
export * from './tenant-gamification-profile.js';
export * from './reward-event.js';
export * from './gamification-service.js';
