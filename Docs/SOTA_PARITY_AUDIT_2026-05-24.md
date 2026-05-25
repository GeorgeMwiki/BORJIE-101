# SOTA Parity Audit — Borjie — 2026-05-24

**Scope.** Compare Borjie's implementation against state-of-the-art
2026 patterns across 10 strategic domains. Each domain notes the SOTA
benchmark, our current implementation with file evidence, a parity
score (A best / D worst), top 3 gaps and recommended next moves.

**Method.** Read 150 source files, 5 web searches per domain class,
prior audits in `.audit/litfin-sota-2026-05-23/` and
`.audit/sota-2026-05-24/` consulted. P32 stalled before producing
output; this is the rerun at reduced scope (10 domains, not 25).

---

## 1. Multi-tenant SaaS architecture (RLS, schema-per-tenant)

**SOTA 2026 (cited):** Supabase + Postgres RLS is the default for B2B
multi-tenant SaaS; `tenant_id` column + RLS policies enforce isolation
at the database edge ([Auth0 / Multi-tenant SaaS authorization model
guide](https://auth0.com/blog/how-to-choose-the-right-authorization-model-for-your-multi-tenant-saas-application/),
[Antstack / Supabase multi-tenant RLS
playbook](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/)).
Production teams `FORCE ROW LEVEL SECURITY` to close the owner-bypass
loophole, scope `set_config('app.tenant_id')` to the transaction, and
write a CI test that flips tenant context between two tenants and
asserts no rows leak.

**Our implementation:** 152 migrations in
`packages/database/src/migrations/`. RLS bootstrapped in `0156_supabase_rls_phase2.sql`
and `0179_rls_policies.sql` (the catch-up generator). 27 migration
files set `ENABLE ROW LEVEL SECURITY`. `set_tenant_context(tenant,
service_role)` helper installed. Three Supabase client variants in
`packages/supabase-client/src/{admin-client,user-client,rls-aware-client}.ts`.
Per-request tenant binding in `packages/database/src/rls/with-tenant-context.ts`
plus the api-gateway tenant-context middleware.

**Parity score:** B

**Top 3 gaps:**
1. No schema-per-tenant tier — every tenant is row-scoped, so the
   largest enterprise customers cannot get a dedicated schema for
   tighter blast radius.
2. No automated cross-tenant leak test in CI (the gates exist as
   unit tests but no test that boots two real tenants and proves
   isolation through every API route).
3. The 5 newly-wired persistent stores (lessonStore, wormAudit,
   skillRegistry, aopRegistry, a2aTaskStore) are constructed in
   `service-registry.ts` but never `c.set()` on the Hono context, so
   downstream routes that read `c.get('lessonStore')` always fall
   through to the in-memory shim — see
   `services/api-gateway/src/composition/service-context.middleware.ts`.

**Recommended next moves:** Wire the 5 stores onto the Hono context.
Add a `tests/cross-tenant-leak.spec.ts` that loops every router with
two tenants and asserts 404.

---

## 2. AI/LLM orchestration (multi-agent, Claude 4.7, AI SDK 5.x)

**SOTA 2026 (cited):** Claude Opus 4.7 + Sonnet 4.6 are the
hierarchical pair for multi-agent systems; Opus orchestrates,
Sonnet/Haiku do the work — Sonnet 4.7 was skipped, the next Sonnet is
4.8 ([Knightli / Claude model
lineup](https://www.knightli.com/en/2026/05/08/anthropic-claude-model-lineup/),
[NxCode / Sonnet 4.8 release
notes](https://www.nxcode.io/resources/news/claude-sonnet-4-8-release-date-features-what-to-expect-2026)).
Vercel AI SDK 5 `ToolLoopAgent` plus AI Gateway is the default routing
substrate ([Vercel / AI agents
guide](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk),
[AI SDK / Agents
overview](https://ai-sdk.dev/docs/agents/overview)).

**Our implementation:** `packages/central-intelligence/src/kernel/` —
40+ kernel modules (cot-reservoir, sensors, world-model, critics,
reflexion, debate, persona-drift, four-eye-approval, killswitch). Brain
kernel wired via `services/api-gateway/src/composition/brain-kernel-wiring.ts`
+ `multi-llm-synthesizer-wiring.ts`. Anthropic SDK v0.30.1 in
`packages/ai-copilot/package.json`. AOP registry, A2A task store
ports defined. `intelligence.router.ts` streams agent events over SSE.

**Parity score:** B+

**Top 3 gaps:**
1. AI SDK is NOT in dependency graph — the orchestrator hand-rolls
   tool loops instead of consuming `ai@5.x` / `ToolLoopAgent`. No
   AI-Gateway-style budget routing.
2. Sonnet 4.6 / Opus 4.7 model IDs not pinned in config; the
   sovereign tests reference older Sonnet 3.5 / 4.5 model IDs.
3. No durable orchestration layer (Temporal / Inngest used only for
   webhooks); long-running agent runs cannot survive a process
   restart cleanly.

**Recommended next moves:** Adopt AI SDK 5 for the ToolLoopAgent
loop. Pin Opus 4.7 / Sonnet 4.6 in a single model-catalog module.

---

## 3. Property-management software (VTS, Yardi, AppFolio, Buildium parity)

**SOTA 2026 (cited):** Yardi shipped predictive occupancy, maintenance
forecasting, market-rent optimisation; AppFolio added AI leasing chat
and a mobile-first resident app; VTS added ML deal-probability scoring
across the leasing lifecycle ([Re-leased / 7 Yardi Voyager
alternatives 2026](https://www.re-leased.com/software/7-best-yardi-voyager-alternatives-for-property-management-in-2026),
[AppFolio / Best property management leasing software
2026](https://www.appfolio.com/blog/best-property-management-software-for-leasing-2026/)).
2026 ROI drivers are AI lease abstraction plus automated accounting
integrations.

**Our implementation:** 198 API gateway routes covering
applications, arrears, leases, work-orders, vendors, inspections,
documents, payments, GEPG, M-Pesa, maintenance taxonomy, renewals,
arrears, occupancy timeline, station-master coverage, vacancy
pipeline, marketplace, conditional surveys, FAR (floor-area-ratio),
move-out checklists, owner statements, monthly close. Forecasting in
`packages/forecasting-engine`. 8 advisor packages
(acquisition / expansion / lifecycle / sustainability / green-angle /
estate-department / stage / role-aware) deliver the AI veteran-expert
layer.

**Parity score:** A-

**Top 3 gaps:**
1. AI lease abstraction is not productised — `packages/document-studio`
   has templates and signing but no batch "ingest a stack of legacy
   leases and emit structured fields" job.
2. No first-party accounting connector (Xero / Sage / NetSuite) —
   GEPG and M-Pesa are present but ledger sync to mainstream
   accounting platforms isn't wired.
3. VTS-style deal-probability scoring on the marketplace
   pipeline is absent; `marketplace.router.ts` has listings and
   applications but no ML conversion model.

**Recommended next moves:** Build a `lease-abstractor` worker that
batches `ocr-extraction.service.ts` → schema extraction → review
queue. Add a Xero connector behind `packages/connectors/`.

---

## 4. Document AI (Anthropic Citations, GraphRAG, Contextual Retrieval + Cohere Rerank)

**SOTA 2026 (cited):** Anthropic Contextual Retrieval is the 2026
baseline (reduces retrieval errors ~49% with contextual embeddings +
contextual BM25, ~67% when paired with reranking) ([AWS / Contextual
retrieval in Anthropic using Amazon
Bedrock](https://aws.amazon.com/blogs/machine-learning/contextual-retrieval-in-anthropic-using-amazon-bedrock-knowledge-bases/),
[Anthropic citations workshop
repo](https://github.com/jwalsh/anthropic-citations-workshop),
[Medium / RAG in 2026 architecture
shifts](https://medium.com/@elammarisoufiane/rag-in-2026-architecture-shifts-emerging-patterns-and-what-it-means-for-java-developers-6f2803e39787)).
Agentic RAG (loop until confident) is the production pattern.

**Our implementation:** `packages/document-studio/src/citations/citation-verifier.ts`
exists. `packages/ai-copilot/src/retrieval/cohere-rerank.ts` is wired
for the reranker leg. Document Intelligence service has OCR (AWS
Textract + Google Vision), embedding service, document-chat,
evidence-pack builder, fraud detection, validation-consistency.
GraphRAG entry-point exists via `packages/graph-sync` + Neo4j queries
in `brain.hono.ts`.

**Parity score:** B

**Top 3 gaps:**
1. Contextual Retrieval (prepending chunk-level context before
   embedding) is not implemented; chunks go to the embedder raw.
2. Citation verifier is present but the brain route never enforces
   "no answer without ≥1 citation" — answers can ship without
   evidence (see `routes/ask/advisor-wiring.ts` — `createStaticDataPort([])`
   placeholder).
3. GraphRAG is read-only — no nightly job builds a graph from the
   doc corpus; the Neo4j layer is wired but not populated automatically.

**Recommended next moves:** Add a chunk-contextualiser pass to the
embedding service. Promote the citation-verifier from optional to
mandatory in the advisor orchestrator.

---

## 5. Geo/GIS (PostGIS, MapLibre, Mapbox, Cesium, Google 3D)

**SOTA 2026 (cited):** Google Map Tiles 3D Photorealistic (Cesium /
deck.gl `Tile3DLayer`) for hero views; MapLibre + PostGIS for the
working surface; Mapbox Satellite for fallback tiles. Drawn boundaries
via `@geoman-io/maplibre-geoman-free`. Reference: prior internal SOTA
brief at
[`.audit/sota-2026-05-24/01-geo-platform.md`](../.audit/sota-2026-05-24/01-geo-platform.md).

**Our implementation:** `packages/geo-platform` (MapLibre 5 +
react.tsx), `packages/spatial-engine` (geometry / snap-to-building /
color-coding / `ParcelMap` + `@geoman-io/maplibre-geoman-free` 0.7),
`packages/geo-intelligence` (imagery providers — Mapbox satellite +
others). `services/api-gateway/src/routes/geo-intelligence/`. Spatial
parcels migration `0164_spatial_parcels.sql`. SAM segmenter wrapper in
`packages/geo-platform/src/segmentation/`.

**Parity score:** B

**Top 3 gaps:**
1. No Google 3D Tiles / Aerial View integration — `geo-intelligence`
   has Mapbox satellite but no Cesium / deck.gl `Tile3DLayer`.
2. PostGIS extension is referenced in migrations but no automated
   check at boot that the extension is installed in production.
3. Geofence runtime is defined but no subscription on the realtime
   channel exists in any portal app (see realtime-adapter chain gap).

**Recommended next moves:** Add a Cesium 3D-tile provider behind a
`GOOGLE_3DTILES_API_KEY` flag. Add a startup probe that runs
`SELECT postgis_version();`.

---

## 6. Workflow engines (Camunda, Temporal, BPMN 2.0)

**SOTA 2026 (cited):** Two camps — Camunda 8 BPMN-centric (regulated
industries) and Temporal code-centric (engineering-led SaaS). Camunda
mindshare 15.7% (down YoY), Temporal 5.7% (up) ([Automation Atlas /
Camunda vs Temporal April
2026](https://automationatlas.io/guides/camunda-vs-temporal-2026-comparison/),
[Camunda / Agentic
Orchestration](https://www.camunda.com/platform/)). Production teams
use one or the other; nobody hand-rolls.

**Our implementation:** `packages/workflow-engine` (bespoke — runs,
review, approval, commit, deltas, hash-chain audit). Hooks an
`AIReviewerPort` plus `ScopeGuard` from `@borjie/assignment-registry`.
A SECOND workflow engine exists in `packages/ai-copilot` and is the
one actually mounted by `services/api-gateway/src/routes/workflows.router.ts`
(via `InMemoryWorkflowRunStore`). Inngest used for webhooks only.

**Parity score:** C+

**Top 3 gaps:**
1. Two competing workflow engines — `@borjie/workflow-engine` and
   `@borjie/ai-copilot` `WorkflowEngine` — the more advanced
   first one with AI-reviewer + scope-guard is NOT wired into any
   route in api-gateway.
2. No BPMN authoring surface — non-developers cannot model a process.
3. State is in-memory; the in-memory `WorkflowRunStore` loses every
   run on process restart.

**Recommended next moves:** Pick ONE engine, delete the other; or
front-load Temporal/Inngest as the durable substrate.

---

## 7. Auth + identity (Supabase Auth, WorkOS, passkeys, SCIM)

**SOTA 2026 (cited):** WorkOS AuthKit handles SAML SSO + SCIM + passkeys
+ MFA + magic auth (free up to 1M MAU); the SOC2 / enterprise
procurement bar is SSO + SCIM + audit logs ([WorkOS / Supabase
integration](https://workos.com/blog/supabase-integration),
[AgileSoftLabs / Auth0 vs Supabase vs WorkOS SSO 2026
comparison](https://www.agilesoftlabs.com/blog/2026/03/auth0-vs-supabase-vs-workos-sso)).

**Our implementation:** Supabase Auth via three client wrappers in
`packages/supabase-client`. JWT verification + Supabase verify in
`packages/ai-copilot` (`verifySupabaseJwt`). `services/identity/`
has invite-code, org-membership, tenant-identity services + Postgres
repos, plus OTP. Auth middleware in `services/api-gateway/src/middleware/{hono-auth,auth.middleware,auth-core}.ts`.
MFA route exists at `routes/auth-mfa.ts`.

**Parity score:** C

**Top 3 gaps:**
1. No passkey / WebAuthn surface — zero matches for
   `passkey|webauthn` across packages/services/apps.
2. No WorkOS integration — only Supabase Auth, which closes off
   enterprise SAML/OIDC self-service tier.
3. No SCIM provisioning endpoint — every user must be added
   manually or via invite-code, which scales badly for enterprise
   tenants.

**Recommended next moves:** Add WorkOS AuthKit in front of Supabase
Auth (their integration is "primary provider, bypass Supabase Auth").
Light-up the WebAuthn endpoint with `@simplewebauthn/server`.

---

## 8. Compliance + audit (SOC 2, ISO 27001, GDPR, POPIA, Tanzania DPA)

**SOTA 2026 (cited):** Enterprise B2B SaaS demand SOC 2 Type II as a
baseline; ISO 27001 is the cross-border baseline; GDPR + per-country
DPAs (POPIA for SA, Tanzania Personal Data Protection Act 2022) are
mandatory in those markets ([Venn / SOC 2 in
2026](https://www.venn.com/learn/soc2-compliance/), [Konfirmity / SOC
2 audit updates
2026](https://www.konfirmity.com/blog/soc-2-what-changed-in-2026)).
72-hour breach reporting under GDPR.

**Our implementation:** `packages/compliance-plugins` covers 17
countries including TZ. Compliance router + plugins router mounted at
`/api/v1/compliance` and `/api/v1/compliance-plugins`. GDPR router at
`/api/v1/gdpr`. DSAR router at `/api/v1/dsar`. WORM audit log
migration `0165_worm_audit_log.sql` + `worm-audit.ts` in document-studio.
SOC2 audit trail via `withSecurityEvents` HOF wrapping every
mutating route. `packages/security-audit` package with scanners +
regression tests.

**Parity score:** B+

**Top 3 gaps:**
1. WORM audit store is `c.set()` nowhere — the persistent adapter
   is built, never reachable from a route handler.
2. SOC 2 + ISO 27001 controls catalogue not mapped to actual code
   (no `Docs/COMPLIANCE/SOC2_CONTROL_MAP.md`).
3. POPIA / TZ DPA per-jurisdiction logic uses default behaviour;
   the country plugin loads but doesn't differentiate data
   retention windows by jurisdiction.

**Recommended next moves:** Wire WORM audit store onto the Hono
context (same fix as gap 1.3). Generate a control catalogue.

---

## 9. Security (RLS, ReBAC Zanzibar/OpenFGA, Cedar, OPA)

**SOTA 2026 (cited):** OpenFGA promoted to CNCF Incubating Oct 2025
(v1.13 by Mar 2026); OpenID AuthZEN Authorization API 1.0 final spec
Jan 2026. Cedar/AWS for declarative ABAC; OPA for
policy-as-code ([Auth0 / ReBAC ABAC OpenFGA
Cedar](https://auth0.com/blog/rebac-abac-openfga-cedar/),
[Permit.io / OPA vs OpenFGA vs Cedar
showdown](https://www.permit.io/blog/policy-engine-showdown-opa-vs-openfga-vs-cedar)).

**Our implementation:** Bespoke `packages/authz-policy` with RBAC
engine, ABAC engine, policy engine, decorators, middleware. JWT
service. RLS at the DB edge (covered above). `packages/security-audit`
ships scanners + regression tests. Killswitch in
`packages/central-intelligence/src/kernel/killswitch.ts`. Tool-call
denylist migration `0157_tool_call_denylist.sql`.

**Parity score:** B

**Top 3 gaps:**
1. No ReBAC engine — relationship-based authorization (Zanzibar
   pattern) is absent, which limits "user X can edit this listing
   because they're in group Y of org Z" reasoning to ad-hoc joins.
2. AuthZEN PDP/PEP interface not adopted; authz is API-coupled.
3. Policy engine has its own cache but no policy-bundle distribution
   mechanism — every restart re-registers policies.

**Recommended next moves:** Trial OpenFGA for the marketplace
membership graph (org → property → unit → tenant). Wrap the existing
policy engine in an AuthZEN-shaped facade.

---

## 10. Voice + TTS/STT (ElevenLabs v3, Hume AI EVI 3, Deepgram Nova 3)

**SOTA 2026 (cited):** ElevenLabs v3 GA Feb 2026 (74 languages); Hume
EVI / Octave 2 leads emotional fidelity; Deepgram Nova-3 Multilingual
Mar 2026 -34% batch WER, -21% streaming WER, 36+ langs with
code-switching ([Webfuse / ElevenLabs cheat sheet
2026](https://www.webfuse.com/elevenlabs-cheat-sheet), [CallSphere /
Deepgram Nova-3 March 2026 WER
drop](https://callsphere.ai/blog/vw1a-deepgram-nova-3-multilingual-march-2026-wer-drop),
[Deepgram / Best TTS APIs
2026](https://deepgram.com/learn/best-text-to-speech-apis-2026)).
Nova-3 + Flux is the May 2026 voice-agent default.

**Our implementation:** `services/voice-agent/` with providers
`elevenlabs-v3.ts`, `cartesia.ts` (Hume Octave fallback embedded),
`spitch.ts` (Nigerian languages), `lelapa.ts` (Vulavula for
Swahili/Bantu/Luganda), `gpt-realtime-2.ts`. STT/TTS/language routers
in `services/voice-agent/src/router/`. Voice route mounted at
`/api/v1/voice` via `voice.router.ts`. Voice-agent-wiring composition.
`packages/chat-ui/src/voice/` for the front-end audio port.

**Parity score:** B+

**Top 3 gaps:**
1. No Deepgram Nova-3 STT — gpt-realtime-2 is the only English STT;
   the cheapest + most accurate option is missing.
2. Hume EVI is wired as a Cartesia fallback only, not for emotion-
   modelled response selection in the orchestrator.
3. No voice-cloning tier for tenants (ElevenLabs voice library) —
   each tenant's brand voice is hard-coded to `mr-mwikila.ts`.

**Recommended next moves:** Add Deepgram Nova-3 provider behind a
`DEEPGRAM_API_KEY` flag and route English through it. Surface a voice-
clone settings page that maps tenant → voice_id.

---

## Portfolio Summary

| # | Domain | Parity | Critical gap |
|---|--------|:------:|---|
| 1 | Multi-tenant SaaS / RLS | B | 5 persistent stores not exposed to routes |
| 2 | AI/LLM orchestration | B+ | AI SDK 5 not adopted |
| 3 | Property management | A- | No AI lease abstraction; no Xero/Sage connector |
| 4 | Document AI (Citations / GraphRAG) | B | Citation verifier not enforced |
| 5 | Geo/GIS | B | Google 3D Tiles missing |
| 6 | Workflow engines | C+ | Two engines; advanced one not wired |
| 7 | Auth + identity | C | No passkeys, no WorkOS, no SCIM |
| 8 | Compliance + audit | B+ | WORM audit unreachable from routes |
| 9 | Security / ReBAC | B | No ReBAC engine |
| 10 | Voice TTS/STT | B+ | No Deepgram Nova-3 |

**Distribution:** A=1, B=8, C=1, D=0. The single C+ (workflow
engines) and C (auth/identity) are the two domains that materially
block enterprise procurement and reliable long-running automation.
Everything else lands at B or better.

---

## Sources

- [Vercel / How to build AI Agents with the AI SDK](https://vercel.com/kb/guide/how-to-build-ai-agents-with-vercel-and-the-ai-sdk)
- [AI SDK / Agents Overview](https://ai-sdk.dev/docs/agents/overview)
- [Antstack / Multi-Tenant Applications with RLS on Supabase](https://www.antstack.com/blog/multi-tenant-applications-with-rls-on-supabase-postgress/)
- [Auth0 / How to choose multi-tenant SaaS authorization model](https://auth0.com/blog/how-to-choose-the-right-authorization-model-for-your-multi-tenant-saas-application/)
- [AWS / Contextual retrieval in Anthropic using Amazon Bedrock](https://aws.amazon.com/blogs/machine-learning/contextual-retrieval-in-anthropic-using-amazon-bedrock-knowledge-bases/)
- [Medium / RAG in 2026 architecture shifts](https://medium.com/@elammarisoufiane/rag-in-2026-architecture-shifts-emerging-patterns-and-what-it-means-for-java-developers-6f2803e39787)
- [Anthropic Citations Workshop](https://github.com/jwalsh/anthropic-citations-workshop)
- [Re-leased / 7 Best Yardi Voyager alternatives 2026](https://www.re-leased.com/software/7-best-yardi-voyager-alternatives-for-property-management-in-2026)
- [AppFolio / Best property management software for leasing 2026](https://www.appfolio.com/blog/best-property-management-software-for-leasing-2026/)
- [Auth0 / Understanding ReBAC and ABAC Through OpenFGA and Cedar](https://auth0.com/blog/rebac-abac-openfga-cedar/)
- [Permit.io / Policy Engine Showdown OPA vs OpenFGA vs Cedar](https://www.permit.io/blog/policy-engine-showdown-opa-vs-openfga-vs-cedar)
- [Automation Atlas / Camunda vs Temporal April 2026](https://automationatlas.io/guides/camunda-vs-temporal-2026-comparison/)
- [Camunda / Agentic Orchestration Platform](https://www.camunda.com/platform/)
- [WorkOS / Enterprise Ready authentication for Supabase](https://workos.com/blog/supabase-integration)
- [AgileSoftLabs / Auth0 vs Supabase vs WorkOS SSO 2026](https://www.agilesoftlabs.com/blog/2026/03/auth0-vs-supabase-vs-workos-sso)
- [Venn / SOC 2 Compliance in 2026](https://www.venn.com/learn/soc2-compliance/)
- [Konfirmity / SOC 2 What Changed in 2026](https://www.konfirmity.com/blog/soc-2-what-changed-in-2026)
- [Knightli / Claude Opus 4.7, Sonnet 4.6, Haiku 4.5 model selection](https://www.knightli.com/en/2026/05/08/anthropic-claude-model-lineup/)
- [NxCode / Claude Sonnet 4.8 release date features 2026](https://www.nxcode.io/resources/news/claude-sonnet-4-8-release-date-features-what-to-expect-2026)
- [Webfuse / ElevenLabs Cheat Sheet 2026](https://www.webfuse.com/elevenlabs-cheat-sheet)
- [CallSphere / Deepgram Nova-3 Multilingual March 2026 WER drop](https://callsphere.ai/blog/vw1a-deepgram-nova-3-multilingual-march-2026-wer-drop)
- [Deepgram / Best Text to Speech APIs in 2026](https://deepgram.com/learn/best-text-to-speech-apis-2026)
