/**
 * Regulatory mirror — jurisdiction rule data.
 *
 * Per-jurisdiction statutes that the kernel's regulatory-mirror module
 * consults at step 10 (policy gate). Each rule set is intentionally a
 * pure data structure — no I/O, no LLM. The kernel's `regulatoryMirror`
 * module owns the matching logic; this folder owns the data.
 *
 * Currently shipped:
 *   - TZ — Landlord & Tenant Act, 2022
 *   - KE — Rent Restriction Act (Cap. 296) + Distress for Rent Act
 *   - UAE/RERA — deferred; structure only so future tenants get a
 *     "not yet implemented" routing path instead of silent allow.
 */
export * from './tz-landlord-tenant-act.js';
export * from './ke-rent-restriction-act.js';
export * from './rera-uae.js';
export * from './rules-types.js';
