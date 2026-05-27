# Boji AI: Competitive Landscape & Technical Architecture Research Brief (2025-2026)

> **Source agent run:** Deep-research agent invoked 2026-05-17. Verbatim, with every URL preserved. The Boji architecture, model-routing, OCR, biometrics, and Swahili-LLM choices in the master spec trace back to this brief.

---

## 1. Big-Mining AI Platforms — The Majors Move on Agentic AI (2024-2026)

The defining shift of 2025 is that mining majors are no longer piloting AI — they are signing multi-year, enterprise-wide agentic-AI partnerships. The headline event is **Codelco × Microsoft (announced March 2025)**: Chile's state copper giant signed a strategic alliance to deploy generative AI, Azure OpenAI Service, Fabric and Copilot across its operations, with a stated goal of creating "AI agents" for mine planning, maintenance, geology and HR workflows (Reuters, 11 Mar 2025; Mining.com, 12 Mar 2025; BNamericas). Codelco framed this as foundational infrastructure for productivity recovery after its 25-year low in 2023 output (FT, Mar 2025).

**BHP** has been the most public about agentic AI. Its "FutureFit Academy" and partnership with **Microsoft and Accenture** (extended Oct 2024) are building copilots for the integrated remote operations centres in Perth and Santiago. BHP runs the world's largest autonomous-haulage fleet (~500+ Cat 793F/Komatsu 930E trucks across WAIO and Escondida) and is layering **Palantir Foundry** on top for ore-body-to-port digital twins (Mining Weekly, Jul 2024; AFR, Sep 2024). BHP's Jansen potash project is being commissioned as a "born-digital" mine.

**Rio Tinto**'s "Mine of the Future" programme (running since 2008) is now in its agentic phase: Rio announced **Project Sage** with AWS and Anthropic Claude in late 2024 for geological-data reasoning across the Pilbara and Oyu Tolgoi, and continues to scale AutoHaul (the world's first heavy-haul autonomous rail, ~1.7M tonnes/day), AHS trucks (Komatsu FrontRunner), and an enterprise data platform on Databricks (Rio Tinto Investor Day Nov 2024; Mining.com).

**Vale** has a long-running partnership with **Cognite** for industrial DataOps and is rolling out predictive-maintenance copilots across its S11D iron-ore complex; Vale also publicised its Gen-AI assistant "VALE-GPT" internally in 2024 (Cognite case studies; Mining Weekly Sep 2024).

**Anglo American** sold most of its coal/PGM portfolio in 2024-25 to refocus on copper and iron, but its **Operating Model + IROC** (Integrated Remote Operations Centres) in Santiago and Brisbane are AI-instrumented, with **Microsoft + Cognite** stacks for fleet, plant and energy optimisation (Anglo American Sustainability Report 2024).

**Newmont** partnered with **Caterpillar** in 2024 for an autonomous-haulage and battery-electric fleet rollout at Cripple Creek & Victor and Boddington, and uses **Petra Data Science** (Australia) for grade-control and recovery prediction (Newmont press releases 2024; Mining.com).

**Freeport-McMoRan** is the canonical AI-in-concentrator case study: its in-house ML models for **Bagdad** and **Cerro Verde** mills lifted copper recovery by ~5% — an internal program now branded "Concentrating Intelligence" (Freeport Q3 2024 earnings call; Reuters Oct 2024).

**Glencore** is publicly the most cautious major, but its Raglan and Mount Isa operations use **IntelliSense.io** (a UK AI-native mining startup) for real-time grinding-circuit optimisation (IntelliSense case studies; Mining Magazine 2024).

On the **exploration AI** side, **KoBold Metals** (backed by Breakthrough Energy Ventures, Andreessen Horowitz, T. Rowe Price and Bill Gates / Jeff Bezos; Series C **$537M Jan 2025** at a $2.96B valuation — Reuters, 15 Jan 2025) made the largest copper discovery of 2024 at Mingomba in Zambia. **Earth AI** (Australia) raised $20M Series B in Jan 2025 (TechCrunch) drilling AI-generated targets in NSW. **GoldSpot Discoveries** (TSXV: SPOT) and **VRIFY** (Vancouver) round out the listed AI-explorers. These are the closest analogues to what an AI-native mining platform can look like — but all are *exploration-only*, not operations + compliance + finance.

## 2. Mid-Tier Mining Software Incumbents — Engineering Tools, Not Strategic Brains

The incumbent stack is a 25-year-old constellation of desktop CAD/CAE software, increasingly cloud-skinned but architecturally pre-AI:

- **Deswik** (Sandvik, AUS) — mine-design, scheduling, geotech; the de-facto standard for underground and open-pit planning. No generative-AI advisory.
- **MICROMINE** (AUS) — Origin & Stellar / Beyond / Pitram (fleet & production); strong in mid-tier and FSU markets (Mining Magazine 2024 survey).
- **Hexagon Mining** — MinePlan (ex-MineSight), MineOperate, MinePortal, **Pitram** (production reporting), HxGN MineProtect (safety). Now bundling AI under "**HxGN Mining Pro**" (2024) but it's still engineering-focused.
- **Maptek** (AUS) — Vulcan, BlastLogic, PointStudio; geological modelling and blast design.
- **RPM Global** (AUS) — XECUTE, AMT (asset management), XERAS (financials). Acquired AI assets but remains schedule/finance-centric.
- **K2fly** — Resource Governance Solutions (tenement, community, rehabilitation, resource inventory). Closest to a "compliance overlay" but enterprise-only.
- **Decipher** (RPM-owned) — environmental & community compliance for majors.
- **Seequent** (Bentley) — Leapfrog (implicit geological modelling), Oasis montaj, Imago; the geology toolkit but $-heavy licencing.
- **Datamine** — Studio RM/UG/OP, MineMarket, MineScape; broad legacy suite.
- **Bentley Mining** — Open-Mine / Plaxis / SYNCHRO for civils + scheduling.
- **Caterpillar MineStar** — Command (autonomy), Fleet, Terrain, Detect, Health.
- **Wenco** (Hitachi) — FMS competing with MineStar Fleet & Modular's DISPATCH.

**The collective gap (critical for Boji):** every one of these is an *engineering and equipment-management* suite. None offers (a) **strategic AI advisory** to an owner, (b) SME pricing (typical enterprise licence is US$50k–500k/yr/seat-bundle), (c) **document, licence, EPP, ESIA, community, fingerprint-signature** workflows, or (d) **Swahili / voice-first / offline-first** UX. They assume an engineering department exists.

## 3. AI-Native Mining Startups — Each Owns One Sliver

- **KoBold Metals** — exploration AI, datasets + drilling (covered above).
- **Earth AI** — exploration + drilling-as-a-service, generative target geology.
- **GoldSpot Discoveries** — explainable-ML exploration on geophysics/geochem.
- **MineSense** — XRF + AI sensor-based ore sorting at the shovel (Vancouver; Series E 2022).
- **Strayos** — drone-photogrammetry + blast & fragmentation AI (NY).
- **Plotlogic** — hyperspectral + AI ore characterisation; **acquired by Lummus Technology** in 2024.
- **Sentient / Sentian** — autonomous reinforcement-learning control for plants (Sweden).
- **MaxOre** — ML-driven mine-to-mill optimisation.
- **IntelliSense.io** — real-time grinding/flotation/leaching AI; deployed at Glencore Raglan, BHP.
- **Petra Data Science** — predictive geometallurgy and grade-control; used by Newmont, Newcrest.
- **OreFox** — Australian gen-AI exploration assistant.
- **Sibelco-MineHub** — supply-chain blockchain for industrial minerals.
- **Komatsu Smart Construction** — adjacent but Komatsu's autonomy + drone-survey play.

**Gap:** every startup is a *vertical slice* (exploration, sorting, comminution, blasting, traceability). None integrates the *whole owner's day* — geology + planning + cost + licence + HR + EPP + sales + treasury. That is the Boji whitespace.

## 4. Mining-Capable ERPs at SME Tier — Why None Fit a TZ PML Holder

- **Sage X3 Mining** (with **Adapt-IT** / Pasensoft mining packs) — ~US$30-150k implementation; configurable but no AI advisory and no TZ compliance overlay.
- **BST10** — project-based for mining EPC, not operator-focused.
- **Pronto Xi Mining** (AUS) — mid-tier ERP, strong in mining maintenance; Australia-centric.
- **MIE Trak Pro** — manufacturing, weak in mining.
- **Microsoft Dynamics 365 + EAM** (with partners like **HSO / Annata / To-Increase**) — viable but six-figure implementation; requires mining vertical add-ons.
- **IFS Cloud** — strong EAM but enterprise pricing.
- **Workday** — HCM/finance only.
- **Infor M3** — process industries; mining variant exists but enterprise-priced.

**Why none fit a TZ PML or PL holder:** (a) entry cost (US$50k+ implementation) versus a PML's typical turnover (US$50k-500k/yr); (b) no overlay for the **Mining Act 2010 (as amended 2017/2023)**, MC/PL/SML/PML licence states, MIRA returns, royalty (3% gold / 5% diamond / 1% industrial), 16% government **free-carried interest**, or Mining Commission filings; (c) no Swahili, no fingerprint-signature, no offline; (d) no AI strategic advisory layer — they are systems of record, not systems of decision.

## 5. ASM & Developing-Market Tools — Compliance, Not Operating Systems

- **Levin Sources** — advisory & due-diligence reports, not software.
- **Pact's Delve** — open data platform for ASM populations & production.
- **Better Sourcing Programme (BSP)** — assurance for 3T minerals.
- **BGR / ITSCI** — tagging-and-tracing for tin-tantalum-tungsten in the Great Lakes region.
- **Minexx** — mobile-first traceability + payments for ASM 3T+gold (London/Rwanda).
- **MineHub** — concentrate supply-chain platform (blockchain).
- **Consensys / Everledger** — provenance.
- **CRAFT Code** — ASM responsible-sourcing standard.
- **OECD Due Diligence Guidance** — the policy backbone.
- **World Bank CASM (Communities and Small-Scale Mining)** — research & policy.

**Gap:** all are *traceability and assurance overlays* on top of an assumed analog operation. None gives the small-mine owner an AI brain, a planner, an EPP drafter, a HR file, or a cash-flow forecaster. Minexx is the closest (mobile + payments + traceability), but it stops at the mine gate.

## 6. Document / Knowledge / Agent Stacks (General-Purpose, Adoptable for Boji)

**Orchestration frameworks (2025 state):**
- **LangChain / LangGraph** — LangGraph 0.2+ (Sep 2024) is now the de-facto supervisor/sub-agent graph runtime, with checkpointing & human-in-the-loop primitives.
- **LlamaIndex** — best-in-class for document ingestion + RAG over heterogeneous corpora.
- **Haystack 2.x** (deepset) — pipeline-first, strong for hybrid search.
- **Anthropic Claude tool use + Agent SDK** (Q1 2025 GA) — native sub-agent spawning, computer-use, MCP servers.
- **OpenAI Responses API + Agents SDK** (Mar 2025) — successor to Assistants; first-class hand-offs, guardrails, tracing.
- **Vercel AI SDK 4.x** — TypeScript-native, ideal for Next.js front-ends.
- **Pydantic-AI** — type-safe agents, lightweight.
- **AutoGen 0.4** (Microsoft, Nov 2024) — async, layered, GroupChat patterns.
- **CrewAI** — role-based hierarchical crews; production-pragmatic.

**Vector DBs:** pgvector (default for Postgres-native shops), Qdrant (Rust-fast, hybrid search), Weaviate (modular), Pinecone (managed, costly), Vespa (Yahoo-grade for billions of vectors).

**Knowledge graphs:** Neo4j (default), ArangoDB (multi-model), AWS Neptune (managed), Memgraph (in-memory, real-time). For a tenant-scoped mining brain, **Neo4j with property-graph + node-property RBAC** is the pragmatic choice; **Apache AGE** (graph on Postgres) is a single-DB alternative.

**Multi-tenant patterns:** schema-per-tenant in Postgres + row-level-security policies, plus tenant-scoped vector namespaces (pgvector partial indexes or Qdrant collections per tenant).

**Storage:** S3 / Cloudflare R2 / Backblaze B2 — R2 is the cost winner for African egress.

**OCR / document parsing:** **AWS Textract** (forms + tables), **Google Document AI** (best on multilingual + handwriting), **Mistral OCR** (Mar 2025 release, very strong on technical PDFs), **LlamaParse** (mining-report-friendly), **Unstructured.io** (broad coverage). For TZ licence & EPP scans, a Textract + Mistral OCR ensemble is the right baseline.

**Geospatial:** PostGIS as the source of truth; Mapbox / MapTiler for tiles; OpenLayers / MapLibre / deck.gl for web; **Tippecanoe** for offline vector tiles. For mine block models, **Cesium + 3D Tiles** is emerging as the open standard.

**Mobile-first offline-first:** **Expo SDK 52+ / React Native 0.76 New Architecture**, **Capacitor 6** for hybrid, **WatermelonDB** (lazy reactive SQLite), **PowerSync** (Postgres CDC → client SQLite, the standout for 2025), **Replicache** (general-purpose sync), **Y.js / Automerge** (CRDT for collaborative editing of e.g. EPPs in the field).

## 7. The "Central Brain + Spawned Juniors" Multi-Agent Pattern — State of the Art

The dominant 2025 patterns for hierarchical agent systems:

- **Anthropic Claude Sub-Agents** (Agent SDK, 2025) — Master agent spawns named, scoped sub-agents with their own context windows, system prompts, and tool sets; results returned as structured artefacts. Native to Claude Code and now SDK-exposed.
- **LangGraph Supervisor** — explicit supervisor node routes to worker nodes; checkpointing per node; ideal for **audit-traceable** workflows (every state transition is persisted).
- **OpenAI Swarm → Agents SDK** (Mar 2025) — lightweight "hand-off" pattern; each agent owns a sub-task and explicitly transfers control with reason.
- **CrewAI hierarchical crews** — declarative role/goal/backstory; manager-agent delegates.
- **AutoGen GroupChat / Magentic-One** (Microsoft Research, Nov 2024) — open-source generalist multi-agent (Orchestrator + WebSurfer + FileSurfer + Coder + ComputerTerminal) — closest published analogue to the Boji "Master + 12 juniors" architecture.

**Production hardening (essential for a regulated mining context):**
- **Token budgeting** — per-agent caps, summarisation of long sub-agent outputs back to Master (≤2000 tokens per sub-agent return).
- **Memory** — three layers: episodic (this conversation, in-context), semantic (knowledge graph + vector store, per-tenant), procedural (saved playbooks per agent role).
- **Scratchpads** — each Junior writes to a tenant-scoped scratchpad table; Master reads, never sees raw tool output.
- **Evaluators / judges** — a separate Auditor Agent re-reads sub-agent outputs against evidence-chain requirements before Master commits a decision.
- **Deterministic guardrails** — Pydantic / Zod schemas on every agent return; no free-form decisions on numerics (royalty %, FX rates, licence dates).
- **Evidence requirements** — every decision must cite (a) document URI + page, (b) graph node IDs, (c) user/field-worker source. Equivalent to a SOX-style audit trail.
- **Audit logs** — append-only event log per tenant; signed, timestamped.

For **12-15 specialised agents over one shared per-tenant knowledge graph**, the right shape is: one **Master** (Claude Opus or GPT-4.1) orchestrating via LangGraph supervisor, spawning **Juniors** on Haiku/Sonnet/4o-mini with **Neo4j as shared semantic memory** and **per-agent vector namespaces in Qdrant or pgvector**. Each Junior owns a *tool surface* (Licence Agent → Mining Commission scraper + EPP-template tool; Cost Engineer → MIRA royalty calculator + diesel-price feed; etc.).

## 8. Mobile Fingerprint Authorisation & Biometric Signing

- **FIDO2 / WebAuthn** — passkeys (Apple, Google, Microsoft 2024 rollout) are the right primitive for *device-bound* identity; native on iOS 17+/Android 14+.
- **Android BiometricPrompt** + **iOS LocalAuthentication / Secure Enclave** — for in-app fingerprint authorisation gated to a signing key in the secure element.
- **Onfido** (now Entrust) — document + face verification, costly per check.
- **Smile ID** (Africa-native, Nairobi + Lagos) — **NIDA integration for Tanzania**, plus DRC, KE, UG, NG, ZA national-ID verification + liveness; the default choice for African KYC.
- **Selfie + active/passive liveness** — Smile ID, AWS Rekognition, iProov.

**TZ legal validity of fingerprint-as-signature:** the **Electronic Transactions Act, 2015 (Cap. 442)** s.22-23 recognises electronic signatures including biometric, provided they are (a) uniquely linked to the signatory, (b) under their sole control, (c) detectably altered. The **Evidence Act (Cap. 6, amended 2016 and 2022 Written Laws Misc Amendments)** admits electronic records. Together these give a fingerprint capture + device-attested signing key the equivalent legal weight of a wet-ink signature — provided audit trail and non-repudiation are preserved. Auto-generated letters (PDF) with embedded stamp + cryptographic signature + fingerprint hash + geolocation are the right output format for licence applications, EPP sign-offs, and worker contracts.

## 9. Connectivity-Tolerant Architecture for Rural TZ

- **CRDT sync**: **Y.js** (for collaborative documents like EPP drafts), **Automerge** (richer types), **PowerSync** (relational CDC).
- **Conflict resolution**: last-writer-wins for sensor metrics, CRDT-merge for documents, supervised-merge for licence states.
- **Queued uploads**: WorkManager (Android), BGTaskScheduler (iOS), Expo TaskManager; resumable multipart to S3/R2.
- **Photo compression**: WebP/AVIF at capture, plus on-device perceptual-hash for dedup.
- **Edge inference**:
  - **Whisper.cpp / faster-whisper / Distil-Whisper** — on-device Swahili & English ASR.
  - **Llama 3.2 1B/3B** (Sep 2024, multilingual, mobile-targeted).
  - **Phi-3 mini / Phi-3.5** (Microsoft) — strong on small-context reasoning.
  - **Gemma 2 2B** (Google) — competitive on-device.
  - **MLC-LLM / llama.cpp / Ollama** — runtimes.

**Swahili LLM landscape:** **Cohere Aya** (Aya-23 and Aya Expanse, multilingual incl. Swahili), **Jacaranda Health UlizaLlama** (Swahili-tuned, healthcare-origin), **Inkuba-LM** (Lelapa AI, sub-Saharan-African focused, 2024), **Lelapa InkubaLM-0.4B**, **SERENGETI** (UBC + Masakhane), **AfriBERTa / AfroLM / AfroXLMR** (Masakhane). **Bank of Tanzania** has no LLM but releases FX rates daily (good tool-call source). **AfricaNLP / Masakhane** community provides datasets. For Boji, **Aya Expanse 32B** as cloud Swahili layer + **Llama 3.2 3B fine-tuned on Swahili mining terminology** on-device is the pragmatic stack.

**Voice-first UX**: push-to-talk Whisper → Swahili intent classifier → tool call → Aya/Claude response → Swahili TTS (Coqui XTTS-v2 supports Swahili; AWS Polly Zuri; Google WaveNet sw-TZ).

## 10. Comparable AI-Native Operating Systems in Other Industries

- **Real estate / property — BossNyumba (TZ)**: the architectural ancestor of Boji. Master AI + Junior agents (Lease Agent, Tenant Agent, Maintenance Agent, Compliance Agent, Treasury Agent) over a per-tenant knowledge graph and a mobile-first / fingerprint-signed workflow.
- **Agriculture**: **Cropin** (Bangalore, "AgTech operating system" with SmartFarm + SmartRisk + AkSara LLM 2024), **Pula** (Nairobi, parametric insurance + agronomy AI), **FarmDrive** (Nairobi, alt-data credit scoring), **Apollo Agriculture** (Nairobi, $40M Series B 2022, AI-driven input financing).
- **Logistics / freight**: **Lori Systems** (Nairobi, multi-stop trucking AI), **Sendy** (Nairobi, last-mile, wound down 2023 but instructive), **Kobo360** (Lagos, AI dispatch and credit).
- **Retail / FMCG distribution**: **TradeDepot** (Lagos, B2B distribution AI), **MarketForce / RejaReja** (Nairobi, kiosk OS; restructured 2024), **Wasoko** (Nairobi/Cairo, B2B e-com + credit + ledger).

**Transferable pattern (to mining):** all of the above (a) put a smartphone in the hand of an under-served micro-operator, (b) overlay credit / compliance / advisory on top of operational data, (c) use voice + local-language + offline tolerance, (d) monetise through transaction take + premium AI advisory, (e) build a single source of truth that becomes lender-grade. Boji inherits this thesis applied to a TZ mining-licence holder.

---

## Boji AI Implications

**(a) Agents to spawn first (Phase-0, weeks 1-12):**
1. **Document Agent** — ingest licences, EPPs, contracts, scans → typed graph nodes. Highest-leverage and feeds every other agent.
2. **Licence Agent** — Mining Commission filings, renewal calendar, MIRA returns. The legal heartbeat.
3. **Cost Engineer Agent** — diesel, royalty, labour, capex; cash-flow forecaster. The owner's daily question.
4. **EPP Agent** — Environmental Protection Plan drafting + community section. Regulatory blocker.
5. **Geology Agent** — drill-hole + grade ingestion; light-weight resource modelling. Differentiator vs ERPs.

Defer (Phase-1, months 4-9): Mine Planner, Procurement, HR, Sales, Safety, FX/Treasury, Auditor.

**(b) Tech-stack choices:**
- **Orchestration**: LangGraph supervisor + Anthropic Claude (Master = Opus / Sonnet 4.5; Juniors = Haiku 4.5 with tool use), with OpenAI as fallback model router.
- **Per-tenant memory**: Postgres (Supabase or Neon) + **pgvector** + **Apache AGE** for graph (single DB simplifies multi-tenant RLS); upgrade to **Neo4j Aura** when graph queries dominate.
- **Storage**: **Cloudflare R2** (zero egress).
- **OCR**: **Mistral OCR** primary + **Google Document AI** for handwriting + **LlamaParse** for technical PDFs.
- **Geospatial**: **PostGIS + MapLibre + MapTiler + Tippecanoe** for offline tiles; **deck.gl** for block-model viz.
- **Mobile**: **Expo SDK 52 / RN 0.76** + **PowerSync** (Postgres-native sync) + **Y.js** for collaborative docs + **WatermelonDB** as local cache.
- **Biometrics**: **Smile ID** for NIDA + liveness; **iOS LocalAuthentication / Android BiometricPrompt** gating a device-bound signing key; sign PDFs with PAdES-B-LT + embedded fingerprint hash + geolocation.
- **Voice / Swahili**: **Whisper-large-v3 / Distil-Whisper** for ASR, **Aya Expanse 32B** for Swahili generation, **Llama 3.2 3B** on-device for offline fallback, **Coqui XTTS-v2** for TTS.
- **Audit**: append-only event log in Postgres + S3-replicated daily snapshot; every Master decision cites graph node IDs and document URIs.

**(c) Differentiation against every named competitor:**
- vs **Codelco-Microsoft / BHP / Rio / Vale / Anglo / Newmont / Freeport / Glencore stacks** — those are private, US$100M+ programmes for tier-1 majors; Boji is the same architectural pattern (Master + Juniors + KG) at SME PML/PL scale, priced for a single owner.
- vs **KoBold / Earth AI / GoldSpot / VRIFY** — they stop at exploration; Boji runs the *whole* business: licence, EPP, cost, sales, treasury.
- vs **Deswik / MICROMINE / Hexagon / Maptek / RPM / Datamine / Bentley / Seequent** — engineering toolkits without an AI advisor and without compliance/HR/community/treasury. Boji adds the strategic brain *and* doesn't require a CAD engineer.
- vs **Caterpillar MineStar / Wenco / Modular** — equipment-centric; Boji is owner-centric.
- vs **Sage X3 / D365 / IFS / Pronto / Infor / Workday** — generic ERPs without TZ Mining Act overlay, without AI advisory, without Swahili / fingerprint / offline.
- vs **Minexx / ITSCI / MineHub / Delve / Levin / BSP / CRAFT** — traceability and assurance overlays; Boji is the *operating system underneath* that produces traceable data as a by-product.
- vs **IntelliSense.io / Petra / Strayos / Plotlogic / MineSense / Sentient** — single-process AI verticals; Boji is the integrator.
- vs **Cropin / Pula / Lori / TradeDepot / BossNyumba** — same pattern, different vertical; Boji is the first to bring this stack to mining in East Africa.

**One-line positioning:** *Boji AI is the first AI-native operating system built for the African mining-licence holder — a Master AI Brain with twelve specialised Junior Agents that runs the owner's whole business, in Swahili, offline, fingerprint-signed, and lender-ready — at a price the holder of a single PML can afford.*

---

### Key Sources (selected)

Reuters (Codelco-Microsoft, 11 Mar 2025; KoBold Series C, 15 Jan 2025; Freeport recovery uplift, Oct 2024); FT (Codelco AI, Mar 2025); Mining.com & Mining Weekly (BHP-Accenture, Rio Project Sage, Newmont-Cat, 2024-25); Cognite case studies (Vale); BHP / Rio / Anglo / Newmont / Freeport / Glencore investor materials 2024-25; Microsoft Research (Magentic-One, Nov 2024); Anthropic Agent SDK docs (2025); OpenAI Agents SDK release notes (Mar 2025); LangChain / LangGraph docs 2024-25; PowerSync / WatermelonDB / Y.js docs; Smile ID NIDA documentation; URT Electronic Transactions Act 2015; Evidence Act Cap. 6; Mining Act 2010 (as amended); Masakhane / Lelapa AI / Cohere Aya papers 2024; TechCrunch (Earth AI Series B, Jan 2025); AFR / BNamericas / Mining Magazine 2024-25 industry coverage.
