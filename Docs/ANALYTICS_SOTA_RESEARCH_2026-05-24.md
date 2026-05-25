# Analytics SOTA Research — May 2026

This document captures the state of the art in analytics, dashboards, and AI-driven chart authoring as of May 2026, and records the design choices that shaped `@borjie/analytics` (v0.1.0).

The package focuses on a Cube-style semantic layer, Vega-Lite v6 chart spec builders, an AI chart author backed by the multi-LLM synthesizer, pre-shipped SOTA dashboard templates, and pluggable parsers for CSV/XLSX/JSON plus PDF/scan adapters for Unstructured.io and LlamaParse. It is intentionally a logic layer — no UI ships in v0.1.0; the React renderers will plug into these specs in a follow-up.

---

## 1. Chart grammar: Vega-Lite v6 + a permissive runtime validator

The four serious contenders in 2026 are Vega-Lite, Apache ECharts, Visx (React-on-D3), and Observable Plot.

- **Vega-Lite v6.x** — declarative JSON-spec grammar. Latest is `6.4.x` (May 2026). Schema URL: `https://vega.github.io/schema/vega-lite/v6.json`. ([Releases · vega/vega-lite](https://github.com/vega/vega-lite/releases), [Vega-Lite docs](https://vega.github.io/vega-lite/))
- **Apache ECharts 6** — canvas-by-default, tree-shakeable, comfortable with 100k+ points via LTTB downsampling; ships 600+ geo maps. Best for enterprise dashboards with large datasets. ([ECharts 6 release notes](https://echarts.apache.org/handbook/en/basics/release-note/v6-feature/))
- **Visx** — Airbnb's low-level React-on-D3 primitives, 15kB starting bundle. Best when "Vega doesn't bend that way". ([The Best React Chart Libraries for 2026](https://www.usedatabrain.com/blog/react-chart-libraries))
- **Observable Plot 0.7** — D3 ergonomics without the implementation pain. Best for static report figures. ([JS charting libraries 2026](https://www.usedatabrain.com/blog/javascript-chart-libraries))

**We adopt Vega-Lite v6** as the canonical spec format because the spec is *data*: one JSON document drives browser rendering, SSR-to-SVG export, PDF embedding, and AI authoring. The chart builders in `src/charts/builders.ts` produce v6 specs directly. Renderers that prefer ECharts or Visx can transform the spec in their own adapter; the upstream pipeline (semantic layer + AI author) stays one source of truth.

The runtime validator (`validateChartSpec` in `src/types.ts`) is intentionally permissive — it only enforces the fields the renderer must have (`data`, `mark`) and passes the rest through. This avoids breaking on Vega-Lite minor-version drift while still catching obviously malformed AI output.

---

## 2. Semantic layer: Cube-style cubes + the Open Semantic Interchange direction

The 2026 semantic-layer landscape is converging:

- **Cube.dev 0.36** — code-first, YAML/JS cube definitions, served via REST/SQL/GraphQL with pre-aggregation caching. Serves metrics, not just defines them. ([Cube vs dbt Semantic Layer](https://unwinddata.com/dbt-semantic-layer-vs-cube), [Top 10 Semantic Layer Tools in 2026](https://promethium.ai/guides/top-10-semantic-layer-tools-2026-definitive-comparison/))
- **dbt Semantic Layer (MetricFlow)** — defines metrics alongside data models in version-controlled YAML; managed API for downstream consumption.
- **Open Semantic Interchange (OSI)** — vendor-neutral YAML standard released January 2026 with Snowflake, dbt Labs, Cube, AtScale, Databricks, and 40+ partners. ([Semantic Layer Architectures](https://www.typedef.ai/resources/semantic-layer-architectures-explained-warehouse-native-vs-dbt-vs-cube))

**We adopt the Cube model** — `defineMetric`, `defineDimension`, `defineCube`, `compileQuery`. Three production-relevant choices:

1. **Tenant scoping is a compile-time invariant.** `compileQuery` injects `tenant_id = $tenant` as the first WHERE clause unconditionally. The result type carries `tenantScoped: true` as a literal so tests can assert it. There is no code path that bypasses this — a property tests in `semantic-compile-sql.test.ts` covers.
2. **Closed unions everywhere user input could leak.** `Aggregation`, `TimeGrain`, `FilterOp` are all `as const` unions; the switch over them is exhaustive; we cannot accept a caller-controlled `agg='DROP TABLE'`.
3. **Identifier safety regex.** Every column / table / dimension id flows through `/^[a-zA-Z_][a-zA-Z0-9_]*$/`. The cube author is a developer; the runtime is hostile data — this is the right place to draw the safety boundary.

**Deferred to v0.2:** OSI YAML import/export. The interchange spec is two months old; we ship the underlying Cube model now and add the OSI envelope when one of our downstream consumers needs it.

---

## 3. In-browser OLAP: DuckDB-WASM is the SOTA "client-side semantic layer"

DuckDB-WASM compiles the full DuckDB engine to WebAssembly, runs in a dedicated worker, reads Parquet / Arrow / CSV / JSON directly, and consistently handily out-performs JavaScript-based libraries on GROUP BY / JOIN / AGGREGATE. ([OLAP in Your Browser: DuckDB Meets Wasm (Vectorlane, Jan 2026)](https://medium.com/@jickpatel611/olap-in-your-browser-duckdb-meets-wasm-9248b1077281), [Browser OLAP Is Here (Syntal, Jan 2026)](https://medium.com/@sparknp1/browser-olap-is-here-duckdb-wasm-changes-teams-b13d3b7352e3), [DuckDB-Wasm intro (duckdb.org)](https://duckdb.org/2021/10/29/duckdb-wasm))

**We adopt** the *port shape* — `MemoryQuery` + `evaluateMemory` give us a complete in-memory query path today, which makes uploaded CSV/XLSX/JSON queryable through the same cube model the warehouse uses. The DuckDB-WASM adapter will land in the renderer package (so callers without WASM can still use the in-memory evaluator).

**Deferred to v0.3:** Apache Arrow + Parquet wire transport. The browser/server boundary is the cube fetcher port (`QueryFetcher`); when we add DuckDB-WASM, we will ship rows as Arrow tables. Today, JSON rows are sufficient.

---

## 4. Streaming analytics: streaming DBs are the right tool for live dashboards

The 2026 streaming-OLAP landscape:

- **ClickHouse 24.x** — push pull, OLAP cluster, seconds-level freshness via batch ingestion. Best for ad-hoc analytical queries on huge historical sets. ([ClickHouse: How to choose a database for real-time analytics in 2026](https://clickhouse.com/resources/engineering/how-to-choose-a-database-for-real-time-analytics-in-2026))
- **Materialize** — incremental view maintenance, strong consistency guarantees, mature DDL.
- **RisingWave** — most complete incremental materialized view implementation in 2026: cascading views, complex joins, sub-second updates, PostgreSQL-compatible, Apache 2.0. ([RisingWave: Best streaming DBs 2026](https://risingwave.com/blog/best-streaming-databases-real-time-analytics-2026/), [Materialize vs RisingWave](https://materialize.com/guides/materialize-vs-risingwave/))

**Why it matters:** the SOTA pattern is to push deltas to the renderer rather than re-run the full query. Vega-Lite supports data updates as transactions — the renderer applies a delta without re-laying out the chart.

**We adopt** the *delta + throttle* shape — `subscribeToWidget` returns an `AsyncIterable<DataDelta>` and coalesces multiple pushes within the throttle window (default 1Hz). The `RealtimePort` is the thin port; we wire `@borjie/realtime-adapter` at composition time without taking it as a hard dep.

**Deferred:** the actual ClickHouse / RisingWave connector. The cube `source.kind === 'sql'` path is sufficient — the warehouse adapter sits behind the existing `QueryFetcher` port.

---

## 5. AI chart authoring: Vanna 2.0 / WrenAI / Hex Magic / Tableau Pulse pattern

The 2026 NL→chart playbook converged this year:

- **Vanna.ai 2.0 (late 2025)** — agent framework with user-aware identity, row-level security, audit logging, streaming chat. Component library you embed. ([Vanna GitHub](https://github.com/vanna-ai/vanna))
- **WrenAI** — complete BI platform with semantic-layer-driven GenBI; built around the "context layer" giving the agent grounded, governed memory. ([WrenAI GitHub](https://github.com/Canner/WrenAI), [Wren AI vs. Vanna](https://www.getwren.ai/post/wren-ai-vs-vanna-the-enterprise-guide-to-choosing-a-text-to-sql-solution))
- **Tableau Pulse** — proactive insight generation in Slack/Teams; metric trend alerts without manual queries. ([Tableau Pulse](https://www.tableau.com/products/tableau-pulse))
- **Power BI Copilot** — full-page report generation from prompts, with DAX measure proposals. Q&A retiring Dec 2026 in favor of Copilot. ([Conversational analytics in 2026](https://sascharudolph.com/portfolio/enabling-conversational-analytics-with-tableau-gpt-powerbi-copilot-and-co/))
- **ThoughtSpot Sage / Spotter** — natural-language search backed by SpotIQ, with GPT writing SQL that Sage converts to ThoughtSpot's query language. ([Natural-language BI 2026](https://querio.ai/articles/natural-language-query-business-intelligence-thoughtspot-vs-power-bi-vs-tableau-2026))
- **Hex Magic** — notebook-native AI that produces SQL + chart + commentary; anchors to known-good templates so output is renderable.

**Shared pattern (we adopt this):**

1. Build a *templated* prompt grounding the model in the data schema + question.
2. Always anchor against a *deterministic template* — the LLM may override, but the fallback is always renderable.
3. Validate LLM output against a chart-spec schema before showing it to the user. Reject and fall back if it fails.
4. Carry the SQL the model wrote in the response (transparency + caching).

**We implement** this in `src/ai-chart-author/`:

- `pickTemplate(question, schema, preferred)` — heuristic keyword router (trend→line, share→pie, distribution→boxplot, correlate→scatter, heatmap→rect, default bar). Identical pattern to Tableau Pulse routing.
- `authorChartFromQuestion({ request, brain, sampleData })` — LLM path with deterministic fallback. Fallback fires on: brain throws, JSON doesn't parse, Vega-Lite validation fails.
- `brainFromSynthesizer(syn)` — adapter wrapping the existing `@borjie/ai-copilot/providers/multi-llm-synthesizer` so the chart author rides the same Mixture-of-Agents proposer/synthesizer pipeline as the rest of the platform's high-stakes reasoning.

**Why the deterministic fallback matters:** the SOTA tools all do this. Hex Magic refuses to show an unrenderable spec; Pulse falls back to a baseline template if its LLM fails. Surfacing a broken spec to the user is the single worst UX failure in this category.

**Deferred:** Anthropic Citations integration. The pipeline that produces evidence-backed natural-language insights will be a separate package (`@borjie/insights`) layered on top of analytics; that is where Citations belong.

---

## 6. Data parsing: pluggable adapters for the PDF/scan path

The 2026 document-parser benchmark winners:

- **Unstructured.io** — widest file-type coverage (PDF, DOCX, PPTX, emails, HTML, images), hybrid rule-based + model-based partitioning, SOC 2 Type II + HIPAA, in-VPC deployment. ([Unstructured benchmarks](https://unstructured.io/benchmarks))
- **LlamaParse** — fastest default for LlamaIndex-native RAG; SDK-driven upload → job poll → result. Best for the "easy 80%". ([LlamaParse vs Unstructured](https://www.llamaindex.ai/compare/llamaparse-vs-unstructured))
- **Reducto** — up to 20% higher parsing accuracy on real-world docs; SOC 2 + HIPAA + on-prem deployment; positioned for regulated industries (healthcare, insurance, finance). ([Reducto vs LlamaParse 2026](https://apiscout.dev/guides/llamaparse-vs-reducto-best-document-ai-api-2026))
- **GROBID** — rule-based, no GPU; lags learning-based approaches on table extraction. Useful for cited research extraction.

Common production pattern: route Unstructured for the common 80%, escalate to LlamaParse or Reducto on the "hard PDF" path.

**We implement** `createUnstructuredParser` and `createLlamaParseParser` as `DocumentParser` adapters in `src/parsers/document.ts`. Both:

- Fail fast at construction time when no API key is configured.
- Accept an injectable `fetchFn` for test + proxy paths.
- Surface HTTP errors with the status code so callers can route retries.

The `DocumentParserRegistry` resolves a parser by id; the composition root picks the right parser per tenant + per MIME. Adding Reducto + GROBID is a 50-line patch and one entry in the registry.

For CSV / JSON we ship built-in parsers (zero dep, the CSV parser is ~150 LOC and RFC-4180 compliant). XLSX is a port (`XlsxAdapter`) — we deliberately do not depend on the 2MB `xlsx` package; consumers wire it once with `xlsxAdapterFromSheetjs(XLSX)`.

`inferSchema` produces a `SchemaProfile` for any `ParsedRow[]`: per-column inferred type, null + distinct counts, numeric summary (min/max/mean/median), small sample. This is what the AI chart author reads to ground its prompt.

---

## 7. Embeddable BI: keep the dashboard a portable JSON document

The SOTA embeddable BI in 2026 is **Sigma**, **Mode**, **ThoughtSpot Embed**, and the new **embeddable.com** SDK. The shared pattern: a dashboard is a serialisable spec the embedder evaluates against a tenant-scoped data source. Authentication is JWT/JOSE per embed session.

**We implement** the *dashboard-as-data* shape in `src/dashboards/compose.ts`: `DashboardDef` is the JSON document, `evaluateDashboard(def, fetcher)` is the pure orchestrator that gathers rows + assembles render-ready specs, and the renderer is a separate concern.

Four SOTA templates ship in `src/dashboards/templates.ts`:

1. **`leasing-financial-performance`** — Gross Rental Income, Occupancy Rate, Arrears (30d), Renewal Rate KPIs + Revenue Trend line + Lease Status pie.
2. **`maintenance-ops`** — Open Tickets, MTTR, SLA Breaches, CSAT gauge + Ticket Lifecycle funnel + Day×Hour demand heatmap.
3. **`tenant-credit`** — Default Rate, Avg Credit Score, Prime/Subprime Ratio + score-distribution boxplot + default-rate trend.
4. **`portfolio-overview`** — NOI, Cap Rate, properties, units + asset-class bar + region pie + markdown notes.

Each template is a function `(params) → DashboardDef`. Every widget query is tenant-scoped by construction (the composer pins `tenantId` on every `Query`).

**Deferred:** signed embed JWTs. Embed sessions belong in `services/api-gateway` (it already issues tenant tokens); the analytics package emits `DashboardDef`s + the gateway wraps them in the embed envelope.

---

## 8. Augmented analytics: Pulse-style proactive insights

Tableau Pulse, ThoughtSpot Spotter, and Power BI Copilot all converged on:

- Proactive metric monitoring (daily check, alert on anomaly).
- Natural-language explanation of changes ("revenue is down 12% week-over-week, driven primarily by the office segment in Nairobi").
- Push to Slack / Teams rather than waiting for the user to open the dashboard.

**We defer the explanation-generation path** to a separate `@borjie/insights` package — that is where Anthropic Citations and the metric-anomaly detector belong. The hook is already there: `evaluateDashboard` returns the raw rows alongside the render-ready spec, which is what an insights generator needs.

**We adopt now:** the `RealtimePort` + `subscribeToWidget` shape gives us the push half (delta arrives → coalesced → emitted). The metric-anomaly half is one composition-root wiring away.

---

## Summary: what we adopted, what we deferred, why

| Area | Adopted in v0.1.0 | Deferred (and why) |
|---|---|---|
| Chart grammar | Vega-Lite v6 spec builders, permissive runtime validator | ECharts / Visx adapters (renderer concern) |
| Semantic layer | Cube model: defineMetric / defineDimension / defineCube / compileQuery, tenant-scoped by construction, closed-union safety | OSI YAML import (spec is 4 months old, no consumer yet) |
| In-browser OLAP | MemoryQuery + evaluateMemory (same shape DuckDB-WASM will plug into) | DuckDB-WASM adapter (lives in renderer) |
| Streaming | RealtimePort + subscribeToWidget with throttled coalescing | RisingWave / ClickHouse cube adapters (compose-time wiring) |
| AI chart author | Template + LLM with deterministic fallback, multi-LLM synthesizer port, JSON-mode validation | Anthropic Citations (belongs in insights pkg) |
| Parsers | Built-in CSV/JSON, XLSX port, Unstructured.io + LlamaParse adapters, schema inference | Reducto + GROBID adapters (one-file additions) |
| Dashboards | DashboardDef + evaluateDashboard + 4 SOTA templates | Signed embed JWTs (gateway concern) |
| Augmented analytics | Delta + throttle infra ready for insights pkg | Metric-anomaly detector + NL explanation (separate pkg) |

The deliberate scope: ship the *logic substrate* — types, semantic layer, chart specs, parsers, AI chart author, dashboard templates, streaming bridge — without committing to a specific renderer, warehouse, or LLM provider. Composition root choices stay choices.

---

## Cited sources

1. [Releases · vega/vega-lite (GitHub)](https://github.com/vega/vega-lite/releases)
2. [Vega-Lite official docs](https://vega.github.io/vega-lite/)
3. [ECharts 6 release notes (Apache ECharts)](https://echarts.apache.org/handbook/en/basics/release-note/v6-feature/)
4. [Cube vs dbt Semantic Layer: Architecture Guide (Unwind Data)](https://unwinddata.com/dbt-semantic-layer-vs-cube)
5. [Top 10 Semantic Layer Tools in 2026 (Promethium)](https://promethium.ai/guides/top-10-semantic-layer-tools-2026-definitive-comparison/)
6. [Semantic Layer Architectures: Warehouse vs dbt vs Cube (Typedef)](https://www.typedef.ai/resources/semantic-layer-architectures-explained-warehouse-native-vs-dbt-vs-cube)
7. [OLAP in Your Browser: DuckDB Meets Wasm (Vectorlane, Jan 2026)](https://medium.com/@jickpatel611/olap-in-your-browser-duckdb-meets-wasm-9248b1077281)
8. [DuckDB-Wasm: Efficient Analytical SQL in the Browser (DuckDB)](https://duckdb.org/2021/10/29/duckdb-wasm)
9. [Best Streaming Databases for Real-Time Analytics 2026 (RisingWave)](https://risingwave.com/blog/best-streaming-databases-real-time-analytics-2026/)
10. [Materialize vs RisingWave comparison (Materialize)](https://materialize.com/guides/materialize-vs-risingwave/)
11. [Real-time analytics platforms 2026 (ClickHouse)](https://clickhouse.com/resources/engineering/real-time-analytics-platforms-a-practical-comparison)
12. [Vanna.ai 2.0 (GitHub)](https://github.com/vanna-ai/vanna)
13. [WrenAI (GitHub)](https://github.com/Canner/WrenAI)
14. [Wren AI vs. Vanna: Enterprise Guide to Text-to-SQL (Wren AI)](https://www.getwren.ai/post/wren-ai-vs-vanna-the-enterprise-guide-to-choosing-a-text-to-sql-solution)
15. [Tableau Pulse product page (Tableau)](https://www.tableau.com/products/tableau-pulse)
16. [Conversational analytics with Tableau GPT, Power BI Copilot & Co. (Rudolph)](https://sascharudolph.com/portfolio/enabling-conversational-analytics-with-tableau-gpt-powerbi-copilot-and-co/)
17. [Natural-language BI: ThoughtSpot vs Power BI vs Tableau 2026 (Querio)](https://querio.ai/articles/natural-language-query-business-intelligence-thoughtspot-vs-power-bi-vs-tableau-2026)
18. [Document Parser Comparison: Docling vs LlamaParse vs Unstructured vs Reducto (Reducto)](https://llms.reducto.ai/document-parser-comparison)
19. [Unstructured benchmarks (Unstructured.io)](https://unstructured.io/benchmarks)
20. [LlamaParse vs Reducto 2026 (APIScout)](https://apiscout.dev/guides/llamaparse-vs-reducto-best-document-ai-api-2026)
21. [Best React Chart Libraries for 2026 (Databrain)](https://www.usedatabrain.com/blog/react-chart-libraries)
