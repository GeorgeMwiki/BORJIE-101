/**
 * Barrel for universal validators. Every function here is:
 *   - pure (no I/O, no throw),
 *   - country-tolerant (unknown country → `validation-unavailable`),
 *   - safe to call in a request hot path.
 */

export * from './phone.js';
export * from './address.js';
export * from './national-id.js';
export * from './tax-id.js';
export * from './bank-account.js';
