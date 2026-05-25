# @borjie/skill-conversation

Phase J6 — **Skill-by-Conversation** substrate.

Lets a property-owner-customer or internal-admin say in chat:

> "Every Monday morning send me a one-page brief on the previous week"

and have the MD reply:

> "I think you want me to set up a weekly brief that runs every Monday at 7am EAT.
> Should I set that up? Reply 'yes' to confirm, 'no' to cancel."

On confirmation, the NL is compiled by `@borjie/aop-compiler` to a
validated Skill + cron + monitor + hook chain. The skill is anchored back
to the conversation_id + message_id so the owner can ask "show me the
skills you've set up" and get a list with creation context.

## Surface

```ts
import {
  classifyIntent,
  compileSkillFromNL,
  InMemorySkillRegistry,
  getSkillStatus,
  pauseSkill,
  resumeSkill,
  deleteSkill,
} from '@borjie/skill-conversation';
```

### 1. Intent classification — the confirmation gate

```ts
const verdict = classifyIntent(naturalLanguageInput);
// → { kind: 'recurring' | 'conditional' | 'ad-hoc' | 'question', confidence: 0.0..1.0, confirmation }
```

The classifier is conservative: anything with "every X" / "when X happens" /
"if X then Y" / "remind me" lands in `recurring` or `conditional` and gets
a `confirmation` prompt. Ad-hoc actions (one-off "send this email now")
and questions ("what's my arrears total?") skip the AOP compile.

### 2. AOP compilation — the validation gate

```ts
const result = await compileSkillFromNL(naturalLanguageInput, {
  scope: 'owner-customer',     // or 'internal-admin'
  tenantId: 'tenant-abc',      // required for owner-customer
  conversationId: 'conv-1',
  messageId: 'msg-1',
  llm,
  toolRegistry,
  autonomyValidator,           // optional — autonomy-cap check
});
```

Returns either:
- `{ ok: true, skill, cron, monitors, hooks, registryEntry, prose, diagram }` — ready to deploy
- `{ ok: false, errors }` — show owner-friendly errors in chat

### 3. Status loop — chat-anchored skill lifecycle

```ts
const registry = new InMemorySkillRegistry();
await registry.save(registryEntry);

// "show me my skills"
const skills = await registry.listByOwner({ tenantId, scope: 'owner-customer' });

// "pause the weekly brief"
await pauseSkill(registry, skillId, { reason: 'tenant-paused' });

// "resume"
await resumeSkill(registry, skillId);

// "delete"
await deleteSkill(registry, skillId);
```

## Scope rules

| Scope            | Who can author             | Tenant required | Platform-wide |
| ---------------- | -------------------------- | --------------- | ------------- |
| `owner-customer` | Tenant owner / co-owner    | yes             | no            |
| `internal-admin` | Platform admin (HQ staff)  | optional        | yes if absent |

Internal-admin skills with no `tenantId` apply to every tenant
(e.g. "weekly customer-owner churn report").

## Coordination

This package is **NOT** consumed by `@borjie/ai-copilot` yet — CL-B2 is
touching that package in parallel. The integration is a follow-up PR.
