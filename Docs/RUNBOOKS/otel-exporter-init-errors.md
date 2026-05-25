# Runbook: OtelExporterInitErrors

| Field | Value |
|---|---|
| Alert | `OtelExporterInitErrors` |
| Severity | warning |
| Page | platform |

## What this means

The OTel span exporter is logging init errors. Traces are being dropped.

## First 5 minutes

1. Check pod logs for `[observability]` lines and stack traces
2. Verify env vars are set correctly:
   - `OTEL_EXPORTER_OTLP_ENDPOINT`
   - `OTEL_EXPORTER_OTLP_PROTOCOL`
   - `OTEL_EXPORTER_OTLP_HEADERS`
3. Test the endpoint manually: `curl -i $OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces`

## Likely root causes

- Collector down or unreachable
- TLS cert rotation broke trust
- Invalid header format (the env parser silently drops malformed pairs)
- Auth header expired (e.g., Honeycomb API key revoked)

## Mitigations

- Restart pods to retry init
- Failover to backup collector (set alternate endpoint)
- Operate in noop mode (clear endpoint env) until repaired

## Escalation

- > 30 min outage → SEV-3 (degraded observability)
- Loss of audit-trail-relevant spans → SEV-2 (compliance impact)
