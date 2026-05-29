# Borjie HPA + Capacity Plan

**Last updated:** 2026-05-29
**Owner:** SRE / Platform
**Status:** Gap-3 (G-FIX-3) — initial baseline. Re-evaluate quarterly
and after every >20 % pilot-tenant growth.

This document defines the per-tenant baseline load model, container
resource limits, replica-count math, scale-up triggers, and a 12-month
cost projection for Borjie's production fleet. It is the input for
the Kubernetes HorizontalPodAutoscaler (HPA) manifests that ship in
`infra/k8s/hpa-*.yaml` and for the dashboards in
`packages/observability/src/metrics/`.

> Bilingual disclaimer (sw): Hati hii hutoa msingi wa upimaji wa uwezo
> wa Borjie kwa kila mteja. Inatumika kuweka kikomo cha replicas na
> bajeti ya rasilimali kwa Kubernetes HPA.

---

## 1. Per-tenant baseline (typical artisanal-to-mid-tier mining org)

These numbers are the result of the W-WIRE-Cognitive + LIVE-Smoke
profiling runs and the pilot tenant (Mwamba demo) over the past 30
days. They represent a "typical" Borjie customer — 1 active owner,
~3 site managers, ~25 workers, ~5 buyer counterparties.

| Domain               | Daily-volume (rows/day) | Peak rate (rows/min) | Notes                                              |
| -------------------- | ----------------------- | -------------------- | -------------------------------------------------- |
| `shift_reports`      | 6                       | 1                    | One per active site per shift (3 shifts × 2 sites) |
| `incidents`          | 0.5                     | 1 (event-driven)     | Spiky; safety pulse weeks see 10×                  |
| `attendance`         | 50                      | 5                    | Worker clock-in / clock-out                        |
| `sales`              | 4                       | 2 (closing window)   | Bursts at mineral pickup time                      |
| `payouts`            | 25                      | 4                    | Weekly payroll burst → 100/min                     |
| `decisions_recorded` | 35                      | 5                    | Owner + manager decision-journal cadence           |
| `owner_brief_*`      | 1 / cron                | 1 / cron             | Daily 06:00 EAT cron only                          |
| `documents_uploaded` | 12                      | 3                    | Mostly KYC + licence renewals                      |
| `brain.turn`         | 150                     | 12                   | Chat usage; expect 2× during PMO weeks             |
| `webhooks.mpesa.*`   | 35                      | 8                    | Tracks payouts + customer pays                     |
| `cockpit.sse.frames` | 800                     | 60                   | All event-bus emissions multiplexed                |

**Conversion notes:**
- `peak rate / daily-volume × 24 × 60` gives a peakedness factor; we
  size for `2 ×` peakedness to absorb fortnightly payroll Mondays.
- The brain.turn rate already includes the 5 hot tool calls per
  turn — those amplify into ~60 `tools.exec` calls/min at peak.

---

## 2. Container CPU + memory limits

The limits below are the production manifests at
`infra/k8s/*-deployment.yaml`. Resource requests are deliberately
~70 % of limits so HPA can react before the kernel starts throttling.

| Service                  | CPU request | CPU limit | Mem request | Mem limit | Notes                                       |
| ------------------------ | ----------- | --------- | ----------- | --------- | ------------------------------------------- |
| `api-gateway`            | 500m        | 1000m     | 768Mi       | 1.5Gi     | Pino + Hono + brain-tools                   |
| `payments-ledger`        | 300m        | 600m      | 384Mi       | 768Mi     | Drizzle + ledger writer                     |
| `consolidation-worker`   | 250m        | 500m      | 384Mi       | 768Mi     | Cron host (owner-brief, retro)              |
| `marketing-web` (Next)   | 200m        | 400m      | 256Mi       | 512Mi     | SSR cache-heavy                             |
| `owner-web` (Next)       | 300m        | 600m      | 384Mi       | 768Mi     | SSR + RealtimeLatencyBadge                  |
| `admin-web` (Next)       | 200m        | 400m      | 256Mi       | 512Mi     | Internal — low traffic                      |
| `otel-collector`         | 100m        | 250m      | 192Mi       | 384Mi     | Sidecar collector                           |
| `redis` (idempotency)    | 100m        | 250m      | 256Mi       | 512Mi     | LRU 100 MB                                  |
| `pg-pooler` (pgBouncer)  | 100m        | 200m      | 128Mi       | 256Mi     | 1 pool per gateway replica                  |

JVM-free posture — all services are Node 22 + native binaries. There
is no need to budget JVM heap headroom.

---

## 3. Replica-count math (closed-form)

For each service, the desired replica count R is derived from:

```
R = ceil( max(
    peak_qps × p99_latency_s / target_cpu_per_replica,
    peak_memory_mb / mem_per_replica
) × redundancy_factor )
```

Where:
- `peak_qps` = peak per-tenant rate × active tenants × 2× peakedness
- `p99_latency_s` = SLO p99 from `Docs/OPS/SLO_ATTESTATION_2026-05-29.md`
- `target_cpu_per_replica` = 700m (70 % of limit)
- `mem_per_replica` = `mem_limit - 128 MB` headroom
- `redundancy_factor` = 1.25 (one replica may rolling-restart at any time)

### 3.1 Worked example — `api-gateway` @ 50 active tenants

- peak_qps = (12 brain.turn + 60 tools + 60 sse) × 50 × 2 = **13 200 QPS**
  spread across 4 sub-paths.
- Steady-state brain.turn p99 = 3 s, tools p99 = 1.5 s, dashboard
  reads p99 = 0.8 s (per SLO doc).
- Effective CPU ≈ 13 200 × 0.05 s (median CPU cost per request) ÷ 0.7
  = **943 CPU-seconds/s** = ~14 replicas raw.
- Add 25 % redundancy → **18 replicas**.
- Memory side: 13 200 × 8 KB working set ≈ 105 MB — non-binding.

### 3.2 Service-by-service planned replicas (50 active tenants)

| Service                | Min | Max | Notes                                         |
| ---------------------- | --- | --- | --------------------------------------------- |
| `api-gateway`          | 4   | 24  | brain.turn drives                             |
| `payments-ledger`      | 2   | 8   | M-Pesa STK callback burst                     |
| `consolidation-worker` | 2   | 4   | Cron schedule — singleton-leader              |
| `owner-web`            | 2   | 6   | SSR + ISR cached                              |
| `admin-web`            | 1   | 2   | Internal only                                 |
| `marketing-web`        | 2   | 4   | CDN absorbs most traffic                      |
| `otel-collector`       | 1   | 3   | Per-AZ                                        |

---

## 4. Scale-up triggers (HPA spec)

All triggers are encoded as `metric-based` HPAs that target the
following signals. The first signal to breach drives the scale event;
multiple signals trigger the maximum requested replica count.

### 4.1 `api-gateway`

| Trigger metric                                    | Threshold | Cooldown | Reason                                                         |
| ------------------------------------------------- | --------- | -------- | -------------------------------------------------------------- |
| CPU utilisation (avg over 60s)                    | >70 %     | 60s up / 5m down | Default Kubernetes HPA signal                            |
| `http_request_duration_seconds{quantile="0.99"}`  | >2.5s     | 90s up / 5m down | Per-replica latency proxy for crowded event-loop         |
| `nodejs_eventloop_lag_seconds{quantile="0.99"}`   | >0.2s     | 30s up / 3m down | Event-loop saturation — earlier signal than CPU          |
| `borjie_brain_turn_inflight`                      | >40       | 30s up / 5m down | Brain.turn concurrency ceiling per replica               |

### 4.2 `payments-ledger`

| Trigger metric                                | Threshold | Cooldown | Reason                                              |
| --------------------------------------------- | --------- | -------- | --------------------------------------------------- |
| CPU utilisation                               | >65 %     | 60s up   | Lower because ledger writes block on PG round-trip  |
| `mpesa_webhook_dedup_age_seconds`             | >300      | 90s up   | Saturation symptom — dedup cache backs up            |
| `ledger_post_duration_seconds{quantile=0.99}` | >1.5s     | 60s up   | Ledger write SLO breach                              |

### 4.3 `consolidation-worker`

Cron schedule means HPA is anchored on **queue depth** rather than
CPU. Trigger on `borjie_cron_lag_seconds > 600` (10-minute delay in
the daily 06:00 EAT brief). Min replicas = 2 (leader + warm standby).

### 4.4 `cockpit-sse` (SSE fan-out)

| Trigger metric                              | Threshold | Cooldown | Reason                                          |
| ------------------------------------------- | --------- | -------- | ----------------------------------------------- |
| Active SSE connections per replica          | >2 000    | 60s up   | Node 22 handles ~3k comfortably; scale early    |
| `cockpit_sse_heartbeat_skip_total` rate     | >0.5/s    | 60s up   | Missed heartbeats — replica struggling          |

---

## 5. Cost projection (12-month, 50-tenant target)

Assumptions:
- AWS Frankfurt (eu-central-1) — closest region with EU residency.
- Reserved instance pricing for 70 % of baseline; on-demand for HPA burst.
- 24×7 production fleet; staging is 9-to-5 with weekend pause.

| Component                | Reserved (USD/mo) | On-demand burst (USD/mo) | Annual    |
| ------------------------ | ----------------- | ------------------------ | --------- |
| EKS control plane         | 73                | —                        | 876       |
| Worker nodes (m6i.large)  | 580               | 220                      | 9 600     |
| Aurora PG (db.r6g.xlarge) | 540               | —                        | 6 480     |
| Aurora replica (1×)       | 405               | —                        | 4 860     |
| Redis ElastiCache         | 110               | —                        | 1 320     |
| S3 + EFS storage          | 95                | 25                       | 1 440     |
| NAT / data egress         | 60                | 90                       | 1 800     |
| OTel collector (Honeycomb)| 199               | —                        | 2 388     |
| Sentry                    | 89                | —                        | 1 068     |
| **Total**                 | **2 151**         | **335**                  | **29 832**|

Per-tenant fully-loaded cost ≈ **USD 50 / tenant / month** at 50
active tenants, dropping to ~USD 28 / tenant / month at 150 tenants
(infra scales sub-linearly because Aurora + EKS control plane are
fixed-overhead).

---

## 6. When to re-evaluate

Re-run the worked example in §3.1 and update §5 when ANY of:

- **Tenant count crosses a milestone** (50 → 100 → 250 → 500).
- **brain.turn p99 changes by >20 %** (because that signal anchors
  the replica math; see `Docs/OPS/SLO_ATTESTATION_2026-05-29.md`).
- **A new high-volume table lands** (e.g. predictive maintenance
  telemetry from R5 device probes — could be 100×).
- **A regulator mandates a new replication topology** (Tanzanian
  data-residency carve-out would add a Lagos / DAR replica).

The dashboards in `packages/observability/src/metrics/` already chart
the inputs to §3.1 — the operator only needs to plug the new values
in and update the cost rollup.

---

## 7. Related docs

- `Docs/OPS/SLO_ATTESTATION_2026-05-29.md` — measured baseline.
- `Docs/OPS/REALTIME_NETWORK.md` — SSE topology.
- `Docs/PERFORMANCE.md` — service-level SLOs by surface.
- `tests/load/*.k6.ts` — load probes that produced the numbers in §1.
- `infra/k8s/hpa-*.yaml` — actual HPA manifests (operator-managed).
