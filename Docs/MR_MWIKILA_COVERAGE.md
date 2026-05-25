# Mr. Mwikila — Admin-Write Coverage Matrix

Goal: every meaningful admin write action is achievable by asking Mr. Mwikila — not only by navigating to an admin page.

Legend:
- **Nav** — admin-portal URL path (manual click-path)
- **Chat** — whether Mr. Mwikila has a skill that wraps the action (Y = yes via tool dispatcher; N = nav-only; P = proposed-action only, user must approve)
- **Test** — E2E spec covering chat-driven invocation

Coverage target: **90%+** of admin-write actions reachable by chat.

---

## Core property operations

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Create property | `/admin/properties/new` | Y | `skill.estate.property.create` | `e2e/tests/brain-chat-admin.spec.ts` |
| Update property | `/admin/properties/:id` | Y | `skill.estate.property.update` | same |
| Delete/retire property | `/admin/properties/:id` | P | `skill.estate.property.retire` (proposes, requires approve) | `admin-operations.spec.ts` |
| Create unit | `/admin/units/new` | Y | `skill.estate.unit.create` | `properties.spec.ts` |
| Update unit | `/admin/units/:id` | Y | `skill.estate.unit.update` | same |
| Import properties CSV | `/admin/migration` | Y | `skill.domain.migration.import` | `progressive-migration.spec.ts` |
| Commit migration | `/admin/migration` | P | `skill.domain.migration-commit` | same |

## Leases + tenants

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Create lease | `/admin/leases/new` | Y | `skill.leasing.abstract` + `skill.leasing.create` | `leases.spec.ts` |
| Renew lease | `/admin/leases/:id/renew` | P | `skill.leasing.renewal_propose` | `real-llm/training-generate.spec.ts` (adjacent) |
| Terminate lease | `/admin/leases/:id/terminate` | P | `skill.leasing.terminate` | `leases.spec.ts` |
| Onboard tenant | `/admin/tenants/new` | Y | `skill.domain.leasing.onboard_tenant` | `tenant-onboarding.spec.ts` |
| Update tenant | `/admin/tenants/:id` | Y | `skill.domain.leasing.update_tenant` | same |
| Mark tenant vacated | `/admin/tenants/:id` | P | `skill.domain.leasing.mark_vacated` | same |

## Maintenance + work orders

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Create work order | `/admin/work-orders/new` | Y | `skill.domain.maintenance.create` | `maintenance.spec.ts` |
| Assign vendor | `/admin/work-orders/:id/assign` | Y | `skill.domain.maintenance.assign` | same |
| Close work order | `/admin/work-orders/:id/close` | P | `skill.domain.maintenance.close` | same |
| Schedule inspection | `/admin/inspections/new` | Y | `skill.domain.maintenance.schedule_inspection` | `maintenance-flow.spec.ts` |
| Rate vendor | `/admin/vendors/:id/rate` | Y | `skill.domain.maintenance.rate_vendor` | same |

## Payments + arrears

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Record payment | `/admin/payments/new` | Y | `skill.domain.finance.record_payment` | `payments.spec.ts` |
| Issue invoice | `/admin/invoices/new` | Y | `skill.domain.finance.issue_invoice` | same |
| Apply late fee | `/admin/arrears/:id/late-fee` | P | `skill.domain.finance.apply_late_fee` | `arrears-triage.spec.ts` |
| Send arrears reminder | `/admin/arrears/remind` | Y | `skill.domain.comms.send_arrears_reminder` | `real-llm/marketing-consultant.spec.ts` |
| Refund payment | `/admin/payments/:id/refund` | P | `skill.domain.finance.refund` | `payments.spec.ts` |
| Reconcile M-Pesa | `/admin/reconcile/mpesa` | Y | `skill.kenya.mpesa_reconcile` | `payments.spec.ts` |
| GePG invoice create | `/admin/payments/gepg` | Y | `skill.domain.finance.gepg_create` | `payments.spec.ts` |

## Communications

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Send broadcast SMS | `/admin/messaging/broadcast` | Y | `skill.domain.comms.broadcast` | `admin-operations.spec.ts` |
| Send individual SMS | `/admin/messaging/send` | Y | `skill.domain.comms.send_sms` | same |
| Draft letter | `/admin/letters/new` | Y | `skill.domain.comms.draft_letter` | `real-llm/brain-turn-real.spec.ts` |
| Set notification preferences | `/admin/settings/notifications` | Y | `skill.domain.comms.set_prefs` | `admin-portal.spec.ts` |

## Training + onboarding

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Generate training path | `/admin/training/generate` | Y | `skill.classroom.generate_path` | `real-llm/training-generate.spec.ts` |
| Assign training | `/admin/training/assign` | Y | `skill.classroom.assign` | same |
| Mark training complete | `/admin/training/:id/complete` | Y | `skill.classroom.mark_complete` | same |
| Certify agent | `/admin/agent-certifications/new` | P | `skill.classroom.certify` | `admin-portal.spec.ts` |

## Compliance + reporting

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Generate risk report | `/admin/reports/risk` | Y | `skill.domain.reports.risk_generate` | `real-llm/brain-turn-real.spec.ts` |
| Export compliance bundle | `/admin/compliance/export` | Y | `skill.domain.compliance.export` | `admin-operations.spec.ts` |
| Acknowledge GDPR request | `/admin/gdpr/:id/ack` | P | `skill.domain.compliance.gdpr_ack` | `admin-operations.spec.ts` |
| Request data erasure | `/admin/gdpr/erase` | P | `skill.domain.compliance.gdpr_erase` | same |
| Interactive reports | `/admin/reports/interactive` | Y | `skill.domain.reports.interactive` | `owner-dashboard.spec.ts` |
| KRA rental summary | `/admin/reports/kra` | Y | `skill.kenya.kra_rental_summary` | `admin-operations.spec.ts` |

## User + organisation admin

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Invite user | `/admin/users/invite` | Y | `skill.domain.hr.invite_user` | `auth.spec.ts` |
| Change user role | `/admin/users/:id/role` | P | `skill.domain.hr.change_role` | `admin-operations.spec.ts` |
| Deactivate user | `/admin/users/:id/deactivate` | P | `skill.domain.hr.deactivate` | same |
| Reset user password | `/admin/users/:id/reset-password` | P | `skill.domain.hr.reset_password` | `auth.spec.ts` |
| Create tenant org | `/admin/organisations/new` | Y | `skill.domain.hr.create_org` (super-admin only) | `admin-portal.spec.ts` |
| Set feature flag | `/admin/feature-flags` | Y | `skill.domain.compliance.feature_flag_set` | `admin-operations.spec.ts` |

## Advanced / super-admin

| Action | Nav | Chat | Skill | Test |
|---|---|:-:|---|---|
| Impersonate tenant | `/admin/su/impersonate/:id` | N | -- (security: intentionally nav-only + MFA) | `admin-portal.spec.ts` |
| Replay webhook | `/admin/webhooks/:id/replay` | P | `skill.domain.comms.replay_webhook` | `admin-operations.spec.ts` |
| Reprocess payment | `/admin/payments/:id/reprocess` | P | `skill.domain.finance.reprocess` | `payments.spec.ts` |
| Drain outbox | `/admin/outbox/drain` | P | `skill.domain.comms.drain_outbox` | `admin-operations.spec.ts` |
| Run background job | `/admin/jobs/run` | P | `skill.domain.hr.run_job` | same |

---

## Wave-14 admin-skill additions

The following `skill.admin.*` tools were added in Wave-14 to close direct-write gaps
and integrate with autonomy + training subsystems. Each is wired into
`ADMIN_SKILL_TOOLS` (see `packages/ai-copilot/src/skills/admin/index.ts`) and
registered by `registerDefaultSkills`.

| Skill | Risk gate | Integrates with |
|---|---|---|
| `skill.admin.create_case` | committed | maintenance taxonomy |
| `skill.admin.assign_work_order` | PROPOSED > KES 100k | vendor directory |
| `skill.admin.approve_lease_renewal` | PROPOSED > 10% rent delta | leasing renewal queue |
| `skill.admin.send_rent_reminder` | PROPOSED > 25 recipients | comms broker |
| `skill.admin.draft_owner_statement` | committed (draft only) | finance rollup |
| `skill.admin.approve_tender_bid` | PROPOSED >= KES 500k | tender scoring output |
| `skill.admin.resolve_arrears_case` | PROPOSED >= KES 20k or write_off | arrears register |
| `skill.admin.reissue_letter` | PROPOSED always (tenant-facing) | letters service |
| `skill.admin.update_property_fields` | committed (allow-listed fields) | property registry |
| `skill.admin.assign_training` | PROPOSED > 25 assignees | Wave-13 training paths |
| `skill.admin.acknowledge_exception` | committed | Wave-14 autonomy exceptions |
| `skill.admin.update_autonomy_policy` | PROPOSED always (org-wide) | Wave-14 autonomy engine |

## Coverage summary

| Bucket | Actions | Chat-enabled | Coverage |
|---|:-:|:-:|:-:|
| Core property | 7 | 7 | 100% |
| Leases + tenants | 6 | 6 | 100% |
| Maintenance | 5 | 5 | 100% |
| Payments | 7 | 7 | 100% |
| Communications | 4 | 4 | 100% |
| Training | 4 | 4 | 100% |
| Compliance | 6 | 6 | 100% |
| Users + org | 6 | 6 | 100% |
| Advanced | 5 | 4 | 80% (impersonation intentionally excluded) |
| Admin (Wave-14) | 12 | 12 | 100% |
| **Total** | **62** | **61** | **98.4%** |

Before Wave-14: 50 actions / 49 chat-enabled = 98%.
After Wave-14: 62 actions / 61 chat-enabled = 98.4% — well above the 90% target.
Twelve new `skill.admin.*` tools added, each with tenant-isolation + (where applicable)
PROPOSED_ACTION gates.

Only `impersonate tenant` is intentionally chat-exempt — super-admin impersonation requires MFA + navigation to `/admin/su/impersonate` by design (defense-in-depth).

## How it's wired

1. Skill definitions under `packages/ai-copilot/src/skills/**`
2. Tool dispatcher in `packages/ai-copilot/src/intelligence-orchestrator/tool-dispatcher.ts`
3. Progressive-intelligence accumulator: `packages/ai-copilot/src/progressive-intelligence/action-accumulator.ts`
4. Proposed-action gate: every `P`-flagged action asks the user to confirm before the gateway writes
5. Gateway tool endpoint: `POST /api/v1/ai-chat/tools/:skill` (admin-auth + audit-logged)

## Re-audit schedule

Re-run this matrix after every minor release (scripted via `scripts/audit-mwikila-coverage.ts`).
