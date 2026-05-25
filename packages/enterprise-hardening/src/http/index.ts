/**
 * HTTP Module
 *
 * Centralised outbound-HTTP primitives:
 * - safeHttpFetch — SSRF-aware wrapper around fetch with internal-IP
 *   denylist + optional allowlist + per-call timeout.
 */

export * from './safe-http-fetch';
