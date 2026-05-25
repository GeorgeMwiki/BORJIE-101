# @borjie/agent-runtime

Internal **Claude-Code-compatible** agent runtime. Discovers the same
filesystem contracts Claude Code does (`.claude/hooks/*.json`,
`.claude/commands/*.md`, `.claude/agents/*.md`, `.claude/skills/*.md`,
`.mcp.json`, `~/.claude/projects/<encoded>/memory/`) and exposes them
to the BORJIE central-intelligence kernel.

## Why this package exists

We already had Claude-Code-style primitives spread across
`packages/central-intelligence` (hook chain, skill retriever,
sub-MD substrate) and `packages/mcp-server` (server side). This
package is the **consumer-side runtime** — the thing that reads
the same `.claude/*` config files Claude Code reads and turns
them into in-process callable objects.

It is intentionally thin. Where a battle-tested primitive already
exists in this monorepo, this package wires to it rather than
duplicating it.

## Subsystems

| Subsystem        | What it does                                            |
|------------------|---------------------------------------------------------|
| `hooks/`         | File-discovered hooks (7 events) + chain runner         |
| `slash-commands/`| Loads `.claude/commands/<name>.md` with `$ARGUMENTS`    |
| `sub-agents/`    | Loads `.claude/agents/<name>.md` w/ restricted tools    |
| `skills/`        | Registers + invokes `.claude/skills/<name>.md`          |
| `mcp/`           | Reads `.mcp.json`, starts stdio servers, discovers tools|
| `memory/`        | `MEMORY.md` index + topical `.md` files                 |
| `permissions/`   | Strict / open / audit modes on top of allow+deny lists  |

## Wire-up

```ts
import { createAgentRuntime } from '@borjie/agent-runtime';

const runtime = await createAgentRuntime({ projectPath: process.cwd() });

const decision = await runtime.permissions.checkPermission({
  tool: 'Bash',
  args: { command: 'rm -rf /' },
});
// → 'deny'  (strict mode, Bash not in allowedTools)

const hookResult = await runtime.hooks.runHooks('PreToolUse', {
  toolName: 'Write',
  toolInput: { path: 'README.md', content: '…' },
});
```
