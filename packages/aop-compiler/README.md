# @borjie/aop-compiler

Compiles natural-language Agent Operating Procedures (AOPs) — written by
owners in plain Swahili or English — into validated, executable workflow
bundles (Skill + cron + monitors + hook chain).

## Why

Property owners write SOPs in chat. We need to (a) understand them, (b) prove
to the owner we understood them, (c) execute them safely on the fleet, and
(d) never let a destructive step fire without a human approval.

## Pipeline

```
NL text
  -> parser/nl-parser.ts        (LLM extracts an AST)
  -> validator/                 (schema, tools, invariants, permissions)
  -> compiler/                  (-> Skill, -> cron, -> monitors, -> hooks)
  -> renderer/                  (-> Mermaid diagram, -> plain English)
```

## Grammar (excerpt)

A step is one of `tool`, `monitor`, `hook`, or `loop`:

| kind    | shape                                                                       |
| ------- | --------------------------------------------------------------------------- |
| tool    | `{ id, tool, args, on_success?, on_failure? }`                              |
| monitor | `{ id, monitor: { until_event?, OR?, timeout }, on_trigger }`               |
| hook    | `{ id, hook: ask-owner \| sandbox-divert \| 4-eye, prompt?, on_approve? }` |
| loop    | `{ id, body[], exit_when: { count\|event } }`                              |

A trigger is one of `cron`, `event`, or `manual`.

## Validation rules

1. Step ids are unique across the whole AOP (loop bodies included).
2. Every transition reference (`on_success`, `on_failure`, `on_trigger`,
   `on_approve`, `on_reject`) resolves to a known step.
3. No cycles unless bounded by an explicit `loop` block.
4. Every monitor must declare a `timeout` — no infinite waits.
5. Destructive-tier tools must be preceded by an `ask-owner` or `4-eye` hook
   whose `on_approve` points at the tool step.
6. Every referenced tool exists in the `BrainToolRegistry`.
7. The declared `entry` (or `steps[0].id`) must exist.
8. The reachable graph must have at least one terminal step (or a loop).

## Reference fixtures

- `__tests__/fixtures/arrears-chase.aop.ts` — day-25 monthly arrears chase
  with reminder -> wait -> call -> wait -> owner-approve -> draft eviction.
- `__tests__/fixtures/lease-renewal.aop.ts` — 60-day-pre-expiry lease
  renewal: draft -> owner-approve -> send -> wait -> record or escalate.
- `__tests__/fixtures/kra-filing.aop.ts` — day-5 monthly MRI compile + KRA
  MCP file with success/failure notifications.

## Usage

```ts
import { compileAOP } from '@borjie/aop-compiler';

const result = await compileAOP(naturalLanguageInput, {
  llm: yourLLMRouter,
  toolRegistry: yourBrainToolRegistry,
});

if (!result.ok) {
  // result.errors -> show to owner
} else {
  // result.skill   -> deploy to fleet
  // result.cron    -> register on scheduler
  // result.monitors-> register on event bus
  // result.hooks   -> register on approval kernel
  // result.diagram -> render Mermaid to owner UI
  // result.prose   -> show plain-English summary
}
```
