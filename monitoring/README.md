# Borjie Monitoring

This directory contains the production observability stack for Borjie:
Prometheus alert rules, Grafana dashboards, Grafana provisioning, and the
Fluent Bit log shipper config. Every alert in this pack ships with a
`runbook_url` annotation pointing at `Docs/RUNBOOKS/<id>.md` — when the
pager wakes you, you should never have to think about where the playbook
lives.

```
monitoring/
  alerts/
    borjie-rules.yml      # Prometheus alert rules (10 alert classes)
  grafana-dashboards/         # JSON dashboards (overview, ai, payments, agent-spans)
  grafana-provisioning/       # Datasource + dashboard provisioning
  fluent-bit/                 # Fluent Bit pipeline for log shipping
  README.md                   # this file
```

## The 10 alerts and their runbooks

| Alert                            | Severity | Team        | Runbook                                                                 |
| -------------------------------- | -------- | ----------- | ----------------------------------------------------------------------- |
| `APIErrorRateHigh`               | page     | sre         | [api-error-rate-high.md](../Docs/RUNBOOKS/api-error-rate-high.md)               |
| `DBConnectionsExhausted`         | page     | sre         | [db-connections-exhausted.md](../Docs/RUNBOOKS/db-connections-exhausted.md)     |
| `AICostSpike`                    | ticket   | brain       | [ai-cost-spike.md](../Docs/RUNBOOKS/ai-cost-spike.md)                           |
| `MpesaWebhookBacklog`            | page     | payments    | [mpesa-webhook-backlog.md](../Docs/RUNBOOKS/mpesa-webhook-backlog.md)           |
| `BrainEventLagHigh`              | page     | brain       | [brain-event-lag-high.md](../Docs/RUNBOOKS/brain-event-lag-high.md)             |
| `PgvectorIndexBloat`             | ticket   | brain       | [pgvector-index-bloat.md](../Docs/RUNBOOKS/pgvector-index-bloat.md)             |
| `PodOOMKillBurst`                | page     | sre         | [pod-oom-kill-burst.md](../Docs/RUNBOOKS/pod-oom-kill-burst.md)                 |
| `RLSViolationAttempts`           | page     | sre         | [rls-violation-attempts.md](../Docs/RUNBOOKS/rls-violation-attempts.md)         |
| `ConstitutionRefuseClauseBurst`  | ticket   | brain-eval  | [constitution-refuse-clause-burst.md](../Docs/RUNBOOKS/constitution-refuse-clause-burst.md) |
| `BackupRestoreDrillFailure`      | ticket   | sre         | [backup-restore-drill-failure.md](../Docs/RUNBOOKS/backup-restore-drill-failure.md) |

Every rule carries:

- `annotations.runbook_url` — full URL on `docs.borjie.com/runbooks/<id>`.
- `annotations.summary` — one-line, used as the PagerDuty / Slack title.
- `annotations.description` — templated message with metric value + likely
  cause.
- `labels.severity` — `page` (wakes on-call), `ticket` (Slack #status-ops),
  or `info`.
- `labels.team` — `sre`, `brain`, `payments`, or `brain-eval`. Used by
  Alertmanager routing to fan out to the right channel.

## Loading the rules into Prometheus

### Bare-metal / VM Prometheus

Drop `alerts/borjie-rules.yml` next to your `prometheus.yml` and add
the path to `rule_files`:

```yaml
# prometheus.yml
rule_files:
  - "alerts/borjie-rules.yml"
```

Then either send `SIGHUP` to the Prometheus process or hit the reload
endpoint (requires `--web.enable-lifecycle`):

```sh
curl -X POST http://prometheus:9090/-/reload
```

### Kubernetes — kube-prometheus-stack (PrometheusRule)

Convert the rule file into a `PrometheusRule` CRD. The `groups:` block of
`borjie-rules.yml` becomes `spec.groups`:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: borjie-rules
  namespace: monitoring
  labels:
    prometheus: kube-prometheus
    role: alert-rules
spec:
  # paste the `groups:` content from borjie-rules.yml here
```

Apply with:

```sh
kubectl apply -f borjie-prometheus-rule.yaml
```

The Prometheus Operator picks up the CRD automatically — no reload needed.

### Validating before you reload

```sh
# 1. Syntax (recommended). Requires the promtool binary.
promtool check rules monitoring/alerts/borjie-rules.yml

# 2. Generic YAML lint.
python3 -m yamllint -d '{extends: default, rules: {line-length: {max: 200}}}' \
  monitoring/alerts/borjie-rules.yml

# 3. Unit tests (optional, requires fixtures).
promtool test rules monitoring/alerts/tests/*.yml
```

## Alertmanager routing snippet

Routes are keyed by `labels.team`. Example:

```yaml
# alertmanager.yml (excerpt)
route:
  receiver: 'default'
  group_by: ['alertname', 'team']
  routes:
    - matchers: [team="sre", severity="page"]
      receiver: 'pagerduty-sre'
    - matchers: [team="sre"]
      receiver: 'slack-status-ops'
    - matchers: [team="payments", severity="page"]
      receiver: 'pagerduty-payments'
    - matchers: [team="payments"]
      receiver: 'slack-payments-ops'
    - matchers: [team="brain", severity="page"]
      receiver: 'pagerduty-brain'
    - matchers: [team="brain"]
      receiver: 'slack-brain-platform'
    - matchers: [team="brain-eval"]
      receiver: 'slack-brain-eval'
```

## Adding a new alert

1. Add the rule to `monitoring/alerts/borjie-rules.yml` in the
   appropriate group (`borjie.api`, `borjie.database`, etc.).
2. Create `Docs/RUNBOOKS/<id>.md` matching the convention used by the
   existing 10 runbooks (`## Symptoms`, `## Suspect causes`, `## Diagnostics`,
   `## Immediate mitigation`, `## Permanent fix`, `## Escalation contact`).
3. Set `annotations.runbook_url` to
   `https://docs.borjie.com/runbooks/<id>` — the docs publisher mirrors
   `Docs/RUNBOOKS/` 1:1.
4. Append the alert to the table in this README and in
   `Docs/RUNBOOKS/README.md`.
5. Validate (`promtool check rules`, `yamllint`) before opening the PR.

## Related docs

- `Docs/RUNBOOK.md` — generic on-call playbook.
- `Docs/RUNBOOKS/incident-response.md` — first 15 minutes when paged.
- `Docs/OPERATIONS.md` — severity ladder + escalation matrix.
- `Docs/KPIS_AND_SLOS.md` — SLO definitions referenced by these alerts.
