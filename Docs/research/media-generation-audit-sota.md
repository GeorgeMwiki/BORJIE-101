# Media Generation — Audit vs SOTA (Image / Short-Video / GIF)

**Date:** 2026-06-08
**Auditor:** Claude (Opus 4.8, 1M ctx) — deep-research subagent
**Scope:** `packages/media-generation/` (Borjie) + `packages/content-studio/` (BOSSNYUMBA101)
**Verdict:** **Current level vs SOTA = 1.5 / 5** — world-class *scaffolding* (types, registry, dispatcher, brand-lock, safety contracts, budgets, DB schema, 78 tests) with the **entire "last mile" unimplemented**: no real media bytes are ever produced, no async job/poll loop exists, no storage upload, no DB persistence, no valid C2PA, and the one wiring point into the brain is a **dead contract mismatch** that always falls back to a 1×1 placeholder PNG.

> One-sentence summary for the owner: *The Sora-2 / Seedance-2 / Flux adapters exist as plausible-looking files but they fabricate fake bytes from JSON metadata, never poll the async jobs these providers actually require, never download the real video/image, never store it, and the brain can't even reach them — so today the product generates exactly zero real images or videos.*

---

## 0. How to read this dossier

- **§1** — what the code actually DOES today (Borjie + BN), file:line grounded.
- **§2** — 2025-2026 SOTA for generative image, short-video, GIF (cited, verified).
- **§3** — the concrete gap list (also in the structured `gaps[]`).
- **§4** — the buildable closure plan (provider abstraction, async job+poll, storage, provenance, brain/genui trigger).

---

## 1. What the codebase actually does today

### 1.1 Borjie `packages/media-generation` — architecture is real, execution is hollow

The package is large and well-factored (many small files, immutable types, 78 `it()`/`test()` cases across 18 test files). It implements **Layers 1-4** of `Docs/DESIGN/MEDIA_GENERATION_SPEC.md`:

| Layer | File | Real? |
|-------|------|-------|
| Types / contracts | `src/types.ts` (364 lines) | **Real** — clean discriminated unions, 9 media classes, 11 provider ids, `MediaProvenance`, `MediaArtifact`, `MediaCompositionError` codes. |
| Recipe registry | `src/registry.ts` | **Real** — versioned `(id,version)` Map, `getLive`, lock policy. 3 seed recipes only. |
| Composer | `src/composer.ts` | **Real but thin** — resolves recipe, checks required inputs, delegates to `recipe.compose`. |
| Brand-DNA prompt prefix | `src/brand-lock/*` | **Real** — `buildBrandedPrompt`, negative-prompt, output validator (vision-API-injectable). |
| Dispatcher + fallback | `src/providers/dispatcher.ts` | **Real logic** — capability-ordered + cost-aware fallback ladder, never-throws loop. |
| 11 provider adapters | `src/providers/*-adapter.ts` | **FAKE OUTPUT** — see §1.2. |
| Safety (NSFW/deepfake/brand) | `src/safety/*` | **Env-gated; effectively dark** — see §1.4. |
| C2PA / watermark | `src/watermark/*` | **Not real C2PA** — see §1.5. |
| Cost-tracker / budgets | `src/budgets/cost-tracker.ts` | **Real** — reserve/commit/release, per-class budgets. |
| Audit-chain link | `src/audit/audit-chain-link.ts` | **Real** — sha256 hash-chain link. |

### 1.2 THE CORE DEFECT — adapters fabricate bytes; no async poll; no download

Every provider adapter is built by `createThinAdapter` (`src/providers/factory.ts`). The factory does a **single** `safeFetch` POST, zod-parses the JSON response, then calls the per-adapter `extractBytes` to produce the artifact body. The problem: **`extractBytes` synthesizes a UTF-8 string, it does not return real media bytes.**

- Sora: `src/providers/sora-adapter.ts:68-69`
  `extractBytes: ({ parsed, brandedPrompt, seed }) => Buffer.from(`+"`"+`sora:${parsed.id}:${brandedPrompt}:${seed}`+"`"+`, 'utf-8')`
- Seedance: `src/providers/seedance-adapter.ts:63-67` → `Buffer.from(`+"`"+`seedance:${parsed.task_id}:...`+"`"+`)`
- Runway: `src/providers/runway-adapter.ts` (last lines) → `Buffer.from(`+"`"+`runway:${parsed.id}:...`+"`"+`)`
- Flux: `src/providers/flux-adapter.ts:67-68` → `Buffer.from(`+"`"+`flux:${parsed.id}:...`+"`"+`)`
- Imagen: `src/providers/imagen-adapter.ts:68-74` → even when the API returns base64, it only takes `b64.slice(0,24)` and wraps it in a string label — **it never decodes the base64 image**.

The factory's own comment admits it: `src/providers/factory.ts:87-97` — *"For adapters that return a media URL we synthesise stable seed bytes (the production caller downloads via the URL)."* But **no production caller exists** that downloads via the URL (see §1.3, §1.6).

**Why this is fatal, not cosmetic:** all four flagship providers are **asynchronous job APIs**. They return a job/task id immediately; you must poll for completion, then download the asset from a (temporary) URL or a content endpoint:

- **OpenAI Sora 2:** `POST /videos` → returns job id + status `queued`; poll `GET /videos/{video_id}` until `completed`; download MP4 from `GET /videos/{video_id}/content` (binary stream) — [OpenAI Sora video-generation guide](https://developers.openai.com/api/docs/guides/video-generation). Borjie's adapter does the POST only, then fabricates bytes.
- **Google Veo 3.1:** long-running **operation**; `while not operation.done: sleep(10); operation = client.operations.get(operation)`; then `client.files.download(file=video.video)` — [Veo API docs](https://ai.google.dev/gemini-api/docs/video). (Borjie has no Veo/Imagen-video adapter at all and no operation poll.)
- **BFL Flux:** *"asynchronous design… first make a request… then query for the result"*; response carries `id` + `polling_url`; poll `GET /v1/get_result?id=…` until `status:"Ready"`, then `result.sample` is a **temporary** URL you must download immediately and re-host — [BFL docs](https://docs.bfl.ml/quick_start/generating_images). Borjie's Flux adapter posts to `/flux-pro-1.1-ultra` and never polls `get_result`.
- **ByteDance Seedance 2.0:** returns `task_id`; async generation on BytePlus ModelArk; poll then fetch — [Seedance 2.0 API reference (BytePlus ModelArk)](https://docs.byteplus.com/en/docs/ModelArk/1520757). Borjie posts to `/text2video` and fabricates bytes from `task_id`.

**Net:** even with every API key set, Borjie cannot produce a single real frame. The adapters would 200-OK on the create call, fabricate a string, seal an audit hash over garbage, and "succeed."

### 1.3 Brain/genui wiring — a DEAD contract mismatch

The only external consumer is `services/api-gateway/src/services/media-generation/image-generator.ts`. It dynamically imports the package and calls:

- `image-generator.ts:44` → `if (mod && typeof mod.createMediaDispatcher === 'function')`
- `image-generator.ts:45` → `dispatcherSingleton = mod.createMediaDispatcher();`
- `image-generator.ts:64` → `const run = (dispatcher as any).generate ?? (dispatcher as any).run;`

**`createMediaDispatcher` is not exported anywhere in the package** (verified: `grep -rn createMediaDispatcher` matches only these two call-sites). The package exports `composeMedia`, `dispatchToProvider`, `defaultMediaRecipeRegistry` — none named `createMediaDispatcher`, and there is no `.generate`/`.run` method on any exported object. So `getDispatcher()` always returns `null`, and `generateImage()` **always** returns the hard-coded 1×1 PNG (`image-generator.ts:29-32`, `:85-90`). The brain tool `mining.media.generate_image` (`services/api-gateway/src/services/media-generation/brain-tools.ts:27-65`) is wired into the brain at `services/api-gateway/src/index.ts:1287,1321` — but it can only ever emit a 1×1 transparent pixel.

The genui/owner-web surface therefore has **no path** to real image/video generation. (The brain *does* have real server-side SVG `generateChart`/`generateDiagram`/`composeInfographic` in the same dir — those work — but those are deterministic SVG renderers, not generative AI media.)

### 1.4 Safety pipeline — contracts real, scanners dark in practice

`src/recipes/_helpers.ts:278-311` runs NSFW + deepfake + brand-violation scans. But:

- NSFW (`src/safety/nsfw-scanner.ts`): real OpenAI Moderation path exists (`omni-moderation-latest`) **but it requires `input.artifact_url`** (`:65`). `_helpers.ts:283-285` passes `artifact_url: args.artifact.storage_key` — a non-resolvable bucket path string (`borjie-media-<class>/<uuid>.png`), not a fetchable URL. Result: the moderation call is never even attempted with a real image; falls to `{ probability: 0, scanner: 'none' }` (`:107-108`).
- Deepfake (`src/safety/deepfake-detector.ts`): Reality Defender wrapper, env-gated `REALITY_DEFENDER_API_KEY`, same `storage_key`-as-URL problem; degrades to permissive 0.
- NSFWJS local path (`nsfw-scanner.ts:97-105`): explicitly *"nsfwjs enabled but no local binding wired"* — a stub.
- The content-rating gate (`src/safety/content-rating-gate.ts`) and consent gate (`_helpers.ts:243-269`) are real policy logic — good — but they gate on probabilities that are always 0.

### 1.5 C2PA / provenance — NOT valid C2PA

`src/watermark/c2pa-embedder.ts` is honest in its docstring (lines 16-19): it ships a **"manifest-only"** implementation that appends a JSON sidecar to the bytes with header `\nC2PA-MANIFEST-v1.4:` (`:125`, `:139-146`). The "signature" is a bare `sha256(audit_hash|checksum|promptHash|tenant_id|brand|tenant_secret)` (`:106-120`).

Per the [C2PA 2.1 specification](https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html), a valid signed manifest requires: a **claim with ≥1 hard-binding hash assertion**, a **COSE-signed claim signature using X.509 certificates** (RFC 3161 timestamp recommended), **CBOR encoding**, and storage in **JUMBF containers within the asset** — *not* an external/appended JSON sidecar, and *not* a plain SHA-256 string. So Borjie's "C2PA" would fail any standard verifier (c2patool, Content Credentials Verify, Adobe CAI). Visible-watermark (`src/watermark/visible-watermark.ts`) is a *planner* only — it emits sharp/ffmpeg parameter shapes but never invokes sharp or ffmpeg (docstring lines 6-12 say so).

### 1.6 Storage + DB persistence — schema exists, nothing writes to it

- DB migration `packages/database/drizzle/0020_media_generation.sql` defines a **good** schema: `media_recipes` (global, RLS-off), `media_artifacts` (storage_key, audit_hash, approval_state CHECK, RLS-on), `media_safety_scans`, `media_engagement_events`, with FORCE RLS (`:203`). This is real and well-modeled.
- **But** there is no Drizzle TS schema export for media in `packages/database/src/schemas/index.ts` (grep finds only comment mentions), and **no route or service ever inserts a `media_artifacts` row** (`grep -rln 'mediaArtifact|media_artifact|insert.*media' services/api-gateway/src` → empty).
- **No Supabase Storage upload anywhere in the media path** (`grep 'storage.from|.upload(|createSignedUrl|getPublicUrl'` over both the package and the api-gateway media service → empty). The `MediaArtifact.body: Buffer` is returned in-memory and dropped on the floor; `storage_key` is a synthetic path that points to nothing.

### 1.7 BOSSNYUMBA101 `packages/content-studio` — honestly-stubbed, better C2PA *design*

BN's `content-studio` is the property-domain ancestor. It is **explicitly self-declared stub** and is therefore more honest than Borjie's:

- `packages/content-studio/src/providers/image/flux.ts:30-31` → `export const STUB_PROVIDER = true; export const REQUIRED_ENV_VAR = 'BFL_API_KEY';` returns `https://stub.bossnyumba.local/flux/<hash>.png` (`:48`) and emits `warnStubInvocation` (`:45`).
- `packages/content-studio/src/providers/image/nano-banana.ts` — same stub pattern for **Gemini 3 Pro Image / Nano Banana** (a model Borjie's adapter set entirely lacks), with a real `edit()` method modeling **conversational editing** + C2PA **ingredients** (`:56-69`, `:82-92`) — a provenance concept (input→output relationships) that Borjie's flat manifest lacks.
- BN has a **LoRA brand registry** (`packages/content-studio/dist/brand/lora-registry.*`) — brand-fine-tuning concept Borjie does not have.
- BN's C2PA (`packages/content-studio/src/c2pa/attestation.ts`, tested in `c2pa/__tests__/c2pa-pipeline.test.ts`) models ingredients/relationships better, but is still not a real COSE/X.509-signed manifest.

**Takeaway for porting:** BN contributes three *design* ideas worth porting to Borjie — Nano-Banana/Gemini-image + conversational edit, C2PA ingredients/relationships, and the LoRA brand registry — but **zero** working generation code (it is stubs by design).

---

## 2. 2025-2026 SOTA (verified)

### 2.1 Short-video generation (the owner's priority)

| Model | What it does (2026) | Pricing | Source |
|-------|--------------------|---------|--------|
| **OpenAI Sora 2 / sora-2-pro** | 720p–1024p, up to ~20s, best multi-shot narrative + native audio. Async `POST /videos` → poll `GET /videos/{id}` → download `GET /videos/{id}/content`. **Sora 2 API scheduled to sunset 2026-09-24** — plan a migration path. | sora-2: $0.10/s (720p); sora-2-pro: $0.30/s (720p), $0.50/s (1024p). 10s ≈ $1–$5. Tier-2 API access ($10+ top-up). | [OpenAI guide](https://developers.openai.com/api/docs/guides/video-generation); [pricing/sunset](https://costgoat.com/pricing/sora); [policy update](https://help.apiyi.com/en/openai-sora-2-policy-change-plus-pro-only-en.html) |
| **ByteDance Seedance 2.0** | #1 on Artificial Analysis Video Arena (T2V Elo 1269, I2V 1351 as of Mar 2026) ahead of Kling 3.0 / Veo 3 / Runway Gen-4.5. **First model accepting 4 input modalities** (text+image+audio+video, up to 12 reference files). 4–15s, 480p/720p, native audio, director-level camera control. Fast/Standard/Pro tiers. Strong on Asian-language overlays. | ~6¢/s reference (varies by tier). Public beta on BytePlus ModelArk Apr 2026; also on fal. | [Seedance 2.0 launch](https://seed.bytedance.com/en/seedance2_0); [BytePlus ModelArk API ref](https://docs.byteplus.com/en/docs/ModelArk/1520757); [fal listing](https://fal.ai/seedance-2.0) |
| **Google Veo 3.1 (Lite/Fast/Quality)** | 8s, 720p/1080p/4k, native audio, 16:9 or 9:16. Async long-running operation + poll + `files.download`. **SynthID watermark non-optional.** | Lite ~$0.05/s, Fast ~$0.15/s, Quality ~$0.40/s. | [Veo API docs](https://ai.google.dev/gemini-api/docs/video); [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing); [Veo 3.1 Lite](https://blog.google/innovation-and-ai/technology/ai/veo-3-1-lite/) |
| **Kling 3.0 / Runway Gen-4.5 / Luma** | Strong alternates; Runway has reference-image-to-video; Kling strong on motion. Borjie has a Runway adapter (also stubbed). | varies | (Artificial Analysis Video Arena, cited via Seedance source above) — UNVERIFIED individual pricing |

### 2.2 Image generation

| Model | What it does (2026) | Pricing | Source |
|-------|--------------------|---------|--------|
| **Google Nano Banana Pro (Gemini 3 Pro Image)** | GA Jun 2026. SOTA text rendering (~94% accuracy), 4K, reasoning "thinking" mode, multi-subject consistency (up to 5 reference subjects), conversational editing. **SynthID watermark non-optional.** | $0.134/img (1K/2K), $0.24 (4K); Batch/Flex ≈ $0.067/2K. | [OpenRouter model card](https://openrouter.ai/google/gemini-3-pro-image-preview); [Gemini image docs](https://ai.google.dev/gemini-api/docs/image-generation); [pricing](https://www.aifreeapi.com/en/posts/nano-banana-pro-price) |
| **BFL Flux 1.1/1.2 Pro Ultra** | Photoreal, strong text, 4MP, ~1s in Ultra. **Async** request → `polling_url` → `get_result` → temporary URL (download immediately, re-host). | ~$0.06/img reference. | [BFL docs](https://docs.bfl.ml/quick_start/generating_images) |
| **OpenAI gpt-image-1 / GPT-Image** | Strong instruction-following image gen/edit via Images API. | per-image / token-based | [OpenAI image guide](https://developers.openai.com/api/docs/guides/video-generation) (same docs host) — UNVERIFIED exact price |
| **Google Imagen 4** | High-fidelity T2I, Vertex/Gemini `:predict`, returns `bytesBase64Encoded`. | per-image | [Gemini image docs](https://ai.google.dev/gemini-api/docs/image-generation) |
| **Ideogram / Recraft / SD3.5** | Ideogram = best in-image typography; Recraft = vector/brand; SD3.5 = open-weights fallback. | varies | UNVERIFIED individual pricing |

### 2.3 GIF / short-clip

There is no first-class "GIF model" at the frontier — **GIF/short-clip is a post-processing step**, not a generation model: generate a short 4-8s clip (Veo Lite / Seedance Fast / Sora 4s) then transcode MP4→GIF/WebP with ffmpeg (palettegen/paletteuse) or output an animated WebP. SOTA practice = generate short MP4 → ffmpeg clip-and-loop → GIF/WebP, with the same provenance attached. (Borjie's `MediaFormat` union is `image | short_video | lipsync_video` — no GIF/WebP transcode lane.)

### 2.4 Safety / provenance SOTA

- **C2PA 2.1 Content Credentials**: COSE-signed, X.509 cert, hard-binding hash assertion, CBOR, JUMBF-embedded. RFC 3161 timestamp recommended. Soft bindings (watermarks/fingerprints) "shall not be used as a hard binding." — [C2PA 2.1 spec](https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html). Reference implementations: Rust `c2patool` / `c2pa-rs`, `c2pa-node`.
- **SynthID** (Google): invisible per-pixel/per-frame watermark, *non-optional* on all Veo + Nano-Banana output; complements (does not replace) C2PA's hard binding. — [Veo docs](https://ai.google.dev/gemini-api/docs/video).
- **Moderation**: OpenAI `omni-moderation-latest` for image moderation (needs a fetchable image URL or base64). Deepfake: Reality Defender / Hive. NIST AI guidance + EU AI Act Art. 50 require AI-content disclosure → C2PA + visible label is the compliant pattern.

---

## 3. Gap list (file:line evidence)

See structured `gaps[]`. Severity legend: BLOCKER = product cannot generate real media at all; HIGH = SOTA-parity / safety / compliance; MED = quality/coverage; LOW = polish.

---

## 4. Closure plan (buildable, no deferral)

**Lane A — Real async provider core (BLOCKER):**
1. Add an async job lifecycle to the adapter contract: `submit()` → `{ job_id, poll_url? }`, `poll(job_id)` → `{ status, asset_url? }`, `download(asset_url)` → real `Buffer`. Refactor `factory.ts` `createThinAdapter` into `createAsyncJobAdapter` with a bounded poll loop (interval + max-attempts + timeout, exponential backoff) reusing `safeFetch`. Replace every `extractBytes` string-fab with a real download of the returned URL (Flux `get_result`/`result.sample`; Sora `GET /videos/{id}/content`; Veo `files.download`; Seedance task poll). Decode Imagen base64 properly.
2. Add the missing flagship models: **Veo 3.1** (video, SynthID), **Nano Banana Pro / Gemini 3 Pro Image** (image + conversational edit, SynthID) — both ported in design from BN. Keep Sora-2 but add a sunset-migration note (2026-09-24) defaulting video fallback to Seedance 2.0 / Veo 3.1.

**Lane B — Storage + persistence (BLOCKER):**
3. Add a `MediaStorage` port (upload Buffer → `storage_key`, return signed/public URL + thumbnail) backed by Supabase Storage; wire into `runRecipe` after byte download.
4. Add the Drizzle TS schema for `media_artifacts`/`media_recipes`/`media_safety_scans`/`media_engagement_events` (table already exists in `0020_media_generation.sql`) and a repository that inserts the sealed artifact row (storage_key, audit_hash, provenance, approval_state) under RLS.

**Lane C — Brain/genui trigger (BLOCKER):**
5. Fix the dead contract: either export `createMediaDispatcher()`/`.generate()` from the package matching `image-generator.ts:44-64`, OR rewrite `image-generator.ts` to call `composeMedia({ recipe_id, ctx })`. Add a `mining.media.generate_video` brain tool (genui video card) alongside the image tool; surface the approval-tier UX (Tier-2 → owner approval) in owner-web.

**Lane D — Safety + provenance to SOTA (HIGH):**
6. Pass a *fetchable* URL (post-upload signed URL or base64) to NSFW/deepfake scanners so they actually run; gate before publish.
7. Replace the JSON-sidecar "C2PA" with a real COSE/X.509-signed JUMBF manifest via `c2pa-node`/`c2patool` `embedFn` (the injection point already exists at `c2pa-embedder.ts:130`). Record SynthID presence for Veo/Nano-Banana output. Invoke sharp/ffmpeg for the visible wordmark (the planner output is ready).

**Lane E — GIF + coverage (MED):**
8. Add a GIF/WebP transcode lane (ffmpeg palettegen/paletteuse) as a post-step on `short_video`; extend `MediaFormat`/recipes.
9. Generate the remaining recipes (spec ships only 3 of 9 classes) and add a real live-mode integration test behind `BORJIE_LIVE_MODE` that asserts non-zero real bytes + a verifiable C2PA manifest.

---

## 5. Sources (all fetched/searched this session)

- OpenAI Sora video-generation guide — https://developers.openai.com/api/docs/guides/video-generation
- Sora pricing & sunset (2026-09-24) — https://costgoat.com/pricing/sora ; policy update — https://help.apiyi.com/en/openai-sora-2-policy-change-plus-pro-only-en.html
- Seedance 2.0 launch — https://seed.bytedance.com/en/seedance2_0 ; BytePlus ModelArk API ref — https://docs.byteplus.com/en/docs/ModelArk/1520757 ; fal — https://fal.ai/seedance-2.0
- Google Veo 3.1 API docs — https://ai.google.dev/gemini-api/docs/video ; Gemini pricing — https://ai.google.dev/gemini-api/docs/pricing ; Veo 3.1 Lite — https://blog.google/innovation-and-ai/technology/ai/veo-3-1-lite/
- Nano Banana Pro / Gemini 3 Pro Image — https://openrouter.ai/google/gemini-3-pro-image-preview ; pricing — https://www.aifreeapi.com/en/posts/nano-banana-pro-price ; Gemini image docs — https://ai.google.dev/gemini-api/docs/image-generation
- BFL Flux async API — https://docs.bfl.ml/quick_start/generating_images
- C2PA 2.1 specification — https://spec.c2pa.org/specifications/specifications/2.1/specs/C2PA_Specification.html
</content>
</invoke>
