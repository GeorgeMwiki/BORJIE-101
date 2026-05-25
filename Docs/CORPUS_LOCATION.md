# Borjie Documentation

The full mining corpus and product spec lives **outside this repo** at:

```
/Users/georgesmackbookair/Desktop/CLAUDE_CURSOR_CODEX PROJECTS/Claude Projects/Boji project/Docs/
```

(set via env var `BORJIE_MINING_CORPUS_PATH`)

This decoupling lets the corpus version independently of code. The first-boot
ingestion job (`services/consolidation-worker/src/tasks/borjie-corpus-ingest.ts`)
reads from `BORJIE_MINING_CORPUS_PATH` and upserts every chunk into
`intelligence_corpus_chunks` with `tenant_id = NULL` so every tenant inherits
the same Tanzanian mining ground truth.

## Where to find what

| Document | Location |
|---|---|
| Full AI spec (165 KB) | `$BORJIE_MINING_CORPUS_PATH/BOJI_AI_SPEC.md` |
| Build plan (Phase 0 → 5, 13 weeks) | `$BORJIE_MINING_CORPUS_PATH/build/BOJI_BUILD_PLAN.md` |
| MVP1 week-by-week | `$BORJIE_MINING_CORPUS_PATH/build/MVP1_BUILD_PLAN.md` |
| Data model | `$BORJIE_MINING_CORPUS_PATH/build/DATA_MODEL.md` |
| Screen catalogue (89 screens) | `$BORJIE_MINING_CORPUS_PATH/build/UI_SCREEN_CATALOGUE.md` |
| Agent prompt library (28 juniors) | `$BORJIE_MINING_CORPUS_PATH/build/AGENT_PROMPT_LIBRARY.md` |
| Primary sources (founder briefs) | `$BORJIE_MINING_CORPUS_PATH/primary_sources/` |
| Mining research dossiers | `$BORJIE_MINING_CORPUS_PATH/research/` |
| Mineral processing playbooks | `$BORJIE_MINING_CORPUS_PATH/research/minerals/` |

## Repo-local docs (ADRs, runbooks)

Architecture Decision Records, runbooks, and code-specific docs live here in
`Docs/` and ship with the code.
