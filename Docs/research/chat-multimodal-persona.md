# Chat · Multimodal · Persona — SOTA Dossier (Lane: multimodal-voice-persona-ux)

**Date:** 2026-06-08
**Author:** research subagent (workflow orchestration)
**Lane:** `multimodal-voice-persona-ux` — the "talk to a real veteran MD" experience
**Audience:** Borjie product, brain, voice, owner-web teams
**Invariants honoured:** INV-H (chat is a rich SOTA conversational workspace, not a text
box), INV-B (surfaces are lenses), the UI invariant (reasoned-need · proposal-gated ·
reversible · chat-refinable), CLAUDE.md hard rules (EN/SW absolute toggle,
evidence-required output, multi-currency).

This dossier answers one question: **what does it take, in June 2026, for the MAIN chat to
feel like talking to a real veteran Managing Director who knows your estate — the same
person across voice, text, and time?** It surveys the realtime-voice, vision-in-chat,
persona-design, memory-personalization, proactive-ambient, turn-taking, and
emotional/relational frontiers, names real sources, and for every finding adds a
"beyond-today" leap. It closes with our concrete gaps versus our own personas + realtime
voice + memory-v2.

---

## 0. Where Borjie stands today (verified in-repo, not assumed)

| Capability | What exists | File / evidence |
|---|---|---|
| Realtime duplex voice | `gpt-realtime-2` provider wired against `wss://api.openai.com/v1/realtime`; emits PartialAudio + PartialTranscript; multi-provider failover (Cartesia, ElevenLabs v3, Lelapa, Spitch) | `services/voice-agent/src/providers/gpt-realtime-2.ts`, `services/voice-agent/src/router/{stt,tts-failover}-router.ts` |
| Voice persona DNA | 6 frozen profiles with tone/pace/register/code-switch/greetings/taboos + a heuristic `scorePersonaFit` validator + `drift-detector` | `packages/ai-copilot/src/voice-persona-dna/{profiles,consistency-validator,drift-detector}.ts` |
| Mr. Mwikila system prompt | Deterministic prompt builder, 4 tools, Constitution C09 escalation | `services/voice-agent/dist/personas/mr-mwikila.js` |
| Mining-domain persona | 8 mode-switched mining-CEO modes (build/strategy/ops/document/finance/risk/board/compliance) | `packages/ai-copilot/src/personas/mining-ceo-{persona,modes}.ts` |
| Memory-v2 | 6-layer cognitive memory (episodic/narrative/procedural/reflective/topic/cohort), bi-temporal, Drizzle + in-memory stores, real consolidator | `packages/memory-v2/src/` (migration 0312) |
| Chat workspace | owner-web HomeChat (chat-first home), GenUITabHost + portal-genui tab-spawn + ambient notice, tool-call sidebar, streaming first-token | `apps/owner-web/src/components/{home-chat,genui-tab}/` |

**Two findings that change the gap analysis up front (both verified in source):**

1. **The voice persona is still property-domain, not mining-domain.** `mr-mwikila.js`
   describes "a property steward who handles rent reminders, viewing bookings, and
   maintenance intake on behalf of landlords and tenants" with tools `lookup_lease`,
   `log_payment`, `book_viewing`, `raise_ticket`. The `voice-persona-dna/profiles.ts`
   personas are `tenant`, `owner`, `vendor`, `regulator`, `applicant` — a real-estate set.
   The mining CEO persona (`mining-ceo-persona.ts`) is text-only and lives in a *different
   package* (`ai-copilot`) from the voice persona (`voice-agent`). **Voice and text are two
   different characters today.** This is the single biggest break of "same person across
   voice+text."

2. **memory-v2's `MemorySurface` enum is property-domain** (`owner_portal`, `tenant_chat`,
   `maintenance_agent`, `leasing_agent`, …) — `packages/memory-v2/src/types.ts`. The
   substrate is excellent (bi-temporal, 6-layer) but its surface taxonomy describes a
   landlord product, and there is no evidence the brain turn writes *persona-relationship*
   memory (preferences, how the owner likes to be addressed, prior decisions) as opposed to
   episodic event logs.

---

## 1. Realtime VOICE agents — making it cockpit-grade

### SOTA (June 2026)

- **OpenAI shipped three production realtime audio models**: `gpt-realtime-2` (voice with
  GPT-5-class reasoning), `gpt-realtime-translate` (live speech-to-speech across 70+
  languages), and `gpt-realtime-whisper` (streaming STT). The realtime path is explicitly
  the recommended starting point when you need *barge-in, low first-audio latency, natural
  turn-taking, and realtime tool use* — interruptions are treated as normal conversation,
  not error states. ([OpenAI: Introducing gpt-realtime](https://openai.com/index/introducing-gpt-realtime/),
  [OpenAI: Advancing voice intelligence](https://openai.com/index/advancing-voice-intelligence-with-new-models-in-the-api/))
- **Rule-based VAD is now considered broken** for turn-taking. The frontier is **semantic
  VAD / semantic end-pointing**: end-of-turn detection that uses linguistic context, not
  just silence, hitting <75ms P99 turn detection with ~40% fewer mid-thought interruptions.
  ([Gradium: Turn-Taking in Voice Agents](https://gradium.ai/content/turn-taking-voice-agents-vad),
  [Phoenix-VAD, arXiv 2509.20410](https://arxiv.org/pdf/2509.20410))
- **Full-duplex models** (Moshi, Hertz-dev, Sesame CSM) handle overlap natively; Moshi's
  depth transformer streams 8 codebook streams so audio starts before the semantic sequence
  finishes, reaching ~160ms latency; an optimized cascaded H100 pipeline sits at 500-700ms
  p95. **Barge-in trick**: buffer the last 3-4 audio chunks so the client can cut in without
  a full round-trip. ([Spheron: Speech-to-Speech GPU Cloud](https://www.spheron.network/blog/speech-to-speech-gpu-cloud-moshi-sesame-csm-hertz-dev/),
  [ICASSP 2026 HumDial full-duplex study, arXiv 2604.21406](https://arxiv.org/html/2604.21406v2))
- **Production economics**: the session-config system prompt is re-sent on every WebSocket
  connect and is the largest per-session input cost; prompt-caching it drops $32/1M → $0.40/1M.
  Use the *lowest reasoning level* that still works (start "low"); constrain the domain —
  "voice agents that try to do everything fail." ([OpenAI Realtime production guide,
  Forasoft 2026](https://www.forasoft.com/blog/article/openai-realtime-api-voice-agent-production-guide-2026),
  [Realtime models prompting, OpenAI](https://developers.openai.com/api/docs/guides/realtime-models-prompting))
- **Semantic interruption detection** (distinguishing a real barge-in from a backchannel
  "mhm / yeah / sawa") is its own 2026 benchmark task — naive VAD treats acknowledgements as
  interruptions and stops the MD mid-sentence. ([Semantic-Aware Interruption Detection,
  arXiv 2603.24144](https://arxiv.org/html/2603.24144v1))

### Beyond-today leap

**Predictive duplex briefings.** A cockpit-grade MD voice doesn't wait to be asked — it
opens the call already mid-thought ("Boss, before you ask — the Geita assay came back, I've
queued three options"), then yields the floor using semantic end-pointing so the owner can
barge in the instant they have a reaction. Pair *speculative response generation* (begin
drafting the reply at end-of-turn prediction, +50-70% LLM calls but materially lower
perceived latency) with a **backchannel model** so the MD emits "mm-hm, I'm following" in
Swahili *while* the owner is still talking — the single strongest "real person" signal,
and one no mining ERP has. Gate it on a per-owner "interruptibility" preference learned in
memory-v2 (some owners hate being talked over).

---

## 2. VISION / upload-in-chat — snap a doré photo, drop a licence PDF → understood + acted on

### SOTA (June 2026)

- **GPT-5.5 (announced 23 Apr 2026) is the first OpenAI model unifying text, image, audio
  and video in one architecture** — "no more stitching GPT-5 + Whisper + Sora behind your
  agent." It is framed *agentic-first, chat-second*, trained on agentic coding, computer
  use, knowledge work, and early scientific research. ([TeamDay: GPT-5.5 launch](https://www.teamday.ai/blog/gpt-5-5-launch),
  [Tosea: GPT-5.5 guide](https://tosea.ai/blog/gpt-5-5-complete-guide))
- **GPT-5.4 reads dense scans, handwritten forms, engineering diagrams and chart-heavy
  reports in a single model pass** — no separate OCR + layout + parser pipeline. Directly
  relevant to "drop a licence PDF / assay certificate / royalty receipt." ([OpenAI cookbook:
  document & multimodal understanding](https://developers.openai.com/cookbook/examples/multimodal/document_and_multimodal_understanding_tips))
- **Native multimodal tool-calling**: images, UI screenshots and document pages can be
  passed *directly as tool parameters* without text conversion first — the agent perceives
  and acts in one loop. Models like GLM-4.6V close the perception→reasoning→action loop
  end-to-end for visual tool use. ([BentoML: open-source VLMs 2026](https://www.bentoml.com/blog/multimodal-ai-a-guide-to-open-source-vision-language-models),
  [GetStream: best visual AI agents 2026](https://dev.to/getstreamhq/best-visual-ai-agents-in-2026-real-time-multimodal-tools-44g6))
- **Visual agents act, not just describe** — image-to-action grounded in a product
  catalog/SKU set is shipping on factory floors and fulfillment centers, and CHI 2026
  compared remote-sighted assistance vs a multimodal voice agent in live inspection
  sequences. ([CHI 2026: Vision in Action](https://dl.acm.org/doi/10.1145/3772318.3791708),
  [Vision AI Trends 2026, AccessNewswire](https://www.accessnewswire.com/newsroom/en/computers-technology-and-internet/vision-ai-trends-2026-manufacturing-quality-inspection-warehouse-1145069))

### Beyond-today leap

**Grounded mining-vision as a first-class chat verb.** A field worker on
`workforce-mobile` snaps a photo of a doré bar / a stockpile / a cracked headframe weld /
a fuel-bowser gauge / a paper licence, and the MD doesn't just caption it — it *grounds it
against the estate's own catalog*: "that's the GR-241 doré pour, your last assay put it at
86.4% Au; at today's LBMA fix and the TZS rate this lot is worth ~X — shall I draft the
royalty filing and stage the offtake to Buyer #12?" Vision passes the image straight into
the brain tool call (no OCR detour), the result renders inline as an editable artifact
(estimated value chart + draft filing preview), and the action is proposal-gated +
reversible per the UI invariant. The MD that can *see your pit* and price what it sees is
the leap; today's mining software cannot ingest a phone photo and turn it into a staged
ledger-adjacent action.

---

## 3. PERSONA / character design — Mr. Mwikila as a consistent veteran MD (EN/SW)

### SOTA (June 2026)

- **2026 enterprises want custom personas, not generic chatbots** — "a business advisor who
  understands your industry," defined by domain expertise + personality/voice + persistent
  memory + tools. Market ~$4.8B (2025) → ~$28.6B (2034). ([Jenova: custom AI persona](https://www.jenova.ai/en/resources/custom-ai-persona))
- **Persona fidelity is the measurable quality bar**: the degree to which the agent keeps
  consistent trait expression, style, knowledge and decision patterns across all outputs;
  failures show as contradictions or *drift* and directly destroy trust. ([Emergent Mind:
  Persona Fidelity](https://www.emergentmind.com/topics/persona-fidelity))
- **Anthropic's Persona Selection Model** (2026) argues an assistant's behaviour is best
  modeled as *selecting and committing to a persona* from a distribution — a frame that
  explains drift and gives levers to stabilize character. ([Anthropic Alignment: PSM](https://alignment.anthropic.com/2026/psm/))
- **Design caution — the anthropomorphism cliff**: human-like cues and perceived
  reliability are the two primary drivers of trust, *but excessive anthropomorphism cuts
  trust by ~47%*. Four persona dimensions: voice (who it is), tone (contextual adjustment),
  emotional intelligence, behavioral guardrails (avoid the uncanny valley). The CARE
  (Context-Ask-Rules-Examples) prompt pattern stabilizes tone. ([Pixelmojo: Agent
  Personality Design](https://www.pixelmojo.io/blogs/agent-personality-voice-design-how-to-build-ai-coworkers-people-trust),
  [Skywork: 2026 persona-setting guide](https://skywork.ai/skypage/en/ai-bot-persona-setting-guide/2026839771872964608))
- Friendly/relatable bots earn ~40% more interaction time than neutral ones — but require
  transparent audit trails and a human in the loop. ([UXPin: AI personas 2026](https://www.uxpin.com/studio/blog/ai-personas/))

### Beyond-today leap

**One canonical Mwikila character sheet, rendered consistently across voice + text +
surface.** Today there are *two* characters (a property steward in `voice-agent`, a mining
CEO in `ai-copilot`) and a property-domain DNA set. The leap is a single
domain-true **Mwikila character sheet** — a veteran Tanzanian mining MD: 30 years from
artisanal pit to mid-tier estate, blunt about safety, conservative on treasury, proud of
the workforce — expressed once as structured DNA (backstory, values, verbal tics, EN+SW
register, taboos) and *injected into both the realtime session config and the text brain
prompt from the same source of truth*, then enforced at runtime by the existing
`scorePersonaFit` + `drift-detector` so the *same* person speaks whether you type or call.
Deliberately tune *below* the anthropomorphism cliff: he is a trusted colleague, never a
"friend who loves you." EN/SW stays an absolute toggle (CLAUDE.md) — Mwikila code-switches
*only inside the active locale's allowed inserts*, never "Habari! Hello there."

---

## 4. Memory-driven personalization in chat

### SOTA (June 2026)

- The agent ecosystem **converged on a three-tier memory taxonomy** mirroring cognitive
  science: **episodic** (specific interactions), **semantic** (concepts + personalization
  facts), **procedural** (action sequences/skills). Borjie's memory-v2 already has these
  plus narrative/reflective/cohort — ahead of the baseline. ([Atlan: Agent Memory
  Architectures](https://atlan.com/know/agent-memory-architectures/),
  [Hermes OS: AI agent memory systems 2026](https://hermesos.cloud/blog/ai-agent-memory-systems))
- **Persona ≠ memory**: the persona anchors *permanent identity* (who Mwikila is); memory
  stores *contextual facts/events* (what happened, what the owner prefers). Both are needed;
  conflating them is a known failure mode. ([Jenova: AI roleplay custom persona](https://www.jenova.ai/en/resources/ai-roleplay-custom-persona),
  [Coda One: Character.AI 2026 guide](https://www.codaone.ai/blog/character-ai-complete-guide-2026/))
- **MemGPT → Letta** productionized OS-style memory paging: core memory (RAM, always
  in-context), archival (disk, vector store), recall (conversation history) — actively page
  in/out rather than passively accumulate. Vendor landscape: Letta, Zep, Mem0, LangMem;
  user-scoped memory is a *separate layer* from checkpointing. ([AgentMarketCap: memory
  vendor landscape 2026](https://agentmarketcap.ai/blog/2026/04/10/agent-memory-vendor-landscape-2026-letta-zep-mem0-langmem),
  [Zylos: agent memory architectures](https://zylos.ai/research/2026-04-05-ai-agent-memory-architectures-persistent-knowledge/))
- **Long-term memory is still the acknowledged hard part** — even Character.AI-class
  products are critiqued for failing at memory + persona consistency + character depth over
  long horizons. ([Skywork: character-AI guide](https://skywork.ai/skypage/en/character-ai-guide-persona-roleplay/2029467207405101056))

### Beyond-today leap

**A semantic "owner model" that personalizes how the MD shows up — not just what it
recalls.** memory-v2 today is event/episode-shaped (a property-domain `MemorySurface`
enum). The leap is a **first-class semantic owner-profile layer**: how this owner likes to
be addressed (terse vs narrative; EN vs SW; numbers-first vs story-first), their risk
appetite, which subsidiaries they care about, decisions they've already made and *won't
revisit*, what they ignored last time. Mwikila pages that into the realtime session config
*and* the text prompt as "core memory" (Letta-style), so on turn one of any new
conversation — voice or text, today or next quarter — he already sounds like he knows you.
The bi-temporal model is the unlock no competitor has: he can say "last March you told me
to hold the Mara licence; that reasoning no longer holds because royalty rates moved —
want to revisit?" — memory that *reasons about its own validity over time*.

---

## 5. PROACTIVE / ambient surfacing in the conversation

### SOTA (June 2026)

- **2026 is the prompt→proactive shift**: agents continuously monitor context, predict
  needs, and initiate without a prompt; ambient agents watch ongoing
  professional↔client conversations and intervene when action is appropriate.
  ([AlphaSense: Proactive AI 2026](https://www.alpha-sense.com/resources/research-articles/proactive-ai/),
  [Buttondown: Proactive AI paradigm shift](https://buttondown.com/verified/archive/proactive-ai-the-paradigm-shift-from-prompts-to/))
- **Timing is the hard variable, not capability**: `ProActor` (ACL 2026) uses
  timing-aware RL so a proactive agent learns *when* to act, not just what. Proactive help
  that mistimes the user's attentional/psychological readiness *backfires* and can feel
  threatening. ([ProActor, arXiv 2605.24900](https://arxiv.org/html/2605.24900v1),
  [Proactive AI can be Threatening, arXiv 2509.09309](https://arxiv.org/pdf/2509.09309))
- **Mixed-initiative treats initiative itself as the control variable** — the system
  continuously decides *who acts, when, and how strongly* given evolving evidence about user
  state, task structure and risk. ([How Users Perceive Mixed-Initiative AI, arXiv 2602.01481](https://arxiv.org/html/2602.01481v1))

### Beyond-today leap

**A calibrated "interrupt budget."** Borjie already has the *plumbing* (portal-genui
tab-proposal → ambient notice → GenUITabHost; proactive notification sink). The frontier
move is governing it: Mwikila maintains a per-owner **interrupt budget** and only spends it
when expected value clears a threshold (a safety incident or a royalty deadline gets a
voice barge-in; a minor FX drift waits for the next briefing). He learns from dismissals
(timing-aware, ProActor-style) and *always says why now* ("I'm raising this unprompted
because the permit lapses in 72h"). This converts ambient surfacing from a notification
firehose into the judgement of a veteran who knows when to knock on your door — the exact
thing that separates a trusted MD from an alerting system.

---

## 6. Natural turn-taking + mixed-initiative dialogue

### SOTA (June 2026)

- Covered technically in §1 (semantic VAD, full-duplex, backchannels, barge-in buffering).
  The dialogue-design overlay: **mixed-initiative is a spectrum** moving from user-led tools
  toward agent-led workflows, with the human shifting from "in the loop on every step" to
  *supervisor/policymaker*. ([From LLM Reasoning to Autonomous Agents, arXiv 2504.19678](https://arxiv.org/pdf/2504.19678))
- **Confirmation frequency is a decision-theoretic choice**, not a constant — a 2026 model
  derives the optimal check-in cadence for multi-step agent tasks; over-confirming wastes
  the relationship, under-confirming loses trust. ([When Should Users Check?, arXiv 2510.05307](https://arxiv.org/pdf/2510.05307))

### Beyond-today leap

**Dynamic floor-control + adaptive confirmation cadence.** Mwikila modulates *who holds the
floor* by stakes: low-stakes ops he just narrates and proceeds; high-stakes (anything
through `LedgerService.post`, any C09 NO-AUTONOMOUS-FILING action) he hands the floor back
and waits. He computes confirmation cadence from reversibility × magnitude × the owner's
demonstrated trust (memory-v2) — so a seasoned owner doing routine work isn't nagged, but a
TZS-50M irreversible transfer always pauses. This is the conversational expression of
Borjie's existing graduated-autonomy gating, surfaced as natural turn-taking.

---

## 7. Emotional / relational design for trust

### SOTA (June 2026)

- **Voice presence has four pillars** (Sesame): emotional intelligence (read + respond to
  emotional context), conversational dynamics (timing, pauses, interruptions, emphasis),
  contextual awareness (adjust tone to situation), and **consistent personality** (coherent,
  reliable, appropriate). Sesame's CSM is end-to-end (multimodal backbone + lightweight
  audio decoder) solving the "one-to-many" problem — many valid ways to say a sentence, only
  some fit the context. Even so, humans still prefer real recordings *when given context* —
  conversational prosody is not solved. ([Sesame: Crossing the uncanny valley of voice](https://www.sesame.com/research/crossing_the_uncanny_valley_of_voice),
  [Beebom: Sesame Maya experience](https://beebom.com/sesame-ai-voice-companion-maya-experience-like-talking-to-real-person/))
- **Expressive TTS is production-ready**: ElevenLabs v3 adds emotion via *audio tags*
  (laugh, whisper, sarcasm, curiosity) and reads prosody to time responses; Cartesia Sonic
  3.5 delivers <100ms model latency with refined prosody + emotion (incl. laughter) for
  real-time agents. ([ElevenLabs v3 expressive mode](https://elevenlabs.io/docs/eleven-agents/customization/voice/expressive-mode),
  [FutureAGI: best TTS APIs 2026](https://futureagi.com/blog/best-text-to-speech-providers-2026/))
- **The emotional-AI market is ~$37.1B (2026)**; voice agents reading urgency/frustration
  cut escalations ~25% — relational, not transactional, engagement. But: human-like cues +
  reliability drive trust while **over-anthropomorphism cuts it ~47%** — the relational
  design must stay calibrated. ([CallBotics: AI voice agent trends 2026](https://callbotics.ai/blog/ai-voice-agent-trends),
  [Pixelmojo: voice & trust](https://www.pixelmojo.io/blogs/agent-personality-voice-design-how-to-build-ai-coworkers-people-trust))

### Beyond-today leap

**Earned-trust prosody — emotion that is honest, not theatrical.** Borjie already
multi-provides ElevenLabs v3 + Cartesia; the leap is wiring *evidence-grounded affect*:
Mwikila's tone is computed from the situation he is *actually* reporting (steady and grave
on a safety incident, warm on a good assay, clipped and careful on a treasury risk) and
from the owner's read state — never random theatrics, and never warmth that papers over bad
news. Crucially, because every Borjie recommendation already cites an `evidence_id`, the
relational layer can be *honest by construction*: confidence in the voice tracks confidence
in the evidence. That honest-affect-plus-citation pairing is what keeps us on the right side
of the 47% anthropomorphism cliff while still earning the 40% deeper engagement of a
relatable advisor.

---

## 8. The "same person across voice + text + time" thesis (beyond-today, lane-level)

The frontier is no longer any single modality — it is **continuity of identity**. Sesame is
chasing it with always-on glasses + long-term memory + adaptive personality; Character.AI is
critiqued for failing it; Letta makes it tractable with paged core memory. For Borjie the
winning, defensible position is a **persistent Mwikila that is provably one character** —
same DNA injected into realtime voice and text, same owner-model memory paged into both,
same evidence-citation discipline, same EN/SW absolute toggle — *who knows your specific
estate*. No mining ERP, and no general voice companion, has the domain truth + the estate
data + the governance (C09, ledger, RLS, audit-chain) wired into one continuous persona.
That combination is the moat.

---

## 9. Our concrete gaps (vs our personas + realtime voice + memory-v2)

**G1 — Voice and text are two different characters (CRITICAL).** `mr-mwikila.js` is a
property steward (rent reminders, lease lookups); `mining-ceo-persona.ts` is the mining MD;
they live in different packages and share no source of truth. Fix: one canonical Mwikila
character sheet feeding both the realtime session config and the text brain prompt.

**G2 — voice-persona-DNA is the wrong domain.** `profiles.ts` ships tenant/owner/vendor/
regulator/applicant real-estate personas. Needs mining-estate personas (owner/MD, manager,
employee, buyer/offtaker, regulator/TMAA, financier) with EN+SW register, taboos, and
domain verbal register.

**G3 — memory-v2 surface taxonomy is property-domain + lacks a semantic owner-model.**
`MemorySurface` is `owner_portal`/`tenant_chat`/`maintenance_agent`/`leasing_agent`/…
There's no first-class "how this owner likes to be addressed / risk appetite / settled
decisions" semantic layer paged into chat as Letta-style core memory.

**G4 — no semantic VAD / barge-in / backchannel in the realtime path.** `gpt-realtime-2.ts`
maps audio+transcript deltas but the session.update sets only modalities/format/voice — no
`turn_detection` (semantic VAD), no interruption handling, no backchannel emission. Today's
voice is request/response, not duplex-natural.

**G5 — no vision-in-chat ingestion → action loop.** No path for a `workforce-mobile` photo
or a dropped licence/assay PDF to enter the brain as a native multimodal tool parameter and
come back as a grounded, proposal-gated action. (Media *generation* exists via media-engine;
visual *ingestion-to-action* does not.)

**G6 — persona consistency is heuristic-only and not enforced on the voice path.**
`scorePersonaFit` + `drift-detector` exist but score against the *property* DNA and are not
wired into the realtime output stream; there is no LLM-judge upgrade running on live voice.

**G7 — proactive surfacing has no interrupt-budget / timing governance.** Plumbing exists
(portal-genui → ambient notice; notification sink) but no per-owner interrupt budget,
expected-value threshold, "why now" justification, or dismissal-learning (ProActor-style).

**G8 — no adaptive confirmation cadence / dynamic floor-control in dialogue.** C09 and
graduated-autonomy gating exist as policy, but the conversation doesn't yet modulate
turn-taking / confirmation frequency by reversibility × magnitude × earned trust.

**G9 — relational prosody is unconditioned.** ElevenLabs v3 + Cartesia are wired for
failover, but tone is not computed from the situation's affect or the cited evidence
confidence — so the voice can't yet be "honest by construction."

**G10 — no measured persona-fidelity / latency SLOs.** No eval asserting voice==text
character fidelity, no first-audio-latency / turn-detection P99 budget, no anthropomorphism
guardrail test — the things the SOTA sources say determine whether it *feels* like a real
veteran MD.
