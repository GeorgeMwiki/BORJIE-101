# FOUNDER LOCKED DECISIONS — 2026-05-27 Addendum: 3D + Avatar Capabilities TABLED

Supplements `FOUNDER_LOCKED_DECISIONS_2026_05_26.md` and `_addendum_universal.md`. Locks a scope decision: **3D generation and advanced avatar generation are TABLED** (intentionally deferred) until further notice.

---

## §1 — What is TABLED (deferred, not deleted)

These capabilities exist as scaffolded adapters in the codebase but are **NOT wired into production paths** and **NOT exposed to users**. Their env keys are commented out. Their dispatch routes return `CapabilityTabledError`.

### 1.1 — 3D model generation
- **`packages/content-studio/src/providers/image/meshy.ts`** — Meshy 3D adapter (text-to-3D-mesh, image-to-3D-mesh)
- **Env keys**: `MESHY_API_KEY`, `NEXT_PUBLIC_MESHY_API_KEY` — commented in `.env` with TABLED marker
- **Status**: Adapter code preserved; not registered in active media dispatcher; no UI surface; no migration table

### 1.2 — Avatar talking-head generation
- **`packages/media-generation/src/providers/hedra-adapter.ts`** — Hedra (audio + image → talking video)
- **`packages/media-generation/src/providers/heygen-adapter.ts`** — HeyGen (script + avatar → video)
- **Env keys**: `HEDRA_API_KEY`, `HEYGEN_API_KEY` — commented in `.env` with TABLED marker
- **Migration 0020 enum value `'avatar_talking_head'`** — preserved in schema (enum values are sticky in Postgres), but NEVER inserted by any code path. Wave 18N media-generation dispatcher will throw `CapabilityTabledError` if anyone tries to enqueue that kind.

---

## §2 — What is KEPT (NOT tabled)

### 2.1 — User profile photo URLs
- **`users.avatar_url`** (column in `0000_borjie_bootstrap.sql`) — user uploads a static photo to MinIO/S3, URL stored here
- **`tenants.avatar_url`** (column in `0003_mining_domain.sql` via `tenant.schema.ts`) — tenant brand logo URL
- **Status**: KEEP. This is plain profile-image URL storage, not generated avatar logic. Wired in admin-web + owner-web settings flows.

### 2.2 — Geographic 3D / Aerial View
- **`packages/geo-platform/src/google/aerial-view-client.ts`** — Google Aerial View API (3D fly-through of a mine site geo)
- **Status**: KEEP. This is map terrain visualisation, not generated 3D content. Useful for site assessment.

### 2.3 — Mr. Mwikila persona avatar / branding
- **NOT generated** — Mr. Mwikila is a **persona name**, not a visual avatar. UI uses a wordmark + Borjie brand color (OKLCH) + initials, NOT a generated face or 3D model.
- **Status**: KEEP the persona-as-text-only stance. Aligns with FOUNDER_LOCKED_DECISIONS §1 decision "Mr. Mwikila is the canonical user-facing identity" — text/wordmark, not face.

---

## §3 — When to revisit

Trigger conditions that would un-table these:
- **3D**: tenant explicitly asks for 3D mine-site walkthroughs, geological model viewers, or equipment 3D inspection workflows
- **Talking-head avatar**: founder revisits the "should Mr. Mwikila have a face?" question — currently locked to NO (per persona-as-text decision)

When revisited:
1. Uncomment env keys + verify provider account active
2. Register adapters in `media-generation` dispatcher
3. Add UI surface (settings → branding → avatar generator)
4. Wire into capability-catalogue with proper measurement axes
5. Update this doc with the new lock decision

---

## §4 — Provenance

- Founder directive 2026-05-27: *"3D DEFINETELY TABLED ... ANY AVATAR LOGIC TABLES"* — interpreted as: 3D and advanced avatar generation capabilities are deferred; basic profile-photo `avatar_url` storage stays.
- This doc is the immutable record; un-tabling requires a new dated lock-doc.
