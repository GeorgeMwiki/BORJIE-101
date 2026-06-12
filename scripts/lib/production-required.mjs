/**
 * production-required.mjs — the SINGLE source of truth for the production
 * credential set, shared by the standalone CLIs:
 *   - scripts/preflight-production.mjs  (PRESENT vs MISSING report)
 *   - scripts/set-gh-secrets.mjs        (push present secrets to GH Actions)
 *
 * This mirrors `PRODUCTION_REQUIRED` in
 * services/api-gateway/src/config/validate-env.ts. The two are kept in lockstep
 * by scripts/__tests__/production-required-parity.test.mjs, which parses the TS
 * source and asserts the label sets are identical — so a new prod-required key
 * added to the gateway schema fails CI until it is also added here.
 *
 * Pure ESM, zero deps. A requirement is SATISFIED when ANY of its `keys` is a
 * non-empty (trimmed) string — `keys` lists aliases (e.g. the gateway accepts
 * either `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`). `keys[0]` is the
 * canonical name a secret store / GitHub Actions secret should use.
 */

/**
 * @typedef {Object} ProductionRequirement
 * @property {string} label  Operator-facing requirement name (canonical).
 * @property {ReadonlyArray<string>} keys  Env keys that satisfy it (aliases).
 * @property {string} why  One-line reason, shown in CLI output.
 */

/** @type {ReadonlyArray<ProductionRequirement>} */
export const PRODUCTION_REQUIRED = Object.freeze([
  {
    label: 'DATABASE_URL',
    keys: ['DATABASE_URL'],
    why: 'Primary Postgres connection — gateway cannot reach the DB without it.',
  },
  {
    label: 'JWT_SECRET',
    keys: ['JWT_SECRET'],
    why: 'HS256 access-token signing root (>= 32 chars).',
  },
  {
    label: 'SUPABASE_URL',
    keys: ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL'],
    why: 'Supabase project URL — server auth + storage. Either alias satisfies.',
  },
  {
    label: 'SUPABASE_ANON_KEY',
    keys: ['SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    why: 'Supabase anon key — public auth path. Either alias satisfies.',
  },
  {
    label: 'SUPABASE_SERVICE_ROLE_KEY',
    keys: ['SUPABASE_SERVICE_ROLE_KEY'],
    why: 'Server-only key (bypasses RLS) — required by storage + signup wiring.',
  },
  {
    label: 'SUPABASE_JWT_SECRET',
    keys: ['SUPABASE_JWT_SECRET'],
    why: 'Canonical auth — the verified-JWT middleware fails closed without it.',
  },
  {
    label: 'ANTHROPIC_API_KEY',
    keys: ['ANTHROPIC_API_KEY'],
    why: 'Primary LLM provider — the brain kernel cannot think without it.',
  },
  {
    label: 'SESSION_HASH_SECRET',
    keys: ['SESSION_HASH_SECRET'],
    why: 'Audit hash-chain HMAC root — degrades to forge-able SHA-256 if unset.',
  },
]);

/**
 * isSatisfied — true when ANY alias key for a requirement is a non-empty
 * (trimmed) string in `source`.
 *
 * @param {ProductionRequirement} req
 * @param {Record<string, string | undefined>} source
 * @returns {boolean}
 */
export function isSatisfied(req, source) {
  return req.keys.some((k) => {
    const v = source[k];
    return typeof v === 'string' && v.trim() !== '';
  });
}

/**
 * partitionRequirements — split the required set into present vs missing for a
 * given env source. Pure; returns fresh arrays (no mutation).
 *
 * @param {Record<string, string | undefined>} source
 * @returns {{ present: ReadonlyArray<ProductionRequirement>, missing: ReadonlyArray<ProductionRequirement> }}
 */
export function partitionRequirements(source) {
  const present = [];
  const missing = [];
  for (const req of PRODUCTION_REQUIRED) {
    if (isSatisfied(req, source)) present.push(req);
    else missing.push(req);
  }
  return { present, missing };
}

/**
 * presentCanonicalKeys — for `set-gh-secrets`: the canonical key name
 * (`keys[0]`) of every requirement satisfied in `source`, plus any non-first
 * alias that is actually the one populated (so we set the exact key the
 * operator filled). Returns the concrete env keys present, de-duplicated.
 *
 * @param {Record<string, string | undefined>} source
 * @returns {ReadonlyArray<string>}
 */
export function presentCanonicalKeys(source) {
  const out = [];
  for (const req of PRODUCTION_REQUIRED) {
    for (const k of req.keys) {
      const v = source[k];
      if (typeof v === 'string' && v.trim() !== '') {
        if (!out.includes(k)) out.push(k);
        break; // one alias per requirement is enough
      }
    }
  }
  return out;
}
