# @borjie/security-hardening

General security hardening package for BORJIE. Ships seven self-contained
subsystems behind small, dependency-light factory functions:

| Subsystem        | Path                          | Responsibility                                        |
| ---------------- | ----------------------------- | ----------------------------------------------------- |
| WebAuthn         | `src/webauthn/`               | Passkey + FIDO2 registration + authentication         |
| MFA              | `src/mfa/`                    | TOTP secret/QR/verify + step-up orchestrator          |
| Browser headers  | `src/headers/`                | CSP / COEP / COOP / CORP / Permissions-Policy / HSTS  |
| Rate limit       | `src/rate-limit/`             | Token bucket + sliding window (memory/Redis port)     |
| Anomaly          | `src/anomaly/`                | Impossible travel + unusual hours + device drift      |
| Credential       | `src/credential-checks/`      | HIBP k-anonymity + credential-stuffing detector       |
| Public surface   | `src/index.ts`                | One-stop `createSecurityHardening(...)` factory       |

All factories accept an optional `now: () => number` clock and an optional
store/network port so they are unit-testable without external dependencies.

See `Docs/SECURITY_HARDENING_RESEARCH_2026-05-24.md` for the design rationale
and the 12+ cited 2026 sources behind each subsystem.
