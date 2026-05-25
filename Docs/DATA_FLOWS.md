# BORJIE Data Flows

## Overview

This document describes the key data flows within the BORJIE platform, including synchronous request patterns, asynchronous event flows, and data synchronization mechanisms.

---

## Core Data Flow Patterns

### Pattern 1: Synchronous Request-Response

Used for: Real-time queries, immediate mutations, user interactions.

```
┌──────────┐     ┌─────────────┐     ┌─────────────┐     ┌──────────────┐     ┌──────────┐
│  Client  │────►│ API Gateway │────►│ Auth/Policy │────►│ Domain Svc   │────►│ Database │
└──────────┘     └─────────────┘     └─────────────┘     └──────────────┘     └──────────┘
                        │                   │                   │                   │
                        │                   │ JWT Validation    │ Business Logic    │ Query/
                        │                   │ Permission Check  │ Validation        │ Mutation
                        │                   │                   │                   │
                        │◄──────────────────┴───────────────────┴───────────────────┘
                        │                      Response
                        ▼
                 ┌──────────┐
                 │  Client  │
                 └──────────┘
```

### Pattern 2: Event-Driven (Outbox Pattern)

Used for: Ensuring data consistency, async notifications, analytics ingestion.

```
┌──────────────┐     ┌──────────────────────────────────────────┐
│ Domain Svc   │────►│              Database Transaction        │
└──────────────┘     │  ┌─────────────┐    ┌─────────────────┐  │
                     │  │ Domain Table │    │  Outbox Table   │  │
                     │  │ (write data) │    │ (write event)   │  │
                     │  └─────────────┘    └─────────────────┘  │
                     └────────────────────────────┬─────────────┘
                                                  │
                     ┌────────────────────────────▼─────────────┐
                     │           Outbox Processor               │
                     │  - Polls outbox table                    │
                     │  - Publishes to event bus                │
                     │  - Marks events as delivered             │
                     └────────────────────────────┬─────────────┘
                                                  │
                     ┌────────────────────────────▼─────────────┐
                     │              Event Bus (Kafka)           │
                     └─────┬─────────────┬─────────────┬────────┘
                           │             │             │
              ┌────────────▼──┐  ┌───────▼───────┐  ┌──▼────────────┐
              │ Notifications │  │   Analytics   │  │  Audit Log    │
              │    Service    │  │    Service    │  │   Service     │
              └───────────────┘  └───────────────┘  └───────────────┘
```

### Pattern 3: Saga (Long-Running Transactions)

Used for: Multi-service operations requiring coordination.

```
                              ┌─────────────────┐
                              │  Saga Manager   │
                              └────────┬────────┘
                                       │
       ┌───────────────────────────────┼───────────────────────────────┐
       │                               │                               │
       ▼                               ▼                               ▼
┌──────────────┐              ┌──────────────┐              ┌──────────────┐
│ Step 1:      │              │ Step 2:      │              │ Step 3:      │
│ Create Lease │──success────►│ Process      │──success────►│ Update Unit  │
│              │              │ Deposit      │              │ Status       │
└──────┬───────┘              └──────┬───────┘              └──────────────┘
       │                             │
       │ failure                     │ failure
       │                             │
       ▼                             ▼
┌──────────────┐              ┌──────────────┐
│ Compensate:  │◄─────────────│ Compensate:  │
│ Delete Lease │              │ Refund       │
└──────────────┘              │ Deposit      │
                              └──────────────┘
```

---

## Business Process Flows

### 1. Customer Onboarding Flow

```
┌─────────────┐
│   START     │
└──────┬──────┘
       │
       ▼
┌──────────────────┐     ┌──────────────────┐
│ Customer submits │────►│ Validate input   │
│ application      │     │ (sync)           │
└──────────────────┘     └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ Create Customer  │
                         │ record (draft)   │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
                    ▼                           ▼
           ┌──────────────────┐       ┌──────────────────┐
           │ KYC Verification │       │ Background Check │
           │ (async)          │       │ (async)          │
           └────────┬─────────┘       └────────┬─────────┘
                    │                           │
                    └─────────────┬─────────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ Update Customer  │
                         │ status           │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │                           │
              ┌─────▼─────┐               ┌─────▼─────┐
              │ Approved  │               │ Rejected  │
              └─────┬─────┘               └─────┬─────┘
                    │                           │
                    ▼                           ▼
           ┌──────────────────┐       ┌──────────────────┐
           │ Send welcome     │       │ Send rejection   │
           │ notification     │       │ notification     │
           └──────────────────┘       └──────────────────┘
```

**Data Stores Involved:**
- Customer table
- KYC records
- Notification queue
- Audit log

---

### 2. Lease Creation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LEASE CREATION FLOW                               │
└─────────────────────────────────────────────────────────────────────────────┘

Actor: Estate Manager / Admin

┌───────────────┐
│ Select Unit   │
│ & Customer    │
└───────┬───────┘
        │
        ▼
┌───────────────────┐     ┌─────────────────────────────────────────┐
│ Validate:         │────►│ Checks:                                 │
│ - Unit available  │     │ - No overlapping lease for unit         │
│ - Customer active │     │ - Customer not blacklisted              │
│ - Terms valid     │     │ - Rent within property guidelines       │
└───────────────────┘     └──────────────────────┬──────────────────┘
                                                 │
                                                 ▼
                          ┌─────────────────────────────────────────┐
                          │ Create Lease (status: draft)            │
                          │ - Store terms                           │
                          │ - Calculate charges                     │
                          └──────────────────────┬──────────────────┘
                                                 │
                                                 ▼
                          ┌─────────────────────────────────────────┐
                          │ Generate Lease Document                 │
                          │ - Apply template                        │
                          │ - Fill customer/unit data               │
                          │ - Store in document service             │
                          └──────────────────────┬──────────────────┘
                                                 │
                                                 ▼
                          ┌─────────────────────────────────────────┐
                          │ Send for E-Signature                    │
                          │ - Create signature request              │
                          │ - Notify signers                        │
                          │ - Status: pending_signature             │
                          └──────────────────────┬──────────────────┘
                                                 │
                          ┌──────────────────────┴──────────────────┐
                          │                                         │
                    ┌─────▼─────┐                             ┌─────▼─────┐
                    │ All Sign  │                             │ Declined/ │
                    │           │                             │ Expired   │
                    └─────┬─────┘                             └─────┬─────┘
                          │                                         │
                          ▼                                         ▼
        ┌─────────────────────────────────┐         ┌──────────────────────────┐
        │ Activate Lease                  │         │ Cancel Lease             │
        │ - Status: active                │         │ - Status: cancelled      │
        │ - Create occupancy record       │         │ - Archive document       │
        │ - Update unit status            │         │ - Notify parties         │
        │ - Generate initial charges      │         └──────────────────────────┘
        │ - Emit LeaseActivated event     │
        └─────────────────┬───────────────┘
                          │
        ┌─────────────────┴─────────────────────────┐
        │                 │                         │
        ▼                 ▼                         ▼
┌──────────────┐  ┌──────────────┐         ┌──────────────┐
│ Update       │  │ Create       │         │ Notify       │
│ Analytics    │  │ Ledger       │         │ Customer     │
│              │  │ Entries      │         │ & Owner      │
└──────────────┘  └──────────────┘         └──────────────┘
```

**Events Emitted:**
- `lease.created`
- `lease.sent_for_signature`
- `lease.signed`
- `lease.activated`
- `occupancy.started`
- `unit.status_changed`

---

### 3. Rent Payment Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RENT PAYMENT FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

                         ┌─────────────────┐
                         │ Payment Trigger │
                         └────────┬────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
       ┌──────▼──────┐    ┌───────▼───────┐   ┌──────▼──────┐
       │ Customer    │    │ Auto-charge   │   │ Manager     │
       │ initiates   │    │ (scheduled)   │   │ records     │
       │ via app     │    │               │   │ (cash/check)│
       └──────┬──────┘    └───────┬───────┘   └──────┬──────┘
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │ Validate Payment        │
                    │ - Active lease exists   │
                    │ - Amount valid          │
                    │ - No duplicate payment  │
                    └────────────┬────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Create PaymentIntent    │
                    │ (status: pending)       │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┴──────────────────┐
              │                                     │
       ┌──────▼──────┐                      ┌───────▼───────┐
       │ Electronic  │                      │ Manual        │
       │ (card/mpesa)│                      │ (cash/check)  │
       └──────┬──────┘                      └───────┬───────┘
              │                                     │
              ▼                                     │
┌─────────────────────────┐                        │
│ Call Payment Provider   │                        │
│ - Stripe/M-Pesa API     │                        │
│ - Handle 3DS if needed  │                        │
└────────────┬────────────┘                        │
             │                                     │
             │ ┌───────────────────────────────────┘
             │ │
             ▼ ▼
┌─────────────────────────┐
│ Process Result          │
└────────────┬────────────┘
             │
    ┌────────┴────────┐
    │                 │
┌───▼───┐        ┌────▼────┐
│Success│        │ Failed  │
└───┬───┘        └────┬────┘
    │                 │
    ▼                 ▼
┌─────────────┐  ┌─────────────┐
│ Record in   │  │ Record      │
│ Ledger      │  │ failure     │
│ (double     │  │ reason      │
│ entry)      │  │             │
└──────┬──────┘  └──────┬──────┘
       │                │
       ▼                ▼
┌─────────────┐  ┌─────────────┐
│ Emit        │  │ Emit        │
│ payment.    │  │ payment.    │
│ succeeded   │  │ failed      │
└──────┬──────┘  └─────────────┘
       │
       │
┌──────┴────────────────────────────────┐
│                                       │
▼                                       ▼
┌─────────────────┐            ┌─────────────────┐
│ Update customer │            │ Notify customer │
│ balance         │            │ & owner         │
└─────────────────┘            └─────────────────┘
       │
       ▼
┌─────────────────┐
│ Check if        │
│ disbursement    │
│ triggered       │
└─────────────────┘
```

**Ledger Entries (Double-Entry):**
```
On rent charge (monthly):
  DEBIT:  Accounts Receivable (Customer) +25,000
  CREDIT: Rental Income                  +25,000

On payment received:
  DEBIT:  Cash/Bank                      +25,000
  CREDIT: Accounts Receivable (Customer) +25,000
```

---

### 4. Maintenance Request Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       MAINTENANCE REQUEST FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────┐
│ Customer/Manager│
│ submits request │
└────────┬────────┘
         │
         ▼
┌─────────────────────────┐
│ Create MaintenanceReq   │
│ - Attach photos         │
│ - Set initial priority  │
│ - Status: submitted     │
└────────────┬────────────┘
         │
         ▼
┌─────────────────────────┐
│ Auto-Triage (AI/Rules)  │
│ - Categorize issue      │
│ - Adjust priority       │
│ - Status: triaged       │
└────────────┬────────────┘
         │
         │ Emit: maintenance.triaged
         ▼
┌─────────────────────────┐
│ Create Work Order       │
│ - Status: open          │
│ - Link to request       │
│ - Calculate SLA         │
└────────────┬────────────┘
         │
         │ Emit: workorder.created
         ▼
┌─────────────────────────┐
│ Assignment Engine       │
│ - Match skills          │
│ - Check availability    │
│ - Balance workload      │
└────────────┬────────────┘
         │
    ┌────┴────┐
    │         │
┌───▼───┐ ┌───▼─────┐
│Manager│ │ Vendor  │
│assign │ │ assign  │
└───┬───┘ └───┬─────┘
    │         │
    └────┬────┘
         │
         ▼
┌─────────────────────────┐
│ Notify Assignee         │
│ - Push notification     │
│ - SMS                   │
│ - Email                 │
│ Status: assigned        │
└────────────┬────────────┘
         │
         │ Emit: workorder.assigned
         ▼
┌─────────────────────────┐
│ Assignee works on task  │
│ - Updates status        │
│ - Adds notes/photos     │
│ - Records costs         │
└────────────┬────────────┘
         │
         ▼
┌─────────────────────────┐
│ Complete Work Order     │
│ - Status: completed     │
│ - Record actual cost    │
│ - Update SLA metrics    │
└────────────┬────────────┘
         │
         │ Emit: workorder.completed
         ▼
┌────────────────────────────────────────────────────────────┐
│                   POST-COMPLETION                          │
├─────────────────┬─────────────────┬───────────────────────┤
│ Notify Customer │ Update Property │ Create vendor invoice │
│ of resolution   │ maintenance     │ if applicable         │
│                 │ history         │                       │
└─────────────────┴─────────────────┴───────────────────────┘
```

**SLA Timer Logic:**
```
Response SLA Start: Request created timestamp
Response SLA Stop:  First status update by assignee

Resolution SLA Start: Request created timestamp
Resolution SLA Stop:  Work order completed timestamp

SLA Breach Check: Background job runs every 5 minutes
  IF current_time > sla_deadline AND status != resolved:
    Create escalation
    Notify manager chain
    Update priority to "escalated"
```

---

### 5. Disbursement Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          DISBURSEMENT FLOW                                  │
└─────────────────────────────────────────────────────────────────────────────┘

Trigger: Monthly (configurable by tenant)

┌─────────────────────────┐
│ Scheduler triggers      │
│ disbursement job        │
└────────────┬────────────┘
         │
         ▼
┌─────────────────────────┐
│ For each Property:      │
│ - Identify owner(s)     │
│ - Get period dates      │
└────────────┬────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CALCULATE AMOUNTS                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Gross Revenue                                                  │
│    + Rent collected                                             │
│    + Late fees collected                                        │
│    + Other income                                               │
│  ─────────────────────────                                      │
│                                                                 │
│  Deductions                                                     │
│    - Management fee (% of gross)                                │
│    - Maintenance costs (work orders)                            │
│    - Vendor invoices                                            │
│    - Reserve contributions                                      │
│    - Other expenses                                             │
│  ─────────────────────────                                      │
│                                                                 │
│  = Net Disbursement Amount                                      │
│                                                                 │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                                 ▼
                    ┌─────────────────────────┐
                    │ Create Disbursement     │
                    │ record (status: pending)│
                    │ - Attach breakdown      │
                    │ - Generate statement    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
             ┌──────▼──────┐          ┌───────▼───────┐
             │ Auto-approve│          │ Requires      │
             │ (under      │          │ approval      │
             │ threshold)  │          │ (large amount)│
             └──────┬──────┘          └───────┬───────┘
                    │                         │
                    │                         ▼
                    │               ┌─────────────────────┐
                    │               │ Notify approvers    │
                    │               │ Wait for approval   │
                    │               └──────────┬──────────┘
                    │                          │
                    │    ┌─────────────────────┴─────────────────────┐
                    │    │                                          │
                    │ ┌──▼───┐                                 ┌────▼────┐
                    │ │Approve│                                │ Reject  │
                    │ └──┬───┘                                 └────┬────┘
                    │    │                                          │
                    └────┴──────────────────┐                       │
                                            │                       ▼
                                            │             ┌─────────────────┐
                                            │             │ Record rejection│
                                            │             │ Notify owner    │
                                            │             └─────────────────┘
                                            ▼
                              ┌─────────────────────────┐
                              │ Process Payout          │
                              │ - Call payment provider │
                              │ - Bank transfer/M-Pesa  │
                              └────────────┬────────────┘
                                           │
                                  ┌────────┴────────┐
                                  │                 │
                           ┌──────▼──────┐   ┌──────▼──────┐
                           │   Success   │   │   Failed    │
                           └──────┬──────┘   └──────┬──────┘
                                  │                 │
                                  ▼                 ▼
                    ┌─────────────────────┐ ┌─────────────────────┐
                    │ Record in ledger    │ │ Record failure      │
                    │ Status: completed   │ │ Alert finance team  │
                    │ Notify owner        │ │ Retry logic         │
                    └─────────────────────┘ └─────────────────────┘
```

---

## Data Synchronization Flows

### Read Model Synchronization (CQRS)

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Write Model   │────►│   Event Bus     │────►│   Read Model    │
│   (Postgres)    │     │   (Kafka)       │     │   Projectors    │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                               ┌─────────┴─────────┐
                                               │                   │
                                        ┌──────▼──────┐    ┌───────▼───────┐
                                        │ Materialized│    │ Search Index  │
                                        │ Views       │    │ (Elasticsearch│
                                        │ (Postgres)  │    │ / Postgres)   │
                                        └─────────────┘    └───────────────┘
```

### Analytics Pipeline

```
┌─────────────────┐
│ Transactional   │
│ Database        │
└────────┬────────┘
         │
         │ CDC (Change Data Capture)
         ▼
┌─────────────────┐
│ Event Stream    │
│ (Kafka)         │
└────────┬────────┘
         │
         │ Stream Processing
         ▼
┌─────────────────┐     ┌─────────────────┐
│ Transformation  │────►│ Data Warehouse  │
│ (dbt/Spark)     │     │ (Lakehouse)     │
└─────────────────┘     └────────┬────────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
             ┌──────▼──────┐          ┌───────▼───────┐
             │ BI/Reports  │          │ ML Pipeline   │
             │ (Metabase)  │          │ (Predictions) │
             └─────────────┘          └───────────────┘
```

---

## Event Schema

### Standard Event Envelope

```json
{
  "id": "evt_abc123",
  "type": "lease.activated",
  "version": "1.0",
  "timestamp": "2026-02-12T10:30:00Z",
  "tenantId": "tnt_xyz789",
  "correlationId": "corr_def456",
  "causationId": "evt_previous",
  "actor": {
    "type": "user",
    "id": "usr_abc123"
  },
  "data": {
    // Event-specific payload
  },
  "metadata": {
    "source": "lease-service",
    "clientApp": "admin-portal"
  }
}
```

### Key Event Types

| Domain | Event | Consumers |
|--------|-------|-----------|
| **Lease** | `lease.created` | Analytics, Audit |
| | `lease.activated` | Unit Service, Payments, Analytics, Notifications |
| | `lease.terminated` | Unit Service, Payments, Analytics, Notifications |
| **Payment** | `payment.initiated` | Analytics, Audit |
| | `payment.succeeded` | Ledger, Notifications, Analytics, Owner Reports |
| | `payment.failed` | Notifications, Analytics |
| **Maintenance** | `request.created` | Work Order Service, SLA Engine, Notifications |
| | `workorder.completed` | Analytics, Owner Reports, Notifications |
| **Financial** | `disbursement.completed` | Notifications, Owner Reports, Analytics |
| | `ledger.entry.created` | Statements, Analytics |

---

## Data Retention and Archival

### Retention Policies

| Data Type | Hot Storage | Warm Storage | Cold Storage |
|-----------|-------------|--------------|--------------|
| **Transactional** | 1 year | 3 years | 7 years |
| **Financial/Ledger** | 3 years | 7 years | Permanent |
| **Audit Logs** | 1 year | 3 years | 7 years |
| **Documents** | Active lease + 1 year | 5 years | 7 years |
| **Analytics** | 2 years | 5 years | Archive |
| **Events** | 90 days | 1 year | Archive |

### Archival Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Hot Storage    │────►│ Warm Storage    │────►│ Cold Storage    │
│  (Postgres)     │     │ (Object Store)  │     │ (Glacier/Archive│
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
   Full query            Limited query            Restore request
   capability            (by date range)          required
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-12 | Architecture Team | Initial data flows documentation |
