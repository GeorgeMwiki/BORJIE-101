/**
 * @borjie/disclosure-layer — Phase N-D
 *
 * IP-protected disclosure layer for the BORJIE Brain.
 *
 * Closes:
 *  - EU AI Act Art. 50 (Aug 2 2026 enforcement)
 *  - GDPR Art. 22 (right to meaningful explanation)
 *  - HUD Fair Housing Act (adverse-action notices)
 *  - Connecticut chatbot disclosure law
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md
 */

// Tier taxonomy (3-tier matrix; 30 fields)
export * from './tier-taxonomy/index.js';

// Role gate (auth-injected role → tier)
export * from './role-gate/index.js';

// CLOSE-pattern refusal grammar (6 pre-built)
export * from './close-pattern/index.js';

// Canary tokens — system-prompt leakage detection
export * from './canary-tokens/index.js';

// Spotlighting — DATA marking (per-session delimiters)
export * from './spotlighting/index.js';

// Hardened system prompt — external + internal variants
export * from './hardened-system-prompt/index.js';

// GDPR Art 22 — counterfactual explainability
export * from './gdpr-art-22-explainability/index.js';

// EU AI Act Art 50 — first-interaction disclosure (Aug 2 2026 deadline)
export * from './eu-ai-act-art-50/index.js';

// Disclosure audit — every disclosure logged as J1 entity (append-only)
export * from './disclosure-audit/index.js';

// Runtime defense composer — chain all 9 modules into one pipeline
export * from './runtime-defense-composer/index.js';
