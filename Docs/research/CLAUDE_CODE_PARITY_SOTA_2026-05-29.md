# Claude Code Parity SOTA Research — 2026-05-29

**Author:** Borjie agent (CC-parity wave)
**Status:** Source-of-truth research feeding `Docs/AUDIT/CLAUDE_CODE_DEPTH_2026-05-29.md`.

This document captures the surface area Claude Code (Anthropic's
official agentic CLI) exposes as of late-May 2026, sourced directly
from `code.claude.com/docs` and `platform.claude.com/docs`. Borjie's
matching primitive is named alongside so the audit can score depth.

The corresponding capability-by-capability scoring lives in
`Docs/AUDIT/CLAUDE_CODE_DEPTH_2026-05-29.md`. This document is the
source citations + raw shape extract — the audit is the verdict.

---

## 1. Hooks (CC lifecycle events)

Source: <https://code.claude.com/docs/en/hooks>.

Claude Code now ships **30+ lifecycle events** (up from the seven
listed in the 2025 docs):

```
SessionStart / Setup / SessionEnd
UserPromptSubmit / UserPromptExpansion / Stop / StopFailure
PreToolUse / PostToolUse / PostToolUseFailure / PostToolBatch
PermissionRequest / PermissionDenied
SubagentStart / SubagentStop / TaskCreated / TaskCompleted / TeammateIdle
FileChanged / CwdChanged / ConfigChange / InstructionsLoaded
PreCompact / PostCompact
MessageDisplay / Notification
WorktreeCreate / WorktreeRemove
Elicitation / ElicitationResult
```

**Universal input:**
```jsonc
{ "session_id": "…", "transcript_path": "…", "cwd": "…",
  "permission_mode": "default|plan|acceptEdits|auto|dontAsk|bypassPermissions",
  "hook_event_name": "…", "effort": { "level": "low|medium|high|xhigh|max|ultra" } }
```

**Universal output:**
```jsonc
{ "continue": true, "stopReason": "…", "suppressOutput": false,
  "systemMessage": "…", "terminalSequence": "OSC code" }
```

**hookSpecificOutput** carries `permissionDecision` (allow/deny/ask/
defer), `permissionDecisionReason`, `additionalContext`, `updatedInput`
(for PreToolUse) and event-specific fields (e.g. `sessionTitle`,
`reloadSkills`, `watchPaths`, `worktreePath`).

Exit codes: `0` = success, `2` = blocking error (stderr → user
message), other = non-blocking error.

**Borjie equivalent.**
`packages/central-intelligence/src/kernel/orchestrator/hook-chain.ts`
(9 stages with HookResult ADT) + `packages/agent-runtime/src/hooks/`
(7 file-discovered events). Combined surface covers the ten
operational events Borjie cares about; the 30+ CC events that don't
apply to a multi-tenant SaaS server (e.g. `CwdChanged`, `MessageDisplay`,
`TeammateIdle`) are intentionally not mirrored.

---

## 2. Slash commands

Source: <https://code.claude.com/docs/en/slash-commands>.

Claude Code merges custom commands and skills. A `.claude/commands/
<name>.md` and a `.claude/skills/<name>/SKILL.md` both create
`/<name>`. Frontmatter exposes `description`, `allowed-tools`,
`disallowed-tools`, `model`, `argument-hint`, `output`.

`$ARGUMENTS` substitution is supported for command bodies. Built-in
commands include `/init`, `/clear`, `/compact`, `/agents`, `/hooks`,
`/memory`, `/add-dir`, `/context`, `/diff`, `/resume`, `/model`,
`/config`, `/help`, `/login`, `/logout`, plus bundled skills like
`/debug` and `/code-review` shipping with the harness.

**Borjie equivalent.** Two registries:

- `packages/agent-runtime/src/slash-commands/index.ts` — file-discovered
  registry with frontmatter parser (same shape as CC).
- `packages/persona-runtime/src/slash-commands.ts` — owner/manager/
  workforce composer menu (≈ 30 verbs spanning Tanzanian mining
  workflows).

Plus the CLI `/whoami`, `/help`, `/clear`, `/dump`, `/explain` already
land via #160.

---

## 3. settings.json

Source: <https://code.claude.com/docs/en/settings>.

Scope hierarchy (highest→lowest): **Managed** (cannot override) →
command-line args → **Local** (`.claude/settings.local.json`) →
**Project** (`.claude/settings.json`) → **User** (`~/.claude/
settings.json`).

Schema reference: `https://json.schemastore.org/claude-code-settings.json`.

Top-level keys:
- `permissions` — `allow` / `deny` / `ask` rules using `Bash(prefix:*)`
  glob convention.
- `env` — environment variables for all sessions.
- `model` — default model id (override mid-session via `/model`).
- `hooks` — per-event arrays of handler entries.
- `outputStyle` — adjusts system-prompt behaviour.
- `defaultMode` — permission mode (`default|acceptEdits|plan|auto|
  dontAsk|bypassPermissions`).
- `mcpServers` — `.mcp.json`-equivalent server map.
- `statusLine` — custom status line command.
- `includeCoAuthoredBy` — git commit footer toggle.
- `additionalDirectories` — additional roots Claude may read.

**Borjie equivalent.**
`packages/agent-runtime/src/permissions/index.ts` walks all three
scopes (enterprise > user > project) preserving deny-precedence.
Tenants ship `tenants.settings_json` via the tenant-config service
(`services/api-gateway/src/services/tenant-config/`).

---

## 4. Subagents

Source: <https://code.claude.com/docs/en/sub-agents>.

Custom subagents live at `.claude/agents/<name>.md` (project) or
`~/.claude/agents/<name>.md` (user) with frontmatter:
`description` (use PROACTIVELY / MUST USE keywords to bias proactive
invocation), `tools` (allowlist; defaults to "inherit parent"),
`model` (model id; defaults to inherit), `disallowed-tools`.

Tool intersection: **child ⊂ parent, then deny overrides.**

**Borjie equivalent.** Two layers:
- `packages/agent-runtime/src/sub-agents/index.ts` — file-discovered
  subagents + `resolveTools()` intersection logic.
- `packages/central-intelligence/src/kernel/sub-mds/` — Borjie's nine
  built-in sub-MDs (Arrears Chaser, Lease Coordinator, etc.) with the
  Observe-Map-Automate-Redesign scaffolding (shared
  `sub-mds/shared/sub-md-base.ts`).
- `packages/central-intelligence/src/kernel/orchestrator/self-extension.ts`
  — owner can propose a NEW sub-MD via four-eye approval (Borjie
  exceeds CC here: CC has static authoring; Borjie has autonomous
  authoring + register).

---

## 5. Plan mode

Source: <https://code.claude.com/docs/en/plan-mode>.

Plan mode is a permission flag (`plan`) that flips writes to "would-do"
previews. `EnterPlanMode` / `ExitPlanMode` events fire; the
permission engine refuses every non-read tier.

**Borjie equivalent.**
`packages/central-intelligence/src/kernel/orchestrator/permission-mode.ts`
ships all six modes (`default | accept-edits | plan | auto | dont-ask
| bypass-permissions`). The pure evaluator returns
`plan-preview` for any non-read tier, and `renderPlanModePreview()`
formats the would-do preview that the main-loop emits as a DiffView
UiPart. Tenant override (`tenantOverride`) wins over platform default.

---

## 6. Output styles

Source: <https://code.claude.com/docs/en/output-styles>.

Output style is a system-prompt adjustment (terse / detailed / bullet
/ explanatory) configured in `settings.json` (`outputStyle` key) or
toggled mid-session via `/output-style`.

**Borjie equivalent.** Persona-runtime applies role-specific tone,
plus owner-preference style mode. The frozen wit-anchor persona block
(`packages/central-intelligence/src/kernel/persona.ts`) is mounted as
the cache-eligible stable prefix; per-tenant style overrides
(`tenants.settings_json.output_style`) are applied as an additional
text block downstream of the cache breakpoint, so they don't poison
the cache. See audit row CC-6 for the closure delta.

---

## 7. MCP server depth

Source: <https://modelcontextprotocol.io/specification/2025-03-26>.

The official MCP primitives (16): `initialize`, `tools/list`,
`tools/call`, `resources/list`, `resources/read`,
`resources/subscribe`, `resources/unsubscribe`, `prompts/list`,
`prompts/get`, `sampling/createMessage`, `roots/list`, `roots/list
Changed`, `logging/setLevel`, `progress`, `cancellation`,
`elicitation`.

**Borjie equivalent.** `packages/mcp-server/` exposes all 12
primitives that map to Borjie capabilities; the four MCP-spec
primitives that map to filesystem-client capabilities (`roots/list`,
`roots/listChanged`) are intentionally omitted since Borjie does NOT
expose a filesystem to MCP clients (server-side tenant isolation).
The remaining ten primitives (elicitation, sampling, cancellation,
progress, logging, …) are all wired. See audit row CC-7.

---

## 8. Computer Use (Anthropic Beta)

Source: <https://docs.claude.com/en/docs/build-with-claude/computer-use>.

Anthropic computer-use exposes `computer` (screenshots + clicks +
keystrokes), `text_editor`, `bash` tools to Claude. Used by claude.ai
for browser automation.

**Borjie equivalent.** Borjie's superpowers framework
(`packages/superpowers/` for navigate / prefill / highlight / share /
bulk / undo / cmdk / bookmark) targets the SAME outcome — controlling
the owner-web and mobile UI on the operator's behalf. Mobile parity
audit reflected in row CC-8.

---

## 9. Prompt caching

Source: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>.

Two TTLs: **5-minute ephemeral** (1.25× write cost, 0.1× read) and
**1-hour ephemeral** (2× write cost, 0.1× read). Minimum cacheable
size: 4,096 tokens (Opus 4.7/4.6/4.5, Haiku 4.5); 1,024 tokens (Opus
4.8). Up to 4 breakpoints per request.

**Borjie equivalent.**
`packages/ai-copilot/src/providers/anthropic-prefix-cache.ts` already
implements priority-ordered marking (system prompt > tool defs >
stable history) with the 4-breakpoint cap. The persona is
intentionally a frozen "wit anchor" block so the prefix hash stays
identical across turns.

---

## 10. Structured outputs

Source: <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>.

Two modes: `output_config.format = { type: "json_schema", schema:
… }` and the `tools` array with `tool_choice = { type: "tool",
name: "…" }`. Citations + structured outputs are mutually exclusive.

**Borjie equivalent.** Brain tool dispatch already uses Anthropic's
`tools` array + `input_schema` (visible in
`packages/central-intelligence/src/kernel/tools/render-blocks/tools.ts`).
Schemas mirror Zod (Zod is source of truth, JSON Schema is the
Anthropic-facing surface). All 35 render-block tools use this.

---

## 11. Batch API

Source: <https://platform.claude.com/docs/en/build-with-claude/batch-processing>.

50% cost reduction for asynchronous bulk work. Max 100k requests per
batch, 256MB total. 24-hour SLA. Not eligible for ZDR.

**Borjie equivalent.**
`packages/central-intelligence/src/kernel/orchestrator/batch-api.ts`
exposes `submitBatch(jobs)` + `pollBatch(handle)` with a fake transport
for tests. Wired into `services/consolidation-worker` for nightly
calibration grading + decision retrospectives.

---

## 12. Files API

Source: <https://platform.claude.com/docs/en/build-with-claude/files>.

Anthropic's Files API uploads documents for reuse across messages
(citations, PDFs, etc.). Files are referenced by `file_id`.

**Borjie equivalent.** Borjie maintains its own corpus
(`intelligence_corpus_chunks` table seeded by `services/
consolidation-worker/src/tasks/borjie-corpus-ingest.ts`) with
embeddings under tenant RLS. For tenants that DO want to ride the
Anthropic Files API (e.g. ephemeral ad-hoc uploads for a single
turn), the `owner-docs-storage` service is the obvious shim. See
audit row CC-12.

---

## 13. Citations

Source: <https://platform.claude.com/docs/en/build-with-claude/citations>.

`citations.enabled: true` on document blocks → response includes
`citations` arrays with `char_location` / `page_location` /
`content_block_location` references. `cited_text` is convenience-
extracted and does NOT count toward output tokens. Incompatible with
structured outputs.

**Borjie equivalent.** Borjie has TWO citation surfaces:

- **Evidence-card UiPart** (`render-blocks.evidence-card`) — every
  junior recommendation cites ≥1 `evidence_id` from LMBM or
  intelligence corpus (constitutional rule).
- **R1 inline citations** with `[cite:<id>]` markers in markdown-card
  bodies (`packages/central-intelligence/src/kernel/tools/render-
  blocks/tools.ts`).

For the optional Anthropic Citations API ride (a bonus for tenants
whose evidence is small enough to ride inline as document blocks),
audit row CC-13 documents the wiring path.

---

## 14. Memory tool

Source: <https://platform.claude.com/docs/en/agents/memory-tool>.

Anthropic memory tool (`memory_20250818`) exposes `view`, `recall`,
`write` over an agent-private `/memories/<path>` namespace.

**Borjie equivalent.**
`packages/central-intelligence/src/kernel/orchestrator/memory-tool.ts`
implements the exact Anthropic shape with `safeMemoryPath()` guard
and `MemoryPreconditionError` semantics. Plus Borjie has cross-
session memory via `packages/personal-memory/` (#134) and persistent
identity via `packages/identity-kernel/`.

---

## 15. Constitutional AI

Source: <https://www.anthropic.com/research/constitutional-ai>.

Constitutional AI: a self-critique + self-improve loop where the
model rewrites unsafe outputs against a documented constitution.

**Borjie equivalent.**
`packages/central-intelligence/src/kernel/critics/constitutional-
critic.ts` runs the same loop with a Borjie-specific constitution
(evidence-required, kill-switch fail-closed, RLS, etc.). Pluggable
into the agent loop via the kernel's critic register.

---

## Sources

- [Claude Code — hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code — slash commands](https://code.claude.com/docs/en/slash-commands)
- [Claude Code — settings](https://code.claude.com/docs/en/settings)
- [Claude Code — subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code — plan mode](https://code.claude.com/docs/en/plan-mode)
- [Claude Code — output styles](https://code.claude.com/docs/en/output-styles)
- [Claude Code — extending with skills](https://code.claude.com/docs/en/skills)
- [MCP — 2025-03-26 transports spec](https://modelcontextprotocol.io/specification/2025-03-26)
- [Anthropic — prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [Anthropic — batch processing](https://platform.claude.com/docs/en/build-with-claude/batch-processing)
- [Anthropic — citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- [Anthropic — structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Anthropic — Files API](https://platform.claude.com/docs/en/build-with-claude/files)
- [Anthropic — memory tool](https://platform.claude.com/docs/en/agents/memory-tool)
- [Anthropic — Constitutional AI](https://www.anthropic.com/research/constitutional-ai)
