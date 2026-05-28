# Chat-as-OS Bidirectional Parity — State of the Art (2026-05-28)

**Audience:** Borjie product, platform, and brain engineers.
**Goal:** Define what it means for every Borjie surface to give the
owner / admin / buyer / workforce user **bidirectional parity**
between an explicit form/tab/button path and the chat ("Mr. Mwikila")
path. Both paths must be first-class: same entity, same record, same
audit row, same downstream effects. Neither path is "the right one."
This document grounds Borjie's manifesto in 2026 SOTA practice from
twelve leading AI-augmented products and consolidates it into 14
engineering principles.

---

## 1. Why Bidirectional Parity Matters

The "chat-as-OS" thesis (popularised by ChatGPT's app store, Claude's
Computer Use, Adept ACT-1 and the OpenAI Operator GA) is that natural
language eventually replaces clicking menus. But every serious
product team that has shipped this has discovered the same failure
mode: if the AI path produces **shadow entities** (a "draft" object
the user cannot find in their normal Drafts tab, a "bid" the user
cannot edit in their Marketplace screen), trust collapses inside one
week. The user has to mentally maintain two product surfaces.

Conversely, the products that have made the chat path stick — Linear,
Notion, Cursor, Replit Agent, Slack slash commands, GitHub Copilot
Workspace, ChatGPT Canvas, Figma First Draft, Lovable, v0 — all
share one architectural commitment:

> The AI path and the human path land on **the same table, the same
> record, the same audit trail**. The only difference is a small
> `provenance` field that tells you which path produced the row.

We call this Bidirectional Parity. It is not optional for Borjie.

---

## 2. Reference Products

### 2.1 Linear — Cmd+K and Linear Agent

Linear's [Cmd+K command palette](https://linear.app/docs/creating-issues)
lets a user create an issue in under three seconds. The
[Linear Agent](https://linear.app/changelog/2026-03-24-introducing-linear-agent)
(March 2026) lets the same user create the same issue via natural
language. Both paths write to the same `issues` table; both surface
the new issue in the same Triage view; both emit the same activity-log
event with `actor_kind` and `via` fields. The agent's issue carries
an `assistant_session_id` referencing the chat turn that produced it,
and a one-click "Open in Agent" pill in the issue header jumps back
to the chat. **Rollback:** issues created by the agent can be deleted
or modified by the user with no extra friction; the agent never owns
the entity post-creation.

Provenance signal: `via: "agent" | "command_palette" | "form" | "api"`.
Rollback mechanism: standard issue delete + activity-log reversal.

### 2.2 Notion AI — AI Blocks vs Manual Blocks

[Notion's AI blocks](https://www.notion.com/help/notion-ai-faqs) and
the
[AI block badge](https://noteforms.com/notion-glossary/ai-blocks)
write content into the same page hierarchy as manually-typed blocks.
The AI-generated block carries a persistent badge (clickable blue
"AI" icon with ellipsis) that survives until the user explicitly
clears formatting (Cmd+Shift+X). The block itself is structurally
identical to a manual block — same parent, same indentation, same
permissions, same comment threading. Notion's API exposes a
`created_by.type === "bot"` flag plus the chat turn ID in a hidden
`assistant_metadata` property.

Provenance signal: `created_by.type` + `assistant_metadata.session_id`.
Rollback mechanism: standard block delete + Notion's version history.

### 2.3 Cursor / Windsurf — Chat Mode vs Edit Mode

Both [Cursor](https://cursor.com/help/integrations/git)
and Windsurf adopted the "chat changes the same file the keyboard
would" model. Chat-mode and edit-mode both run through the same
in-memory file buffer, both produce ordinary git diffs, both can be
committed under either the human's or the AI's authorship. Cursor's
@Git Commit and @PR contexts give the AI access to the same git tree
the user sees. The defining commitment is that **a chat edit looks
like any other edit in `git blame`** — only the commit message
trailer (`Assisted-by: Cursor-Composer`) marks provenance.

Provenance signal: commit trailer / co-author line.
Rollback mechanism: `git revert`, identical to manual reverts.

### 2.4 Lovable / Bolt.new / v0

The three AI app builders compared in
[Better Stack's deep dive](https://betterstack.com/community/comparisons/bolt-vs-v0-vs-lovable/)
all converge on the same architectural pattern: chat output is a
React tree a human developer could have written manually. v0
specifically generates "the cleanest React code in the AI builder
space," and its chat output is editable in any IDE the human chooses
because the file structure is identical to what `create-next-app`
would scaffold. The chat path and the manual path produce the same
filesystem.

Provenance signal: per-commit metadata + the v0 chat-URL stamped in
the file header comment.
Rollback mechanism: standard git history, no special "AI-only"
revert needed.

### 2.5 Replit Agent — Same Filesystem as the IDE

[Replit's snapshot engine](https://replit.com/blog/inside-replits-snapshot-engine)
gives the Agent and the IDE access to the same Git repository.
[Replit's docs](https://docs.replit.com/replit-workspace/workspace-features/version-control)
state that "All four version control options (Agent Checkpoints, Git
Pane, Git CLI, and File History) interact with the same underlying
Git repository." The Agent's commits are normal commits in the
normal history; the only marker is the checkpoint metadata pointing
back to the chat session.

Provenance signal: checkpoint metadata + commit-trailer URL.
Rollback mechanism: standard `git reset` / `git revert`; Replit's
History++ also offers point-in-time restore.

### 2.6 Slack — Slash Commands and Forms Both Create Messages

Slack's
[slash-command guide](https://docs.slack.dev/interactivity/implementing-slash-commands/)
shows that a `/poll` command and a manually-built Block Kit poll
produce identical `messages` entities in the channel. Both can be
edited (within Slack's edit window), both can be reacted to, both
appear in the channel's normal scrollback, both trigger the same
webhooks. The slash-command path inserts a `bot_id` field in the
message envelope, but the channel UI treats the messages identically.

Provenance signal: `bot_id` + `app_id` on the message envelope.
Rollback mechanism: standard message delete / edit.

### 2.7 Figma — AI Generation vs Manual Drawing

[Figma First Draft / Figma AI](https://help.figma.com/hc/en-us/articles/23870272542231-Use-AI-tools-in-Figma-Design)
generates ordinary nodes in the file tree — frames, vectors,
components — that look identical to what a designer would draw by
hand. The
[version history](https://www.mcpbundles.com/blog/figma-mcp-server)
labels AI-generated saves with timestamps and authors so the audit
trail captures "Generated via First Draft" alongside "Manual save."
Once placed, the nodes are fully editable like any other node.

Provenance signal: version-history label + node-creator metadata.
Rollback mechanism: Figma's version history revert.

### 2.8 GitHub Copilot Workspace — Agent PRs

[GitHub's March 2026 release](https://github.blog/changelog/2026-03-20-trace-any-copilot-coding-agent-commit-to-its-session-logs/)
adds an `Agent-Logs-Url` trailer to every Copilot-agent commit
message, giving reviewers a permanent link from agent-authored
commits back to the full session logs. The
[Copilot Workspace docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)
state that "Commits from Copilot cloud agent are authored by Copilot,
with the person who started the task listed as co-author. All
commits are co-authored for traceability." The PR itself is a
regular PR; the diff is a regular diff; the reviewer experience is
identical to a human PR.

Provenance signal: `Co-Authored-By: GitHub Copilot` + `Agent-Logs-Url`
trailer.
Rollback mechanism: revert the PR via the normal GitHub UI.

### 2.9 Anthropic Computer Use / OpenAI Operator

[Anthropic's Transparency Hub](https://www.anthropic.com/transparency/voluntary-commitments)
and the
[Cowork analysis](https://blog.pluto.security/p/inside-claude-cowork-how-anthropics)
reveal both the strength and the weakness of agent-driven OS-level
automation. The strength: the agent's clicks and keystrokes are
literally indistinguishable from the user's at the OS layer. The
weakness: Cowork actions are not centrally audited, which Anthropic
acknowledges as an enterprise gap. **The lesson for Borjie:** parity
must include the audit trail, not just the entity. Every chat-driven
write must produce the same audit row a manual write would.

Provenance signal: local session log + (forthcoming) cloud audit ID.
Rollback mechanism: per-side-effect compensating action.

### 2.10 ChatGPT Canvas / Claude Artifacts

[ChatGPT Canvas](https://artificialcorner.com/p/claude) and
[Claude Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)
both expose the AI-generated content as a co-editable surface. Canvas
goes furthest: the user can highlight text and type directly into the
artifact, blurring the line between chat-generated and human-edited
content. The
[XSOne deep-dive](https://xsoneconsultants.com/blog/chatgpt-canvas-vs-claude-artifacts/)
notes that Canvas's "surgical precision" comes from treating the
artifact as a single editable document with a unified change history,
regardless of who made each edit. This is the model Borjie's drafts
must follow.

Provenance signal: per-edit attribution in the change log
(`actor: "user" | "assistant"`).
Rollback mechanism: per-edit undo + full revision history.

### 2.11 Apple Shortcuts AI / Microsoft Power Automate Copilot

[Power Automate Copilot](https://learn.microsoft.com/en-us/power-automate/copilot-overview)
and Apple's
[AI-powered Shortcuts](https://dev.to/ashikur_rahmannazil93/apple-shortcuts-is-getting-an-ai-makeover-heres-what-that-means-for-automation-1bp1)
both let the user describe an automation in natural language; the
result is the same flow / shortcut a manual builder would have
clicked together. The user can then open the generated flow in the
visual editor and edit step-by-step. The chat path is a faster way
to reach the same destination — not a separate destination.

Provenance signal: `generation_source: "copilot"` on the flow header.
Rollback mechanism: standard flow delete / edit.

### 2.12 Arc Browser — Command Bar + AI

[Arc Max](https://arc.net/max) renames AI-summarised tabs with a
clear AI-source label and lets the user override the title with a
double-click. The bookmark created via the Command Bar's AI summary
is structurally identical to a hand-saved bookmark; only a small
icon distinguishes the source.

Provenance signal: `source: "ai_summary"` on the bookmark.
Rollback mechanism: standard bookmark edit / delete.

---

## 3. Cross-Cutting Patterns

Across these twelve products, four patterns recur:

1. **Single source of truth.** The chat path and the manual path
   write to the same table / file / node — never to a parallel
   "chat-only" store.
2. **Provenance is a metadata field, not a class of entity.** A
   single column / property records `via` (chat | form | api | agent)
   plus actor / session / turn.
3. **Visible-but-unobtrusive badging.** A small icon / pill / colour
   tells the user "this came from chat" without making the entity
   feel second-class.
4. **Standard rollback.** No special "undo a chat action" flow —
   the entity is editable / deletable / revertable through the
   normal UI mechanisms users already know.

The
[Reversible AI Systems article](https://www.raktimsingh.com/reversible-ai-systems-enterprise-ai-undo-button/)
formalises this as the **Reversible Autonomy** triad: observability,
audit trail, rollback. The
[TianPan agent-rollback piece](https://tianpan.co/blog/2026-04-20-ai-agent-data-rollback-production)
adds the operational constraint that "compensating actions are
required to roll back multi-step workflows" — every WRITE tool must
have a defined undo. The
[Augment Code agent-audit playbook](https://www.augmentcode.com/guides/multi-agent-outputs-n-pass-enterprise-audit)
calls out attributability and reversibility as the two hard tests
for enterprise audit compliance.

---

## 4. The Borjie Chat-as-OS Manifesto

These are the 14 principles every Borjie surface must obey. They are
binding on every PR that touches an entity-mutating route, brain
tool, or list/detail view.

**1. Every UI action has a chat equivalent.** If the owner can do X
by clicking, the owner must be able to do X by asking Mr. Mwikila.
"Click here to add a reminder" must have a `reminders.create` chat
tool.

**2. Every chat action persists into the matching UI surface.** A
draft composed via chat must appear in the Documents tab the user
opens five minutes later — not in a parallel "chat history" only.

**3. Same entity table, same record shape, same audit row —
regardless of entry path.** No "chat-drafts" table separate from
"manual-drafts." There is one `document_drafts` table, one
`marketplace_bids` table, one `reminders` table.

**4. Every record carries a `provenance` jsonb column.**
`{via: 'chat' | 'form' | 'agent_apply' | 'api', actorId, sessionId,
requestedAt, turnId?}`. Backfilled on every legacy row as
`{via: "legacy", ...}`.

**5. Chat-created records show a small "via Mr. Mwikila" gold pill
in the UI list.** Not a stigma — a trail. The same way a Notion AI
block shows a small AI badge.

**6. The owner can edit a chat-created record manually after the
fact.** No two-class system. A chat-drafted MoU is editable in the
draft editor exactly the same way a manually-uploaded MoU is.

**7. The owner can revert any chat action within reason.** Every
WRITE tool has a defined compensating action (revoke a bid, delete a
draft, unschedule a reminder). The compensating action follows the
same RLS + audit path as the original.

**8. Every chat tool call writes the same audit row a manual API
call would.** The hash-chained `ai_audit_chain` and the
`audit_events` rows are produced by both paths, with `via` in the
event payload.

**9. Chat tools do not bypass policy gates / kill switches / four-eye
approvals.** Every WRITE tool's HTTP-POST destination is a route
that already enforces policy; the tool inherits this enforcement
because it routes through the same gateway.

**10. Auto-categorisation is owner-overridable.** When a chat-created
draft is auto-filed into `/docs/regulator-letters/`, the owner can
drag-drop it elsewhere. The re-folder is itself a revision with
`{via: "form", previousFolder, newFolder}` provenance.

**11. Versioning is consistent.** A revision created via chat
(`N`) and a revision created via form (`N+1`) share the same revision
chain, the same `draft_revisions` table, the same diff machinery.

**12. Search across the explicit tab returns chat-created and
form-created entities together.** No "show chat-created only" filter
required by default; provenance is a metadata column, not a partition
key.

**13. Citation tracking.** A chat-created entity carries
`provenance.turnId` so a reviewer can click the badge and jump to the
chat turn that produced it.

**14. Unified timeline per entity.** A drawer / detail view shows
"created via chat by Mr. Mwikila at 14:32 → edited via form by you
at 16:01 → revised via chat at 18:45." A single timeline for both
paths — no two histories to reconcile.

---

## 5. Operational Implications for Borjie

### 5.1 Schema

A single migration (`0101_universal_provenance.sql`) adds
`provenance jsonb NOT NULL DEFAULT '{"via":"unknown"}'::jsonb` to
every state-mutable table the brain or the UI touches. The default
`{"via":"unknown"}` is replaced at insert time by either
`buildChatProvenance()` (from a brain tool) or `buildFormProvenance()`
(from an explicit route).

### 5.2 Provenance Helper

`services/api-gateway/src/services/provenance.ts` exports two pure
functions that take a Hono `Context` and return a `Provenance`
object. Both helpers consult the same `Provenance` zod schema so the
JSONB column is structurally identical regardless of caller.

### 5.3 Brain Tool Wiring

Every brain-tool descriptor whose handler does an HTTP POST or PUT
must inject `provenance: buildChatProvenance(c, turnId)` into the
POST body. Tool descriptors declare `isWrite: true` so the wiring is
mechanical: walk the file, find every `isWrite: true` block, ensure
its handler forwards `provenance`.

### 5.4 Route Wiring

Every route handler that does a `db.insert(...).values(...)` for one
of the listed tables must read `body.provenance` if present and fall
back to `buildFormProvenance(c)`. This is also mechanical: walk the
routes, find every insert into a listed table, ensure provenance is
forwarded.

### 5.5 UI Wiring

Every list/table component in `apps/owner-web`, `apps/admin-web`,
`apps/workforce-mobile`, and `apps/buyer-mobile` that renders rows
from a listed table must surface the "via Mr. Mwikila" pill when
`row.provenance.via === 'chat'`. Clicking the pill opens
`/chat?session={provenance.sessionId}&turn={provenance.turnId}`.

### 5.6 Detail-Drawer Timeline

Every detail-drawer component for a listed entity must include a
Timeline tab that lists creation + revision + chat-turn events,
ordered by time, with provenance-coloured icons.

### 5.7 "Open in Chat" Affordance

Every explicit form / detail view gains a small icon in its top-right
corner: "Talk to Mr. Mwikila about this." Click opens the chat pane
with `@-reference` pre-filled (`@parcel-GLD-2026-04-12`,
`@draft-MSA-Mahenge`, `@reminder-5`).

### 5.8 "Open in Tab" Affordance

Every entity-mentioning chat reply renders the entity ID as a chip;
click jumps to the entity's explicit detail view.

### 5.9 Auto-Categorisation

Chat-created drafts pass through the universal drafter's
`composeFreeForm` which infers `kind` + `counterparty`. The drafter
publishes an event the documents-tab listener consumes to auto-file
the draft into the right folder.

### 5.10 Policy Gate Verification

Every brain tool whose `isWrite` is true MUST route through an HTTP
endpoint that already invokes `policyGate.evaluate()`. The brain
tool itself never inserts directly. A test (`policy_gate_coverage.spec`)
walks every WRITE tool and asserts its target endpoint is in the
policy-gated set.

---

## 6. Anti-Patterns We Refuse

- **Shadow stores.** Never store chat-created entities in a parallel
  table.
- **Bypass routes.** Brain tools never call `db.insert` directly.
- **Silent provenance.** Default-stamping every row "form" is wrong;
  unknown rows are `"unknown"` until backfilled.
- **AI-only audit chain.** The hash-chained audit chain receives
  events from both paths; never a chat-only variant.
- **Two-class entities.** A chat-created MoU is not a draft; it is a
  draft revision exactly like a manual one.
- **Hidden chat actions.** Every WRITE tool surfaces a
  confirmation_card or a high-stakes four-eye when the existing UI
  flow would have.

---

## 7. Glossary

- **Provenance.** The `{via, actorId, sessionId, requestedAt,
  turnId?}` jsonb metadata stamped on every row.
- **Chat path.** A user-facing entry that goes through the brain
  (LLM tool-call) and emerges as an HTTP POST.
- **Form path.** A user-facing entry that goes directly through an
  explicit route handler (clicked button → POST).
- **Agent-apply path.** A worker / background job that applies a
  pending owner-approved action.
- **API path.** A programmatic caller (third-party integration).
- **Compensating action.** The undo operation for a WRITE tool, with
  the same shape (POST to a `/.../revoke` or `/.../delete` endpoint).

---

## 8. Sources

- Linear — [Cmd+K guide](https://linear.app/docs/creating-issues),
  [Linear Agent changelog](https://linear.app/changelog/2026-03-24-introducing-linear-agent)
- Notion AI —
  [What is Notion AI?](https://www.notion.com/help/notion-ai-faqs),
  [AI Blocks glossary](https://noteforms.com/notion-glossary/ai-blocks)
- Cursor — [Cursor Git docs](https://cursor.com/help/integrations/git)
- v0 — [v0 by Vercel review](https://dev.to/pickuma/v0-by-vercel-review-ai-generated-react-components-that-actually-ship-25d1)
- Replit Agent —
  [Snapshot Engine](https://replit.com/blog/inside-replits-snapshot-engine),
  [Workspace version control](https://docs.replit.com/replit-workspace/workspace-features/version-control)
- Slack — [Implementing slash commands](https://docs.slack.dev/interactivity/implementing-slash-commands/)
- Figma — [Use AI tools in Figma](https://help.figma.com/hc/en-us/articles/23870272542231-Use-AI-tools-in-Figma-Design)
- GitHub Copilot Workspace —
  [Trace any Copilot commit](https://github.blog/changelog/2026-03-20-trace-any-copilot-coding-agent-commit-to-its-session-logs/),
  [Track agent sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)
- Anthropic —
  [Cowork audit gap](https://blog.pluto.security/p/inside-claude-cowork-how-anthropics),
  [Transparency Hub](https://www.anthropic.com/transparency/voluntary-commitments)
- ChatGPT Canvas vs Claude Artifacts —
  [Side-by-side 2026](https://instapods.com/blog/claude-artifacts-vs-chatgpt-canvas/),
  [XSOne deep-dive](https://xsoneconsultants.com/blog/chatgpt-canvas-vs-claude-artifacts/)
- Power Automate Copilot —
  [Microsoft Learn](https://learn.microsoft.com/en-us/power-automate/copilot-overview)
- Arc Browser — [Arc Max](https://arc.net/max)
- Reversible AI Systems —
  [Raktim Singh framework](https://www.raktimsingh.com/reversible-ai-systems-enterprise-ai-undo-button/),
  [TianPan rollback](https://tianpan.co/blog/2026-04-20-ai-agent-data-rollback-production),
  [Augment Code audit playbook](https://www.augmentcode.com/guides/multi-agent-outputs-n-pass-enterprise-audit)
- Audit-trail patterns —
  [TianPan decision provenance](https://tianpan.co/blog/2026-04-19-decision-provenance-agentic-systems),
  [PostgreSQL JSONB audit](https://smarttechdevs.in/blog/scalable-audit-trails-laravel-postgresql-jsonb)
