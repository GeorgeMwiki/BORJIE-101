# Chat-Handles-Everything — SOTA Research (2026-05-29)

**Status:** Active. Companion to
[`CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md`](./CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md).

**Question:** What does state-of-the-art look like in May 2026 for
**"the chat handles everything the UI can do"** — for an agentic
operating system where the chat surface is canonical and the UI is
visualisation?

This doc captures the seven frontier patterns Borjie must absorb to
push past parity into excellence, and the explicit gaps where Borjie
already leads.

---

## 1. Frontier reference points (May 2026)

| Product | Pattern that matters here |
|---------|----------------------------|
| **Anthropic Claude 4.7 Computer Use** | Hybrid Reasoning layer pauses before chains, zoom-on-demand crops, OSWorld 72.5%. Iterative loop survives UI surprises. ([Anthropic](https://www.anthropic.com/product/claude-code), [TI 2026](https://tech-insider.org/anthropic-claude-computer-use-agent-2026/)) |
| **Manus AI Agent Mode** (Meta, Q4-2025 acquisition) | Two-mode split: *Chat* for quick Q&A, *Agent* for long-horizon plans. Generates an explicit plan-with-dependencies graph users can review before execution. Continuous evaluate-and-refine loop. ([Manus](https://manus.im/features/agent-skills), [Lindy](https://www.lindy.ai/blog/manus-ai-review)) |
| **OpenAI ChatGPT Agent** (Operator successor, Aug 2025) | Sensitivity tiering: low-risk autonomous, medium-risk show-preview, high-risk hard-stop with hand-back. CAPTCHA / payment / login surfaces always block. ([OpenAI](https://openai.com/index/introducing-chatgpt-agent/), [Coasty](https://coasty.ai/blog/openai-operator-review-2026-20260510)) |
| **Claude Code Agent SDK** | Tool-use loop with built-in `Read` / `Edit` / `Bash` / `Write`. Default is *ask-before-edit*; --dangerously-skip-permissions exists but is gated by org admin. ([Claude Code Docs](https://code.claude.com/docs/en/agent-sdk/overview)) |
| **Cursor 3.0 Agents Window** (Apr 2026) | Parallel multi-agent execution across local + cloud + SSH. Each agent owns a worktree; conflicts auto-resolve via git. Phone + Slack invocation. ([Codersera](https://codersera.com/blog/cursor-ide-complete-guide-2026/)) |
| **ChatGPT Voice + Agent Mode** | Voice and Agent are still separate surfaces; voice is conversation-only. Hands-free *task execution* via voice is still a frontier capability. ([ChatGPT Voice](https://chatgpt.com/features/voice/)) |
| **v0.app full-stack sandbox** | Chat-to-app generation now includes API routes + Server Actions + database. Production-ready React via shadcn/ui only. Plan-then-execute UX. ([Vercel](https://vercel.com/blog/introducing-the-new-v0)) |

### Pattern distillation

Five patterns these tools all converge on:

1. **Plan-before-execute graph.** Multi-step tasks render an
   explicit DAG of subtasks; user can prune or re-order before the
   agent fires.
2. **Risk-tiered confirmation.** Low-risk autonomous, medium-risk
   preview, high-risk hand-back. CAPTCHA / payment / auth always
   block.
3. **Mid-stream inline blocks.** Results render *inside* the chat
   stream: tables, diffs, charts, confirmation cards.
4. **Undo journal.** Every chat-initiated mutation is reversible
   from the same chat surface (Claude Code's "undo last edit",
   Cursor's worktree revert).
5. **Hands-free is voice + STT + TTS + agent loop.** Not yet
   shipped by any frontier vendor as a single integrated surface —
   this is greenfield for Borjie.

---

## 2. Where Borjie already leads

Mapping Borjie's shipped capability vs. the frontier:

| Capability | Borjie status | Frontier comparison |
|------------|---------------|---------------------|
| Persona-aware tool catalog | Mr. Mwikila routes by persona (owner / manager / worker / buyer / admin) — `services/api-gateway/src/composition/brain-tools/*` | Claude Code has no persona layer; ChatGPT Agent picks tools by ad-hoc reasoning. **Borjie ahead.** |
| Bidirectional UI ↔ chat parity | `provenance.via='chat' \| 'form'` on every state-mutable table (migration 0101) + "via Mr. Mwikila" pill on list views (#131) | Cursor and Claude Code persist edits to disk but don't track *origin surface*. **Borjie ahead.** |
| Multi-debate for high-stakes | Brain debate mode (#127) routes high-risk policy turns through multiple personas before commit | Closest analogue is Anthropic's Constitutional AI critique pass — not user-facing. **Borjie ahead.** |
| Audit chain | Hash-chained `audit_events` with append-only invariant | Cursor / Claude Code: best-effort logging, mutable. **Borjie ahead.** |
| Evidence-required output | AuditorAgent rejects empty `evidence_id` arrays | None of the frontier tools enforce this. **Borjie ahead.** |
| Inline blocks (16 kinds) | `<draft_preview>`, `<confirmation_card>`, `<inline_table>`, `<inline_chart>`, `<micro_action_card>`, … | v0 has component-blocks; ChatGPT has structured tool-output blocks. **Roughly at parity.** |
| Tool catalog size | 107+ brain tools wired (#155 + #181) | Cursor: ~30 built-in. Claude Code: ~15. ChatGPT Agent: ~50. **Borjie ahead in count, behind in self-discoverability.** |

---

## 3. Where Borjie has gaps vs. frontier

| Gap | Frontier reference | Borjie wave to close |
|-----|---------------------|------------------------|
| **Plan-before-execute DAG.** Multi-step chat requests today fire as a single tool or a hard-coded chain. No user-reviewable plan graph between intent and execution. | Manus AI Agent Mode generates and renders explicit plan graphs; users prune before firing | **CE-2** (this wave) |
| **Hands-free voice.** Voice STT exists only as `expo-av` audio capture for shift reports (workforce-mobile). No Web Speech API STT + TTS playback wired to chat. | ChatGPT Voice (conversation-only), no frontier vendor ships voice → agent yet | **CE-3** (this wave) |
| **Undo from chat.** Decision-journal recorder exists (`services/api-gateway/src/services/decision-journal/`) but no `undo` brain tool surface | Claude Code's "undo last edit", Cursor's worktree revert | **CE-5** (this wave) |
| **Confirmation gate visibility.** Policy gate runs server-side but chat-initiated kill-switch / four-eye / sovereign actions don't surface the explicit two-tap confirmation card in chat UI | ChatGPT Agent's risk-tiered preview-then-confirm | **CE-4** (this wave) |
| **Result-preview self-discovery.** Inline blocks render but the brain doesn't reliably select the *right* block kind for the result type (e.g. tabular query → table; ranked recommendation → ordered-list card) | Manus AI auto-selects block kind from result schema | **CE-6** (this wave) |
| **Citation click-through.** R1 inline citations exist (#175) but the click-through to source-of-truth is patchy across surfaces | ChatGPT Agent shows source-of-truth on every cited claim | **CE-7** (this wave) |

---

## 4. Architectural decisions

### 4.1 Plan-DAG representation

A multi-step plan is `{steps: PlanStep[], deps: Edge[]}` where:

```typescript
interface PlanStep {
  readonly id: string;
  readonly toolId: string;       // must exist in brain-tool catalog
  readonly input: unknown;       // zod-validated against tool's input schema
  readonly riskTier: 'low' | 'medium' | 'high';
  readonly evidenceIds: string[];
  readonly humanCheckpoint?: 'preview' | 'confirm' | 'two-tap';
}
```

The orchestrator (CE-2) renders this as `<plan_preview>` inline
block. User taps "Run" → orchestrator fires steps in topological
order, pauses at every `humanCheckpoint` for confirmation.

### 4.2 Voice loop architecture

Single integrated loop on owner-web:

```
Mic ── Web Speech API STT (sw-TZ + en-TZ) ──▶ chat input
                                                  │
                                                  ▼
                                          Mr. Mwikila brain
                                                  │
                                                  ▼
                                         Inline blocks rendered
                                                  │
                                                  ▼
                                  Web Speech API TTS plays response
```

On workforce-mobile and buyer-mobile, swap Web Speech for
`expo-speech` + `@react-native-voice/voice`. Same brain back-end.

### 4.3 Undo journal contract

Each chat-initiated mutation appends to `decision_journal` with a
`reversal_descriptor`:

```typescript
interface ReversalDescriptor {
  readonly toolId: string;            // the inverse tool
  readonly input: unknown;            // payload for the inverse
  readonly snapshotHash: string;      // for staleness detection
}
```

Brain tool `undo.last(n)` pops the top `n` entries, fires their
reversals in reverse order, asserts snapshot still matches before
each step. Conflict → preview the diff, ask user.

### 4.4 Risk tier mapping

Borjie's existing inviolables (CLAUDE.md hard rules) already define
risk tiers:

| Prefix | Tier | Default checkpoint |
|--------|------|---------------------|
| `kill_switch.*` | high | two-tap confirm |
| `four_eye.*` | high | second-approver block |
| `sovereign.*` | high | preview + owner confirm |
| `policy_rollout.*` | high | preview + owner confirm |
| `mining.production.*`, `treasury.ledger.*` | medium | preview |
| `ops.tabs.*`, `owner.reminders.*` | low | autonomous |
| All reads (`.search`, `.inspect`, `.list`) | low | autonomous |

This mapping is the single source of truth for CE-4. Stored in
`services/api-gateway/src/services/orchestration/risk-tiers.ts`.

---

## 5. Anti-patterns to avoid

- **Don't replicate the OpenAI Operator failure mode** where every
  step asks confirmation. Use risk tiers — low-risk fires
  autonomously.
- **Don't allow voice to skip confirmation gates.** Voice convenience
  must not bypass the kill-switch / four-eye / sovereign two-tap.
- **Don't let undo bypass policy gates.** The reversal must itself
  pass through `policy-gate.evaluate()`. Otherwise undo is a
  permission-escalation primitive.
- **Don't render plan graphs the user can't reason about.** Cap
  visible steps at 8; collapse deeper trees behind "Show details".

---

## 6. Wave map

| Scope | Outcome | Deliverable |
|-------|---------|-------------|
| **CE-1** (this wave, complete) | Coverage audit + research | `Docs/AUDIT/CHAT_ACTION_COVERAGE_2026-05-29.md`, this doc |
| **CE-2** | Plan-DAG orchestrator + top-5 complex flows | `services/api-gateway/src/services/orchestration/`, plan-preview inline block |
| **CE-3** | Voice hands-free verification | `apps/owner-web/src/components/voice/`, `Docs/OPS/VOICE_HANDS_FREE.md` |
| **CE-4** | Confirmation gates on chat-initiated mutations | `services/api-gateway/src/services/orchestration/risk-tiers.ts` |
| **CE-5** | Undo from chat | brain tool `undo.last(n)` + reversal descriptors |
| **CE-6** | Result-block self-selection | brain block-kind selector |
| **CE-7** | Citation click-through verification across surfaces | per-surface audit table |

---

## Sources

- [Claude Code by Anthropic](https://www.anthropic.com/product/claude-code)
- [Anthropic Claude 4.7 Computer Use](https://tech-insider.org/anthropic-claude-computer-use-agent-2026/)
- [Manus AI Agent Skills](https://manus.im/features/agent-skills)
- [Lindy — Manus AI Review 2026](https://www.lindy.ai/blog/manus-ai-review)
- [Introducing ChatGPT Agent](https://openai.com/index/introducing-chatgpt-agent/)
- [Coasty — OpenAI Operator Review](https://coasty.ai/blog/openai-operator-review-2026-20260510)
- [Claude Code Agent SDK Overview](https://code.claude.com/docs/en/agent-sdk/overview)
- [Cursor 3.5 IDE Guide](https://codersera.com/blog/cursor-ide-complete-guide-2026/)
- [ChatGPT Voice](https://chatgpt.com/features/voice/)
- [v0 Vercel — Introducing the new v0](https://vercel.com/blog/introducing-the-new-v0)
