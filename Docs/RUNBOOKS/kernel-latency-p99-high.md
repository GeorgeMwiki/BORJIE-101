# Runbook: KernelLatencyP99High

| Field | Value |
|---|---|
| Alert | `KernelLatencyP99High` |
| Severity | warning |
| Page | central-command on-call |

## What this means

p99 of kernel request duration over 5 minutes is >2000 ms, sustained ≥15 min.

## First 5 minutes

1. Check the `Latency percentiles (ms)` panel — is p50 also up, or only p99?
2. If p50 stable, p99 up → tail-latency from a sub-MD or external provider.
3. If both up → systemic (DB pool, network, GC).
4. Look at `kernel_requests_total` rate — has the load doubled?

## Likely root causes

- Model provider degradation (Anthropic, OpenAI latency spike)
- DB connection-pool saturation (check pool gauges)
- Long-running tool execution (HQ tool stuck in retry loop)
- Cold-start after redeploy

## Mitigations

- Scale read-pool replicas
- Cap per-tenant concurrent tool calls
- Switch primary LLM provider via feature flag

## Escalation

- 30 min unmitigated → notify central-command lead
- p99 > 5 s for ≥10 min → upgrade to critical / declare SEV-2
