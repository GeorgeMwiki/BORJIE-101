# @borjie/security-audit

Security-audit toolchain for the BORJIE monorepo. Three pillars:

1. **Static scanners** (`./src/scanners/`) — walk the repo for hardcoded
   tenant/org/user IDs, real-looking secrets, PII-leaking logger calls
   and `tenant_id` columns missing RLS.
2. **Cross-tenant regression harness** (`./src/regression/`) — reusable
   helpers + generated specs that prove tenant A cannot read/write
   tenant B's data through ANY route in the api-gateway.
3. **PII-redaction utilities** (`./src/redaction/`) — recursive
   `redactPII()` plus a `withPIIRedaction()` logger wrapper.

The package has zero runtime dependencies — every helper is pure-Node
so it can run inside CI without `pnpm install` against the rest of the
monorepo.

See `Docs/SECURITY_AUDIT_2026-05-24.md` for the latest findings report.
