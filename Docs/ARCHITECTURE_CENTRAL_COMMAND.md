# Central Command Architecture

> Operator-facing canonical architecture for Borjie's Central
> Command brain + admin platform. Promoted from
> `.planning/central-command/00-architecture.md` (original preserved
> as design history); this document is the authoritative reference
> for operators, partners, auditors, and new engineers.

## Phase status

| Phase | Status | Reference |
|---|---|---|
| Phase A | ✅ Shipped (PR #59) | AG-UI wire, HQ tool vocabulary, generative UI primitives, sensorium, progressive intelligence, durable execution |
| Phase B | ✅ Shipped (PR #64) | DSPy GEPA prompt evolution, counter-model, Reflexion buffer, Liveblocks rooms, persona-drift detection |
| Phase C | ✅ Shipped (PR #67) | 3 destructive HQ tools, retention, search UI, S3 sessions, weekly prompt compiler |
| Wave-L | ✅ Shipped (PR #68) | OpenTelemetry 0.218, Vite 6, Vitest 4, ESLint 10 flat-config |
| Phase D | 🚧 In flight | Comprehensive gap closure — encryption-at-rest, observability, audit hardening |
| Phase E | ⏳ Planned | QLoRA per-tenant adapters; active labelling queue; cross-region read replicas |

## Vision

The admin portal (`apps/admin-platform-portal/`) is a **Central Command**: 
the admin can run the entire Borjie company by chatting with the brain.
The brain **senses** every user interaction, **acts** across every cell 
of the body, and **learns** continuously from every signal.

> **The brain controls every cell. Mouse moves = touching the brain's skin.
> The OS IS the brain's neural network.**

## High-level system diagram

```
                                ┌─────────────────────────────┐
                                │     Customer App (Next)     │
                                │     Owner Portal (Vite)     │
                                │  Estate Manager App (Next)  │
                                │  Admin Central Command (Vite)│
                                └──────────────┬──────────────┘
                                               │
                                       ┌───────▼────────┐
                                       │  AG-UI / SSE   │
                                       │  Liveblocks 3  │
                                       └───────┬────────┘
                                               │
                                ┌──────────────▼──────────────┐
                                │       API Gateway           │
                                │  (auth · ratelimit · CORS)  │
                                └──────────────┬──────────────┘
                                               │
        ┌──────────────────┬───────────────────┼───────────────────┬──────────────────┐
        │                  │                   │                   │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌────────▼────────┐ ┌────────▼────────┐ ┌───────▼────────┐
│ Central       │  │ Domain        │  │ Payments        │ │ Notifications   │ │ Document       │
│ Intelligence  │  │ Services      │  │ + Ledger        │ │ + Webhooks      │ │ Intelligence   │
│ (the Brain)   │  │ (CRUD core)   │  │ (M-Pesa, GePG,  │ │ (SMS, WA, Email)│ │ (OCR, Textract)│
│               │  │               │  │  Stripe, ...)   │ │                 │ │                │
└───────┬───────┘  └───────┬───────┘  └────────┬────────┘ └────────┬────────┘ └───────┬────────┘
        │                  │                   │                   │                  │
        └──────────────────┴───────────┬───────┴───────────────────┴──────────────────┘
                                       │
                              ┌────────▼─────────┐
                              │   Postgres +     │       ┌──────────────────┐
                              │   pgvector       │◀─────▶│  Cross-Portal    │
                              │   + RLS          │       │   Event Bus      │
                              └────────┬─────────┘       │  (Redis pub/sub) │
                                       │                 └──────────────────┘
                              ┌────────▼─────────┐
                              │   8-stage Sleep  │       ┌──────────────────┐
                              │   Consolidation  │──────▶│ Session Replay   │
                              │   (nightly)      │       │   (S3 chunks)    │
                              └──────────────────┘       └──────────────────┘
                                       │
                              ┌────────▼─────────┐       ┌──────────────────┐
                              │   Inngest        │       │   Temporal       │
                              │   (primary)      │       │   (destructive)  │
                              └──────────────────┘       └──────────────────┘
```

## The 8-layer Central Command pattern

1. **Conversational surface** — Vercel AI SDK 5/6 + AG-UI Protocol
2. **Presence packet** — route, selection, focus, last query
3. **Orchestrator** — Claude Agent SDK + LangGraph `interrupt()` for HIL
4. **Typed action registry** — metadata-bounded (agent CANNOT invent tools)
5. **Risk-tiered HIL gate** — Permit.io + four-eye-approval
6. **MCP bus** — 2025-11-25 spec (Tasks, URL Elicitation)
7. **Permission-aware retrieval** — identity is the boundary, not the prompt
8. **OTel + Phoenix audit fabric** — every span, tool, decision logged + replayable

## Stack decisions (locked)

| Layer | Choice | Why |
|---|---|---|
| Brain↔UI wire | **AG-UI Protocol** (SSE, typed events) | CopilotKit-led standard |
| Chat UI | Vercel AI SDK 5+ UIMessage parts | RSC `streamUI` paused; tool-result rendering wins |
| Agent runtime | `@anthropic-ai/claude-agent-sdk` | Battle-tested loop, hooks, subagents, skills |
| Workflow orchestration | LangGraph (`interrupt()` + checkpointing) | HIL gates, pause/resume, DAG state |
| Tool protocol | MCP 2025-11-25 (Tasks, Sampling, URL Elicit) | Industry standard, async long-running ops |
| Chart engine | **Vega-Lite v5** | Pure JSON, ajv-validatable, near-zero invalid-spec rate |
| Form engine | TanStack Form + Zod + zod-to-json-schema | Single source: schema → form + tool input + DB validator |
| Data table | TanStack Table v8 | Sort/filter/CSV, JSON-driven |
| Memory: temporal KG | Zep / Graphiti pattern (bi-temporal) | "Tenant X lived in 4B Jan-Mar" → queryable at time T |
| Memory: skill registry | Voyager-style | NL description, embedding, success/fail, tenant scope |
| Memory: per-session reflection | Reflexion (Shinn et al., NeurIPS 2023) | +22% AlfWorld, no weight updates |
| Memory: per-turn reflection | Self-RAG (IsREL/IsSUP/IsUSE tokens) | Lowest hallucination rate of 12 RAG variants |
| Sleep-time compute | 8-stage nightly worker | Expand consolidation-worker |
| Prompt optimization | DSPy GEPA/MIPROv2 weekly | External memory only; base model immutable |
| Realtime sync | tRPC v11 SSE + Liveblocks 3.0 rooms | Humans + agents as first-class peers |
| **Durable agent** | **Inngest primary; Temporal for hardest 5%** | See ADR 0003 |
| Observability | Langfuse self-hosted + Arize Phoenix | OTel GenAI semconv (see ADR 0005) |
| Browser perception | a11y tree, NOT DOM | 93% token savings |

## Inngest + Temporal coexistence

Both runtimes are wired today (PR #67 closed Phase C wiring). Boundary:

- **Inngest** — agency-run dispatch, webhook fan-out, notification
  dispatch, consolidation runner ticks, wake-loop triggers. Default
  for every new background job.
- **Temporal** — long-running destructive workflows: eviction, payout
  disbursement, KRA-MRI tenant-data export, monthly-close end-to-end
  multi-day runs.

Cross-talk happens through the outbox + event bus. See
[ADR 0003](./ADR/0003-inngest-and-temporal-coexistence.md).

## The 13-step kernel pipeline

Every brain turn runs the same 13 steps. See
`packages/central-intelligence/README.md` for the canonical reference.

1. Cache check
2. Inviolable / killswitch
3. Tier classification
4. Memory recall (4-tier hierarchy)
5. Cohort signal (DP-bounded)
6. Persona binding (per-tenant)
7. Sensor failover (provider cascade)
8. Normalize / PII scrub
9. Judge / generate
10. Drift detection
11. Policy gate / four-eye
12. Confidence tagging
13. Provenance + audit (hash-chained)

## 8-stage nightly sleep consolidation

Runs every night via `consolidation-runner` Inngest function:

1. Ingest — day's traces, thumbs, overrides, edit-diffs
2. Cluster — embedding clustering by intent / failure mode
3. Reflect — LLM critic writes "what went well / what failed"
4. Promote — recurring success → skill library; recurring failure → prompt patch
5. Decay — old facts fade unless re-seen
6. Consolidate — Zep-style community detection merges duplicate entities
7. Re-embed — with current embedding model version
8. Publish — "brain delta" event so caches refresh; OTel + Langfuse summary

## Sensory bus (14 events)

`(tenantId, userId, sessionId, surface, route, timestamp, payload)`:

`page.view`, `page.leave`, `element.click`, `input.change`,
`form.submit`, `scroll.depth`, `dwell.time`, `focus.change`,
`keyboard.shortcut`, `copy.paste`, `viewport.resize`,
`network.request`, `error.boundary`, `a11y.tree.diff`.

Mouse.move @ 4Hz → session-replay only, never LLM context.

## Action-authority ladder (motor output)

Low → high authority:

1. `render-widget` (generative UI subtree)
2. `mutate-state` (setState on shared room)
3. `fill-form` (typed action — `useCopilotAction`)
4. `scroll-to` / `highlight` / `focus` (attention primitives)
5. `navigate` (router push — reversible)
6. `run-server-action` (server-enforced RBAC)
7. `run-durable-workflow` (Inngest / Temporal — SOX-grade)
8. `computer-use` (last resort)

Every action emits a `tool_call` + `tool_response` audit pair.

## HIL safety primitives

1. Pre-execution approvals only — never retroactive
2. Risk tiers: `read` / `mutate` / `destroy` / `billing` / `external-comm`
3. Challenge-and-response approvals (5-item checklist)
4. Counter-model sanity check on destructive actions
5. Metadata-bounded action surface (agent cannot invent tools)
6. Identity-scoped retrieval (the agent only sees what the admin can see)
7. Tamper-resistant audit (every call recorded; reversible)
8. EU AI Act Article 14 + NIST AI RMF compliance

## Anti-stack (do NOT pick)

- Replicache (maintenance mode)
- Triplit (acquired by Supabase)
- Helicone (March 2026 maintenance mode)
- Pusher/Ably with tRPC (paid-priority-only)
- Stateful WebSocket in serverless (use SSE)
- Vercel AI SDK v4 RSC `streamUI` (officially paused)
- LLM emitting raw JSX (use typed primitives instead)
- LLM modifying form schemas (privilege escalation — schemas server-owned)
- LLM-emitted Tailwind classes (purged in prod build)
- DOM in prompts (use a11y tree)
- Mouse-move events to LLM (session-replay only)
- Computer Use as default

## Related

- `packages/central-intelligence/README.md`
- `Docs/ARCHITECTURE.md` — system-wide architecture (broader)
- `Docs/ARCHITECTURE_BRAIN.md` — earlier brain architecture (preserved)
- `.planning/central-command/00-architecture.md` — design source
- `Docs/ADR/` — every architectural decision record
