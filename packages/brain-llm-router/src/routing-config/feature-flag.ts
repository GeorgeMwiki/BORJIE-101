/**
 * routing-config/feature-flag.ts — the DEFAULT-ON kill-switch that gates the
 * entire config-driven routing path.
 *
 * `BORJIE_LLM_ROUTING_CONFIG` is a reversible master switch:
 *   - UNSET / any value except an explicit off-token → ON (config-driven
 *     routing is consulted; admin config can steer model selection).
 *   - explicit off-token ('0' | 'false' | 'off' | 'no') → OFF (today's static
 *     TASK_LADDER routing stands; the config reader is bypassed entirely).
 *
 * This matches the FLAG_ACTIVATION_PLAN "kill-switch, verified-then-on"
 * convention (full powers default-on; the flag only DISABLES, never silently
 * bypasses a security floor). Turning it off is the instant rollback to
 * static routing if a bad config ships — the resolver also fails safe on a
 * per-read basis, so this is belt-and-braces.
 *
 * Read at the seam (not cached at module load) so an operator flip takes
 * effect on the next turn without a restart. The env read is cheap + guarded.
 */

const OFF_TOKENS: ReadonlySet<string> = Object.freeze(
  new Set(['0', 'false', 'off', 'no']),
);

/**
 * True iff config-driven routing is enabled. Default-on: only an explicit
 * off-token disables it. Never throws.
 */
export function isRoutingConfigEnabled(): boolean {
  try {
    if (typeof process === 'undefined' || !process.env) return true;
    const raw = process.env.BORJIE_LLM_ROUTING_CONFIG;
    if (raw === undefined || raw === null) return true;
    const normalised = raw.trim().toLowerCase();
    if (normalised.length === 0) return true;
    return !OFF_TOKENS.has(normalised);
  } catch {
    // FAIL-SAFE: if the env read throws, default to ON (the resolver itself
    // still falls back to the static ladder on any per-read problem).
    return true;
  }
}
