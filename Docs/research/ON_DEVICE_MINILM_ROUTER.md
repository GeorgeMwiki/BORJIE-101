# On-Device Pre-Network Router — MiniLM-L6-v2 ONNX

**Last updated:** 2026-05-29
**Roadmap item:** R4 (XL, 2027+ — DO NOT BUILD UNTIL Q4 2026)
**Companion code:** `packages/on-device-router/` (no-op stub)
**Status:** RESEARCHED + STUBBED. Production work is explicitly
deferred per `Docs/RESEARCH/mobile-onload-intelligence.md` §9.4.

---

## 1. The problem

Every routing decision in the mobile apps today round-trips to the
api-gateway. For hot paths ("which tool fires for *home → tap mic →
say 'cash flow'*?") that's 200–400 ms of round-trip latency before
the brain even starts thinking.

Sibling apps (Replika, Lensa, etc.) have shipped on-device intent
routers for ~3 years using bundled MiniLM-L6-v2 ONNX embeddings.
The cost: ~80 MB of model weights, ~10 ms inference on a modern
phone, and the bundle-size hit that's unwelcome on Tanzanian Itel /
Tecno worker phones with limited storage budgets.

---

## 2. Model selection matrix

| Model | Size (quantised) | Inference (ms, mid-tier Android) | Pros | Cons |
|---|---|---|---|---|
| **MiniLM-L6-v2 ONNX** | 80 MB | 8–15 | Battle-tested, embedding-quality | Bundle size |
| **Phi-3-mini-4k Q4** | 1.8 GB | 200+ | Strong reasoning | Too big for Itel |
| **Gemma-2B Q4** | 1.2 GB | 150 | Google support | Still too big |
| **all-MiniLM-L6-v2 Q8** | 22 MB | 20 | 4× smaller | Slightly lower recall |
| **DistilBERT Q4** | 40 MB | 30 | Open | Slower than MiniLM |

**Recommendation:** MiniLM-L6-v2 Q8 (22 MB) shipped as a download-on-
first-launch asset rather than bundled, with the full Q4 80 MB
variant available for Wi-Fi installs. The router uses the highest-
quality variant available locally.

---

## 3. Deployment options

### 3.1 React Native (workforce-mobile + buyer-mobile)

- **onnxruntime-react-native** — official ONNX runtime port. Works
  on Hermes via JSI. Verified by Replika in production.
- **transformers.js (RN port)** — pure JS path, ~3× slower but no
  native bindings to maintain.
- **react-native-rknn** — Rockchip NPU path. Only relevant if we
  ever ship a hardware-NPU phone variant (unlikely pre-2028).

Lean: **onnxruntime-react-native** + a thin TypeScript wrapper that
exposes `routeOnDevice(prompt)` → `{ toolId, confidence }`.

### 3.2 Web (owner-web)

The web cockpit doesn't need this — desktop latency to the api-
gateway is already <50 ms. We don't bundle the model into the web
build.

---

## 4. Wire shape (Phase-2, NOT in this commit)

```
// Client side (mobile app)
const decision = await routeOnDevice(promptText);
// decision = {
//   toolId: 'mining.cockpit.daily-brief' | null,
//   confidence: 0.0..1.0,
//   inferMs: 12
// }

// Then on the server turn:
await brain.turn({
  prompt: promptText,
  routerHint: decision.toolId,   // server can validate / override
  routerConfidence: decision.confidence
});
```

The server treats `routerHint` as a HINT — the brain's policy gate
re-validates the tool selection per the standard catalog rules.
Wrong hints are ignored; correct hints save 100–300 ms by pre-warming
the tool's resolver while the LLM stream is still loading.

---

## 5. Accuracy A/B plan

Phase-2 work: ship the router behind a feature flag, log every
(hint, actual) pair via the existing brain-audit chain. Target
**≥85% hint-matches-actual** before flipping the cap. Below that
the hints harm latency rather than help (cache thrashing).

---

## 6. Why deferred to 2027+

Per `Docs/RESEARCH/mobile-onload-intelligence.md` §9.4:

1. Bundle-size budget. The pilot demographic (Tanzanian artisanal
   miners on Itel A56) has ~200 MB free storage on average. An 80 MB
   model bundle is a hard sell pre-pilot.
2. Hardware diversity. Quantisation kernels differ across the long
   tail of Android ARM SoCs. Pre-pilot we don't know which kernels
   we need.
3. Maintainability. Native ONNX runtime updates require coordinated
   app-store releases; the team is too small to keep up pre-launch.

When the pilot lands and the SLO data confirms TTFT pain, this
ships.

---

## 7. What's in this commit

- `packages/on-device-router/` — TypeScript stub. `routeOnDevice()`
  returns `{ toolId: null, confidence: 0 }` so callers can wire the
  signature today without behaviour change.
- This research doc.
- The roadmap R4 status row updated with "DO NOT BUILD UNTIL Q4 2026".

## 8. DO NOT DO

- Do not add the model weights to the repo. The eventual asset path
  is `apps/workforce-mobile/assets/onnx/MiniLM-L6-v2-q8.onnx`,
  downloaded on first launch.
- Do not promote the server-side `routerHint` to authoritative — it
  is always a hint, the policy gate is canonical.
- Do not bundle MiniLM into the web build.
