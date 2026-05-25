# PagerDuty — Infrastructure-as-Code

Source-of-truth YAML for BORJIE PagerDuty services and escalation
policies. The PagerDuty UI is read-only at the org level for everyone
except the on-call manager — every change MUST go through this directory
and be reviewed.

## Files

| File | Purpose |
|---|---|
| `services.yaml` | One `Service` document per BORJIE service. Severity routing, integration list, ack/auto-resolve timers. |
| `escalation-policies.yaml` | Named escalation chains referenced by `services.yaml`. |

Service names in `services.yaml` mirror the operational service boundary
in `Docs/ARCHITECTURE.md`. Adding a new service to the platform means
adding a `Service` document here AND a corresponding row in
`Docs/OPERATIONS.md §6`.

## Applying via Terraform (preferred)

```bash
cd infra/terraform/pagerduty
terraform init
terraform plan  -var "pagerduty_token=$PAGERDUTY_API_TOKEN"
terraform apply -var "pagerduty_token=$PAGERDUTY_API_TOKEN"
```

The Terraform module reads both YAML files and produces a
`pagerduty_service` + `pagerduty_escalation_policy` per document. Schedule
names are resolved at plan-time against the live PagerDuty org; if a name
doesn't exist, plan fails closed.

## Applying via `pdc-cli` (one-off, no Terraform)

`pdc-cli` is the official PagerDuty CLI. It accepts the same multi-document
YAML format we use here.

```bash
pdc-cli auth login                               # OAuth flow, one-time
pdc-cli services apply -f services.yaml
pdc-cli escalation-policies apply -f escalation-policies.yaml
```

Run `pdc-cli services diff -f services.yaml` before `apply` to see exactly
what will change. CI also runs `diff` on every PR that touches this
directory and posts the output as a comment.

## Severity routing convention

Every service uses the same four-tier mapping (`critical`, `error`,
`warning`, `info`):

- `critical` -> paging incident, urgency `high`, SLA 5–15 min
- `error` -> paging incident, urgency `high`/`low` by service
- `warning` -> Slack `#status-ops`, no page
- `info` -> log only, no page

Alert sources MUST translate their own severity to one of these four
values via the Events API v2 payload field. The mapping lives in:

- Prometheus alertmanager: `infra/alerts/alertmanager.yml`
- Sentry: project alert rules (UI; no IaC yet — JIRA OPS-414)
- CloudWatch: `infra/terraform/modules/alarms/`

## Adding a new service

1. Append a new `Service` document to `services.yaml`. Keep the alphabetical
   ordering by `metadata.name`.
2. If the service needs a new escalation chain, add a matching
   `EscalationPolicy` document to `escalation-policies.yaml` and reference
   it from the new service.
3. Add a row to `Docs/OPERATIONS.md §6` (the contacts table) so on-call
   responders know who answers the new pager.
4. PR title MUST start with `chore(pagerduty):` to trigger the CI diff
   step.

## Drift detection

A nightly GitHub Action (`.github/workflows/pagerduty-drift.yml`) runs
`pdc-cli services diff` against this directory and opens an issue if drift
is detected. Drift is almost always a sign someone clicked in the UI —
which is the failure mode this IaC repository exists to prevent.
