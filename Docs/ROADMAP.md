# Borjie Roadmap — 0 open R-items

**Last updated:** 2026-05-29 (evening sweep)
**Closure pass:** see `Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md` for the
default-CLOSE-NOW triage that retired 30+ stale "wave-scale" entries
PLUS the closing sweep that ship all 8 remaining `R-FUTURE-*` /
`R19` / `R22` / `R37` items.

This roadmap is intentionally EMPTY. Every previously-deferred
engineering item has been shipped today (commits + SHAs in the
"Shipped trailer" section below). The only forward-looking work
that remains is operator-action items in
`Docs/OPS/OPERATOR_ACTION_LIST.md` (purchases, signed contracts,
external credentials) — those are NOT engineering deferrals; they
are physical-world dependencies.

If a future item needs to land here, follow the rules in
`Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md` §"Default rule reaffirmed":
the bar for entry is operator-action / regulator-cooperation /
genuine 2027+ research target. Stubs + missing routes + un-mounted
components are CLOSE-NOW.

---

## Shipped trailer — 2026-05-29 evening sweep

All eight items shipped tonight live behind real code + tests +
commits + pushes. See git log + the closing audit doc for SHAs.

| Item | Title | Commit + locus |
|------|-------|----------------|
| R-FUTURE-1 | On-device MiniLM router pipeline | `b1a3d7a3` · `packages/on-device-router/` (router + model-loader + fallback-server + 14 tests; ONNX bundle = OA-016) |
| R-FUTURE-2 | Textarea ghost-overlay (Smart-Compose v2) | `6e3155d1` · `apps/owner-web/src/components/smart-compose/GhostCompletionTextarea.tsx` + 6 tests |
| R-FUTURE-3 | PnlTable BFF wire | `9c555229` · `services/api-gateway/src/routes/bff/pnl-table.hono.ts` + `apps/owner-web/src/lib/queries/pnl.ts` + `PnlTableLive.tsx` (12 tests) |
| R-FUTURE-4 | EntityTimeline drawer + 4 composers | `fd629328` · `apps/owner-web/src/components/EntityTimeline/` (composers + drawer + 5 tests) |
| R-FUTURE-5 | Marketing hero re-skin | `b87ab40e` · `apps/marketing/src/components/Hero.tsx` (MeshGradient + NeonGlow wired) |
| R19 | Scanner deskew + PDF assembler | `87981927` · `services/api-gateway/src/services/scan-pipeline/` + flag `SCAN_PIPELINE_ASSEMBLE_ENABLED` (9 tests) |
| R22 | Per-tenant renderer adapter registry | `ab47a012` · `packages/report-engine/src/renderers/tenant-renderer-registry.ts` (6 tests) |
| R37 | Referral attribution MVP | `5029a3c0` · `services/api-gateway/src/services/referrals/referral-attribution.ts` (11 tests) |

End of roadmap. Every entry has either been:

- **Shipped** (see Shipped trailer + `Docs/AUDIT/ROADMAP_PURGE_2026-05-29.md`),
- **Moved to operator-action list** (`Docs/OPS/OPERATOR_ACTION_LIST.md`),
- **Closed inline** in the default-CLOSE-NOW pass,
- **Deleted as dead code** (R18 station-master / R23 renewal /
  R26 marketplace-inbound / R34 SectionSkeleton-equivalent-shipped).
