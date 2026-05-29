# Borjie Capability — Live Evidence Audit

**Date:** 2026-05-29
**Auditor:** Agent
**Method:** Live HTTP probes against the running api-gateway on `:4001`. Each capability is exercised end-to-end and its observable HTTP / DB / SSE result is captured.

**Auth context:**
- JWT secret: `test-secret-for-dev-only-32chars` (HS256)
- Demo tenant: `00000000-0000-0000-0000-000000000001`
- Tokens minted with role `OWNER` / `ADMIN` as needed.

This document is GENERATED, then maintained — each section is independently re-runnable.

---

## Summary Table

(Filled in at the end; placeholder until all sections run.)

| Capability category | Total | Passing | Failing |
|---|---|---|---|
| §1 Superpowers | 8 | TBD | TBD |
| §2 Dynamic tab types | 32 | TBD | TBD |
| §3 Inline blocks | 16 | TBD | TBD |
| §4 Blackboard primitives | 9 | TBD | TBD |
| §5 Cron workers | 7 | TBD | TBD |
| §6 Opportunity rules | 33 | TBD | TBD |
| §6 Risk rules | 33 | TBD | TBD |
| §7 Brain tools | TBD | TBD | TBD |
| §8 MCP server | TBD | TBD | TBD |
| §9 CLI commands | TBD | TBD | TBD |
| §10 Closed-loop telemetry | 1 | TBD | TBD |
| §11 Decision journal | 1 | TBD | TBD |
| §12 Entity index | 1 | TBD | TBD |

## DO NOT SHIP list

(Populated after evidence is captured.)

---

(Sections populated by subsequent commits.)
