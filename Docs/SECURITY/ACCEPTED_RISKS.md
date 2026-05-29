# Accepted Security Risks

**Last review:** 2026-05-29
**Owner:** Security / Platform team

This document records `pnpm audit` advisories that are deliberately
accepted (with mitigations) because the fix is either not available
upstream or would require a breaking transitive-toolchain upgrade.
Every entry must include: severity, dep path, justification, exposure
analysis, mitigation, next-review.

The `scripts/audit-with-allowlist.mjs` gate fails CI on any HIGH or
CRITICAL advisory not registered in its in-code allowlist. The entries
below cover only LOW and MODERATE advisories — neither blocks CI but
both are tracked so they cannot be quietly forgotten.

---

## Active accepted risks

### A-001 — `send@0.18.0` (LOW) — template injection in redirect

| Field | Value |
| ----- | ----- |
| Advisory | https://github.com/advisories/GHSA-m6fv-jmcg-4jfg |
| Severity | LOW (CVSS 5.0) |
| Patched in | `send >= 0.19.0` |
| Vulnerable path | `apps/{buyer,workforce}-mobile > expo@51.0.39 > @expo/cli@0.18.31 > send@0.18.0` |
| Exposure | None at runtime — `send` is pulled in by `@expo/cli`, the developer-only Expo CLI bundled into the Expo Go workflow. Production app bundles do not ship `@expo/cli` or `send`; the Expo CLI runs only on developer machines. |
| Mitigation | Expo 52 ships `@expo/cli@>0.18.31` which pulls `send@>=0.19.0`. Upgrading Expo 51 → 52 is tracked in `Docs/ROADMAP.md` (mobile platform upgrade) and not within the launch-readiness scope. Until then, the only callers of `send` are CLI dev tools. |
| Next review | 2026-Q3 (with Expo 52 upgrade) |

### A-002 — `vite@5.4.21` (MODERATE) — path traversal in dev-server optimized-deps `.map`

| Field | Value |
| ----- | ----- |
| Advisory | https://github.com/advisories/GHSA-jqfw-vq24-v9c3 |
| Severity | MODERATE (CVSS 6.5) |
| Patched in | `vite >= 6.4.2` |
| Vulnerable path | `packages/recommendations > vitest@2.1.9 > @vitest/mocker@2.1.9 > vite@5.4.21` |
| Exposure | None at runtime — `vite` is a test-time dependency of `vitest@2.1.9`, used only by `packages/recommendations` test runs. No application code ships Vite. The CVE requires the attacker to reach a running Vite dev server, which never starts in production or CI builds. |
| Mitigation | `packages/recommendations` is pinned to `vitest@2.1.9` because the package's own test rig requires features that were removed in vitest 3. The workspace-wide migration to `vitest@4` (root devDependency) is tracked under the same `Docs/ROADMAP.md` migration epic. The remaining vitest 2 island is the only blocker for retiring vite 5. |
| Next review | 2026-Q3 (with vitest migration) |

---

## Risk-acceptance checklist

When adding an entry here:

1. Confirm the advisory cannot be fixed by adding a `pnpm.overrides`
   entry in `package.json`.
2. Trace the dep chain — record the literal path from
   `pnpm audit --json`.
3. Confirm there is no production attack surface (server, mobile
   release bundle, CI runner).
4. Document the upgrade path that will close the entry.
5. Set a `next_review` date no further out than 6 months.
6. Open a tracking issue or roadmap line so the entry has an owner.

## Out-of-band scans

The `pnpm audit` allowlist (in `scripts/audit-with-allowlist.mjs`) is
the gate for HIGH+ npm advisories. Additional scanners that may flag
unrelated risks:

- `gitleaks detect` — secret scan, runs in `security.yml`.
- `trivy fs .` — CVE scan, runs in `ci.yml > security-scan` job.
- `semgrep` — taint analysis, runs in `strict-ci.yml`.
- `codeql` — runs in `codeql.yml`.

If any of those flags an issue we cannot remediate, append a new
section here so the decision trail is one document.
