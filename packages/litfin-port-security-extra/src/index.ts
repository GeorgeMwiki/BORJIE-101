/**
 * `@borjie/litfin-port-security-extra` — public surface.
 *
 * LITFIN-ported security + governance patterns:
 *   - webhook-signature verifiers (Stripe, M-Pesa, GePG, Twilio)
 *   - signed-event-emit primitive with multi-key verifier
 *   - per-domain constitutional rules + starter property-mgmt set
 *   - per-jurisdiction GDPR-equivalent SAR deadline helpers
 *   - anti-fraud heuristics (velocity + geo-anomaly)
 */

export * from './types.js';
export * from './webhook-signatures.js';
export * from './signed-event.js';
export * from './constitutional-rules.js';
export * from './gdpr-equivalents.js';
export * from './anti-fraud-heuristics.js';
