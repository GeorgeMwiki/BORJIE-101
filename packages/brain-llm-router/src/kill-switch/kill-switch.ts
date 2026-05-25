/**
 * AI kill switch — 3 trigger surfaces.
 *
 * Ported from LITFIN `src/core/litfin-ai/llm/prompt-budget.ts` lines
 * 117-167. Adapted for Borjie's en/sw bilingual platform.
 *
 * Surfaces (any active → kill):
 *   1. Env var `BORJIE_AI_KILL_SWITCH=true` (deployment-level).
 *   2. localStorage `borjie_ai_kill_switch === "1"` (client / QA).
 *   3. DB feature flag (resolved by the caller; passed in as `dbFlag`).
 *
 * Caller passes the resolved DB boolean to keep this file PURE +
 * importable from edge runtimes. The DB read itself happens in the
 * composition root and is cached / RLS-scoped there.
 *
 * **Fail-closed semantics** (per project rule): never catch + ignore
 * errors from this module. If the env or localStorage read throws,
 * we conservatively return `false` so the LLM hot path stays live —
 * but we NEVER swallow upstream errors from the caller's DB read.
 *
 * Used for:
 *   - Cost runaway (a feedback loop is burning $/min)
 *   - Provider incident (Anthropic outage, can't fall back)
 *   - Compliance hold (data-handling investigation)
 *   - Maintenance window
 */

export type KillSwitchLanguage = 'en' | 'sw';

export type KillSwitchDbReader = () => boolean | null | undefined;

// ─────────────────── Optional DB reader injection ──────────────────

let injectedDbReader: KillSwitchDbReader | null = null;

/**
 * Register a synchronous DB reader. The composition root wires a real
 * reader that consults a cached feature-flags table; tests inject a
 * stub. When set, `isKillSwitchActive()` can be called with no args.
 */
export function setKillSwitchDbReader(reader: KillSwitchDbReader): void {
  injectedDbReader = reader;
}

export function resetKillSwitchDbReader(): void {
  injectedDbReader = null;
}

// ─────────────────────────── Detection ─────────────────────────────

function envFlagActive(): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const v = process.env.BORJIE_AI_KILL_SWITCH;
  if (!v) return false;
  // Accept "true" / "1" / "yes" as truthy.
  return /^(?:true|1|yes)$/i.test(v.trim());
}

function localStorageFlagActive(): boolean {
  if (typeof globalThis === 'undefined') return false;
  const ls = (globalThis as { localStorage?: Storage }).localStorage;
  if (!ls) return false;
  try {
    const v = ls.getItem('borjie_ai_kill_switch');
    return v === '1' || v === 'true';
  } catch {
    // SSR / private mode / quota exceeded — conservative noop.
    return false;
  }
}

/**
 * True iff any of the 3 surfaces is active.
 *
 * Order of authority:
 *   1. DB flag (most authoritative — sovereign operator control)
 *   2. Env var (deployment-level)
 *   3. localStorage (client / dev / QA)
 */
export function isKillSwitchActive(
  dbFlag?: boolean | null,
): boolean {
  // Explicit dbFlag arg wins
  if (dbFlag === true) return true;
  // Injected reader fallback (so callers can use no-arg form)
  if (dbFlag === undefined && injectedDbReader) {
    if (injectedDbReader() === true) return true;
  }
  if (envFlagActive()) return true;
  if (localStorageFlagActive()) return true;
  return false;
}

// ───────────────────── Canned response prompt ──────────────────────

/**
 * Returns the canned "service paused" prompt in the requested
 * language. Bilingual (en / sw) for Borjie's TZ + KE + UG + NG
 * tenant base. Plain text, no em-dashes, no language mixing.
 */
export function buildKillSwitchPrompt(language: KillSwitchLanguage): string {
  if (language === 'sw') {
    return [
      'Mfumo wa Borjie upo katika hali ya matengenezo ya muda mfupi.',
      'Tafadhali jaribu tena baada ya dakika chache.',
    ].join(' ');
  }
  return [
    'The Borjie platform is in a brief maintenance window.',
    'Please try again in a few minutes.',
  ].join(' ');
}
