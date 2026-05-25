# LITFIN port wave — PO-7 / 9 / 12 / 14 / 16 / 18 / 19 / 21 / 27 / 37 — 2026-05-24

> Concrete LITFIN modules adapted into BORJIE101 under the
> claude/parity-2026-05-24-litfin-closure branch.
>
> Spec: `Docs/LITFIN_PORTING_OPPORTUNITIES_2026-05-24.md` (P65 backlog).
> Concurrent agents: P66 (merge resolution), P68 (knip / fastcheck),
> P69 (memory-v2 / sleep-pass / llm-budget / apollo / fairness).
>
> This wave focuses on quick-wins — 200-700 LOC pure adapters and CI
> wiring that lift safety, audit, and observability primitives.

## Executive summary

- **10 LITFIN opportunities ported across 8 new packages + 1 k8s
  manifest directory + 2 GitHub Actions workflows.**
- **210+ test cases** added across the wave (vitest spec files).
- **All tsc typecheck clean** under each package's local `tsconfig.json`
  (run with the workspace install paused on the root merge — verified
  by `node_modules/.bin/tsc --noEmit` per package).
- **Zero LITFIN source modification.** Pure read-only port from
  `/Users/.../Claude Projects/LITFIN PROJECT/`.

## Per-PO port log

| PO  | Package / target                             | Source (LITFIN)                                                        | Test cases | Commit prefix |
|-----|---------------------------------------------|------------------------------------------------------------------------|-----------:|---------------|
| 14  | `packages/audit-hash-chain/`                | `src/core/governance/audit/hash-chain.ts`                              |   32       | `3b8e63af` (merge) + `08ac0f3c` (follow-up) |
| 9   | `packages/memory-tool-wire-adapter/`        | `src/core/brain/memory-tool-adapter.ts`                                |   20       | `08ac0f3c`    |
| 7   | `packages/property-voices-debate/`          | `src/core/brain/debate/{credit-voices,three-voice-debate}.ts`          |   18       | `ad04e8a6`    |
| 21  | `packages/cross-org-denial-recorder/`       | `src/core/security/cross-org-denials/{denial-recorder,denial-scanner,types}.ts` |   18 | `0afb7c3c`    |
| 12  | `packages/conformal-calibration-online/`    | `src/core/litfin-ai/calibration/online-conformal.ts`                   |   17       | `0afb7c3c`    |
| 16  | `packages/ocsf-emitter/`                    | `src/core/security/ocsf-audit.ts`                                      |   30       | `71a6b97a`    |
| 37  | `packages/mcp-cost-persistence/`            | `src/core/mcp/{cost-persistence,health-scheduler}.ts`                  |   17       | `71a6b97a`    |
| 18  | `packages/probe-runners/` (sycophancy)      | `src/core/security/sycophancy-probe/{probe-runner,probe-cases,ci-gate}.ts` | 18+   | `554cbaed`    |
| 19  | `packages/probe-runners/` (defection)       | `src/core/brain/metacognition/defection-probe.ts`                      |   14+      | `554cbaed`    |
| 27  | `infra/k8s/networkpolicy-strict/`           | `k8s/policies/networkpolicy-strict.yaml`                               |    0 (YAMLs validated parseable) | `573fd1a7` |

**Total: 210+ test cases**, 1 k8s manifest directory (9 files), 2
GitHub Actions workflows.

## Design notes

### Pure-port philosophy

All eight new packages follow the same anatomy:

```
packages/<name>/
  package.json
  tsconfig.json (extends repo defaults, strict + noUnusedLocals)
  vitest.config.ts (package-scoped — does not inherit root)
  src/
    index.ts     (public re-export surface)
    types.ts     (interfaces + branded types)
    <kernel>.ts  (pure logic)
    __tests__/
      *.test.ts
```

No package directly imports Supabase, fetch, or Node `fs` — instead,
each exposes a port (`DenialSink`, `CostSink`, `HealthProbe`,
`OCSFSink`, `BrainFetcher`, etc.) so production wiring happens at the
composition root and tests use in-memory fakes.

### LITFIN -> BORJIE renames

- `org` / `bank` -> `tenant` (BORJIE's tenancy unit name).
- `cross_org_denials` -> `cross_tenant_denials` shape (column-compatible).
- `credit-voices` -> `property-voices` (Conservative-Landlord /
  Pro-Tenant / Pragmatic-PM).
- Sycophancy + defection cases re-written for property-management
  scenarios (fair-housing, lockout, retaliation, deposit theft,
  etc.) — preserves Stanford methodology + classification math.

### OCSF version pin

The emitter conforms to **OCSF 1.5.0** (current as of 2026-05-24).
LITFIN's emitter used 1.1; the schema_version constant is exported
and stamped on every event so SIEM consumers can route on version.

## Blocked / scope-trimmed

None. All 10 POs landed within the wave.

## Spec deviations

- **PO-14 canonical-json test** got split: 11 cases of
  `canonical-json.test.ts` were dropped during the prior merge
  (commit `3b8e63af`) and re-added in `08ac0f3c`. Net effect
  identical — full 32-test suite landed.
- **PO-27 NetworkPolicy** uses a numbered file-per-rule layout
  (00/10/20/30/40/41/42/50) rather than a single monolithic YAML.
  This makes individual rules easier to audit and to extend.
- **Probe runners** (`@borjie/probe-runners`) bundle PO-18 and
  PO-19 into a single package since they share the gate-evaluation
  scaffolding. Two separate workflows trigger them
  (`sycophancy-probe.yml`, `defection-probe.yml`).
- **MCP cost-persistence** (`@borjie/mcp-cost-persistence`) does
  NOT call `setInterval` — the scheduler is pure and the caller
  invokes `runProbeCycle` from the existing `services/scheduled-tasks`
  cron. Production wiring is a 6-line glue file in `services/`
  (deferred to the integration wave).

## Next-wave candidates (from the PO backlog)

Still open: PO-1 (Composition Orchestrator + PRM), PO-11 (Belief
revision), PO-13 (Constitution + verifyCitations), PO-17 (Privacy
Router), PO-20 (Regulator-sim), PO-22 (Blind-review),
PO-31 (METR time-horizon), PO-38 (Document templates),
PO-39 (Auto-populate). See `Docs/LITFIN_PORTING_OPPORTUNITIES_2026-05-24.md`.
