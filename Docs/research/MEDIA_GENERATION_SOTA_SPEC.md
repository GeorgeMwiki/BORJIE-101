# MEDIA-GENERATION SOTA — DESIGN SPEC (lane `media-generation-sota`)

**Date:** 2026-06-08
**Branch:** `integration/parity-final`
**Author:** Claude (Opus 4.8, 1M ctx) — `media-generation-sota` lane subagent
**Lane gap IDs:** `MG-01 … MG-09` (Master Gap Register §C.2), keystone dependency `COG-07 / AUT-14` (modality arbiter)
**Cited dossier:** `Docs/research/media-generation-audit-sota.md` (verdict 1.5 / 5 — world-class scaffolding, last mile unimplemented)
**Companion design:** `Docs/DESIGN/MEDIA_GENERATION_SPEC.md`
**Status:** SPEC ONLY — no code written, no migration applied. Append-only numbering reserved: migration **`0313`**.

> One-line: turn the existing `@borjie/media-generation` scaffolding (real types/registry/dispatcher/brand-lock/budgets/78 tests) into a working output modality the MD can call — real bytes via async provider jobs, Supabase-Storage persistence + signed-URL delivery, valid C2PA 2.1 + SynthID provenance, a brain `generate_video` tool, and the modality-arbiter `media` lane — without touching the money path, weakening RLS, or breaking the EN/SW toggle.

---

## 0. How to read this spec

- **§1** — exact current-state at file:line (what is real vs hollow).
- **§2** — verified 2026 SOTA model/API landscape (cited).
- **§3** — target architecture (new `media-job-runner` package surface + gateway route + modality-arbiter `media` lane).
- **§4** — file-level change list, per gap, with exact paths + functions.
- **§5** — the migration (`0313`), RLS+FORCE, canonical GUC fix for the pre-existing `0020` defect.
- **§6** — hard-rail compliance matrix.
- **§7** — test plan.
- **§8** — rollout / reversibility.
- **§9** — sources.

---

## 1. Current state (file:line grounded)

The package `packages/media-generation/` already implements Layers 1–4 of `Docs/DESIGN/MEDIA_GENERATION_SPEC.md`. Verified by reading the source this session:

| Concern | File | Reality |
|---|---|---|
| Types / contracts | `packages/media-generation/src/types.ts` (364 ln) | **Real.** 9 `MediaClass`, 3 `MediaFormat` (`image\|short_video\|lipsync_video` — **no GIF**, `types.ts:28`), 11 `MediaProviderId` (`types.ts:57-68`), `MediaArtifact.body: Buffer` (`types.ts:239`), `MediaProvenance`, `MediaCompositionError` codes (`types.ts:338-362`). |
| Adapter factory | `packages/media-generation/src/providers/factory.ts` | **Hollow.** `createThinAdapter` does ONE `safeFetch` POST (`factory.ts:164`), zod-parses, then `extractBytes` (`factory.ts:191`) **fabricates a UTF-8 string** — no poll, no download. The factory comment admits it (`factory.ts:88-92`: *"we synthesise stable seed bytes (the production caller downloads via the URL)"*) but **no such caller exists**. |
| Dispatcher | `packages/media-generation/src/providers/dispatcher.ts` | **Real logic.** `dispatchToProvider` never-throws fallback loop (`dispatcher.ts:52-85`); `FALLBACK_BY_CAPABILITY` (`:91-125`); cost-aware `reorderForCost` (`:177-209`). Video ladder is `runway→sora→seedance` (`:107-116`) — **stale ordering** (no Veo). |
| Recipe pipeline | `packages/media-generation/src/recipes/_helpers.ts` | **Real but byte-blind.** `runRecipe` (`:68-209`) dispatches, runs safety (`runSafetyPipeline` `:278-311`), embeds C2PA (`:149-162`), plans visible watermark (`:170-172`), re-seals audit hash (`:175-188`). It **never uploads to storage and never persists a DB row.** `artifact.body` is returned in-memory and dropped. |
| Safety scanners | `src/safety/nsfw-scanner.ts`, `deepfake-detector.ts` | **Dark.** NSFW only runs when `apiKey && input.artifact_url` (`nsfw-scanner.ts:65`); `_helpers.ts:284` passes `args.artifact.storage_key` (a synthetic bucket path, not fetchable) → falls to `{ probability: 0, scanner: 'none' }` (`nsfw-scanner.ts:108`). Deepfake same `storage_key`-as-URL bug (`_helpers.ts:284`). |
| C2PA | `src/watermark/c2pa-embedder.ts` | **Not real C2PA.** `embedC2paManifest` (`:139-146`) appends a JSON sidecar after header `\nC2PA-MANIFEST-v1.4:` (`:125`); "signature" is a bare `sha256(...)` (`:106-120`). Fails any COSE/X.509/JUMBF verifier. The injection point `embedFn` already exists (`:130`). |
| Visible watermark | `src/watermark/visible-watermark.ts` | **Planner only** (`:6-12`) — emits `sharp_composite` (`:28`) / `ffmpeg_filter` (`:34`) shapes; never invokes sharp/ffmpeg. |
| Storage | — | **Absent in the media path.** But `@borjie/storage-adapter` already ships a production `StorageAdapter` port with `upload()` + `getUrl()` signed URLs (`packages/storage-adapter/src/supabase.ts:41-94`), `STANDARD_BUCKETS` incl. `media-photos`/`media-videos` (`packages/storage-adapter/src/types.ts:18-26`), and `tenantScopedPath()` matching the canonical RLS path `(storage.foldername(name))[1] = current_setting('app.current_tenant_id')` (`types.ts:30-33`). **The media package must consume this, not reinvent it.** |
| DB persistence | `packages/database/drizzle/0020_media_generation.sql` | **Schema exists but is buggy + unwired.** Good tables (`media_recipes` global RLS-off, `media_artifacts`/`media_safety_scans`/`media_engagement_events` tenant-scoped). **TWO defects:** (a) RLS uses **`ENABLE`, not `FORCE`** (`0020...sql:76`), and (b) the policy binds the **non-canonical** GUC `app.tenant_id` (`0020...sql:80`) instead of the canonical `app.current_tenant_id` used everywhere else (`migrations/0309_...sql:96`, `storage-adapter/types.ts:32`). No Drizzle TS schema export in `packages/database/src/schemas/index.ts`. No row is ever inserted. |
| Brain wiring | `services/api-gateway/src/services/media-generation/image-generator.ts` | **DEAD contract.** `getDispatcher()` (`:36-51`) imports the package and calls `mod.createMediaDispatcher` (`:44`) + `.generate`/`.run` (`:64`) — **none exported** (package exports `composeMedia`, `index.ts:65`). So `generateImage()` **always** returns the hard-coded 1×1 PNG (`:29-32`, `:85-90`). Tool `mining.media.generate_image` is wired (`brain-tools.ts:27-65`, registered `api-gateway/src/index.ts:1287`) but can only ever emit a transparent pixel. **No `generate_video` tool exists.** |
| Modality arbiter | — | **MISSING (keystone COG-07).** `Decision` ADT has 6 variants (`orchestrator/decision.ts:137-158`: `respond_to_owner`/`tool_call`/`spawn_sub_md`/`schedule_wake`/`monitor`/`final`) — **no `media`/`run_modality` lane.** `main-loop.ts` drives `router.call` at `:716` then dispatches. Media is reachable today only as a generic `tool_call`. |

**Net:** with every API key set, Borjie produces **zero real frames**: the create call 200-OKs, a string is fabricated, an audit hash is sealed over garbage, and it "succeeds." This spec closes that.

---

## 2. Verified 2026 SOTA (cited this session)

### 2.1 Short video (owner priority)
- **OpenAI Sora 2 / sora-2-pro** — async `POST /videos` → poll `GET /videos/{id}` (60 req/min/key, exp-backoff after 3) → download MP4 `GET /videos/{id}/content`; jobs expire after **24 h**. Pricing $0.10/s (720p std) … $0.70/s (1080p pro); Batch tier halves rates with 24 h SLA. **API sunsets 2026-09-24 — migration mandatory.** ([OpenAI video guide](https://developers.openai.com/api/docs/guides/video-generation); [pricing/sunset](https://costgoat.com/pricing/sora); [tiers](https://www.aifreeapi.com/en/posts/sora-2-api-pricing-quotas))
- **Google Veo 3.1 (Lite/Fast/Quality)** — Gemini API long-running **operation**; poll `operation.done` every ~10 s; `client.files.download(...)`; videos auto-deleted after **2 days** → download-and-persist immediately. **SynthID watermark non-optional.** Lite $0.05/s (720p), Fast $0.15/s, Quality $0.40/s, 4K upscale $0.50/clip. ([Veo API docs](https://ai.google.dev/gemini-api/docs/video); [Lite launch](https://www.marktechpost.com/2026/03/31/google-ai-releases-veo-3-1-lite-giving-developers-low-cost-high-speed-video-generation-via-the-gemini-api/); [pricing](https://costgoat.com/pricing/google-veo))
- **ByteDance Seedance 2.0** — public beta on BytePlus ModelArk since **2026-04-14**; text/image/reference-to-video; Fast/Standard/Pro; async task submit→poll. QPS=2/account, max 3 concurrent tasks; ~$0.092/s (480p Fast) … $0.198/s (720p Std). #1 Video Arena Elo. ([ModelArk API ref](https://docs.byteplus.com/en/docs/ModelArk/1520757); [beta guide](https://help.apiyi.com/en/seedance-2-api-public-beta-guide-2026-en.html); [Seedance 2.0](https://seed.bytedance.com/en/seedance2_0))

### 2.2 Image
- **Nano Banana Pro / Gemini 3 Pro Image** — GA **Jun 2026**; best-in-class text rendering (readable in-image typography), conversational editing, localized edits, 2K/4K. **SynthID non-optional.** $0.134/img (1K–2K), $0.24 (4K), Batch $0.067/2K. ([Google blog](https://blog.google/technology/ai/nano-banana-pro/); [OpenRouter card](https://openrouter.ai/google/gemini-3-pro-image-preview); [pricing](https://pricepertoken.com/pricing-page/model/google-gemini-3-pro-image-preview))
- **BFL Flux 1.1/1.2 Pro Ultra** — async: `POST` → `polling_url` → `GET /v1/get_result?id=` until `Ready` → `result.sample` **temporary URL, download immediately + re-host**. ~$0.06/img. ([BFL docs](https://docs.bfl.ml/quick_start/generating_images))
- **Google Imagen 4** — Vertex/Gemini `:predict` returns `bytesBase64Encoded` (decode → bytes). ([Gemini image docs](https://ai.google.dev/gemini-api/docs/image-generation))

### 2.3 GIF / animation
No frontier "GIF model" — GIF/WebP is a **post-process**: generate a short MP4 (Veo Lite / Seedance Fast / Sora 4 s) → ffmpeg `palettegen`/`paletteuse` → GIF or animated WebP, carrying the same provenance.

### 2.4 Provenance / safety
- **C2PA 2.1/2.4** — claim of assertions, **COSE-signed** with **X.509** cert (RFC 5280), **CBOR** (RFC 8949) assertions, embedded in **JUMBF** (ISO 19566-5) container in-asset; RFC 3161 timestamp recommended; soft bindings (watermarks) "shall not be used as a hard binding." Reference impls: Rust `c2pa-rs`/`c2patool`, `c2pa-node`. ([C2PA 2.4 spec](https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html); [c2pa-rs usage](https://github.com/contentauth/c2pa-rs/blob/main/docs/usage.md); [CAI tools](https://opensource.contentauthenticity.org/docs/c2patool/docs/manifest/))
- **SynthID** (Google) — invisible per-pixel/per-frame watermark, non-optional on all Veo + Nano-Banana output; **complements** (does not replace) C2PA hard binding. ([Veo docs](https://ai.google.dev/gemini-api/docs/video))
- **Moderation** — OpenAI `omni-moderation-latest` needs a **fetchable image URL or base64**; deepfake via Reality Defender/Hive. EU AI Act Art. 50 + NIST → C2PA + visible label is the compliant disclosure pattern.

---

## 3. Target architecture

Two principles: **(1)** keep the proven scaffolding; replace only the hollow last mile. **(2)** put all I/O (network polling, ffmpeg, sharp, c2pa-node, Supabase upload) in a NEW, gateway-side package so `@borjie/media-generation` stays pure/dependency-light and CI-fast.

### 3.1 New package — `packages/media-job-runner`

Holds everything that is I/O-heavy or has native deps (so the pure package's 78 tests stay hermetic). Many small files (<400 ln each) per coding-style.

```
packages/media-job-runner/
  package.json            # deps: @borjie/media-generation, @borjie/storage-adapter,
                          #       @borjie/database, c2pa-node, sharp, fluent-ffmpeg, undici, zod, pino
  src/index.ts            # public surface (createMediaJobRunner)
  src/job/async-job.ts    # AsyncJob port: submit()->{job_id,poll_url?}; poll()->{status,asset_url?|b64?}; download()->Buffer
  src/job/poll-loop.ts    # bounded backoff loop (interval, max-attempts, hard-timeout); pure-ish, fetch injected
  src/providers/sora2.ts      # POST /videos -> poll GET /videos/{id} -> GET /videos/{id}/content
  src/providers/veo31.ts      # Gemini operation poll -> files.download (records SynthID present)
  src/providers/seedance2.ts  # ModelArk task submit -> poll -> fetch
  src/providers/flux.ts       # POST -> polling_url -> get_result -> download result.sample (re-host immediately)
  src/providers/nano-banana.ts# Gemini 3 Pro Image (image + conversational edit; records SynthID)
  src/providers/imagen4.ts    # :predict -> decode bytesBase64Encoded
  src/storage/media-storage.ts# MediaStorage port over @borjie/storage-adapter (upload+thumb+signed URL)
  src/persistence/media-repo.ts# Drizzle repo: insert media_artifacts/media_safety_scans under RLS
  src/provenance/c2pa-cose.ts # real COSE/X.509/JUMBF embed via c2pa-node -> embedFn for c2pa-embedder
  src/provenance/synthid.ts   # record SynthID presence flag for Veo/Nano-Banana outputs
  src/watermark/render.ts     # execute the VisibleWatermarkPlan (sharp composite / ffmpeg drawtext)
  src/transcode/gif.ts        # ffmpeg palettegen/paletteuse: MP4 -> GIF/animated WebP
  src/safety/scan-after-upload.ts # pass POST-UPLOAD signed URL to NSFW/deepfake; gate before publish
  src/runner.ts           # orchestrates: compose(pure)->upload->scan->c2pa->watermark->transcode->persist->signed URL
  src/__tests__/...       # unit (mocked fetch/ffmpeg) + a BORJIE_LIVE_MODE integration test
```

**Why a second package, not edits inside `media-generation`:** `media-generation` is imported pure by the brain/composer paths and has a hermetic 78-test suite; adding `sharp`/`c2pa-node`/`ffmpeg` native deps there would slow CI and risk install fragility (the C2PA docstring at `c2pa-embedder.ts:13-18` chose dependency-freedom deliberately). The runner is the "production caller" the factory comment (`factory.ts:88-92`) always assumed but never had.

### 3.2 Contract change inside `media-generation` (minimal, pure)

Extend the adapter contract to expose the async lifecycle WITHOUT pulling I/O deps in. Add to `MediaProviderAdapter` (`types.ts:304-313`) an optional:

```ts
readonly job?: {                                  // present on async providers
  submit(input: MediaProviderInput, ctx: ProviderContext): Promise<{ job_id: string; poll_url?: string }>;
  poll(job_id: string, ctx: ProviderContext): Promise<{ status: 'pending'|'ready'|'failed'; asset_url?: string; b64?: string }>;
};
```

The pure package keeps `invoke()` for sync providers (Imagen base64) and tests; the runner uses `job` when present and supplies the real `download()` over `undici`. `extractBytes` (`factory.ts:88-97`) is downgraded to base64-decode-only (Imagen) and otherwise removed — strings are never fabricated again.

### 3.3 Gateway route — `services/api-gateway/src/routes/media/generate.hono.ts` (NEW)

```
POST   /api/media/generate          # body: { class, prompt, inputs[], aspect_ratio, duration_sec?, target_audience }
                                     #  -> 202 { job_id }  (async; returns immediately)
GET    /api/media/jobs/:job_id       # poll -> { status, artifact?: { id, signed_url, thumb_url, approval_state } }
POST   /api/media/:artifact_id/approve  # Tier-2 owner approval -> flips approval_state -> auto re-signs URL
GET    /api/media/:artifact_id        # signed-URL fetch (RLS-scoped)
```
- Zod-validated body (coding-style: validate user input). Supabase-JWT auth via existing gateway middleware; `app.current_tenant_id` GUC already bound by middleware → repo writes are RLS-scoped automatically.
- Hono route file `*.hono.ts` (convention; `*.router.ts` deprecated).
- Origin allowlist CORS (no reflective CORS); no raw HTML; signed URLs only (never public bucket URLs for Tier-1/2 pending content).

### 3.4 Modality-arbiter `media` lane (closes the keystone hook for this lane only)

This lane does **not** build the whole arbiter (that is `COG-07`'s job). It defines and reserves the **`media` Decision lane + dispatcher actuation** so that when the arbiter ships, media is a first-class output modality, and meanwhile the brain tool path works.

- Add a 7th `Decision` variant in `packages/central-intelligence/src/kernel/orchestrator/decision.ts` after `:158`:
  ```ts
  | { readonly kind: 'generate_media'; readonly media_class: string; readonly prompt: string;
      readonly inputs: ReadonlyArray<{ key: string; value: unknown }>; readonly target_audience: string }
  ```
- Add a matching `DispatchResult` ack `{ kind: 'media_queued'; job_id: string }`.
- In `main-loop.ts`, the dispatcher port (`Dispatcher.dispatch`, `:223`) gets a `generate_media` arm that calls the gateway media runner (via the injected port, not a direct import — keeps central-intelligence app-agnostic).
- The **arbiter hook**: a single pure function `decideMediaModality(intent): boolean` lives in a new `orchestrator/modality-arbiter-media.ts` that the future `modality-arbiter.ts` (COG-07) composes. Until COG-07 lands, the brain still reaches media through the `mining.media.generate_image` + new `mining.media.generate_video` `tool_call` path — so this lane delivers value standalone and slots cleanly into the keystone later.

---

## 4. File-level change list (per gap)

### MG-01 — real async provider core (BLOCKER)
- **NEW** `packages/media-job-runner/src/job/async-job.ts`, `job/poll-loop.ts` — bounded backoff loop (interval default 5 s, max 60 attempts, hard-timeout per class from `MEDIA_CLASS_LATENCY_MS`, exp-backoff after 3 attempts per Sora rate guidance).
- **NEW** `providers/{sora2,veo31,seedance2,flux,nano-banana,imagen4}.ts` — each implements `submit/poll/download` against the verified endpoints in §2.
- **EDIT** `packages/media-generation/src/types.ts:304-313` — add optional `job` to `MediaProviderAdapter`.
- **EDIT** `packages/media-generation/src/providers/factory.ts:88-97,191` — remove string-fabrication; `extractBytes` becomes base64-decode-only (Imagen) or omitted.

### MG-02 — storage + persistence (BLOCKER)
- **NEW** `packages/media-job-runner/src/storage/media-storage.ts` — `MediaStorage` port over `@borjie/storage-adapter` `createSupabaseStorageAdapter` (`storage-adapter/src/supabase.ts:41`): `upload(buffer, tenantScopedPath, contentType)` to bucket `media-videos`/`media-photos` (`storage-adapter/types.ts:18-26`), generate thumb (sharp/ffmpeg first frame), return `getUrl()` signed URL (`supabase.ts:75-94`).
- **NEW** `packages/database/src/schemas/media.schema.ts` — Drizzle TS schema for `media_recipes`/`media_artifacts`/`media_safety_scans`/`media_engagement_events`.
- **EDIT** `packages/database/src/schemas/index.ts` — export the new schema (currently only comment mentions, `:961`).
- **NEW** `packages/media-job-runner/src/persistence/media-repo.ts` — inserts the sealed `media_artifacts` row (storage_key, audit_hash, provenance JSONB, approval_state, span_citations) under RLS; one `media_safety_scans` row per scanner.

### MG-03 — brain/genui trigger (BLOCKER)
- **EDIT** `services/api-gateway/src/services/media-generation/image-generator.ts:36-90` — replace the dead `createMediaDispatcher` path: call the media-job-runner (`POST /api/media/generate` internal port) and **return the signed URL**, not a 1×1 PNG. Keep the 1×1 fallback ONLY for the no-key/brownout branch (and log via Pino, not console).
- **EDIT** `services/api-gateway/src/services/media-generation/brain-tools.ts:26-172` — add `mining.media.generate_video` ToolHandler (class, prompt, duration_sec, aspect_ratio); surface `approval_state` + `signed_url` in the result; evidence summary cites recipe + provider.
- **NEW** `services/api-gateway/src/routes/media/generate.hono.ts` — the route in §3.3; register in the gateway route table next to other `*.hono.ts` routes.
- **EDIT** owner-web — add the Tier-2 approval card UX (a genui video/image card showing `pending → approve/reject`). (File-level: `apps/owner-web` chat genui card registry — surface only, no money path.)

### MG-04 — flagship models + Sora sunset migration (HIGH)
- Add **Veo 3.1** + **Nano Banana Pro** providers (§4 MG-01 list). Record SynthID presence (`provenance/synthid.ts`).
- **EDIT** `packages/media-generation/src/providers/dispatcher.ts:107-116` — new video ladder `seedance → veo → sora` (Seedance #1 Arena + cheapest tier; Veo next; **Sora last, behind a sunset guard** that drops Sora after `2026-09-24` via a date check). Add `veo`/`nano_banana` to `MediaProviderId` (`types.ts:57-68`) and `FALLBACK_BY_CAPABILITY`.

### MG-05 — safety scanners run (HIGH)
- **NEW** `packages/media-job-runner/src/safety/scan-after-upload.ts` — after upload, fetch the **signed URL** (or base64 for images) and pass it to `scanForNsfw` (which gates on `input.artifact_url`, `nsfw-scanner.ts:65`) and `detectDeepfake`. Gate via `applyContentRatingGate` (`_helpers.ts:128`) BEFORE the artifact is marked publishable.
- **EDIT** `packages/media-generation/src/recipes/_helpers.ts:283-286` — the in-package safety call keeps the bytes path for unit tests; the runner re-runs scans with a fetchable URL post-upload (authoritative gate). Document that `storage_key` is NOT a URL.

### MG-06 — valid C2PA 2.1 + SynthID (HIGH)
- **NEW** `packages/media-job-runner/src/provenance/c2pa-cose.ts` — real COSE/X.509/JUMBF manifest via `c2pa-node` (or `c2patool` child-process), wired as the `embedFn` parameter that already exists at `c2pa-embedder.ts:130`/`140`. Map the existing assertion shape (`c2pa-embedder.ts:69-105`) to CBOR assertions; sign with a tenant/brand cert from secret store (env at bootstrap only). Record SynthID presence as a C2PA assertion for Veo/Nano output.
- **NEW** `packages/media-job-runner/src/watermark/render.ts` — execute the `VisibleWatermarkPlan` (`visible-watermark.ts:22-46`): sharp `composite` for images, ffmpeg `drawtext`/overlay for video. Tier-2 always composited.

### MG-07 — GIF/WebP lane (MED)
- **EDIT** `packages/media-generation/src/types.ts:28` — extend `MediaFormat` to `'image'|'short_video'|'lipsync_video'|'gif'`.
- **EDIT** `packages/database/drizzle` constraint — handled by migration `0313` (adds `gif` to `format` CHECK on `media_recipes`/`media_artifacts`; **append-only**, never edit `0020`).
- **NEW** `packages/media-job-runner/src/transcode/gif.ts` — ffmpeg `palettegen`/`paletteuse` post-step on `short_video` → GIF or animated WebP; provenance + C2PA carried forward.

### MG-08 — remaining recipes (MED)
- **NEW** `packages/media-generation/src/recipes/{marketing-still,site-visualisation,investor-brand-video,social-post-short-video,tutorial-lipsync-video,avatar-talking-head}.ts` — author the 6 missing of 9 classes (only 3 seeded today: `briefing-thumbnail`, `marketplace-listing-hero`, `social-post-still`).
- **EDIT** `packages/media-generation/src/registry.ts` + `index.ts:316-327` — register + export the new recipes.

### MG-09 — live-mode integration test (LOW)
- **NEW** `packages/media-job-runner/src/__tests__/live-mode.integration.test.ts` — behind `BORJIE_LIVE_MODE=strict` (guard exists: `media-generation/src/providers/live-mode-guard.ts`): generate a real image, assert non-zero bytes, assert a **verifiable** C2PA manifest (c2patool `--info` exit 0), assert a `media_artifacts` row exists, assert NSFW scan ran (scanner !== 'none').

---

## 5. Migration `0313` + RLS fix (append-only)

**File:** `packages/database/src/migrations/0313_media_generation_fixups.sql` (highest forward delta today is `0312`; this is the next number — **immutable, never edit `0020`**).

Contents (idempotent `IF NOT EXISTS` / `DO` blocks):

1. **Fix the pre-existing `0020` RLS defect** — `0020_media_generation.sql:76,80` uses `ENABLE` (not `FORCE`) and binds non-canonical `app.tenant_id`. Migration `0313`:
   - `ALTER TABLE media_artifacts FORCE ROW LEVEL SECURITY;` (also `media_safety_scans`, `media_engagement_events`).
   - `DROP POLICY IF EXISTS tenant_isolation ON media_artifacts;` then recreate binding the **canonical** GUC:
     ```sql
     CREATE POLICY media_artifacts_tenant_isolation ON media_artifacts
       USING (tenant_id = current_setting('app.current_tenant_id', true))
       WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true));
     CREATE POLICY media_artifacts_service_role_bypass ON media_artifacts
       USING (current_setting('app.is_service_role', true) = 'true')
       WITH CHECK (current_setting('app.is_service_role', true) = 'true');
     ```
     (Pattern copied verbatim from `migrations/0309_cognitive_memory_audit_chain.sql:82-113`.)
2. **GIF format** — `ALTER TABLE ... DROP CONSTRAINT media_recipes_format_chk` then re-add with `IN ('image','short_video','lipsync_video','gif')`; same for `media_artifacts_format_chk`.
3. **SynthID + provenance columns** — `ALTER TABLE media_artifacts ADD COLUMN IF NOT EXISTS synthid_present boolean NOT NULL DEFAULT false`, `ADD COLUMN IF NOT EXISTS c2pa_manifest_present boolean NOT NULL DEFAULT false`, `ADD COLUMN IF NOT EXISTS signed_url_expires_at timestamptz`.
4. **Down migration** — `packages/database/src/migrations/down/0313_*.down.sql` reverses columns + restores prior policy (note: the prior policy was the buggy one; the down script documents that 0313's RLS hardening is intentionally one-way-safe — re-applying 0020's weaker policy is the only reversal and is gated behind a comment warning).

**Money-path note:** none. Media generation never touches `LedgerService.post()`. Cost *accounting* uses the existing in-package `cost-tracker` (reserve/commit/release) — it is a budget guard, not a ledger posting. If/when media spend must hit the books, it goes through `LedgerService.post()` in a separate lane, not here.

---

## 6. Hard-rail compliance matrix

| Rail | Compliance |
|---|---|
| Money via `LedgerService.post()` | **N/A** — no ledger writes; cost-tracker is a pre-spend budget guard only. |
| RLS FORCE + canonical `app.current_tenant_id` | **Strengthened.** `0313` upgrades `0020` from `ENABLE`+`app.tenant_id` to `FORCE`+`app.current_tenant_id` (the pre-existing bug). New repo writes inherit the GUC bound by gateway middleware. |
| Supabase-JWT auth | Route uses existing gateway auth middleware; no Clerk. |
| Append-only migrations | New `0313` only; `0020` untouched. |
| AI audit chain append-only | `buildMediaAuditLink` (`audit/audit-chain-link.ts`) re-seals over real bytes+real safety scan; never mutated. |
| Predictions APPEND | N/A. |
| No `console.log` in services | Runner + route use Pino logger (the package's `MediaLogger`/`NOOP_LOGGER`, `types.ts:280-290`); replace any `console` in `image-generator.ts`. |
| No reflective CORS / raw HTML | Origin allowlist; signed URLs; no HTML interpolation. |
| `process.env` only at bootstrap | API keys + C2PA cert read once at gateway bootstrap and injected into the runner; providers receive keys via ctx, not `readEnvKey` at call time in services. (The package's `readEnvKey` stays for standalone tests.) |
| Multi-currency `formatCurrency` | Any cost shown to owner (approval card) uses `formatCurrency(cents, tenantCurrency)`; never hard-code USD. |
| EN/SW absolute toggle | All prompts, approval-card copy, toasts, and the brand prompt-prefix honor `ctx.language` (`MediaComposeContext.language`, `types.ts:177`); recipe subject copy has full EN+SW; zero mixing. |
| Evidence-required AI output | `span_citations` already threaded through `runRecipe` (`_helpers.ts:186`) → persisted to `media_artifacts.span_citations`; auditor rejects empty chains for tier-2 published media. |
| Kill-switch fail-closed | Media generation respects the kill-switch gate at the brain-tool boundary; never catch+ignore. |

---

## 7. Test plan

- **Unit (pure, hermetic — stays in `media-generation`):** existing 78 tests keep passing; add tests for the new `job` contract shape and the `seedance→veo→sora` ladder + sunset guard (date-mocked).
- **Unit (runner, mocked I/O):** mock `fetch`/`undici` for each provider's submit/poll/download; mock ffmpeg/sharp/c2pa-node; assert poll-loop backoff + hard-timeout; assert GIF transcode invoked for `gif` format; assert upload→signed-URL→scan ordering.
- **Integration:** `media-repo` against a fresh Postgres (RLS on) — assert a write under tenant A is invisible to tenant B (RLS proof), assert `FORCE` blocks the table owner too.
- **Migration:** `0313` applies clean on fresh PG17 in lex order (CI `migration-apply-check.yml`); assert the policy now binds `app.current_tenant_id` and `relforcerowsecurity = true`.
- **Live (gated `BORJIE_LIVE_MODE=strict`):** MG-09 test — real bytes, verifiable C2PA, real DB row, scanner ran.
- **Coverage:** ≥80% on the new runner package per testing rules.

---

## 8. Rollout / reversibility

- **Flag-gated:** real generation behind `MEDIA_GENERATION_LIVE` (default off). Off → keeps current 1×1-PNG behavior, zero provider spend, zero blast radius. On → routes through the runner.
- **Cost guard:** per-class budgets (`MEDIA_CLASS_BUDGET_CENTS`) + cost-aware ladder already enforce a hard ceiling; the runner reserves BEFORE submit and releases on poll-timeout/fail. A global per-tenant daily media-spend cap is added in the route.
- **Provider failover:** dispatcher fallback ladder means one provider outage degrades gracefully; Sora sunset (2026-09-24) is handled by the date-guard dropping Sora from the ladder automatically.
- **Reversibility:** code change is additive (new package + new route + 7th Decision lane reserved but inert until COG-07). Disabling the flag fully reverts behavior. Migration `0313` is forward-only but its only schema-destructive act is policy hardening (safe to keep); `down/0313` documents the (discouraged) reversal.
- **Sequencing:** MG-01→02→03 (BLOCKERs) ship first as one vertical slice (image-only, Flux+Nano) to prove real-bytes→storage→signed-URL→brain card end-to-end; then MG-04/05/06 (video + safety + C2PA); then MG-07/08/09.

---

## 9. Sources (fetched/searched 2026-06-08)

- OpenAI Sora video guide — https://developers.openai.com/api/docs/guides/video-generation ; pricing/sunset — https://costgoat.com/pricing/sora ; tiers — https://www.aifreeapi.com/en/posts/sora-2-api-pricing-quotas
- Google Veo 3.1 API — https://ai.google.dev/gemini-api/docs/video ; Lite launch — https://www.marktechpost.com/2026/03/31/google-ai-releases-veo-3-1-lite-giving-developers-low-cost-high-speed-video-generation-via-the-gemini-api/ ; pricing — https://costgoat.com/pricing/google-veo
- ByteDance Seedance 2.0 ModelArk API — https://docs.byteplus.com/en/docs/ModelArk/1520757 ; beta guide — https://help.apiyi.com/en/seedance-2-api-public-beta-guide-2026-en.html ; launch — https://seed.bytedance.com/en/seedance2_0
- Nano Banana Pro / Gemini 3 Pro Image — https://blog.google/technology/ai/nano-banana-pro/ ; OpenRouter — https://openrouter.ai/google/gemini-3-pro-image-preview ; pricing — https://pricepertoken.com/pricing-page/model/google-gemini-3-pro-image-preview
- BFL Flux async API — https://docs.bfl.ml/quick_start/generating_images
- Gemini image (Imagen) docs — https://ai.google.dev/gemini-api/docs/image-generation
- C2PA 2.4 spec — https://spec.c2pa.org/specifications/specifications/2.4/specs/C2PA_Specification.html ; c2pa-rs usage — https://github.com/contentauth/c2pa-rs/blob/main/docs/usage.md ; CAI c2patool — https://opensource.contentauthenticity.org/docs/c2patool/docs/manifest/
