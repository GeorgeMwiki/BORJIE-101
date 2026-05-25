# Borjie Brain — Architecture

Status: Phase 1–4 implementation underway on `claude/estate-management-ai-oUheQ`.

## 1. The singular-intelligence model

Borjie is **one reasoning mind, many execution contexts**. Conceptually there is a single
"Estate Management Brain" that *manifests* as different personae depending on who is talking
to it and what they need. Mechanically, every persona:

- Shares the same tenant-scoped **Canonical Property Graph** (`@borjie/graph-sync`) as
  read/write state.
- Shares the same **Thread Store** (conversation, decisions, visibility labels).
- Shares the same **Prompt Registry**, **Review Service**, **Governance Service**, and
  **Predictive Engine**.
- Differs only in: system prompt, permitted tool subset, memory filter, and visibility scope.

This directly follows the 2026 consensus (Anthropic orchestrator-workers + Cognition's
"share context, share traces" principle): a deterministic orchestrator routes turns to
personae; personae write back to shared state; handoff between personae is via a structured
**HandoffPacket** — never a bare message.

```
              ┌────────────────────────────────────────────┐
              │ SHARED STATE (tenant-scoped)               │
              │  • Canonical Property Graph (Neo4j)        │
              │  • Entity DB (Postgres + Drizzle)          │
              │  • Thread Store (conversation + decisions) │
              │  • Prompt Registry / Governance / Review   │
              └───────────────────┬────────────────────────┘
                                  │ (tool calls, RBAC-checked)
                                  ▼
      ┌───────────────────────────────────────────────────┐
      │      DETERMINISTIC ORCHESTRATOR (state machine)   │
      │   intent → plan → route → dispatch → review gate  │
      └───┬──────────┬─────────────┬────────────┬─────────┘
          │          │             │            │
          ▼          ▼             ▼            ▼
   ┌──────────┐ ┌─────────┐ ┌──────────────┐ ┌────────────┐
   │ Estate   │ │ Juniors │ │ Coworker     │ │ Migration  │
   │ Manager  │ │ (5 dom) │ │ (per-employee│ │ Wizard     │
   │ (admin)  │ │         │ │  persona)    │ │            │
   └──────────┘ └─────────┘ └──────────────┘ └────────────┘
          ▲          ▲             ▲            ▲
          │          │             │            │
    admin chat   team surface  employee chat   onboarding
```

## 2. Persona taxonomy

| Persona kind | Id | Audience | Scope | Default model |
|---|---|---|---|---|
| Estate Manager | `estate-manager` | Admins | Full tenant | Sonnet + Opus advisor |
| Junior (Leasing) | `junior.leasing` | Leasing team | Units, leases, applicants | Sonnet |
| Junior (Maintenance) | `junior.maintenance` | Maintenance team | Work orders, vendors, assets | Sonnet |
| Junior (Finance) | `junior.finance` | Finance team | Ledger, payments, arrears, reports | Sonnet + Opus advisor |
| Junior (Compliance) | `junior.compliance` | Compliance/Legal | Docs, KRA, DPA, cases | Sonnet + Opus advisor |
| Junior (Communications) | `junior.communications` | Marketing/CS | Announcements, notices, replies | Haiku + Opus advisor |
| Coworker | `coworker.<employeeId>` | Single employee | Employee's assignments only | Haiku + Opus advisor |
| Migration Wizard | `migration-wizard` | Admin (onboarding) | Onboarding workspace | Sonnet |

Every persona is an instance of `Persona` (see `packages/ai-copilot/src/personas/persona.ts`).

## 3. The Advisor pattern (2026)

Executor model (Sonnet/Haiku) runs the turn; when confidence is low or the task hits a
classified hard category (lease interpretation, legal, large financial), it consults an
Opus advisor mid-turn via the `advise()` tool. Cheaper + more accurate than Opus-everywhere.

## 4. Visibility contracts

Every message written to the Thread Store carries a `VisibilityScope`:

- `private` — only the author persona + the human who initiated the turn see it.
- `team` — the team bound to the Junior plus management.
- `management` — admins and team leaders.
- `public` — full tenant audit surface.

Coworker messages default to `private`; explicit user action or orchestrator policy
promotes them to `team` or `management`. This solves the "surveillance" UX problem.

## 5. What exists vs what this branch adds

### Kept and amplified (no deletions)
- `packages/ai-copilot/src/ai-copilot.ts` — `AICopilot` facade (extended, not rewritten).
- All existing domain copilots, services, governance, review, prompt-registry, predictive
  engine, OpenAI + Mock providers — preserved.
- `packages/graph-sync` — remains the shared-state primitive.

### Added in this branch
- `packages/ai-copilot/src/providers/anthropic.ts` — Anthropic Opus/Sonnet/Haiku provider.
- `packages/ai-copilot/src/providers/advisor.ts` — Advisor pattern executor.
- `packages/ai-copilot/src/thread/` — Thread Store, HandoffPacket, Visibility.
- `packages/ai-copilot/src/personas/` — Persona abstraction + 8 personae.
- `packages/ai-copilot/src/orchestrator/` — Deterministic state-machine router.
- `packages/ai-copilot/src/skills/kenya/` — M-Pesa, KRA, Swahili, service-charge.
- `packages/ai-copilot/src/eval/` — Eval harness + golden scenarios.
- `packages/database/src/schemas/hr.schema.ts` — Department/Team/Employee/Assignment/Performance.
- `packages/database/src/schemas/conversation.schema.ts` — Threads/Messages/Visibility.
- `apps/estate-manager-app/src/app/brain/` — Chat UI (LitFit-style stepper) + Migration.

## 6. Non-negotiable design rules

1. **Orchestrator is code**, not an LLM. The LLM proposes intent; the FSM routes, enforces
   RBAC, calls review gates.
2. **Every tool call goes through RBAC + review + governance services.** No persona
   bypasses those layers, ever.
3. **No persona has private memory.** All memory is either shared state (CPG, Thread Store)
   or derived-on-demand from it.
4. **Handoff between personae = HandoffPacket.** Never a bare trailing message.
5. **Irreversible actions are human-gated.** Lease writes, financial postings, terminations,
   outgoing tenant communications — all require review unless auto-approval rule explicitly
   allows it.
