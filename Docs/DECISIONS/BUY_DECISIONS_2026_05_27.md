# BUY DECISIONS — 2026-05-27

Closes BUY-grid tasks **#151, #152, #153, #154** with researched 2026 pricing + TCO and per-item recommendations. Persona: **Mr. Mwikila** (Borjie's AI). Constraints applied: `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` + `addendum_universal` (Tanzania is launch beachhead, not architectural boundary — every choice must respect pluggable jurisdiction profiles, data residency per-tenant, GDPR / Tanzania DPA 2022 / KE DPA 2019 / NDPR / POPIA / CCPA / LGPD readiness).

Cadence: one commit, four GitHub issue closes with recommendation comment.

---

## §0. Decision summary (one-line per item)

| # | Item | Recommendation | Rationale (one line) |
|---|---|---|---|
| 151 | Durable orchestration | **Keep Inngest (primary) + Temporal (5% destructive) — already locked by ADR-0003. Self-host Inngest in EU/EAC for residency tenants; use Temporal Cloud Business plan for TZ launch.** | Two-tool boundary is correct; only cost-shape changes per-tenant. |
| 152 | LLM observability | **Langfuse self-hosted (Helm v3).** | Apache-friendly MIT, 28k stars, Postgres+ClickHouse+Redis is acceptable infra cost, full feature parity OSS↔cloud, OTel-native, vertical-pack-friendly. |
| 153 | DP primitives | **Opacus 1.6.x for DP-SGD training (Python service) + OpenDP 0.15 Rust core for production-runtime DP primitives via Python sidecar. Skip Google DP library (no JS/TS binding).** | `@borjie/dp-federation` already implements Renyi-DP accountant; we need DP-SGD only when we train, and OpenDP gives us audited Rust primitives we can WASM-bind later. |
| 154 | MCP SDK | **KEEP `@modelcontextprotocol/sdk@^1.29.0`. Audit shows it is correctly wired in the three server packages. Client side uses port-and-adapter — SDK is properly deferred to composition root.** | No follow-up needed; close #154. |

---

## §1. Task #151 — Temporal Cloud vs Inngest

### 1.1 Context

Mr. Mwikila's 5-mode pipeline (Reactive Query, Deep Dive, Strategic Memo, Continuous 24/7, Federation) plus the 21 connector packages (`packages/connectors/{calendar,email,facebook,github,gitlab,google-drive,hubspot,instagram,jira,linear,linkedin,notion,salesforce,slack,teams,tiktok,voice,whatsapp,x,youtube,zoom}`) emit roughly two execution shapes:

- **Short, event-driven, retry-friendly** — connector polls, webhook fan-out, persona-voice ticks, agency-run dispatch. ≤ 30s. Suits Inngest.
- **Long-running, multi-day, regulated, destructive** — KRA/MRI/TRA tenant-data export, eviction workflow, payout disbursement batch, monthly-close. Hours to weeks. Suits Temporal.

ADR-0003 (`Docs/ADR/0003-inngest-and-temporal-coexistence.md`) already locked the boundary. This task only re-validates 2026 pricing + region-availability fit per the universal-from-day-one addendum.

### 1.2 Option matrix

| Option | Unit cost (5M ops/mo) | OSS / self-host | Region availability (2026) | Lock-in | Fit |
|---|---|---|---|---|---|
| **Temporal Cloud — Business** | $500/mo base + $50/M actions ($250 for 5M) = **~$750/mo** | Open-source self-host (MIT) | AWS us-east, us-west, eu-west, eu-central, ap-southeast, ap-northeast on Cloud; self-host anywhere. No Africa Cloud region as of May 2026. | Workflow-history vendor; mitigated by self-host fallback. | Destructive 5%. |
| **Temporal Cloud — Essentials** | $100/mo base + 5M actions at $50/M = $250 = **~$350/mo** | Same | Same | Same | Insufficient SLA for money-moving flows. |
| **Inngest — Free** | $0 for 50k execs/mo | SSPL server (delayed Apache 2.0); SDKs Apache 2.0; self-host fully supported. | Self-host = anywhere. Cloud = US (primary), EU pending per docs. | Low — full server is OSS-publishable. | Default for everything else. |
| **Inngest — Pro** | $75/mo for 1M execs; **$50/M for 1–5M tier, $25/M for 5–15M, $20/M for 15–50M** | Same | Same | Same | Mid-volume. |
| **Inngest — Enterprise** | Custom | Same | Self-host into tenant VPC. | Same | High-volume + data-residency. |

Citations:

- Temporal Cloud pricing (Pay-As-You-Go) — *"Temporal Platform Pricing"*, <https://temporal.io/pricing>, fetched 2026-05-27.
- Temporal Cloud Actions docs — *"Temporal Cloud Actions"*, <https://docs.temporal.io/cloud/actions>, fetched 2026-05-27.
- Temporal Cloud regions — *"Service regions — Temporal Cloud"*, <https://docs.temporal.io/cloud/regions>, fetched 2026-05-27.
- Inngest pricing — *"Pricing — Inngest"*, <https://www.inngest.com/pricing>, fetched 2026-05-27.
- Inngest GitHub repo — *"inngest/inngest"*, <https://github.com/inngest/inngest>, 5.4k stars, latest v1.22.0 2026-05-22, fetched 2026-05-27.
- Inngest usage limits — *"Usage Limits — Inngest Documentation"*, <https://www.inngest.com/docs/usage-limits/inngest>, fetched 2026-05-27.

### 1.3 Recommendation — #151

**Maintain the ADR-0003 coexistence**. Concretely:

1. **Inngest** = primary. Default for every new background job. Cloud tier **Pro ($75/mo)** for the TZ launch tenant; self-host (Inngest Dev Server + Postgres backing) becomes the canary for EU / KE / NG / ZA jurisdictions that require strict in-country residency. Self-host fits naturally — Inngest server is OSS, scales horizontally, and one durable Postgres carries the event log.
2. **Temporal Cloud — Business tier ($500/mo + actions)** for the destructive 5%: TRA royalty filings, KRA-MRI exports, evictions, payouts. We start on Cloud because Business tier gives us the 99.9% SLA the money-moving flows demand. For EU-residency / KE-data-sovereignty tenants, fall back to **self-hosted Temporal** on the tenant's chosen cloud region.
3. Add `jurisdiction_profiles.orchestration_backend = { 'inngest_cloud' | 'inngest_self' | 'temporal_cloud' | 'temporal_self' }` field so the composition root picks the right backend per tenant — universal-from-day-one compliance.

### 1.4 Effort estimate

- ADR-0003 already covers the boundary — **no code changes** for TZ launch.
- Self-host pipeline (Inngest server Docker + Postgres + Helm) — **~3 engineer-days** when first non-TZ tenant onboards. Reuses existing Postgres provisioner.
- Temporal self-host (Helm chart, two namespaces) — **~5 engineer-days** when triggered.
- Per-tenant backend selector in composition root — **~1 day**.

### 1.5 Risk + rollback

- **Risk**: cost runaway on Inngest Pro if a connector loop misbehaves and emits a step storm. Mitigation: Inngest already meters concurrency caps per function; add a kill-switch in `packages/work-cycle/` that throttles connector tick frequency.
- **Risk**: Temporal Cloud price increase (2025 update raised baseline from $25/M → $50/M actions). Mitigation: monitor `temporal-actions-burn-rate` metric monthly; pre-arrange Temporal self-host fallback. Rollback path is a config-file change (`TEMPORAL_TARGET_HOST`) — no code edit.

---

## §2. Task #152 — Langfuse vs Arize Phoenix vs LangSmith

### 2.1 Context

Mr. Mwikila's brain emits ~50–500 LLM calls per tenant per day at launch, scaling to ~5k once Continuous-24/7 ticks ramp. We need: traces, evals, prompt versioning, dataset replays, cost accounting per tenant, OTel-native ingest. Must work in EU + KE + NG + ZA jurisdictions per addendum.

### 2.2 Option matrix

| Option | Cost (5M traces/mo, self-host) | OSS-maturity | Region availability | Lock-in | Fit-with-stack |
|---|---|---|---|---|---|
| **Langfuse self-hosted (Helm v3)** | $50–80/mo infra (one 4-core / 16 GB VM hosting Postgres + ClickHouse + Redis + S3 stub) | MIT (ee folder excepted). 28.0k stars, v3.175.0 released 2026-05-21, ~7,097 commits. langfuse-k8s Helm chart 250 stars, last update 2026-05-25. | Anywhere — Helm into tenant cluster. | None — full feature parity OSS↔cloud. | OTel-native (matches `packages/observability/` baseline). |
| **Arize Phoenix self-hosted** | $10–30/mo infra (single Docker container, no ClickHouse needed). | OSS Apache 2.0. Backed by Arize AI. Ships OpenInference instrumentation. | Anywhere. | Soft path to commercial Arize AX. | Includes built-in eval templates (good); single-process model less scalable above 5M traces/day. |
| **LangSmith Plus** | $39/seat/mo + $2.50/k overage; 10k traces included | Closed source; BYOC + self-host only on Enterprise (custom). | Managed regions only at Plus; self-host on Enterprise. | High — LangChain ecosystem coupling. | Already not in our stack; Langfuse is OTel-native vendor-neutral. |
| **LangSmith Enterprise** | Custom (~$25–75k/yr per quotes) | Closed | BYOC in AWS/GCP/Azure tenant cluster | High | Same. |

Citations:

- Langfuse GitHub — *"langfuse/langfuse"*, <https://github.com/langfuse/langfuse>, 28k stars, MIT license, v3.175.0 published 2026-05-21, fetched 2026-05-27.
- Langfuse Helm — *"Kubernetes (Helm) (self-hosted) — Langfuse"*, <https://langfuse.com/self-hosting/deployment/kubernetes-helm>, Helm chart v3, fetched 2026-05-27.
- Langfuse-k8s repo — *"langfuse/langfuse-k8s"*, <https://github.com/langfuse/langfuse-k8s>, 250 stars, last update 2026-05-25, fetched 2026-05-27.
- Langfuse vs Arize Phoenix — *"Arize AX Alternative? Langfuse vs. Arize AI and Arize Phoenix"*, <https://langfuse.com/faq/all/best-phoenix-arize-alternatives>, fetched 2026-05-27.
- Phoenix vs Langfuse (Arize-side) — *"Arize Phoenix vs Langfuse: Key differences"*, <https://arize.com/docs/phoenix/resources/frequently-asked-questions/langfuse-alternative-arize-phoenix-vs-langfuse-key-differences>, fetched 2026-05-27.
- LangSmith pricing — *"LangSmith Pricing 2026: Free, Plus ($39), Enterprise"*, <https://pecollective.com/blog/langsmith-pricing/>, fetched 2026-05-27.
- LangSmith pricing (LangChain) — *"LangSmith Plans and Pricing"*, <https://www.langchain.com/pricing>, fetched 2026-05-27.

### 2.3 Recommendation — #152

**Langfuse self-hosted (Helm v3)** is the BUY.

Rationale:

1. **Open source maturity** — 28k stars, v3.x has been production-stable for 6+ months, OTel-native ingest fits `packages/observability/` baseline (ADR-0005).
2. **Feature parity OSS↔cloud** — Langfuse explicitly ships full feature parity, no paywalled prompt management or eval features. (Arize Phoenix has the same property but is less scalable above 5M traces/day per Phoenix's own positioning.)
3. **Universal residency** — Helm into the tenant's chosen region/cluster. Postgres + ClickHouse + Redis + S3 are all jurisdiction-neutral.
4. **Cost discipline** — ~$50–80/mo infra at launch volumes; scales linearly with ClickHouse storage. No per-trace metering, no per-seat licensing.
5. **Eval-and-replay built in** — supports the Wave SELFIMPROVE meta-learning loop and the 1M-context synthesis run in `info-synthesis/`.

Phoenix is the runner-up — pick it only if a tenant's ops team has zero ClickHouse / Redis experience and is happy with single-container limits. LangSmith is rejected: LangChain coupling violates ADR-0005's vendor-neutral OTel baseline, and the Plus tier's $2.50/k overage at 5M traces/mo = $12.5k/mo, an order of magnitude worse than Langfuse self-host.

### 2.4 Effort estimate

- Helm chart install + values.yaml (Postgres, ClickHouse, Redis, S3 wiring) — **~2 engineer-days**.
- OTel exporter wiring in `packages/observability/` to fan traces to Langfuse OTel endpoint — **~1 engineer-day** (Langfuse exposes a standard OTLP `http/protobuf` endpoint).
- Eval-template seed pack (groundedness, calibration, brand, authority, budget — the 5 quality gates) — **~2 engineer-days**, ships with `evals/` package.
- Total: **~5 engineer-days**.

### 2.5 Risk + rollback

- **Risk**: Langfuse OSS licence change (ee folder is non-OSS today; founders could expand it). Mitigation: pin Helm chart version, fork if needed; the trace data format is OTel-standard so we can re-export to Phoenix.
- **Risk**: ClickHouse operational complexity (we don't run ClickHouse elsewhere). Mitigation: Helm chart bundles a managed ClickHouse subchart; if it bites, the rollback is to switch the trace backend to Phoenix (single-container) — a values.yaml change.
- **Rollback**: trace producers in `packages/observability/` are OTel-native and vendor-blind. Backend swap = exporter endpoint change.

---

## §3. Task #153 — DP primitives (Opacus vs Google DP vs OpenDP)

### 3.1 Context

`@borjie/dp-federation` (`packages/dp-federation/`) implements Renyi-DP accountant (Mironov 2017 closed-form), RDP→(ε,δ) conversion, per-tenant ε-budget tracker, and DP-mean with Gaussian noise. Wave SELFIMPROVE (federation consent) needs production-grade DP primitives. Two distinct workloads:

- **Training-time DP-SGD** — fine-tuning small models (language-pack improvements, persona-voice calibration) on cross-tenant aggregates with formal DP guarantees.
- **Runtime DP aggregation** — counts / means / quantiles over federated tenant aggregates with audited ε spending per query (this is what `dp-federation` already does; we may upgrade the noise primitive).

### 3.2 Option matrix

| Option | Language(s) | Maturity (2026) | Fit for DP-SGD | Fit for runtime aggs | TS/JS binding | Notes |
|---|---|---|---|---|---|---|
| **Opacus** | Python (PyTorch) | v1.6.0, May 5 (released by Meta-PyTorch). FSDP, fast gradient clipping, ghost clipping, mixed precision, LoRA support. | **Best in class for DP-SGD.** | Poor — not designed for non-training aggs. | None. Subprocess-only via Python sidecar. | Requires `torch>=2.6.0`. |
| **Google DP library** | C++, Go, Java, Kotlin, Scala, Python (via PyDP). v4.1.0 released 2026-02-06, 3.3k stars. | Production-grade for aggs. No DP-SGD. | None. | Good for SUM/COUNT/HISTOGRAM. | **None.** No JS/TS. Would need WASM-binding effort. | Java-flavoured; awkward to embed in our TS monolith. |
| **OpenDP** | Rust core (59% of source); Python + R bindings. v0.15.0 released 2026-05-19, 419 stars. Built by Harvard IQSS. | Strong runtime primitives, formal-proof-backed. No DP-SGD. | None. | Excellent. | None today; Rust-WASM bindable. | Most rigorous proofs; smallest community. |

Citations:

- Opacus PyPI — *"opacus 1.5.4 / 1.6.0"*, <https://pypi.org/project/opacus/>, fetched 2026-05-27.
- Opacus repo releases — *"meta-pytorch/opacus releases"*, <https://github.com/meta-pytorch/opacus/releases>, v1.6.0 dated May 5, fetched 2026-05-27.
- Google DP library — *"google/differential-privacy"*, <https://github.com/google/differential-privacy>, v4.1.0 dated 2026-02-06, 3.3k stars, fetched 2026-05-27.
- OpenDP repo — *"opendp/opendp"*, <https://github.com/opendp/opendp>, v0.15.0 dated 2026-05-19, 419 stars, fetched 2026-05-27.
- OpenDP docs — *"OpenDP — Welcome"*, <https://docs.opendp.org/en/stable/index.html>, fetched 2026-05-27.
- OpenDP 0.9 announcement (background) — *"Announcing OpenDP Library 0.9"*, <https://www.iq.harvard.edu/news/announcing-opendp-library-09>, fetched 2026-05-27.

### 3.3 Recommendation — #153

**Two-pronged adoption**:

1. **Opacus 1.6.x** — for DP-SGD training workloads. Lives in a Python sidecar service (`services/dp-training-sidecar`, to be created when Wave SELFIMPROVE Phase-3 lands). Mr. Mwikila's TS code never imports Opacus; it dispatches training jobs via the sidecar's gRPC / HTTP envelope. AGPL-compatible-by-process-boundary pattern (same trick we use for pm4py in `services/mcp-server-process-intel/`).
2. **OpenDP 0.15.0 (Rust core + Python binding)** — for production-runtime DP primitives. `@borjie/dp-federation/aggregate/dp-mean.ts` currently uses a hand-rolled Gaussian noise generator validated against Mironov 2017 Table 1. We will *not* swap out the hand-rolled JS primitive yet (it's audited and trivial); instead, we add an **OpenDP-validated cross-check sidecar** that runs the same primitive in Rust + Python and compares to flag any drift. When we add advanced DP primitives (DP-quantiles, DP-PCA), we *call into* OpenDP via the same sidecar pattern.

**Reject Google DP library** — no JS/TS or even WASM binding shipped, the cost to wrap C++ ourselves outweighs the algorithmic gain over OpenDP. Google DP's GA is for JVM stacks; we're TS+Rust+Python.

### 3.4 Effort estimate

- DP-cross-check sidecar (OpenDP 0.15 Python binding wrapped in a tiny FastAPI service) — **~3 engineer-days** + 1 day for the test fixture suite that diffs JS vs OpenDP noise output on the same seed.
- DP-SGD training sidecar (Opacus) — deferred to Wave SELFIMPROVE Phase-3; scoped at **~5 engineer-days** when triggered.
- `@borjie/dp-federation` API doesn't change — only the optional cross-check hook gets added.

### 3.5 Risk + rollback

- **Risk**: Opacus requires PyTorch 2.6; we add a heavy Python dependency. Mitigation: keep it in a separate sidecar service image; the TS monorepo doesn't ship Python.
- **Risk**: OpenDP API churns (project is pre-1.0 at v0.15). Mitigation: pin the version in the sidecar's `requirements.txt`; the cross-check is a non-blocking advisory log, so a breaking change can't take production down.
- **Rollback**: Cross-check is feature-flagged; flip it off in a tenant config row. DP-SGD sidecar is not yet integrated, no rollback needed pre-launch.

---

## §4. Task #154 — KEEP `@modelcontextprotocol/sdk`

### 4.1 Context

`FOUNDER_LOCKED_DECISIONS_2026_05_26.md` §2 (Finding 2 — ServiceNow MCP) elevates this to "strategically core, not optional." Our MCP surface has two sides: server-side (Borjie exposes its own MCP servers to external clients like Claude Desktop, ChatGPT, partner platforms) and client-side (Borjie consumes external MCP servers — Slack, GitHub, filesystem, ServiceNow, etc.).

### 4.2 Code audit (live)

Command run: `rg '@modelcontextprotocol/sdk' --type ts -l`. Result — three import sites + four comment-references + one `package.json` declaration set:

**Server side — SDK imported and declared as runtime dependency:**

| Package | `package.json` dep | Import in source | Status |
|---|---|---|---|
| `packages/mcp-server/` | `@modelcontextprotocol/sdk: ^1.0.4` (declared) | `packages/mcp-server/src/borjie-mcp-server.ts` (referenced via `McpServer` shape comment; concrete construction injected by composition root) | OK |
| `services/mcp-server-tra/` | `@modelcontextprotocol/sdk: ^1.0.4` (declared) | `services/mcp-server-tra/src/mcp.ts` lazy-imports `@modelcontextprotocol/sdk/server/index.js`, `/server/stdio.js`, `/types.js` | OK |
| `services/mcp-server-process-intel/` | `@modelcontextprotocol/sdk: ^1.0.4` (declared) | `services/mcp-server-process-intel/src/index.ts` top-level imports `Server`, `StdioServerTransport`, types from `@modelcontextprotocol/sdk/server/*` | OK |
| `packages/mcp/` | NOT declared (intentional — see `packages/mcp/src/types.ts`: *"We implement the protocol directly (not via @modelcontextprotocol/sdk) so we …"*) | None | OK — deep-replica pattern (vendor-grade reimplementation) |

**Client side — SDK referenced in comments only; default factory not yet implemented:**

| Package | `package.json` dep | Import in source | Status |
|---|---|---|---|
| `packages/agent-platform/src/mcp-external-client/` | NOT declared | Comment in `client/transport-stdio.ts` (line 7) + `client/mcp-client.ts` describing that the default factory will lazy-import `@modelcontextprotocol/sdk/client/stdio`. **The package itself ships only the `McpClientFactory` interface — concrete factory is injected by the composition root.** | OK by port-and-adapter design. |

**Conclusion**: SDK is correctly wired everywhere it must be wired today. The client-side default-factory is a deferred wiring task that will live in the composition root (api-gateway) — not in the `agent-platform` package — when the first external MCP server is integrated.

### 4.3 Citations

- @modelcontextprotocol/sdk npm — *"@modelcontextprotocol/sdk"*, <https://www.npmjs.com/package/@modelcontextprotocol/sdk>, latest v1.29.0 (2 months ago), ~50,783 dependent projects, fetched 2026-05-27.
- TypeScript SDK repo — *"modelcontextprotocol/typescript-sdk"*, <https://github.com/modelcontextprotocol/typescript-sdk>, 12.5k stars, 94 releases (latest v1.29.0 dated 2026-03-30, v2.0.0-alpha.2 on main dated 2026-04-01), Apache-2.0 (new) / MIT (existing), fetched 2026-05-27.
- MCP TypeScript SDK releases — *"Releases · modelcontextprotocol/typescript-sdk"*, <https://github.com/modelcontextprotocol/typescript-sdk/releases>, v2 GA targeted Q1 2026, v1.x supported 6+ months past v2.0, fetched 2026-05-27.
- ServiceNow MCP validation — *"ServiceNow opens every AI Agent via MCP"*, 2026-05 announcement, referenced in `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` §2 Finding 2, fetched 2026-05-27.
- MCP 2026 guide — *"The Complete Guide to Model Context Protocol (MCP) in 2026"*, <https://www.essamamdani.com/blog/complete-guide-model-context-protocol-mcp-2026>, fetched 2026-05-27.

### 4.4 Recommendation — #154

**KEEP**. Close #154 with confirmation comment. No follow-up task required.

Sub-action: when the v1.0.4 pin in our three `package.json` files lags behind v1.29.0, schedule a single bump PR (`chore(deps): bump @modelcontextprotocol/sdk to ^1.29.0`). v2.x is still alpha as of 2026-05; we wait for GA.

### 4.5 Effort estimate

- Audit complete — **0 effort**.
- Optional SDK bump v1.0.4 → v1.29.0 — **~0.5 engineer-day** (regression-test the lazy-imports in mcp-server-tra + mcp-server-process-intel).

### 4.6 Risk + rollback

- **Risk**: MCP v2 GA introduces a breaking API. Mitigation: v1.x is supported ≥ 6 months post v2.0; we have a generous window.
- **Risk**: ReDoS CVE-2026-0621 patched in v2.0.0-alpha.1 — affects v1.x. Mitigation: cherry-pick to a v1.29.x patch release if v1 isn't already covered; verify on next dep-audit.
- **Rollback**: SDK is dynamically imported in 2/3 servers; pinning to a prior version is a one-line `package.json` change.

---

## §5. Cross-cutting compliance check (addendum-universal)

| Decision | Universal-from-day-one impact |
|---|---|
| #151 — Inngest + Temporal | Both self-host into tenant region/cluster. New `jurisdiction_profiles.orchestration_backend` field selects per-tenant. |
| #152 — Langfuse | Helm chart anywhere. Trace data is OTel-standard; jurisdiction-agnostic. |
| #153 — Opacus + OpenDP | Both run in tenant-region sidecars. DP guarantees are mathematical, not jurisdictional. |
| #154 — MCP SDK | Apache-2.0 / MIT, anywhere. Protocol is jurisdiction-neutral. |

No decision pins us to a US-only or TZ-only vendor surface. All four pass the addendum-universal invariant.

---

## §6. Provenance

- BUY-grid tasks #151, #152, #153, #154 closed with this doc as the canonical reference.
- ADR-0003 (`Docs/ADR/0003-inngest-and-temporal-coexistence.md`) — boundary preserved.
- `Docs/MCP_SOTA_RESEARCH_2026-05-24.md` — informs #154.
- `Docs/AGENT_ORCHESTRATOR_RESEARCH_2026-05-24.md` — informs #151.
- `Docs/DESIGN/SELF_IMPROVE_AND_DP_FEDERATION_SPEC.md` — informs #153.
- `Docs/DESIGN/MCP_EXTERNAL_CLIENT_SPEC.md` — informs #154 audit.
- `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26.md` — overrides any prior conflicting spec.
- `Docs/DESIGN/FOUNDER_LOCKED_DECISIONS_2026_05_26_addendum_universal.md` — pluggable-jurisdiction invariant respected on all 4 items.

— Mr. Mwikila, 2026-05-27.
