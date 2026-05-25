# DR — Region Failover Runbook

Owner: Platform SRE.
Last review: 2026-05-17 (Phase D agent D9).
Trigger: primary region (`eu-west-1`) unavailable for >= 15 minutes OR
an executive failover decision (e.g. data-residency directive).

This runbook covers the warm-standby region that Phase D agent D9
introduced via `infra/terraform/modules/multi-region`. The module is
disabled by default (`enable_multi_region = false` in
`infra/terraform/environments/production/main.tf`); the steps below
assume it has been switched on and applied successfully.

## 0. Pre-flight (every quarter)

1. Confirm the secondary read replica is reachable from the standby
   VPC: `psql -h $(terraform output -raw secondary_rds_endpoint) -d postgres -c 'SELECT 1;'`
2. Confirm S3 cross-region replication health:
   `aws s3api get-bucket-replication --bucket <primary>` should show
   `Status: Enabled` and a recent replication metric in CloudWatch.
3. Confirm the Route 53 health check is reporting `Healthy`:
   `aws route53 get-health-check-status --health-check-id $(terraform output -raw primary_health_check_id)`.
4. Run the documented DR drill once per quarter and file the result in
   the SOC 2 evidence archive.

## 1. Decide to fail over

A failover should be authorised by either:

- Two-person sign-off (Platform Lead + on-call SRE) when the primary
  region is unavailable but data integrity is uncertain; OR
- A single sign-off when CloudWatch + the synthetic probe BOTH report
  the primary region down for >= 15 consecutive minutes.

Log the decision in the incident channel and start the timer. Target
RTO: 30 minutes. Target RPO: 5 minutes (S3) / 60 seconds (RDS).

## 2. Promote the RDS read replica

```bash
aws rds promote-read-replica \
  --db-instance-identifier borjie-production-replica \
  --region us-east-1
```

Wait until the instance status transitions from `modifying` to
`available`. Confirm the WAL position is current:

```bash
psql -h <new-endpoint> -d postgres \
  -c 'SELECT pg_current_wal_lsn();'
```

## 3. Switch object storage to the DR bucket

1. Update the application config secret `S3_BUCKET` to the DR bucket
   ID (`terraform output -raw secondary_s3_bucket`).
2. Trigger a deploy of the API gateway + worker services so each pod
   picks up the new bucket. Expect a 2-3 minute rolling restart.
3. Validate object writes succeed from at least one service.

## 4. Force Route 53 to the secondary endpoint

Failover is automatic when the primary health check enters the
`Unhealthy` state. To force it manually:

```bash
aws route53 change-resource-record-sets \
  --hosted-zone-id $(terraform output -raw route53_zone_id) \
  --change-batch file://failover.json
```

Where `failover.json` flips the `primary` record to `Failover: SECONDARY`
or sets the `disabled` flag on the primary health check.

## 5. Validate the new primary

- Confirm the application is reachable: `curl https://<primary_dns_name>/healthz`.
- Confirm webhooks are flowing: check `agent-platform/webhook-delivery`
  metrics; failed-delivery rate must drop within 5 minutes.
- Re-run the security-route-coverage CI gate on a fresh PR to confirm
  the gate is green in the new region (smoke test, not a deploy gate).

## 6. Post-failover hardening

1. Re-create the read replica in the OLD primary region once it
   recovers (`terraform apply -var enable_multi_region=true` after
   inverting `primary_region`/`secondary_region`).
2. File the post-mortem within 5 business days.
3. Refresh the SOC 2 CC7.4 (system recovery) evidence package with the
   timestamps captured during the failover.

## Appendix — cross-references

- Central SSRF guard mirror: `packages/agent-platform/src/webhook-delivery.ts::assertSafeWebhookUrl`
  hand-mirrors the predicate in
  `packages/enterprise-hardening/src/http/safe-http-fetch.ts`. Any change
  to the denylist there must also be reflected in the mirror.
- Tenant-isolation breach audit feed: `cross_tenant_denials`
  (migration `0153`) — confirm the table is replicating to the
  secondary read replica before declaring failover complete.
