# @borjie/self-codegen

**Phase N-B — Self-Code-Writing Harness.** Closes the top-12 patterns from
`.research/r-codegen-self-code-writing-frontier.md`. Gives the brain
Opus-parity ability to propose, sandbox, execute, review, and ship code
changes — with mandatory four-eye gates on every destructive surface.

## Hard NEVERS (enforced)

1. **NEVER `bypassPermissions`** — type-level forbidden in `opus-parity-config`.
2. **NEVER let the brain modify its own production runtime** — research worktree
   only; deny-globs cover `.claude/**`, `packages/self-codegen/**`.
3. **NEVER skip dual-human approval on CODEOWNER globs** — the
   `three-layer-review` Layer 3 only fires when CODEOWNER-only globs are
   touched and always demands the dual-human gate.

## Nine modules

| # | Module | One-liner |
| --- | --- | --- |
| 1 | `plan-execute-split/` | Opus 4.7 plans read-only, Sonnet 4.7 executes; ~3× cheaper than Opus-only end-to-end. |
| 2 | `worktree-sandbox/` | `git worktree` + optional Daytona two-layer isolation; cleanup ALWAYS runs (try/finally). |
| 3 | `pre-tool-use-hooks/` | Deny destructive globs at the runtime boundary via `canUseTool`. |
| 4 | `three-layer-review/` | Inline subagent + CodeRabbit adapter + `/ultrareview` Opus xhigh. |
| 5 | `codeowners-templating/` | Generates `.github/CODEOWNERS` + required-reviewer-rule JSON from `borjie.codeowners.yml`. |
| 6 | `multi-agent-reflexion/` | 3 parallel critics (factual + senior-eng + security) — avoids local-optima trap. |
| 7 | `skill-emit-on-success/` | Voyager-compounding: proposes `SKILL.md` on success → K-C HITL gate. |
| 8 | `post-tool-audit-hook/` | Async forensic trail to sovereign-ledger + Slack on every Write/Edit/Delete. |
| 9 | `opus-parity-config/` | Default `task_budget = $1000`; adaptive + interleaved thinking on. |

## Read-only enforcement in Plan phase

The Plan phase takes a `ReadOnlyContext` whose type only exposes
`Read | Grep | Glob | Bash(read-only)` — there is no `write`, `edit`, `delete`
member, so calling those is a TypeScript compile error. At runtime, a
`disallowedTools: ['Write', 'Edit', 'Delete']` set is appended as a
belt-and-suspenders. If anything tries to mutate, the plan task throws
`PlanPhaseReadOnlyViolation`.

## Default deny globs

```
**/migrations/**
**/m-pesa/**
.claude/**
.github/workflows/**
**/*.env*
**/secrets/**
```

## 3-critic combination rule

```
any 'block'    → block
any 'comments' → comments  (append all findings)
all 'pass'     → pass
```

## Sample `borjie.codeowners.yml`

```yaml
defaultOwners:
  - '@platform-admin'
ruleSets:
  finance:
    paths:
      - 'services/payments-ledger/**'
      - 'packages/connectors/m-pesa/**'
    owners:
      - '@finance-lead'
      - '@finance-deputy'
  database:
    paths:
      - 'packages/database/src/migrations/**'
    owners:
      - '@db-lead'
  selfPolicy:
    paths:
      - '.claude/**'
      - '.github/workflows/**'
      - 'packages/self-codegen/**'
    owners:
      - '@platform-admin'
      - '@security-lead'
```

## Usage sketch

```ts
import { runSelfCodegenTask } from '@borjie/self-codegen';

const result = await runSelfCodegenTask({
  task: 'Fix the M-Pesa retry cap',
  repo: { url: 'git@github.com:GeorgeMwiki/BORJIE101.git', baseBranch: 'main' },
  allowedGlobs: ['packages/connectors/m-pesa/**'],
  budgetUsd: 1000,
  useDaytona: false,
});

if (result.status === 'pr-opened') {
  console.log(`PR: ${result.prUrl}`);
}
```

## Coverage

- 90+ unit tests
- 12 integration tests
- Plan-phase read-only enforcement: type-level + runtime
- Worktree sandbox cleanup runs on throw
- All 6 default deny-globs covered
- 3-critic Reflexion: disagreement → not-pass
- CODEOWNERS yml → file shape
- End-to-end "fix trivial bug" simulation
