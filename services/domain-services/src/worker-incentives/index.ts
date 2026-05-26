/**
 * Worker incentives module — Borjie mining.
 *
 * Replaces the property-domain `gamification` postgres repository with a
 * mining-specific equivalent that tracks safety badges, productivity
 * rewards, attendance streaks, and incident-free milestones per worker.
 */

export * from './types.js';
export * from './postgres-worker-incentives-repository.js';
