/**
 * Permission validator — confirms that destructive-tier tools used in the AOP
 * are guarded by an `ask-owner` or `4-eye` hook AND that every tool step's
 * args do not exfiltrate sensitive PII keys without an explicit grant.
 *
 * CRITICAL (C1, fail-closed contract):
 * The registry's optional `tier` function tells us which tier a tool sits in.
 * If the registry does NOT supply tier info we used to skip the destructive
 * guard check entirely; that turned every wiring of `BrainToolRegistry`
 * without `tier()` into a sovereign-tier bypass surface. We now treat the
 * MISSING-tier-fn case as "every tool is destructive" — the AOP only
 * compiles if every tool step is guarded by an ask-owner / 4-eye hook with
 * on_approve pointing at it. Production registries MUST keep `tier()` wired.
 *
 * HIGH (H4, PII guard):
 * Any tool step whose args (recursively) contain a known sensitive PII key
 * (`kra_pin`, `nin`, `mpesa_pin`, `huduma_number`, …) must be explicitly
 * whitelisted by listing the key in the AOP's `grants[]` field, otherwise
 * the AOP is rejected. This prevents an LLM-authored AOP from quietly
 * dragging owner/tenant PII out of the kernel through a write-tier tool.
 */

import type {
  AOP,
  AOPStep,
  BrainToolRegistry,
  ValidationError,
  ValidationResult,
} from '../types.js';

function* walk(steps: ReadonlyArray<AOPStep>): Generator<AOPStep> {
  for (const step of steps) {
    yield step;
    if (step.kind === 'loop') yield* walk(step.body);
  }
}

/**
 * A "guarded" tool step is one whose graph-predecessor is a hook step of
 * kind `ask-owner` or `4-eye` and whose `on_approve` points to this tool.
 */
function findGuards(ast: AOP): Map<string, 'ask-owner' | '4-eye'> {
  const guards = new Map<string, 'ask-owner' | '4-eye'>();
  for (const step of walk(ast.steps)) {
    if (step.kind !== 'hook') continue;
    if (step.hook !== 'ask-owner' && step.hook !== '4-eye') continue;
    if (step.on_approve !== undefined) {
      guards.set(step.on_approve, step.hook);
    }
  }
  return guards;
}

/**
 * Known PII key names (lowercased + snake_case + kebab-case + camelCase
 * variants). Any args object that contains one of these keys at any depth
 * forces the AOP to declare an explicit `grants[]` entry.
 *
 * Conservative list — easy to extend. We deliberately don't try to be
 * exhaustive; the policy is "deny by default, allow with explicit grant".
 */
const PII_KEYS: ReadonlySet<string> = new Set([
  'kra_pin',
  'kra-pin',
  'krapin',
  'nin',
  'mpesa_pin',
  'mpesa-pin',
  'mpesapin',
  'huduma_number',
  'huduma-number',
  'hudumanumber',
  'national_id',
  'national-id',
  'nationalid',
  'tax_id',
  'tax-id',
  'taxid',
  'ssn',
  'passport_number',
  'passport-number',
  'passportnumber',
  'bvn',
  'card_number',
  'card-number',
  'cardnumber',
  'cvv',
  'pin',
]);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/\s+/g, '_');
}

/**
 * Walk a tool-args record recursively and collect every PII key encountered.
 * Returns a Set of the normalised key names (lowercased).
 */
function collectPiiKeys(args: unknown, seen: Set<string> = new Set()): Set<string> {
  if (args === null || args === undefined) return seen;
  if (typeof args !== 'object') return seen;
  if (Array.isArray(args)) {
    for (const item of args) collectPiiKeys(item, seen);
    return seen;
  }
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    const normalised = normaliseKey(k);
    if (PII_KEYS.has(normalised)) seen.add(normalised);
    collectPiiKeys(v, seen);
  }
  return seen;
}

export function validatePermissions(
  ast: AOP,
  registry: BrainToolRegistry,
): ValidationResult {
  const guards = findGuards(ast);
  const errors: ValidationError[] = [];

  // ── H4 — PII-key inspection (always on; independent of tier wiring) ──
  // Grants[] is an optional field on the AOP; if absent, treat as empty.
  const grants = new Set(
    Array.isArray((ast as AOP & { grants?: ReadonlyArray<string> }).grants)
      ? ((ast as AOP & { grants?: ReadonlyArray<string> }).grants ?? []).map(
          (g) => normaliseKey(String(g)),
        )
      : [],
  );

  for (const step of walk(ast.steps)) {
    if (step.kind !== 'tool') continue;

    // PII check.
    const found = collectPiiKeys(step.args);
    for (const key of found) {
      if (!grants.has(key)) {
        errors.push({
          code: 'pii-key-not-granted',
          message: `Tool step "${step.id}" passes PII key "${key}" in args but the AOP has no matching entry in grants[]. Add the key to grants[] to acknowledge the data flow.`,
          path: ['steps', step.id, 'args'],
        });
      }
    }

    // Destructive-guard check — fail-closed when tier() absent.
    const tier =
      registry.tier !== undefined
        ? registry.tier(step.tool)
        : ('destructive' as const);
    if (tier !== 'destructive') continue;
    if (!guards.has(step.id)) {
      errors.push({
        code: 'destructive-tool-unguarded',
        message:
          registry.tier === undefined
            ? `Tool "${step.tool}" (step "${step.id}") treated as DESTRUCTIVE because the registry exposes no tier() introspector; every tool must be preceded by an ask-owner or 4-eye hook with on_approve pointing at this step (fail-closed default)`
            : `Destructive tool "${step.tool}" (step "${step.id}") must be preceded by an ask-owner or 4-eye hook with on_approve pointing at this step`,
        path: ['steps', step.id],
      });
    }
  }

  return { ok: errors.length === 0, errors };
}
