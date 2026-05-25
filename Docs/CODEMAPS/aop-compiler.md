# AOP Compiler Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/aop-compiler/`
**Public entry:** `packages/aop-compiler/src/index.ts`
**Tier scope:** cognitive core (Agent-Oriented Programming compiler)

## Purpose

Compiles a high-level Agent-Oriented Programming (AOP) DSL into the
brain's executable plan format. An AOP source describes goals,
preconditions, agent capabilities, and policy constraints
declaratively; the compiler parses → validates → renders into a
runnable plan that the central-intelligence kernel can execute via
its multi-agent debate / LATS planner.

## Entry points

- `src/index.ts` — barrel.
- `src/types.ts` — AST + compiled-plan types.
- `src/parser/` — tokenizer + parser for the AOP DSL.
- `src/validator/` — semantic checks (capability bindings,
  policy references).
- `src/compiler/` — IR generation.
- `src/renderer/` — emits the kernel-runnable plan format.

## Internal structure

- `parser/` — grammar + AST builder.
- `validator/` — `AOPValidationError` + checks.
- `compiler/` — `compile(ast)` core.
- `renderer/` — kernel-plan emitter.
- `__tests__/` — unit + golden-file tests per stage.

## Dependencies

- Upstream: zod, `@borjie/domain-models`.
- Downstream: central-intelligence (planner), agent-platform.

## Common workflows

- **Compile an AOP file** →
  `parse(source) → validate(ast) → compile(validated) → render(ir)`.
- **Add a new capability** → declare in domain-models, add validator
  rule, extend renderer.
- **Debug a plan** → run with `--trace` to dump IR stages.

## Anti-patterns to avoid

- Never skip the validator — bad IR crashes the kernel later.
- Never emit a plan referencing capabilities that aren't declared
  in the validator's capability registry.
- Never mutate AST nodes — produce new ones.

## Related codemaps

- [central-intelligence.md](./central-intelligence.md) — runs compiled plans
- [agent-platform.md](./agent-platform.md) — capability registry
- [domain-models.md](./domain-models.md) — shared types
