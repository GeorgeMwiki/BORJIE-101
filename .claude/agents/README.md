# BORJIE Claude Skills

This directory contains BORJIE operator skills in the
[Anthropic Skills SKILL.md format](https://claude.com/blog/skills),
the same open standard adopted by OpenAI Codex CLI, ChatGPT, GitHub
Copilot, and Cursor in 2025-2026.

## Why skills (not prompts in code)

Each `.md` file is a self-contained, filesystem-discoverable contract:
front-matter declares the trigger conditions + tools the skill needs,
and the body is the procedure the agent follows. The procedure is
**loaded on demand** — the skill name and description are exposed
upfront so the agent can decide whether to invoke; the body never
leaks until invocation. This is Anthropic's "progressive disclosure"
pattern (one of the IP-safe capability-contract idioms from
`.audit/litfin-sota-2026-05-23/20-zero-friction-onboarding.md`).

## Skills shipped

| Skill | When | Hard gate |
|-------|------|-----------|
| `lease-renewal` | tenant within 90d of expiry, in good standing | NEVER auto-send |
| `eviction-prep` | confirmed arrears past grace period | C09 — NO autonomous filing, 4-eye approval, habitability check |
| `owner-onboarding` | new owner first chat | Day-0 autonomy = read + create only |

## Format reference

```markdown
---
name: <kebab-case unique id>
description: <when to trigger; visible to the agent for routing>
tools: <comma-separated subset of allowed tool surface>
---

# Skill name

## When this fires
...

## Workflow
1. step
2. step

## Hard rules
- NEVER ...
- ALWAYS ...

## Failure modes
- condition → behavior

## Outputs
- artifact 1
- artifact 2
```

## Runtime skills

Document-generation skills used by the runtime (Carbone / Typst /
Citations / etc.) live in `services/reports/skills/`. Those are
invoked programmatically by `@borjie/document-studio`. The
operator skills here are invoked CONVERSATIONALLY by Claude (Desktop,
Code, or our chat-ui) when the description matches the user's intent.
