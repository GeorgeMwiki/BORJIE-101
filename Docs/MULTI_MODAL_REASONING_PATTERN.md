# Multi-Modal Reasoning Orchestration Pattern

**Date:** 2026-06-11  
**Status:** Canonical pattern (required reading for ALL reasoning-UI integration)  
**Severity:** HIGH — closes the orchestration gap between ReAct kernel + GenUI composition

---

## The Problem: Disjoined Reasoning and UI Composition

Borjie's reasoning loop (main-loop orchestrator) and generative UI system (genui-tab-proposal) are **causally separated**:

```
┌─────────────────┐
│  Kernel         │
│  Reasoning      │
│  (ReAct)        │
│  → Decision     │
└────────┬────────┘
         │ "decision.kind: respond_to_owner"
         ▼
┌─────────────────────────────┐
│ Modality Arbiter            │
│ (post-classifies)           │
│ → routes to modality        │
└────────┬────────────────────┘
         │
    ┌────┴──────────────────────────┬─────────────────┬──────────────────┐
    ▼                                ▼                 ▼                  ▼
┌────────┐                    ┌────────────┐   ┌────────────┐   ┌─────────────┐
│  Chat  │                    │  GenUI     │   │ Forecast   │   │  Document   │
│ (pure  │                    │ Bridge     │   │ (separate) │   │  (separate) │
│ text)  │                    │ (separate) │   │            │   │             │
└────────┘                    └────────────┘   └────────────┘   └─────────────┘
```

**The gap:** reasoning has NO visibility into what UI the answer needs; UI detection runs POST-reasoning and cannot influence the reasoning strategy.

**Why it matters:** a single user prompt ("show me the workforce") should trigger:
- Reasoning about the workforce state (tools: graph queries, metrics, forecasts)
- Simultaneous UI composition decision (data table? org chart? timeline?)
- Data binding from reasoning artifacts directly into UI props (not re-fetched)

Today: reason → classify → detect-UI-intent → separate re-execution. The estate reasons twice.

---

## The Solution: Multi-Modal Reasoning Composer

A **unified orchestrator** that:

1. **Pre-reasoning:** declares candidate UI shapes from the user intent
2. **During reasoning:** reasons TOWARD a goal that emits both text + UI data
3. **Post-reasoning:** binds proven data + confidence signals → final multi-modal artifact

### Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  User Prompt                                                    │
│  "show me payroll by site"                                      │
│          │                                                       │
│          ▼                                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 1. INTENT CLASSIFIER (fast, <10ms)                      │  │
│  │    Detects: { domain: 'payroll', entity: 'site',        │  │
│  │              suggested_shapes: ['data_table',            │  │
│  │                                 'bar_chart'] }           │  │
│  └─────────┬──────────────────────────────────────────────┘  │
│            │                                                  │
│            ▼                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 2. MULTI-MODAL GOAL SYNTHESIS                           │  │
│  │    Reasoning goal: "answer owner question AND emit      │  │
│  │    proof-carrying data artifacts for the shapes:        │  │
│  │    [ table_schema, chart_spec ]"                        │  │
│  │                                                          │  │
│  │    This is the SYSTEM PROMPT modification — no new      │  │
│  │    capability, just a reframing.                        │  │
│  └─────────┬──────────────────────────────────────────────┘  │
│            │                                                  │
│            ▼                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 3. UNIFIED REASONING LOOP (main-loop)                   │  │
│  │    for each iteration:                                  │  │
│  │      - run tools as today                               │  │
│  │      - collect both TEXT evidence AND DATA ARTIFACTS    │  │
│  │      - emit tool_result with data provenance markers    │  │
│  │    Until: (a) answer is complete AND                    │  │
│  │           (b) ≥1 shape has proof-carrying data          │  │
│  └─────────┬──────────────────────────────────────────────┘  │
│            │                                                  │
│            ▼                                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ 4. MULTI-MODAL ANSWER ASSEMBLY                          │  │
│  │    - text: the final answer                             │  │
│  │    - artifacts: [                                       │  │
│  │        { kind: 'data_table',                            │  │
│  │          data: <proven data from tool result>,          │  │
│  │          schema: <inferred from data>,                  │  │
│  │          evidence_ids: [tool_result.callId, ...] },    │  │
│  │        { kind: 'bar_chart',                             │  │
│  │          data: <proven data>,                           │  │
│  │          spec: <vega spec>,                             │  │
│  │          evidence_ids: [...] }                          │  │
│  │      ]                                                  │  │
│  │    - confidence: scored post-reasoning                  │  │
│  └─────────┬──────────────────────────────────────────────┘  │
│            │                                                  │
│            ▼                                                  │
│  SSE Stream: [ text deltas, artifacts, citations ]         │  │
│                                                              │  │
└──────────────────────────────────────────────────────────────────┘
```

---

## Code-Level Contract

### 1. Intent Classifier (fast path, no I/O)

```typescript
interface MultiModalIntent {
  domain: string;           // 'payroll' | 'workforce' | 'assets'
  entity: string;           // 'site' | 'employee' | 'shift'
  action: string;           // 'show' | 'compare' | 'forecast'
  
  // Candidate UI shapes ranked by confidence
  suggested_shapes: Array<{
    kind: GenUICatalogType;  // 'data_table' | 'bar_chart' | etc
    confidence: number;       // [0, 1]
    reason: string;          // why this shape fits
  }>;
  
  // Fallback: always include 'chat' (safe default)
}
```

### 2. Goal Reframing

When a multi-modal intent is detected:

```typescript
// Before: "Answer the user's question."
// After:
const systemGoal = `
Answer the user's question AND emit proof-carrying data artifacts.

For each suggested shape in the intent:
- Run the requisite tools
- Prove the data: every cell/point carries an evidence_id back to a tool result
- Emit as a \`ui_artifact\` event with the shape's schema + data

The final answer MUST include:
1. Prose explanation (text)
2. ≥1 artifact (if shapes were suggested)
3. Citations for both (evidence_ids in artifacts; tool_result.callId in text)
`;
```

### 3. Data Artifact Protocol (During Reasoning)

Tools return **proof-carrying data:**

```typescript
interface ToolResultArtifact {
  kind: 'data';
  columns: Array<{ name: string; type: string }>;
  rows: Array<Record<string, unknown>>;
  row_evidence: Map<number, string[]>;  // row_index → [evidence_id, ...]
}

// Example tool result:
{
  kind: 'ok',
  message: 'Fetched payroll by site',
  data: {
    kind: 'data',
    columns: [
      { name: 'site_name', type: 'string' },
      { name: 'total_payroll', type: 'number' }
    ],
    rows: [
      { site_name: 'Mwadui', total_payroll: 125000 },
      { site_name: 'Bulyanhulu', total_payroll: 98000 }
    ],
    row_evidence: {
      0: ['payroll_query_result:row:0'],
      1: ['payroll_query_result:row:1']
    }
  },
  citations: [{ id: 'payroll_query_result', source: 'ledger_table' }]
}
```

### 4. Multi-Modal Response Shape

The orchestrator response now carries:

```typescript
interface OrchestratorMultiModalResponse {
  kind: 'answer';
  text: string;           // the prose answer as before
  artifacts: Array<{
    id: string;
    kind: GenUICatalogType;
    title?: string;
    data: Record<string, unknown>;        // proven data from tools
    schema?: Record<string, unknown>;     // inferred or declared schema
    spec?: Record<string, unknown>;       // Vega spec for charts
    evidence_ids: string[];               // trace back to tool results
    confidence: number;                   // [0, 1]
  }>;
  citations: Citation[];
  honesty?: HonestVerdict;
}
```

---

## Implementation Checklist

A build agent MUST implement:

### A. Intent Classifier Wiring

- [ ] Create `packages/central-intelligence/src/kernel/orchestrator/intent-classifier.ts`
- [ ] Implement fast multi-modal intent detection (rule + embedding tiers)
- [ ] Wire into `main-loop.ts` BEFORE reasoning (line 45 insertion point)
- [ ] Test: 50 intent fixtures (5 per domain × 10 domains)

### B. System Prompt Modifier

- [ ] Extend `packages/central-intelligence/src/kernel/assembler.ts`
- [ ] Add `renderMultiModalGoal(intent: MultiModalIntent): string`
- [ ] Fold into system prompt when `intent.suggested_shapes.length > 0`

### C. Tool Result Enrichment

- [ ] Extend `ToolOutcome` type to include optional `data: ToolResultArtifact`
- [ ] Audit 40 tools in `packages/central-intelligence/src/tools/registry.ts`
- [ ] Retrofit proof-carrying data on: graph_query, list_records, forecast, summary
- [ ] Leave others as-is (safe fallback to text-only)

### D. Answer Assembly

- [ ] Create `assembleMultiModalAnswer()` in main-loop
- [ ] Call after reasoning completes, before response
- [ ] Bind artifacts: data + schema + vega specs from tool results
- [ ] Confidence scoring: include artifact_confidence in honesty verdict

### E. Tests

- [ ] `__tests__/multi-modal-intent.test.ts`: 50 intents + fast path
- [ ] `__tests__/multi-modal-main-loop.test.ts`: end-to-end (text + 2 artifacts)
- [ ] `__tests__/tool-result-artifact.test.ts`: proof-carrying data protocol
- [ ] All tests: zero tolerance for mixed EN/SW in artifact titles/labels

### F. Docs

- [ ] Update `Docs/CODEMAPS/central-intelligence.md` § "Multi-modal Orchestration"
- [ ] Add flowchart: Intent → Goal Reframing → Unified Loop → Assembly
- [ ] Cross-reference: `MASTER_ARCHITECTURE.md` §1.7 (FACE)

---

## Guarantee of Correctness

This pattern:
- ✓ Preserves ReAct reasoning unmodified (system prompt adjustment only)
- ✓ Reuses existing tool registry + modality arbiter (no architectural breakage)
- ✓ Proof-carries data end-to-end (evidence_ids in artifacts)
- ✓ Falls back to chat-only when no multi-modal intent (safe default)
- ✓ Observes EN/SW purity (no mixing in generated artifact labels)
- ✓ Honors reversibility + autonomy (artifacts are attachments, not mutations)

---

## Related Work

| Existing System | Role | Unchanged By This Pattern |
|---|---|---|
| `main-loop.ts` | Reasoning engine | YES—only system prompt + response shape |
| `modality-arbiter.ts` | Output classification | YES—still routes post-hoc; this is PRE-reasoning |
| `genui-tab-proposal.ts` | Tab spawning | SUPPLEMENTED—can now read artifacts from reasoning |
| `agent-loop.ts` | Streaming contract | EXTENDED—new `ui_artifact` events, same SSE shape |
| `packages/genui` | UI rendering | UNCHANGED—already handles 32 kinds |

---

## The One Invariant

**Multi-modal reasoning is NOT a new cognitive capability** — it is a **unification of intent, reasoning, and UI composition into one directed loop**. The brain still thinks; the difference is it *thinks toward* a multi-modal goal and emits proof-carrying data the UI layer can bind without re-fetching. This closes the feedback loop between "what the user needs" and "what the reasoning produces" without adding a new reasoning engine.
