# Knowledge / Persona Handoff SOTA — 2026-05-29

**Audience:** LLM coding assistants implementing the cross-role
context-handoff chain inside Borjie. The mining-OS Mr. Mwikila persona
must move fluidly between owner / manager / worker / buyer chats while
preserving scope, identity, audit chain, and RLS boundary.

This doc is the input-state for the K-A / K-B / K-C / K-D chain.

---

## 1. State of the art (Q2 2026)

### 1.1 Slack — Embedded AI Handoff (May 2026)

Slack's May 2026 release introduces **Embedded AI Handoff**, where
Slackbot routes a request to a specialised agent (or human), the agent
acts, and the handoff returns to the original conversation with the
context preserved. Thread-level replies are the canonical handoff
surface: when an agent quotes a previous message the receiver inherits
the quoted scope automatically. Cross-channel mention practice is to
use the `ext-` / `connect-` prefix to flag external scope and explicit
"Moving to #channel-foo for implementation" pointers when context
shifts. Source: Slack release notes May 2026 + collaboration
guidelines.

### 1.2 Linear / Microsoft Agent Framework — handoff orchestration

Both adopt a typed-context-object pattern: the orchestrator owns a
single typed envelope that follows the work across agents. Prior
messages are *recast as narrative context* rather than appearing as
the new agent's own outputs; tool calls made by previous agents are
**summarised or marked** so the new agent acts on the results without
confusing them with its own capabilities. Microsoft's Agent Framework
formalises this as "handoff" — a first-class orchestration primitive
with explicit clarity + audit-trail guarantees.

### 1.3 Anthropic Claude Memory (March 2026)

Three-layer model:

1. Short-term context (single conversation window).
2. Session memory — extracted **structured key-value pairs**, not raw
   logs ("user prefers TypeScript", "owner uses TZS as primary").
3. Imported memory — third layer added March 2026 for portability.

Memories are **scored against the current topic before injection** so
irrelevant facts don't pollute the active prompt. Claude is required
to **acknowledge when stored context is influencing a response** —
the transparency contract.

### 1.4 Notion AI — cross-page memory & entity linking

50-page context window (January 2026) + cross-page AI blocks that
resolve one level of linked pages beyond the window. **Custom
Instructions** persist at workspace scope so the agent knows the
team's brand voice, structure, preferences. Entity matching boosts
relevance through a hybrid (semantic + BM25 + entity-match) signal
in their memory retrieval pipeline.

### 1.5 cursor-agent-team — multi-role single-conversation

Influential 2026 framework that **eliminates distinct agent instances**
in favour of role-switching within a unified context window. Uses
Aspect-Oriented Programming primitives to enforce persona consistency
without polluting core logic. Argues conventional multi-agent
handoffs suffer from "context loss and identity fragmentation" —
state degrades across boundaries.

### 1.6 Manus — RAG + system-prompt persona

Manus encodes its persona + scope in a detailed system prompt and
uses a vector store for past dialogue + retrieved docs. The agent's
identity is anchored at the system-prompt level so role consistency
survives long contexts.

---

## 2. Synthesis — Borjie's handoff invariants

| Invariant                          | Source                              |
| ---------------------------------- | ----------------------------------- |
| Typed handoff envelope             | Linear / MS Agent Framework         |
| Audit-chain hash on every handoff  | Borjie CLAUDE.md + Linear           |
| RLS-aware scope filtering          | Borjie hard rules + Anthropic       |
| Persona-aware entity vocabulary    | Notion + Anthropic memory filtering |
| Reply-card bubble-back             | Slack thread handoff                |
| Breadcrumb context narrowing       | Notion cross-page resolution        |
| Cross-role decision link auto-emit | MS Agent Framework + Linear         |
| Append-only, immutable             | Borjie audit-hash-chain             |
| Bilingual sw/en                    | Borjie hard rule                    |

---

## 3. Mapping to the 4 links

### K-A — Cross-role `@mention` handoff
Slack Embedded AI Handoff is the closest peer. Borjie extends it with
a hash-chained `chat_handoffs` row + RLS-aware scope filtering so the
target's tenant + persona ceiling cannot be bypassed by the source.

### K-B — Persona-aware entity-index queries
Anthropic's relevance-scored memory + Notion's entity-match retrieval
inform the design: the same `entity.search` query under owner JWT vs
worker JWT must return **different fields** (financials redacted for
workers) and **different rows** (workers see only sites they've worked
at). Achieved by injecting `persona` into the existing query layer and
post-filtering by the persona's permitted projection.

### K-C — Decision-journal cross-references
Linear / MS Agent Framework's "handoff = first-class primitive with
audit trail" is the model. Borjie auto-emits `decision_links` rows
joining owner decisions to manager worktrees so managers see a curated
"Decisions affecting your work" feed without polling.

### K-D — Contextual handoff at app boundaries
Notion's breadcrumb-narrowed entity retrieval + cursor-agent-team's
single-conversation-with-role-switching model. The owner's nav stack
(cockpit → manager's worktree → worker detail) emits a
`<context_set>` SSE tag so the brain narrows entity-search relevance
to the crumb stack and the chat preserves the breadcrumb header.

---

## 4. Non-negotiables (Borjie hard rules)

- Every handoff writes one hash-chained audit-chain entry.
- Target tenant must equal source tenant (cross-tenant denial = HTTP 403).
- Target's RLS scope is the hard cap (owner cannot widen worker view).
- Brain emits XML-style SSE tags; FE parses + strips before render.
- Pino logger only — no `console.log` in services.
- Decision recorder is the only path that writes `decision_links`.
- Bilingual labels for every user-visible chip / button.

---

## 5. Out-of-scope (future work)

- Cross-org handoff (only intra-tenant covered here).
- Voice-channel handoff (sw/en TTS pivot lives in `voice.router.ts`).
- Buyer↔owner handoff (covered by anti-conflict task #193).
- Compliance/regulator persona handoff (anti-conflict task #194).

---

## 6. Sources

- Slack Release Notes May 2026 — Embedded AI Handoff.
- Microsoft Agent Framework — Workflows / Orchestrations / Handoff.
- Anthropic Claude memory update — March 2026.
- Notion AI Releases April 2026 — cross-page AI blocks.
- cursor-agent-team paper (Zenodo 18605311, 2026).
- Manus AI agent technical investigation (GitHub gist, 2026).
- OpenAI Agents SDK — Understanding Handoffs.
- mem0 — State of AI Agent Memory 2026.
