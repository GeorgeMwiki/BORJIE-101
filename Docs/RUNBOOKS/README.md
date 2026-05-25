# Operational Runbooks Index

> Every production-grade operational procedure for Borjie.
> Audience: on-call SRE, platform admin, security responder, DPO.
> If you are paged at 3 AM, the runbook you need is in this index.

## Incident response

| Runbook | When to read |
|---|---|
| [incident-response.md](./incident-response.md) | Generic incident playbook — paging, comms, severity matrix |
| [killswitch.md](./killswitch.md) | Flipping the platform killswitch; blast-radius matrix |
| [audit-chain-verification.md](./audit-chain-verification.md) | Nightly audit-verifier cron alerts; suspected tamper |
| [dr-region-failover.md](./dr-region-failover.md) | Cross-region failover when primary is lost |

## Routine operations

| Runbook | When to read |
|---|---|
| [migration-production.md](./migration-production.md) | Applying DB migrations to prod safely |
| [backup-restore.md](./backup-restore.md) | Restore-from-backup procedures |
| [encryption-at-rest-key-rotation.md](./encryption-at-rest-key-rotation.md) | KEK / DEK rotation procedure |
| [cron-supervisor-debug.md](./cron-supervisor-debug.md) | Diagnosing stuck scheduled jobs |

## Customer + compliance

| Runbook | When to read |
|---|---|
| [tenant-onboarding.md](./tenant-onboarding.md) | New tenant setup, seeding, branding |
| [tenant-offboarding-rtbf.md](./tenant-offboarding-rtbf.md) | GDPR/PDPA RTBF cascade; offboarding |
| [four-eye-approval-review.md](./four-eye-approval-review.md) | Reviewing kernel-proposed sovereign actions |

## Cross-reference

- First-time live test: see [`Docs/SUPABASE_LIVE_TEST.md`](../SUPABASE_LIVE_TEST.md)
- Kernel boot smoke: see [`.planning/RUNBOOK.md`](../../.planning/RUNBOOK.md)
- Master docs index: see [`Docs/INDEX.md`](../INDEX.md)
