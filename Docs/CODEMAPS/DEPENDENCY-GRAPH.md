# Module Dependency Graph

**Last Updated:** 2026-05-22
**Scope:** Top ~30 edges across workspace packages, services, apps.

Workspace dependencies use `workspace:*` (pnpm). Direction is
consumer → producer (an arrow `A → B` means A depends on B).

## High-level view

```mermaid
graph LR
  subgraph Apps
    owner[apps/owner-portal]
    estate[apps/estate-manager-app]
    customer[apps/customer-app]
    admin[apps/admin-platform-portal]
    market[apps/marketing]
    mobile[apps/borjie_app Flutter]
  end

  subgraph Cognitive
    ci[central-intelligence]
    aic[ai-copilot]
    obs[observability]
    fc[forecasting]
    fce[forecasting-engine]
    mi[market-intelligence]
    mb[marketing-brain]
    ag[autonomy-governance]
    bp[browser-perception]
    gs[graph-sync]
    gp[graph-privacy]
    aop[aop-compiler]
    cwk[consolidation-worker]
  end

  subgraph Spine
    gw[api-gateway]
    db[database]
    pl[payments-ledger]
    plsvc[services/payments]
    auth[authz-policy]
    cfg[config]
    cp[compliance-plugins]
    dm[domain-models]
    ds[domain-services]
    id[identity]
    notif[notifications]
    wh[webhooks]
    out[outbox-processor]
    docint[document-intelligence]
    fi[file-ingest]
    eh[enterprise-hardening]
    conn[connectors]
    ap[agent-platform]
    mcps[mcp-server]
    mcpw[mcp-server-firs/nggis/nin/opay/process-intel]
  end

  subgraph UX
    dss[design-system]
    apic[api-client]
    apis[api-sdk]
    chat[chat-ui]
    dyn[dynamic-sections]
    gen[genui]
    sp[spotlight]
    rt[realtime-rooms]
  end

  owner --> apic
  owner --> dss
  estate --> apic
  estate --> dss
  customer --> apic
  customer --> dss
  admin --> apis
  admin --> dss
  admin --> chat
  admin --> ci
  admin --> sp
  market --> dss

  apic --> dm
  apis --> dm
  dss --> dm
  chat --> rt
  chat --> gen
  chat --> ds
  gen --> dss
  sp --> apic
  sp --> dss

  gw --> auth
  gw --> ds
  gw --> obs
  gw --> ap
  gw --> ci
  gw --> pl
  gw --> notif
  gw --> docint
  gw --> fi
  gw --> wh
  gw --> dm
  gw --> cfg
  gw --> eh
  gw --> mcps
  gw --> dyn

  ds --> db
  ds --> dm
  ds --> obs
  ds --> auth
  ds --> cp

  pl --> db
  pl --> dm
  pl --> obs
  pl --> conn
  plsvc --> pl
  plsvc --> conn
  plsvc --> obs

  id --> db
  id --> notif
  id --> obs

  notif --> cfg
  notif --> obs
  notif --> dm

  wh --> db
  wh --> obs

  out --> obs
  out --> cfg

  docint --> db
  docint --> obs
  docint --> dm

  fi --> db
  fi --> obs
  fi --> dm

  eh --> obs
  eh --> cfg

  conn --> obs
  conn --> cfg

  ap --> auth
  ap --> obs

  mcps --> auth
  mcps --> obs
  mcps --> dm
  mcpw --> mcps
  mcpw --> conn

  ci --> obs
  ci --> auth
  ci --> ap
  ci --> dm
  ci --> aic
  ci --> ag
  ci --> fc
  ci --> fce
  ci --> mi
  ci --> bp
  ci --> gs
  ci --> aop
  ci --> rt

  aic --> obs
  aic --> dm

  fce --> fc
  fce --> obs
  mi --> conn
  mi --> obs
  mb --> mi
  mb --> ci

  gs --> db
  gs --> obs
  gs --> gp
  gp --> obs

  cwk --> ci
  cwk --> obs
  cwk --> db

  mobile --> gw
```

## Top-30 edges (consumer → producer)

| # | Consumer | Producer | Note |
|---|----------|----------|------|
|  1 | api-gateway | authz-policy | JWT + RBAC middleware |
|  2 | api-gateway | domain-services | core CRUD |
|  3 | api-gateway | observability | OTel + audit boot |
|  4 | api-gateway | central-intelligence | brain wiring |
|  5 | api-gateway | payments-ledger | money path |
|  6 | api-gateway | notifications-service | OTP + alerts |
|  7 | api-gateway | document-intelligence | KYC + OCR |
|  8 | api-gateway | file-ingest | conversational ingest |
|  9 | api-gateway | dynamic-sections | adaptive layout signals |
| 10 | api-gateway | enterprise-hardening | middleware |
| 11 | api-gateway | mcp-server | MCP surface |
| 12 | central-intelligence | observability | decision trace |
| 13 | central-intelligence | forecasting-engine | forecasts |
| 14 | central-intelligence | autonomy-governance | caps + handoff |
| 15 | central-intelligence | browser-perception | computer-use |
| 16 | central-intelligence | graph-sync | graph context |
| 17 | central-intelligence | ai-copilot | personas |
| 18 | central-intelligence | aop-compiler | plans |
| 19 | domain-services | database | persistence |
| 20 | domain-services | domain-models | shapes |
| 21 | payments-ledger | database | ledger tables |
| 22 | payments-ledger | connectors | M-Pesa adapter |
| 23 | services/payments | payments-ledger | book of record |
| 24 | identity | notifications-service | OTP delivery |
| 25 | identity | database | identity tables |
| 26 | mcp-server-* | mcp-server | tool registry base |
| 27 | mcp-server-* | connectors | resilience |
| 28 | graph-sync | graph-privacy | DP guard on aggregates |
| 29 | consolidation-worker | central-intelligence | memory layer |
| 30 | apps/* | api-client / api-sdk | typed HTTP |

## Hot paths (read these first)

- Money path: `customer-app → api-client → api-gateway → payments-ledger → connectors(M-Pesa) → database`.
- Brain decision path: `chat-ui → api-gateway → central-intelligence → (autonomy-governance, forecasting-engine, graph-sync) → observability(decision-trace)`.
- Identity path: `mobile/customer-app → api-gateway → identity → database (+ notifications OTP)`.

## Notes

- The dependency direction is enforced by `pnpm-workspace.yaml` and
  `tsconfig` references. CI fails on cycles.
- LITFIN-style architecture-imports lint planned (ADR-0013) to make
  forbidden edges hard errors.
