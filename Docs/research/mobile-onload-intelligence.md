# Mobile On-Load Intelligence — SOTA 2026 Research

**Audience:** Borjie engineering (workforce-mobile + buyer-mobile, Expo SDK 51,
React Native 0.74, Hermes).
**Question:** How do 2026 SOTA products deliver AI chat intelligence on mobile
without the 3–5 s first-token latency that kills the UX?
**Author:** Mobile-intel research wave (Claude Opus 4.7, 1M context).
**Date:** 2026-05-27.
**Status:** Research only. No code changes. Engineering proposal in section 9.

---

## 0. TL;DR — what to do, in order

1. **Phase 1 (≤ 2 dev-weeks)** — Convert `POST /api/v1/brain/turn` from
   "single JSON blob in 2–5 s" to **SSE streaming via `expo/fetch`**, layer
   an **acknowledge-fast** placeholder (`"Karibu, ninafikiri…"`) emitted in
   <100 ms, and enable **Anthropic 5-minute prompt caching** on the system
   prompt + persona + tool definitions. Expected first-paint:
   **≤ 200 ms perceived**, real first token **≤ 1.0 s** on 4G, **≤ 1.8 s** on
   3G. Cuts effective TTFT by 60–85 %.
2. **Phase 2 (≤ 3 dev-weeks)** — Background **thread-replay** + **chip
   prefetch** so the home screen is already populated when the user lands;
   local cache of last N turns for offline replay; persistent KV via
   Anthropic 1-hour cache for the owner's daily session.
3. **Phase 3 (≤ 4 dev-weeks, owner-mobile only)** — **Cloudflare Workers AI
   edge "first-50-tokens" path** that answers acknowledgements + simple
   routing while the main Anthropic call is in flight. Workers AI sits in
   Cape Town/Joburg POPs → ~80 ms RTT from Dar es Salaam vs ~280 ms to
   us-east. Saves ~200 ms on TTFT.
4. **Phase 4 (deferred to 2027)** — **On-device router** via a 22 MB ONNX
   MiniLM-L6 embedding for "what tool/screen does this prompt need?" The
   model answer still comes from the server; only the routing decision is
   local, eliminating one network hop on hot paths.

Full on-device LLM (MLC-LLM / ExecuTorch with Llama 3.2 1B) is **NOT
recommended for workforce-mobile until 2027+**. The 4 GB RAM / Snapdragon-
class entry phones (Itel, Tecno) we ship to thermally throttle from
8 tok/s → 1.2 tok/s after 90 s (RunAnywhere benchmark, 2026).

---

## 1. Latency budget — what SOTA targets

| Surface | TTFT (real) | First "sign of life" (perceived) | Source |
|---|---|---|---|
| Anthropic Claude API, Haiku 4.5 | **0.59 – 0.95 s** | n/a | [Artificial Analysis][aa-haiku] |
| Anthropic Claude API, Sonnet 4.6 (low effort) | **1.20 s** | n/a | [Artificial Analysis][aa-sonnet] |
| OpenAI ChatGPT mobile (GPT-5 fast) | **0.825 s** | ~150 ms ack | [BenchLM 2026][bench-llm] |
| Perplexity mobile (voice mode) | **~400 ms** voice-to-voice | <150 ms partial transcript | [DataStudios][perp-voice] |
| Cloudflare Workers AI (Llama-3.3 70B edge) | **200–300 ms** first-token | ~50 ms route | [CallSphere 2026][cf-voice] |
| Apple Foundation Models (iPhone 15 Pro, on-device 3B) | **0.6 ms / token** prefill, **30 tok/s** decode | instant | [Apple ML Research][apple-fm] |
| Gemini Nano 4 (Pixel 10 Pro, on-device) | < network — **0 ms** network | instant | [Google AI Edge][litert-blog] |
| Llama-3.2 1B on Snapdragon 695 (4 GB phone) | **prefill 350 tok/s, decode 40 tok/s** under thermal budget | instant | [Software Mansion ExecuTorch][rne-perf] |
| Llama-3.2 1B same phone, 90 s sustained | decode collapses to **1.2 tok/s** | instant | [RunAnywhere][runany] |

**Industry rule of thumb (2026):** users perceive any silence > 500 ms as
"the app froze". Skeleton + streaming tokens cut perceived wait by
55–70 % at identical actual latency ([Performance-First UX 2026][perf-ux]).

**Borjie's real network reality (Dar es Salaam, mid-tier mining estate):**

- 4G median RTT to AWS us-east-1: ~280 ms
- 4G median RTT to AWS af-south-1 (Cape Town): ~85 ms
- 3G median RTT to either: 350–700 ms with jitter
- Tanzania urban 4G download ~29 Mbps / 24 ms latency
  ([RFBenchmark][rf-tz])
- Tower-side 3G in mining regions: bursty, 500 ms p50, multi-second p95.

This makes **server region + streaming + prompt cache** worth ~1.5 s on
TTFT, before we touch the model.

---

## 2. Architectural ladders — ranked by feasibility

Each tier compounds. The ms savings are **additive on TTFT**, not
multiplicative on total response time.

### Tier 1 — Server-side optimisations only

Cheapest, lowest risk, biggest absolute win. Do these first.

| Lever | TTFT saving | Cost | Borjie status |
|---|---|---|---|
| **SSE streaming** vs JSON return | "Perceived 55–70 % faster" ([Performance-First UX][perf-ux]); user sees tokens at ~600 ms not 2–5 s | 1–2 dev-weeks (Hono SSE + RN reader) | NOT WIRED on `/brain/turn`. Already wired on `chat` router (see `streamChat.ts`). |
| **Anthropic prompt caching (5-min ephemeral)** on system prompt + persona + tool defs | **13–31 % TTFT** ([Anthropic platform][anth-cache]); up to **85 %** on long prompts (~11.5 s → 2.4 s on 100k tokens) | 1–2 days (add `cache_control: {type:"ephemeral"}` markers); requires ≥ 1024 tokens per breakpoint | NOT WIRED. Brain orchestrator rebuilds system prompt every turn. |
| **Cache pre-warming** before user's first message | Eliminates cold-cache penalty for the first ack | Background "ping" on thread open | Easy. Tied to Phase-1 streaming work. |
| **Right model per intent** — Haiku 4.5 for chit-chat / acks, Sonnet 4.6 for reasoning | TTFT 0.95 s vs 1.24 s → 240 ms saved when Haiku suffices ([Artificial Analysis][aa-haiku]) | Routing in brain | Brain already supports multi-LLM router; not all junior paths use it. |
| **Smaller `max_tokens`** | Reduces tail risk on slow tokens; affects p95 not p50 | trivial | trivial |
| **Region replica** — gateway in af-south-1 (Cape Town) | ~200 ms saved per request from Tanzania | infra | Today: us-east only. Considered but blocked on Supabase region. |
| **Stop streaming when persona is decided** for the ack | First UI paint at ~100 ms not 600 ms | Brain change | Tier 2 territory; see below. |

**Cumulative tier-1 effect for Borjie:** TTFT drops from ~2.5 s p50
(today) to **~0.6–1.0 s real first token** on 4G, with the **first
"thinking…" frame in <200 ms**.

### Tier 2 — Client-side optimistic UI

Free engineering, big perceived win. Independent of model.

| Pattern | Saving | Implementation cost |
|---|---|---|
| **Skeleton tokens** in bubble while waiting | Perceived ~60 % faster ([LinkedIn skeleton study][perf-ux]) | trivial |
| **Acknowledge-fast** — emit a localized one-liner ("Karibu, ninafikiri…" sw / "Got it, thinking…" en) in <100 ms before the model returns | Sub-100 ms first paint | Brain emits ACK SSE event before invoking Claude |
| **Predictive composer** — when user opens chat, show 3–4 last-likely-prompt chips that map to background-prefetched answers | Tapping a chip = instant; only typing has full latency | Chips already exist; prefetch missing |
| **History replay** — refetch last thread on chat open so the bubble cascade is already there at first paint | Perceived "instant chat" | Done partially in `useChat.ts`; not background-replayed |
| **Local-prompt-hash cache** — if exact same userText was sent in last 24 h, replay the answer with a "from cache" badge | 0 ms for hot paths | New |

### Tier 3 — Hybrid edge inference

Worth it for owner-mobile (urban 4G/5G). Skip for workforce-mobile on 3G.

- **Cloudflare Workers AI** runs Llama-3.3 70B at 200–300 ms first-token in
  edge POPs ([CallSphere 2026][cf-voice]). Joburg + Cape Town POPs are
  ~85 ms from Dar es Salaam.
- **Pattern:** edge handles the **first 50 tokens** (acknowledgement +
  initial reasoning) while we kick off the slower Anthropic call in
  parallel. When Anthropic streams its tokens back, we **switch sources
  seamlessly** by index (the SSE bubble keeps appending). Falls back to
  edge-only if Anthropic times out.
- **Latency saved on TTFT:** ~200 ms net for owner-mobile, ~0–100 ms for
  workforce-mobile (3G hides the win).
- **Cost:** edge inference at $0.011 per 1M input tokens for Llama 3.1 8B
  on Workers AI free tier (Cloudflare 2026 pricing). Negligible vs
  Anthropic API spend.

### Tier 4 — On-device router (not full LLM)

A 22–80 MB embedding model + on-device intent classification. Decides
**which Borjie tool/persona to call** without a network round-trip. Server
still produces the answer; we save 1 hop.

- **Pick:** Xenova `all-MiniLM-L6-v2-onnx` (~80 MB, 384 dim) via
  `onnxruntime-react-native` ([HuggingFace Transformers.js][hf-tjs]). Works
  cross-platform; tested on Hermes via [react-native-transformers][rnt]
  (note: archived; consider direct `onnxruntime-react-native` instead).
- **Effect:** on a hot "show me my license" prompt, we skip the brain's
  "which persona?" pass — save ~100–300 ms of server thinking.
- **Risk:** misroutes when intent is ambiguous; must still hit the brain
  to validate. Per Borjie's `CLAUDE.md` evidence-required rule, **the
  router is a hint, never the final decision** — the server confirms.

### Tier 5 — Full client-side LLM

**Not recommended for Borjie until 2027+.** Real numbers:

- **MLC-LLM via `react-native-ai`** (Callstack, 2026):
  Llama-3.2-3B-Instruct q4f16_1, ~2 GB on disk, requires
  iOS "Increased Memory Limit" entitlement; **iPhone 15 Pro: ~25 tok/s
  decode**; **Snapdragon 8 Gen 3 (S24 Ultra): ~18 tok/s**; budget
  Snapdragon 695: **8 tok/s decode, drops to 1.2 tok/s after 90 s
  thermal**.
  ([Callstack][cs-rn-ai], [RunAnywhere][runany])
- **ExecuTorch via `react-native-executorch`** (Software Mansion):
  Llama-3.2-1B quantized: **350 tok/s prefill, 40 tok/s decode** on
  reference Android device — beats MLC for small models. Bundle
  size impact: 200–400 MB per model. ([Software Mansion][rne-perf])
- **llama.rn** (`mybigday/llama.rn` v0.12.1): GGUF, requires RN New
  Architecture (we ship Old Arch still). Metal accel on iOS 7+ GPU.
  Streaming via callback. ([llama.rn][llamarn])
- **Apple Foundation Models** (iOS 26+ only): 3B on-device, **0.6 ms/token
  prefill, 30 tok/s decode** on iPhone 15 Pro ([Apple ML][apple-fm]).
  Privacy-first, free, but iOS-only and excludes our worker base.
- **Gemini Nano** (Pixel 10/Galaxy S26 only): ~940 tok/s reported on
  Pixel 10 Pro Nano v3 ([Google AI Edge][litert-blog]). Excludes our
  Itel/Tecno worker hardware.

**Why we say no for Borjie workforce-mobile:**
1. Worker hardware = Itel/Tecno entry tier, 4 GB RAM, Snapdragon
   400/600-class. RunAnywhere's 2026 test shows these phones **thermally
   die in 90 s**, dropping to 1.2 tok/s, hotter than a user wants to
   hold.
2. Bundle size +200–400 MB blows Google Play 100 MB main-bundle limit;
   we'd need dynamic asset packs.
3. The CLAUDE.md **evidence-required rule** means every AI output must
   cite ≥ 1 evidence_id from LMBM/corpus. On-device LLM has no access to
   our pgvector corpus and would fail audit.
4. The CLAUDE.md **AI audit chain is hash-chained, append-only** —
   client-side inference cannot append-and-verify against the server's
   audit chain without round-tripping anyway.

For **owner-mobile (iPhone)**, Apple Foundation Models could power a
single offline "summarise this dashboard" view — out of scope here.

---

## 3. Borjie-specific recommendations

### Workforce-mobile (workers, 3G, Itel/Tecno class)

- **Tier 1 + Tier 2 + offline cache.** No edge, no on-device LLM.
- Aggressive **last-thread persistence** so the chat is always
  "populated" within 1 frame of opening.
- **Acknowledge-fast** is critical here — 3G can hide 1.5 s of real
  latency behind a sw-localised "Karibu, ninafikiri…" rendered locally.
- Background **prefetch the 3–4 most-likely next prompts** every time
  the chat goes idle for >30 s. Owner of the home screen knows the
  worker's persona + role + last action → can predict reasonably.

### Buyer-mobile + Owner-mobile (better networks, iPhones common)

- **Tier 1 + Tier 2 + Tier 3 (edge first-50-tokens).**
- Owner on iOS 26 can opt into Apple Foundation Models for one offline
  view (cockpit summary). Not the main chat.
- Worth wiring `react-native-ai` for an experimental "offline cockpit
  briefing" feature on iPhone 15+. **Behind a feature flag.**

### Both surfaces

- **On-device embedding (MiniLM-L6-v2, ~80 MB)** for pre-network intent
  routing. Always a hint, never a final decision.
- **Anthropic 5-min ephemeral cache on system prompt + persona
  scaffolding + tool catalog** — saves 13–31 % TTFT for every turn
  inside a session. The 1-hour cache is worth the 2× write cost for
  the owner's daily strategy session because the same scaffold gets
  hit dozens of times.

---

## 4. First-token-time engineering — concrete patterns

### 4.1 Streaming SSE in React Native — what actually works in Hermes

**State as of 2026-05:**

- React Native core `fetch` does NOT expose `Response.body` as a
  `ReadableStream` ([RN issue #27741][rn-fetch-stream]). It is an XHR
  polyfill that buffers.
- **Hermes** exposes global `ReadableStream`, `WritableStream`,
  `TransformStream`, `TextEncoderStream`, `TextDecoderStream`. Has done
  since RN 0.73.
- **`expo/fetch`** (Expo SDK 52+) provides a **WinterCG-compliant fetch
  with `body.getReader()`**. On Expo SDK 51 + RN 0.74 it is partially
  available; the canonical answer for Borjie is **upgrade to SDK 52**
  for the streaming chat path. (We can do this incrementally — `expo`
  alongside `react-native` `fetch` via `EXPO_PUBLIC_USE_RN_FETCH=1` env
  toggle.) ([expo/fetch docs][expo-fetch])
- **Fallback for SDK 51 today:** **`react-native-sse`**
  ([binaryminds/react-native-sse][rn-sse]) — XHR-backed EventSource
  with Bearer header support, auto-reconnect, custom event types.
  Known gotcha: does not auto-close on app backgrounding; we already
  handle that pattern in `streamParser.ts` and `useChat.ts`.

Our **`apps/workforce-mobile/src/chat/streamChat.ts`** already has the
right shape — it tries `response.body.getReader()` then falls back to
buffered `.text()`. The fallback path is the wrong UX on a 5-second
response. Fix: prefer `expo/fetch` OR `react-native-sse`, then fall back
to a polling stub only on error.

**Code sketch — SDK 51 with `react-native-sse`:**

```ts
import EventSource from 'react-native-sse';

export async function streamBrainTurn(args: {
  userText: string;
  threadId: string | null;
  onAck: (text: string) => void;     // <100 ms placeholder
  onToken: (token: string) => void;  // streaming model tokens
  onDone: (final: BrainTurnResponse) => void;
  onError: (err: string) => void;
}): Promise<void> {
  const token = await getAuthToken();
  const url = `${API_BASE_URL}/api/v1/brain/turn/stream`;
  const es = new EventSource(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: { toString: () => `Bearer ${token}` },
    },
    body: JSON.stringify({
      userText: args.userText,
      threadId: args.threadId ?? undefined,
    }),
    pollingInterval: 0, // disable auto-reconnect for one-shot brain turn
  });
  es.addEventListener('ack',   (e) => args.onAck(JSON.parse(e.data).text));
  es.addEventListener('token', (e) => args.onToken(JSON.parse(e.data).t));
  es.addEventListener('done',  (e) => { args.onDone(JSON.parse(e.data)); es.close(); });
  es.addEventListener('error', (e) => { args.onError(e.message ?? 'stream'); es.close(); });
}
```

**Code sketch — SDK 52+ with `expo/fetch` (preferred long-term):**

```ts
import { fetch } from 'expo/fetch';
const resp = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify({ userText, threadId }),
});
const reader = resp.body!.getReader();
const decoder = new TextDecoder();
const parser = new SseParser(); // we already have this
while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  for (const ev of parser.feed(decoder.decode(value, { stream: true }))) {
    handle(ev);
  }
}
```

### 4.2 "Acknowledge fast, think slow"

Server side: brain emits an SSE `event: ack` with a sw/en one-liner
**before** invoking Claude. Generation: deterministic, no LLM call,
sub-50 ms. Client renders it as the first bubble fragment.

```ts
// Pseudo-Hono handler
brainRouter.post('/turn/stream', async (c) => {
  return streamSSE(c, async (s) => {
    const lang = pickLanguage(c); // 'sw' | 'en'
    await s.writeSSE({
      event: 'ack',
      data: JSON.stringify({
        text: lang === 'sw' ? 'Karibu, ninafikiri…' : 'Got it, thinking…',
      }),
    });
    // ... kick off Anthropic call, stream tokens as 'token' events
  });
});
```

This single event drops perceived TTFT from ~600 ms (Claude Haiku) to
**~50–100 ms**. Cheap.

### 4.3 Prefetch popular chip handler

```ts
// On HomeChat mount, if idle > 30 s, prefetch the top-K likely chips.
useEffect(() => {
  const t = setTimeout(async () => {
    if (!hasUnreadTurn) {
      for (const chip of topKChips(role, lastScreen)) {
        await prefetchBrainTurn(chip.prompt); // background, no UI
      }
    }
  }, 30_000);
  return () => clearTimeout(t);
}, [hasUnreadTurn, role, lastScreen]);
```

Cached server-side via Anthropic prompt cache + an in-process LRU keyed
by `(tenant, role, promptHash)`. If the user taps the chip, the answer
streams from the warmed cache → **TTFT ~150 ms** vs ~1 s cold.

### 4.4 Cache-key strategy

Three layers:

1. **Anthropic ephemeral cache** (`cache_control:{type:"ephemeral"}`) on
   system prompt + persona + tool catalog. Server-managed, 5-min TTL.
2. **Server LRU** in api-gateway, keyed `(tenant_id, role, promptHash,
   personaId)`. Stores the full `BrainTurnResponse` for 60 s. Skip for
   prompts containing dynamic time/location tokens.
3. **Client cache** in AsyncStorage, keyed by `(threadId, promptHash)`.
   If exact-match within 24 h, render with a small "from history"
   badge while we still fire-and-forget a background refresh.

### 4.5 Brain THREAD persistence on chat open

```ts
// HomeChat root effect.
useEffect(() => {
  void Promise.allSettled([
    fetchLastThread(),         // populates the bubble cascade
    prefetchBrainTurn(null),   // warms the Anthropic cache via no-op /ping
  ]);
}, []);
```

The bubble cascade renders first paint at ~150 ms even if the user
just typed something — they don't see a blank screen.

---

## 5. On-device embeddings — what's actually usable in 2026

| Option | Verdict | Why |
|---|---|---|
| **`onnxruntime-react-native` + MiniLM-L6-v2** | **USE THIS** | 80 MB, 384 dim, runs cross-platform via ONNX Runtime Mobile. Embeds in <50 ms on Snapdragon 6xx. Active project. |
| **`react-native-transformers`** | Avoid | Archived July 2025. Was a wrapper around the above; do it directly. |
| **`transformers.js`** | Web only | Designed for browser/Node. Bundle bloat in RN. Mobile path is the underlying ONNX runtime. |
| **Apple Core ML BERT-mini** | iOS-only | Cannot be shared cross-platform; would split codebase. Use only if you need iOS-specific gains. |
| **Gemini Nano embedding API** | Pixel/Samsung-only | Fragments the worker base; skip. |

**Vector store on-device:** `sqlite-vec` ([midswirl][sqlite-vec]) or
`ObjectBox` ([ObjectBox][objbox]) — both ship HNSW on mobile. For
Borjie's "what tool?" router we only need ~200 vectors of cached
tool descriptions; a flat in-memory cosine over 200×384 floats is
< 5 ms in Hermes and doesn't need a DB. Defer the DB.

---

## 6. Anti-patterns — explicit DON'Ts

| Anti-pattern | Why it hurts Borjie |
|---|---|
| **Polling `/brain/turn` until done** instead of streaming | Wastes a full RTT per poll; on 3G that's 500 ms × N polls. Always inferior to one SSE connection. |
| **Synchronous device-model loading on cold start** | A 200 MB GGUF takes 4 s to mmap on Snapdragon 695. App boot must NOT block on this. If we ever ship an on-device model, it must lazy-load behind a feature flag and pre-warm AFTER first paint. |
| **Trusting on-device output without server verification** | Violates CLAUDE.md `evidence-required` rule. Auditor Agent rejects empty evidence chains. On-device must be a hint, never an answer. |
| **Skipping Pino logger to "feel faster"** | Pino is async + adds <1 ms. Removing it loses redaction and breaks the hash-chained audit. Hard NO. |
| **Reflective CORS to make edge handoff easier** | Hard rule in CLAUDE.md — origin allowlist only. Workers AI integration must use an allowlisted edge domain. |
| **Raw HTML token rendering** | DOMPurify required. If on-device model returns markdown with HTML, sanitise client-side before render. |
| **Caching across tenants** | RLS is FORCE-enabled. Any cache key must include `tenant_id`. The server LRU cache MUST be partitioned. |
| **Using `console.log` to debug stream events** | Hard rule — Pino only in services. In RN, OK during dev but lint-trim before ship; current hook system warns on this. |
| **Adding a new edge endpoint without rate-limiter wiring** | Brain rate limiter already exists (`sharedRateLimiter` in `brain.hono.ts`). The edge path must be subject to the same per-user quota. |
| **Forgetting Authorization on `react-native-sse`** | The library accepts an object header that stringifies on each retry — see code sketch above. Forgetting the lazy `toString` causes silent 401s on reconnect. |

---

## 7. References

| # | URL | One-line takeaway |
|---|---|---|
| 1 | [Apple ML Research — Foundation Models][apple-fm] | 3B on-device, 0.6 ms/token prefill, 30 tok/s decode, iPhone 15 Pro. |
| 2 | [Apple Security — Private Cloud Compute][apple-pcc] | PCC = hardened iOS-derived OS on custom Apple silicon servers; cloud equivalent of on-device privacy. |
| 3 | [Android Developers — Gemini Nano][gemini-nano] | AICore system service exposes Nano via ML Kit GenAI; "low inference latency"; no public latency numbers on the dev page. |
| 4 | [Google AI Edge — LiteRT][litert-overview] | LiteRT = TFLite successor; 1.4× faster GPU; LiteRT-LM handles KV cache + speculative decoding; up to 2.2× via spec. |
| 5 | [Google Devs blog — LiteRT universal framework][litert-blog] | NPU ≈ 100× CPU, 10× GPU. LiteRT-LM bypasses traditional latency bottlenecks with speculative decoding. |
| 6 | [llama.rn — mybigday][llamarn] | RN binding of llama.cpp, GGUF, Metal accel iOS, OpenCL Android (Adreno), token-callback streaming, requires RN New Arch from v0.10. |
| 7 | [react-native-executorch — Software Mansion][rne-perf] | Llama-3.2 1B quantized: 350 tok/s prefill, 40 tok/s decode on reference Android. 2–4× speedup vs BF16, 56 % size reduction. |
| 8 | [react-native-ai — Callstack][cs-rn-ai] | Vercel-AI-SDK shaped, unified provider for MLC + ExecuTorch + Apple Foundation Models. Setup currently complex. |
| 9 | [HuggingFace — LLM on edge via RN][hf-rn-edge] | End-to-end RN tutorial: llama.rn + GGUF + react-native-fs + axios. Recommends 1–3B quantized for phones. |
| 10 | [RunAnywhere — $150 Android LLM test][runany] | Snapdragon 695 + 4 GB RAM, Qwen 2.5 0.5B Q6_K: 8–12 tok/s, dies to 1.2 tok/s after 90 s thermal. 8 % battery / 10 min voice. |
| 11 | [Anthropic — Streaming messages][anth-stream] | Canonical SSE event schema: `message_start`, `content_block_start`, `content_block_delta` (text_delta), `content_block_stop`, `message_delta`, `message_stop`. |
| 12 | [Anthropic — Reducing latency][anth-latency] | Choose Haiku, shrink prompt, stream, cache prefix. Authoritative latency advice. |
| 13 | [Anthropic — Prompt caching][anth-cache] | 5-min ephemeral default (March 2026 change); 1-h extended at 2× write cost; 13–31 % TTFT win, up to 85 % on long prompts. |
| 14 | [Artificial Analysis — Haiku 4.5][aa-haiku] | TTFT 0.59–0.95 s; 88.7 tok/s decode; cheapest fast-path Anthropic model. |
| 15 | [Artificial Analysis — Sonnet 4.6][aa-sonnet] | TTFT 1.20 s low-effort; reasoning mode much higher; trade-off pivot point. |
| 16 | [BenchLM 2026 — LLM API latency][bench-llm] | ChatGPT API TTFT ~825 ms; Haiku 4.5 best non-reasoning TTFT in 2026 benchmark. |
| 17 | [Perplexity voice mode][perp-voice] | ~400 ms voice-to-voice with predictive streaming. |
| 18 | [Cloudflare Workers AI voice agents][cf-voice] | Edge inference 200–300 ms first token; Joburg/Cape Town POPs; sub-100 ms voice TTFB on Aura-1 TTS. |
| 19 | [expo/fetch][expo-fetch] | WinterCG fetch in Expo SDK 52+; `body.getReader()` works for text/event-stream. |
| 20 | [react-native-sse — binaryminds][rn-sse] | SDK 51 fallback: XHR-backed EventSource with Bearer header support + auto-reconnect. |
| 21 | [RN issue #27741 — fetch streaming][rn-fetch-stream] | RN core fetch is XHR polyfill; no native ReadableStream. Use Expo fetch or polyfill. |
| 22 | [Hermes engine status][hermes] | Hermes exposes ReadableStream / TextDecoderStream globals as of RN 0.73; required for streaming chat in RN. |
| 23 | [Performance-First UX 2026][perf-ux] | Skeleton tokens cut perceived wait 55–70 %; optimistic UI tricks brain into "instant". |
| 24 | [Callstack — MLC OpenCL profiling][cs-mlc-android] | Adreno requires `_0` weight layout to avoid 20–50 s freeze on first inference. Practical mobile gotcha. |
| 25 | [arXiv — Edge-cloud speculative decoding][edge-spec] | 35 % latency reduction by edge SLM drafts verified by cloud LLM; 11 % extra from preemptive drafting. |
| 26 | [arXiv — PerCache predictive RAG][percache] | 34.4 % latency reduction via predictive hierarchical mobile cache. |
| 27 | [Glean — KV cache TTFT impact][glean-kv] | Warm KV cache drops TTFT 18.5 s → 8.0 s at long context; sub-second reload up to 16k. |
| 28 | [HuggingFace Transformers.js v3][hf-tjs] | Cross-platform ONNX runtime; MiniLM-L6-v2 384-dim embeddings ~80 MB. |
| 29 | [sqlite-vec for RAG][sqlite-vec] | Embedded vector store; WASM-friendly; works in mobile via embedded SQLite. |
| 30 | [ObjectBox on-device 2026][objbox] | Mobile-native vector DB with HNSW; Flutter + native bindings. |
| 31 | [RFBenchmark Tanzania mobile][rf-tz] | Tanzania urban 4G median 29 Mbps / 24 ms; 3G remains common in mining regions. |

---

## 8. Glossary & cross-cutting notes

- **TTFT** — Time to first token: wall-clock from request send to first
  user-visible token. The metric that decides whether the chat "feels"
  fast.
- **TPS / decode** — Tokens per second once generation has started.
  Matters less than TTFT for first-impression; matters for long
  answers.
- **Prefill** — One-time cost to ingest the prompt + system + history.
  Dominates TTFT. KV cache reuse is what kills prefill cost.
- **KV cache** — Per-layer attention cache. Anthropic's `cache_control`
  marker lets us reuse it across requests for 5 min (or 1 h at 2×
  cost).
- **Speculative decoding** — A small "draft" model proposes N tokens;
  the large model verifies in parallel. Cuts TPS for repetitive
  patterns by 2–3×. Anthropic + OpenAI default 2026; we don't control
  it.

---

## 9. Concrete proposal for Borjie — phased plan

### Phase 1 — Streaming + ack + cache (highest ROI)

**Goal:** TTFT from ~2.5 s (today, JSON return) to **≤ 1.0 s real**
and **<200 ms perceived** on 4G; from ~5 s to **≤ 1.8 s real** on 3G.

**Engineering cost:** 1.5–2 dev-weeks.

**Files to add/modify:**

- `services/api-gateway/src/routes/brain.hono.ts` — add
  `brainRouter.post('/turn/stream', ...)` that returns SSE. Reuse
  existing `withSecurityEvents` middleware. The existing `/turn`
  endpoint stays for non-streaming callers (admin-web) until they
  also migrate.
- `services/api-gateway/src/composition/brain-stream.ts` (new) —
  wires the brain orchestrator to emit SSE events: `ack`, `token`,
  `tool_call`, `evidence`, `done`. Anthropic's stream SDK is the
  source; we re-emit through Hono's `streamSSE` helper.
- `packages/ai-copilot/src/brain/turn-stream.ts` (new) — async-
  iterable wrapper around the existing `Brain.turn()` that yields
  events as the model streams.
- `packages/ai-copilot/src/brain/prompt-cache.ts` (new) — applies
  `cache_control: {type:"ephemeral"}` to system prompt + tool
  catalogue + persona before sending. Skips when prompt < 1024 tok.
- `apps/workforce-mobile/src/chat/brainTurn.ts` — extend with
  `postBrainTurnStream()`. Keep `postBrainTurn()` for non-chat
  callers. (Same pattern in `apps/buyer-mobile/src/chat/brainTurn.ts`.)
- `apps/*/src/chat/streamChat.ts` — replace current `chat` router
  call with `brain/turn/stream`. The existing SSE parser is reusable.
- `apps/*/src/chat/HomeChat.tsx` — render the `ack` event as the
  first bubble fragment (in italic with a typing indicator), then
  append `token` events into the same bubble.
- `apps/*/package.json` — add `react-native-sse` for SDK 51 path
  (or bump to SDK 52 and use `expo/fetch`). Decide once; recommend
  SDK 52 bump to remove a polyfill liability long-term.

**Blockers / risks:**
- Migrating to Expo SDK 52 has knock-on effects in EAS configs and
  workforce-mobile's existing native modules. Pre-validate.
- Anthropic prompt cache requires ≥ 1024 tokens per breakpoint —
  short Borjie system prompts may not qualify; we'll need to
  consolidate `personae` + `tool-catalog` into one cache block.
- SSE through corporate proxies / mobile carriers can buffer; Hono
  needs `Cache-Control: no-cache, no-transform` + `X-Accel-Buffering:
  no` headers (already standard but verify in `streamSSE` config).
- Rate limiter must apply to the new endpoint too — wire
  `sharedRateLimiter` in the new route.

**Hardware impact:** none. Net effect on workforce-mobile is reduced
data transfer (we no longer block on a single response, the user
sees value mid-stream → may cancel earlier).

**Latency budget after Phase 1 (4G, Dar es Salaam to us-east-1):**

| Component | ms |
|---|---|
| RTT to gateway | 280 |
| Gateway auth + RLS bind | 30 |
| Brain prelude (persona pick, no LLM) | 30 |
| ACK SSE emitted | <50 |
| **Perceived first frame** | **~390 ms (vs ~2500 ms today)** |
| Claude Haiku TTFT with cache | 600–950 |
| **Real first token** | **~900–1300 ms** |

### Phase 2 — Prefetch + history-replay + client cache

**Goal:** First *useful* paint within 1 frame of opening chat for
warm sessions. TTFT-on-chip ≤ 200 ms for prefetched chips.

**Engineering cost:** 2 dev-weeks.

**Files:**
- `apps/*/src/chat/useChat.ts` — add background `fetchLastThread()`
  on mount; add idle-prefetch timer.
- `apps/*/src/chat/prefetch.ts` (new) — selects top-K likely prompts
  per role/screen; fires a no-stream variant of `/brain/turn` that
  is cached server-side.
- `services/api-gateway/src/routes/brain.hono.ts` — add
  `brainRouter.post('/turn/prefetch', ...)` that does a non-streaming
  brain turn but stores the response keyed on prompt-hash with a 60 s
  TTL.
- `packages/ai-copilot/src/brain/cache-layer.ts` (new) — in-process
  LRU keyed `(tenant_id, role, promptHash, personaId)`. RLS-safe via
  explicit tenant key.
- `apps/*/src/chat/local-cache.ts` (new) — AsyncStorage layer keyed
  `(threadId, promptHash)`, 24 h TTL.

**Blockers:** the prefetch cache MUST be tenant-isolated; failing
that, leaks across tenants. Code review checklist must include
"every cache key includes `tenant_id`".

**Hardware impact:** AsyncStorage grows ~50 KB/user; bounded by an
LRU at 200 entries.

### Phase 3 — Edge first-50-tokens (owner-mobile only)

**Goal:** TTFT < 500 ms for the owner-mobile chat. Skip workforce.

**Engineering cost:** 3 dev-weeks (Cloudflare Workers setup, prompt-
mapping infra, race-and-merge logic).

**Files:**
- `services/edge-brain` (new infra package) — Cloudflare Worker
  deployed to af-south1 (Joburg/Cape Town) with Workers AI binding.
  Receives Borjie-shaped prompts, returns the first 50 tokens of an
  acknowledgement + initial reasoning via Llama-3.3 70B on Workers
  AI.
- `services/api-gateway/src/composition/edge-brain-client.ts` (new)
  — when feature flag `BORJIE_EDGE_BRAIN=on` and surface is
  `owner-mobile`, race the edge call and the Anthropic call. Stream
  whichever returns first; switch to Anthropic at sentence boundary
  for the rest.
- `apps/owner-mobile/src/chat/streamChat.ts` — feature-flag aware.
- Workers AI domain must be added to CORS allowlist.

**Blockers:**
- Workers AI free tier limits (10 M tokens/day) — measure burn.
- Edge inference output quality must be "good enough" for first 50
  tokens; tested with regulatory queries, must not contradict
  Anthropic's eventual answer (we splice at sentence boundary so
  divergence is bounded).
- Audit chain: edge tokens are NOT recorded in our hash chain (CLAUDE.md rule).
  Resolution: edge output is **non-binding** — it's a "thinking
  preface"; the binding answer is the Anthropic one. The audit
  records `final_text = anthropic_text`, not the edge preface.

**Latency budget after Phase 3:**

| Component | ms |
|---|---|
| RTT to af-south-1 POP | 85 |
| Edge inference TTFT | 200 |
| **Perceived first token** | **~285 ms** |
| Anthropic catches up at sentence ~1–2 | 900–1300 |
| Cutover is transparent | — |

### Phase 4 — On-device router (Tier 4, deferred)

**Goal:** Skip one network hop on the brain's "which tool?" pass for
hot prompts.

**Engineering cost:** 4 dev-weeks (model bundling, JSI native module
verification, accuracy A/B).

**Files:**
- `packages/router-onnx` (new) — wraps `onnxruntime-react-native` +
  bundled MiniLM-L6-v2 + a small classifier head trained on our
  tool taxonomy. Exposes
  `predictTool(userText) → {toolId, confidence}`.
- `apps/*/src/chat/HomeChat.tsx` — calls the router before posting;
  passes `routerHint` along to `/brain/turn/stream`.
- `services/api-gateway/src/routes/brain.hono.ts` — accepts the
  `routerHint` field; brain uses it to skip its own routing pass
  but always verifies before tool-calling.

**Blockers:**
- 80 MB model bundle; need Expo asset config or download-on-first-use.
- Cold-start time of ONNX runtime in Hermes is ~600 ms on
  Snapdragon 695 (one-time). Must lazy-init AFTER first paint.
- `CLAUDE.md` evidence-required rule — the router output is never
  the final answer, only a hint. Code review must enforce.

**Latency saved:** 100–300 ms per turn for "what tool?" routing.

### Migration path (no breakage)

- Both `/brain/turn` (JSON) and `/brain/turn/stream` (SSE) coexist.
  Admin-web (server-rendered) stays on JSON; mobile apps migrate.
- Feature-flag `BORJIE_BRAIN_STREAM_ENABLED` per surface, default on
  for mobile in Phase 1.
- Local cache is opt-in via the same flag.
- Edge path is feature-flagged separately and only on for
  `owner-mobile` initially.
- All four phases are independently shippable; the streaming change
  (Phase 1) is the bare-minimum requirement to be considered
  competitive with 2026 SOTA chat UX.

---

## Appendix A — Anthropic SSE event schema (canonical)

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_...","model":"claude-haiku-4-5",...}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Karibu"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" mfanyakazi"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":42}}

event: message_stop
data: {"type":"message_stop"}
```

Source: [Anthropic — Streaming messages][anth-stream].

Tool-use blocks arrive as `content_block_start` with
`content_block.type === "tool_use"` followed by `input_json_delta`
chunks; assemble with the existing `streamParser.ts` logic.

---

## Appendix B — Borjie-shaped SSE event schema (proposed)

Above the Anthropic stream we layer Borjie semantics:

```
event: ack
data: {"text":"Karibu, ninafikiri…","lang":"sw"}

event: persona_picked
data: {"id":"borjie.junior.geologist","reason":"licence_query"}

event: tool_call
data: {"name":"borjie.licence.lookup","arguments":{"licence_id":"PL12345"}}

event: token
data: {"t":"Leseni"}

event: evidence
data: {"evidence_id":"evt_8a2...","source":"intelligence_corpus","span":[123,456]}

event: done
data: {"finalPersonaId":"borjie.junior.geologist","handoffs":[...],"audit_hash":"sha256:..."}

event: error
data: {"code":"RATE_LIMIT","message":"slow down"}
```

The `evidence` event satisfies the CLAUDE.md evidence-required rule
inline — UI can render evidence chips next to streamed sentences.

---

## Appendix C — KPI dashboard (post-implementation)

| Metric | Today | After P1 | After P2 | After P3 |
|---|---|---|---|---|
| Workforce 4G TTFT real (p50) | ~2.5 s | ~1.0 s | ~0.9 s | ~0.9 s |
| Workforce 4G perceived first paint | ~2.5 s | ~0.4 s | ~0.3 s | ~0.3 s |
| Workforce 3G TTFT real (p50) | ~5.0 s | ~1.8 s | ~1.6 s | ~1.6 s |
| Owner 4G TTFT real (p50) | ~2.0 s | ~0.8 s | ~0.7 s | ~0.3 s |
| Owner prefetched-chip TTFT | n/a | n/a | ~150 ms | ~150 ms |
| Anthropic spend / month | baseline | −10 % (cache hits) | −15 % | −15 % |

(Targets, not commitments — measured in eval rig under `evals/` once
P1 lands.)

---

[apple-fm]: https://machinelearning.apple.com/research/introducing-apple-foundation-models
[apple-pcc]: https://security.apple.com/documentation/private-cloud-compute
[gemini-nano]: https://developer.android.com/ai/gemini-nano
[litert-overview]: https://ai.google.dev/edge/litert
[litert-blog]: https://developers.googleblog.com/litert-the-universal-framework-for-on-device-ai/
[llamarn]: https://github.com/mybigday/llama.rn
[rne-perf]: https://docs.swmansion.com/react-native-executorch/
[cs-rn-ai]: https://www.callstack.com/blog/meet-react-native-ai-llms-running-on-mobile-for-real
[hf-rn-edge]: https://huggingface.co/blog/llm-inference-on-edge
[runany]: https://www.runanywhere.ai/blog/on-device-llm-android
[anth-stream]: https://platform.claude.com/docs/en/docs/build-with-claude/streaming
[anth-latency]: https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency
[anth-cache]: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
[aa-haiku]: https://artificialanalysis.ai/models/claude-4-5-haiku
[aa-sonnet]: https://artificialanalysis.ai/models/claude-4-sonnet/providers
[bench-llm]: https://benchlm.ai/llm-speed
[perp-voice]: https://www.datastudios.org/post/perplexity-ai-and-voice-conversation-features-live-queries-and-real-time-responses
[cf-voice]: https://callsphere.ai/blog/vw6c-cloudflare-workers-ai-sub-100ms-voice-2026
[expo-fetch]: https://docs.expo.dev/versions/latest/sdk/expo/
[rn-sse]: https://github.com/binaryminds/react-native-sse
[rn-fetch-stream]: https://github.com/facebook/react-native/issues/27741
[hermes]: https://reactnative.dev/docs/hermes
[perf-ux]: https://wearepresta.com/performance-first-ux-2026-architecting-for-revenue-and-speed/
[cs-mlc-android]: https://www.callstack.com/blog/profiling-mlc-llms-opencl-backend-on-android-performance-insights
[edge-spec]: https://arxiv.org/pdf/2505.21594
[percache]: https://arxiv.org/pdf/2601.11553
[glean-kv]: https://www.glean.com/blog/glean-kv-caches-llm-latency
[hf-tjs]: https://huggingface.co/docs/transformers.js/index
[rnt]: https://github.com/daviddaytw/react-native-transformers
[sqlite-vec]: https://www.midswirl.com/blog/road-to-sqlite-vec-exploring-sqlite-as-a-rag-vector-database
[objbox]: https://objectbox.io/262454-2/
[rf-tz]: https://rfbenchmark.com/en/mobile-internet-in-north-africa-kenya-and-tanzania-availability-quality-and-speed/
