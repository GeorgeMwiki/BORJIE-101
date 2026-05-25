# Dependency Hygiene

This document tracks accepted-risk dependency advisories that are
allowlisted in `scripts/audit-with-allowlist.mjs`. Each entry includes
the rationale, the codebase audit confirming the risk does not apply
to our usage patterns, and the next review date.

The allowlist is consulted by:

- `.github/workflows/pr-check.yml` — PR `Security Check` job
- `.github/workflows/security-scan.yml` — `Dependency Audit (pnpm audit)` job

Both run `node scripts/audit-with-allowlist.mjs` instead of the raw
`pnpm audit --audit-level=high`. The wrapper exits 0 only when every
high+ advisory is in the allowlist; new advisories outside the
allowlist fail the build immediately.

## Status snapshot

After wave-5 dep hygiene push (commit ahead of `main`):

| Severity | Count | Notes |
|---|---|---|
| critical | 0 | — |
| high | 2 | Both allowlisted: `lodash`, `drizzle-orm` |
| moderate | 1 | `lodash` (informational; not blocking) |
| low | 0 | — |

53 total advisories (3 low / 31 moderate / 19 high) reduced to 3 via
`pnpm.overrides` patches in the root `package.json`. The override
patches force-bump transitive deps to fixed versions for: minimatch,
path-to-regexp, node-forge, picomatch, axios, fast-uri, fast-xml-builder,
esbuild, ajv, brace-expansion, vite, follow-redirects, postcss,
next-intl, uuid, ip-address, hono, @tootallnate/once.

## Allowlisted advisories

### 1. `lodash` (high + moderate)

**Advisory IDs**:
- `_.template` Code Injection (high)
- `_.unset` Prototype Pollution via array-path bypass (moderate)

**Vulnerable**: `>=4.0.0 <=4.17.23` (we use `4.17.21`).

**Patched version**: `>=4.18.0` — **does not exist on npm**. Latest
published lodash is `4.17.21`. The patch was proposed but never
released as a 4.x bump; the recommended remediation is to migrate to
`lodash-es` per-function imports, or upgrade individual call sites
where untrusted input is involved.

**Codebase audit (2026-05-09)**:
- `_.template` callers in our code: 0 calls accept untrusted input.
  All template strings are hardcoded literals.
- `_.unset` callers: limited to internal state mutations on
  controlled objects, no caller-supplied paths.

**Mitigation**: Lodash usage is constrained to `_.merge`, `_.pick`,
`_.omit`, `_.debounce`, `_.throttle` and similar pure-function
utilities. None of the vulnerable code paths are reachable.

**Tracked in**: this document.

**Next review**: 2026-Q3 — re-audit usage; consider per-function
`lodash.<fn>` imports to drop the umbrella package.

### 2. `drizzle-orm` (high)

**Advisory ID**: SQL injection via improperly-escaped SQL identifiers.

**Vulnerable**: `<0.45.2` (we use `0.36.4`, pinned in
`pnpm.overrides`).

**Patched version**: `>=0.45.2`. The fix is a major-version-style
upgrade (0.36 → 0.45) with breaking schema-builder changes.

**Codebase audit (2026-05-09)**:
- The advisory applies when callers pass tenant-controlled identifier
  strings (table/column names) into raw SQL templates. Our code uses
  Drizzle's typed schema builders end-to-end; raw `sql` template
  interpolation is reserved for static identifiers (verified across
  every call site in `services/`, `packages/database/src/services/`,
  and `services/api-gateway/src/services/monthly-close/`).
- Tenant data flows through parameterised queries only.

**Mitigation**: Audit confirmed no caller-tenant-controlled
identifiers reach the raw-SQL surface. Identifier interpolation is
constrained to compile-time-known strings.

**Tracked in**: this document.

**Next review**: 2026-Q2 — schedule the 0.36 → 0.45 migration as a
focused PR with schema diffing + test sweep.

## Removing an entry

Once an upstream patch is consumable (e.g. drizzle-orm 0.45 migration
ships, or lodash-es replaces lodash), update the allowlist in
`scripts/audit-with-allowlist.mjs` and the `pnpm.overrides` block in
the root `package.json`. The wrapper script will start failing on any
matching advisory the moment the entry is removed.

## Adding a new entry

A new entry must include:

1. The package name and severity range.
2. The vulnerable + patched version ranges.
3. A codebase audit confirming the vulnerable code path is unreachable
   in our usage.
4. A mitigation summary.
5. A `tracked_in` reference (this document or a JIRA/issue link).
6. A `next_review` date (quarterly cadence).

Entries without a code audit must NOT be allowlisted — fix or upgrade
instead.
