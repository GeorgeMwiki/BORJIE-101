# Canonical Property Graph (CPG) — Architecture

## Overview

The Canonical Property Graph (CPG) is Boss Nyumba's knowledge graph layer built on Neo4j. It provides a read-optimized projection of the relational database designed for:

- **AI-powered intelligence**: Graph traversals power risk prediction, evidence assembly, and natural language queries
- **Relationship reasoning**: Multi-hop queries that are prohibitively expensive with SQL JOINs
- **Explainable AI**: Every AI recommendation includes graph paths as evidence citations
- **Enterprise rollups**: Natural hierarchical aggregation (Org → Region → Property → Unit)

**PostgreSQL remains the source of truth** for all transactional operations. Neo4j is a synchronized read projection that the AI layer queries.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              AI COPILOT LAYER                                    │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                     GraphAgentToolkit                                     │   │
│  │  get_case_timeline | get_tenant_risk_drivers | get_vendor_scorecard       │   │
│  │  get_unit_health | get_parcel_compliance | generate_evidence_pack         │   │
│  │  get_property_rollup | get_portfolio_overview | get_graph_stats           │   │
│  └────────────────────────────────┬─────────────────────────────────────────┘   │
│                                   │                                              │
│  ┌────────────────────────────────▼─────────────────────────────────────────┐   │
│  │                    GraphQueryService                                      │   │
│  │  Parameterized Cypher queries │ Tenant isolation │ Evidence paths         │   │
│  └────────────────────────────────┬─────────────────────────────────────────┘   │
└───────────────────────────────────┼──────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           NEO4J (CPG Database)                                   │
│  ┌─────────────────────────────────────────────────────────────────────────┐    │
│  │  Node Labels: Property, Unit, Customer, Lease, WorkOrder, Invoice,      │    │
│  │               Payment, Case, Notice, Document, Vendor, Asset,           │    │
│  │               Parcel, SubParcel, MaintenanceRequest, Inspection, ...     │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Relationships: HAS_UNIT, APPLIES_TO, BILLED_TO, PAYS, TARGETS,        │    │
│  │                 ASSIGNED_TO, OPENED_BY, CASE_ABOUT, INCLUDES, ...       │    │
│  ├─────────────────────────────────────────────────────────────────────────┤    │
│  │  Constraints: Uniqueness on (_tenantId, _id) for all core labels        │    │
│  │  Indexes: Status, type, date fields + full-text search                  │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────┬───────────────────────────────────────────────────┘
                              ▲
                              │ ETL Sync (event-driven)
                              │
┌─────────────────────────────┼───────────────────────────────────────────────────┐
│                    GraphSyncEngine                                                │
│  ┌──────────────────────────┴──────────────────────────────────────────────┐    │
│  │  Event Handlers (outbox pattern):                                       │    │
│  │  property.created → upsert Property node + relationships                │    │
│  │  lease.activated  → upsert Lease + APPLIES_TO + HAS_LEASE edges         │    │
│  │  payment.succeeded → upsert Payment + PAYS edge                         │    │
│  │  workorder.created → upsert WorkOrder + TARGETS + ASSIGNED_TO edges     │    │
│  │  case.created → upsert Case + OPENED_BY + CASE_ABOUT edges             │    │
│  │  ...                                                                    │    │
│  └─────────────────────────────────────────────────────────────────────────┘    │
│  Batch UNWIND for throughput │ MERGE for idempotency │ _syncedAt tracking       │
└─────────────────────────────────────────────────────────────────────────────────┘
                              ▲
                              │ Domain Events
                              │
┌─────────────────────────────┼───────────────────────────────────────────────────┐
│                   PostgreSQL (Source of Truth)                                    │
│  Outbox table → Event Bus → GraphSyncEngine consumer                             │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Package Structure

```
packages/graph-sync/
├── src/
│   ├── client/
│   │   └── neo4j-client.ts          # Connection management, health checks
│   ├── schema/
│   │   ├── node-labels.ts           # All CPG node labels with type safety
│   │   ├── relationship-types.ts    # All CPG relationship types
│   │   └── constraints.ts           # Uniqueness constraints + indexes
│   ├── sync/
│   │   └── graph-sync-engine.ts     # PostgreSQL → Neo4j ETL engine
│   ├── queries/
│   │   ├── graph-query-service.ts   # Safe, parameterized query endpoints
│   │   └── graph-agent-toolkit.ts   # AI agent tool interface
│   ├── scripts/
│   │   └── init-graph.ts            # Graph initialization script
│   └── index.ts                     # Package exports
├── package.json
└── tsconfig.json
```

---

## Node Labels (50+ types)

### Organization & Governance
`Org` → `Region` → `Area` → `Property`

### Physical Hierarchy
`Property` → `Building` → `Block` → `Floor` → `Unit` → `Space` → `Asset`

### Land Hierarchy
`Property` → `Parcel` → `SubParcel` → `Improvement` → `Asset`

### People & Occupancy
`Person` ← `TenantProfile` → `Unit` (via OCCUPIES)
`Customer` ← `TenantProfile` (via FOR_CUSTOMER)

### Contracts
`Lease` → `Unit` (via APPLIES_TO)
`Customer` → `Lease` (via HAS_LEASE)

### Finance
`Invoice` → `Customer` (via BILLED_TO)
`Payment` → `Invoice` (via PAYS)

### Legal
`Case` → `Customer` (via OPENED_BY)
`Case` → `Unit|Lease|WorkOrder` (via CASE_ABOUT)
`EvidencePack` → `Document|Message|WorkOrder|...` (via INCLUDES)

---

## Design Rules

### Rule 1 — Everything must have a "home"
Every operational node (WorkOrder, Invoice, Case) connects to exactly one primary location anchor (Unit or Parcel). This makes rollups deterministic.

### Rule 2 — Documents attach to events, not just people
A Document links to who submitted it AND what it supports (Lease, Case, Payment). This enables one-query evidence packs.

### Rule 3 — TenantProfile is the tenancy context
Don't hang operational data off Person directly. TenantProfile = person-in-this-org-at-this-property. Solves multi-tenancy, privacy, and history.

### Rule 4 — _tenantId on every node
Every node carries `_tenantId`. Every Cypher query filters by `_tenantId`. No cross-tenant traversals possible.

---

## AI Agent Tool Definitions

| Tool | Description | Use Case |
|------|-------------|----------|
| `get_case_timeline` | Chronological history of a dispute case | "Show me the history of Case #123" |
| `get_tenant_risk_drivers` | Risk analysis with evidence | "Why is tenant John at risk?" |
| `get_vendor_scorecard` | Vendor performance metrics | "How is ABC Plumbing performing?" |
| `get_unit_health` | Unit composite health score | "What's the status of Unit 2B?" |
| `get_parcel_compliance` | Expiring documents/leases | "What's expiring on Plot 45?" |
| `get_property_rollup` | Property-level KPIs | "Give me a summary of Westlands Tower" |
| `generate_evidence_pack` | Court-ready evidence bundle | "Prepare evidence for Case #456" |
| `get_portfolio_overview` | Multi-property summary | "Show me the portfolio overview" |
| `get_graph_stats` | Graph health metrics | "Is the knowledge graph up to date?" |

---

## Multi-Tenant Security

1. **Node-level isolation**: Every node has `_tenantId` property
2. **Query-level enforcement**: All Cypher queries include `{_tenantId: $tenantId}` in MATCH patterns
3. **Service-level enforcement**: GraphQueryService requires `tenantId` as first parameter
4. **API-level enforcement**: GraphAgentToolkit extracts `tenantId` from JWT auth context
5. **No cross-tenant traversals**: Graph structure prevents data leakage

---

## Sync Architecture

### Event-Driven Sync (Primary)
1. Domain service writes to PostgreSQL + outbox table (existing pattern)
2. Outbox processor publishes event to event bus
3. GraphSyncEngine consumes events and updates Neo4j
4. MERGE operations ensure idempotency (safe to replay)

### Batch Sync (Backfill)
For initial data load or recovery, use batch UNWIND operations:
- 1000+ nodes per batch transaction
- Parallel by entity type
- _syncedAt tracks freshness

### Consistency Model
- **Eventual consistency**: Neo4j may lag PostgreSQL by seconds
- **Idempotent sync**: Same event processed twice = same result
- **No writes to Neo4j except through sync**: Graph is read-only for applications

---

## Infrastructure

### Docker Compose
```yaml
neo4j:
  image: neo4j:5-community
  ports:
    - "7474:7474"  # Browser UI
    - "7687:7687"  # Bolt protocol
  environment:
    NEO4J_AUTH: neo4j/borjie_graph_dev
    NEO4J_PLUGINS: '["apoc"]'
```

### Environment Variables
```
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=borjie_graph_dev
NEO4J_DATABASE=neo4j
```

### Getting Started
```bash
# Start infrastructure
docker compose up -d

# Initialize graph (constraints + indexes)
pnpm --filter @borjie/graph-sync graph:init

# Neo4j Browser
open http://localhost:7474
```

---

## Research Validation

This architecture is validated by:
- **Cherre**: World's largest real estate knowledge graph ($3.3T AUM)
- **Reonomy**: 54M+ property knowledge graph with entity resolution
- **Legislate**: Patented KG for property contract management
- **RealEstateCore**: Open ontology standard for property graphs
- **Microsoft GraphRAG**: Production framework for graph-powered AI
- **Neo4j Multi-tenancy**: Database-per-tenant pattern at enterprise scale

Boss Nyumba is the **first property management platform in Africa** built with a graph-native intelligence layer.

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-02-17 | Architecture Team | Initial CPG architecture |
