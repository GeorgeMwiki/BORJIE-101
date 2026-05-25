# BORJIE KPIs and SLOs

## Overview

This document defines the Key Performance Indicators (KPIs) and Service Level Objectives (SLOs) for the BORJIE platform. These metrics guide operational decisions, alert thresholds, and capacity planning.

---

## Business KPIs

### Customer Success Metrics

| KPI | Definition | Target | Measurement Frequency |
|-----|------------|--------|----------------------|
| **Rent Collection Rate** | (Rent collected / Rent due) × 100 | ≥ 95% | Monthly |
| **On-Time Payment Rate** | (Payments within grace period / Total payments) × 100 | ≥ 85% | Monthly |
| **Customer Retention Rate** | (Customers with renewed leases / Expiring leases) × 100 | ≥ 75% | Quarterly |
| **Customer Satisfaction (NPS)** | Net Promoter Score from surveys | ≥ 40 | Quarterly |
| **Average Arrears Age** | Mean days outstanding for overdue payments | ≤ 15 days | Weekly |

### Property Operations Metrics

| KPI | Definition | Target | Measurement Frequency |
|-----|------------|--------|----------------------|
| **Occupancy Rate** | (Occupied units / Total units) × 100 | ≥ 90% | Monthly |
| **Vacancy Duration** | Average days unit remains vacant | ≤ 30 days | Monthly |
| **Maintenance SLA Compliance** | (Requests resolved within SLA / Total requests) × 100 | ≥ 90% | Weekly |
| **Emergency Response Time** | Time from emergency request to first response | ≤ 1 hour | Real-time |
| **Work Order Completion Rate** | (Completed work orders / Created work orders) × 100 | ≥ 95% | Weekly |

### Owner Satisfaction Metrics

| KPI | Definition | Target | Measurement Frequency |
|-----|------------|--------|----------------------|
| **Owner NPS** | Net Promoter Score from owner surveys | ≥ 50 | Quarterly |
| **Disbursement Accuracy** | (Accurate disbursements / Total disbursements) × 100 | ≥ 99.9% | Monthly |
| **Statement Delivery Rate** | (Statements delivered on time / Total statements) × 100 | 100% | Monthly |
| **Owner Portal Adoption** | (Active owner users / Total owners) × 100 | ≥ 80% | Monthly |

### Platform Growth Metrics

| KPI | Definition | Target | Measurement Frequency |
|-----|------------|--------|----------------------|
| **Tenant Acquisition Rate** | New organizations onboarded per month | Growth target | Monthly |
| **User Activation Rate** | (Users completing onboarding / Invited users) × 100 | ≥ 70% | Weekly |
| **Property Portfolio Growth** | Net properties added to platform | Growth target | Monthly |
| **Revenue Per Unit** | Total platform revenue / Active units | Growth target | Monthly |

---

## Service Level Objectives (SLOs)

### Availability SLOs

| Service | SLO | Error Budget (monthly) | Measurement |
|---------|-----|------------------------|-------------|
| **API Gateway** | 99.9% uptime | 43.8 minutes | Synthetic monitoring |
| **Authentication Service** | 99.95% uptime | 21.9 minutes | Health checks |
| **Payment Processing** | 99.9% uptime | 43.8 minutes | Transaction success rate |
| **Core Services** | 99.5% uptime | 3.65 hours | Health checks |
| **Mobile/Web Apps** | 99% uptime | 7.3 hours | Real user monitoring |

### Latency SLOs

| Operation | p50 | p95 | p99 | Measurement |
|-----------|-----|-----|-----|-------------|
| **API Response (read)** | ≤ 100ms | ≤ 300ms | ≤ 500ms | APM tracing |
| **API Response (write)** | ≤ 200ms | ≤ 500ms | ≤ 1000ms | APM tracing |
| **Authentication** | ≤ 150ms | ≤ 400ms | ≤ 800ms | APM tracing |
| **Payment Initiation** | ≤ 500ms | ≤ 1500ms | ≤ 3000ms | APM tracing |
| **Report Generation** | ≤ 5s | ≤ 15s | ≤ 30s | Background job metrics |
| **Search Queries** | ≤ 200ms | ≤ 500ms | ≤ 1000ms | Query metrics |

### Throughput SLOs

| Service | Sustained | Peak | Measurement |
|---------|-----------|------|-------------|
| **API Gateway** | 1000 req/s | 5000 req/s | Request metrics |
| **Payment Processing** | 100 tx/s | 500 tx/s | Transaction metrics |
| **Event Processing** | 500 events/s | 2000 events/s | Event bus metrics |
| **Notification Delivery** | 1000 msg/s | 5000 msg/s | Delivery metrics |

### Data Durability SLOs

| Data Type | RPO | RTO | Backup Frequency |
|-----------|-----|-----|------------------|
| **Transactional Data** | 0 (sync replication) | ≤ 15 minutes | Continuous |
| **Financial Ledger** | 0 (sync replication) | ≤ 15 minutes | Continuous |
| **Document Storage** | ≤ 1 hour | ≤ 4 hours | Hourly |
| **Analytics Data** | ≤ 24 hours | ≤ 24 hours | Daily |
| **Audit Logs** | ≤ 1 hour | ≤ 4 hours | Hourly |

---

## SLA Definitions by Tier

### Maintenance Request SLAs

| Priority | Response Time | Resolution Time |
|----------|---------------|-----------------|
| **Emergency** | ≤ 1 hour | ≤ 4 hours |
| **High** | ≤ 4 hours | ≤ 24 hours |
| **Medium** | ≤ 24 hours | ≤ 72 hours |
| **Low** | ≤ 48 hours | ≤ 7 days |

### Support SLAs (Platform Support)

| Severity | Response Time | Update Frequency | Resolution Target |
|----------|---------------|------------------|-------------------|
| **Critical** (system down) | ≤ 15 minutes | Every 30 minutes | ≤ 4 hours |
| **High** (major feature broken) | ≤ 1 hour | Every 2 hours | ≤ 8 hours |
| **Medium** (partial impact) | ≤ 4 hours | Daily | ≤ 3 business days |
| **Low** (minor issue) | ≤ 24 hours | As needed | ≤ 10 business days |

---

## Alerting Thresholds

### Critical Alerts (PagerDuty)

| Metric | Condition | Action |
|--------|-----------|--------|
| API Availability | < 99% for 5 minutes | Page on-call |
| Payment Failures | > 5% failure rate for 5 minutes | Page on-call |
| Database Connections | > 90% pool utilization | Page on-call |
| Error Rate | > 10% 5xx responses for 5 minutes | Page on-call |
| Latency p99 | > 5s for 5 minutes | Page on-call |

### Warning Alerts (Slack)

| Metric | Condition | Action |
|--------|-----------|--------|
| API Availability | < 99.5% for 15 minutes | Notify team |
| Error Rate | > 1% 5xx responses for 15 minutes | Notify team |
| Latency p95 | > 1s for 15 minutes | Notify team |
| Queue Depth | > 1000 messages for 10 minutes | Notify team |
| Disk Usage | > 80% | Notify team |
| Memory Usage | > 85% | Notify team |

### Business Alerts

| Metric | Condition | Action |
|--------|-----------|--------|
| Daily Collection Rate | < 80% of expected | Email operations |
| Lease Expirations | > 50 in next 30 days | Email managers |
| Overdue Payments | > 10% increase week-over-week | Email finance |
| Failed Disbursements | Any failure | Email finance |

---

## Monitoring Stack

### Metrics Collection

```yaml
# Prometheus scrape config
scrape_configs:
  - job_name: 'api-gateway'
    scrape_interval: 15s
    static_configs:
      - targets: ['api-gateway:9090']
    
  - job_name: 'domain-services'
    scrape_interval: 15s
    kubernetes_sd_configs:
      - role: pod
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        regex: 'borjie-.*'
        action: keep
```

### Key Dashboards

| Dashboard | Purpose | Refresh |
|-----------|---------|---------|
| **System Overview** | High-level health across all services | 1 minute |
| **API Performance** | Request rates, latencies, errors | 30 seconds |
| **Payment Operations** | Payment success/failure, volumes | 1 minute |
| **Tenant Health** | Per-tenant resource usage, errors | 5 minutes |
| **Business Metrics** | Collection rates, occupancy, SLA compliance | 15 minutes |

### Log Aggregation

```
Application Logs → Fluentd → Loki → Grafana
                              ↓
                         Alertmanager
```

Log retention:
- Hot storage (searchable): 7 days
- Warm storage (archived): 90 days
- Cold storage (compliance): 7 years

### Distributed Tracing

```
Request → OpenTelemetry SDK → Collector → Tempo → Grafana
```

Trace sampling:
- Error traces: 100% sampled
- Slow traces (> p95): 100% sampled
- Normal traces: 1% sampled

---

## Capacity Planning

### Baseline Metrics (per 1000 units managed)

| Resource | Estimate |
|----------|----------|
| API Requests | ~50,000/day |
| Database Storage | ~10 GB/month growth |
| Object Storage | ~50 GB/month growth |
| Event Messages | ~100,000/day |

### Scaling Triggers

| Metric | Scale Up Threshold | Scale Down Threshold |
|--------|-------------------|---------------------|
| CPU Utilization | > 70% for 5 minutes | < 30% for 15 minutes |
| Memory Utilization | > 80% for 5 minutes | < 40% for 15 minutes |
| Request Queue | > 100 pending for 1 minute | < 10 pending for 5 minutes |
| Database Connections | > 80% pool for 2 minutes | < 30% pool for 10 minutes |

---

## SLO Review Process

### Weekly Review

- Review error budgets consumed
- Identify top error sources
- Prioritize reliability improvements

### Monthly Review

- Compare actuals vs. SLO targets
- Review business KPI trends
- Adjust alert thresholds if needed

### Quarterly Review

- Evaluate SLO target appropriateness
- Review capacity projections
- Plan infrastructure investments

---

## Incident Management

### Severity Classification

| Severity | Definition | Example |
|----------|------------|---------|
| **SEV1** | Complete service outage | All APIs returning 5xx |
| **SEV2** | Major feature unavailable | Payments not processing |
| **SEV3** | Degraded performance | API latency > 2x normal |
| **SEV4** | Minor issue, workaround available | Report generation slow |

### Incident Response Times

| Severity | Acknowledgment | Initial Response | Status Update |
|----------|----------------|------------------|---------------|
| SEV1 | ≤ 5 minutes | ≤ 15 minutes | Every 15 minutes |
| SEV2 | ≤ 15 minutes | ≤ 30 minutes | Every 30 minutes |
| SEV3 | ≤ 1 hour | ≤ 2 hours | Every 2 hours |
| SEV4 | ≤ 4 hours | ≤ 8 hours | Daily |

### Post-Incident Review

All SEV1 and SEV2 incidents require:
1. Incident timeline (within 24 hours)
2. Root cause analysis (within 48 hours)
3. Action items with owners (within 72 hours)
4. Post-mortem review meeting (within 1 week)

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-12 | Architecture Team | Initial KPIs and SLOs |
