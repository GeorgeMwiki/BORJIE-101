# @borjie/mcp-server-process-intel

Sandboxed **Model Context Protocol** server that clones the **Microsoft Power Automate Process Mining** 9-tool grammar (Apr 2026 MCP release), backed by `pm4py` (Inductive Miner-infrequent + Split Miner) inside an isolated Python sidecar.

It powers the **OBSERVE → MAP** stages of the junior-replacement pipeline: the MD (or any MCP-aware agent) can call these tools to discover processes, locate bottlenecks, check conformance, surface rework loops, and detect concept drift against per-tenant activity logs.

---

## The 9 tools

| # | Tool name | What it answers |
|---|---|---|
| 1 | `process_intel.get_processes` | Which processes do we have data for? |
| 2 | `process_intel.get_bottleneck_analysis` | Where does this process slow down? |
| 3 | `process_intel.get_variants_with_metrics` | What are the variants of this process? (frequency + duration) |
| 4 | `process_intel.get_correlation` | Which case attributes correlate with cycle time? |
| 5 | `process_intel.get_conformance` | Token-replay against a normative model |
| 6 | `process_intel.get_loop_analysis` | Where are the loops / rework cycles? |
| 7 | `process_intel.get_handoff_matrix` | Who passes work to whom? (social network) |
| 8 | `process_intel.get_cycle_time_distribution` | Cycle-time histogram + percentiles |
| 9 | `process_intel.get_drift_alerts` | Concept drift across rolling windows |

Each tool ships a JSON-Schema `inputSchema` so any MCP client can discover its parameters via `tools/list`. Output shapes are documented inline in `src/tools/*.ts` and surfaced as `outputSchema` for downstream renderers.

---

## License segregation (CRITICAL)

`pm4py` is **AGPL-3.0**. This package is **MIT**. We keep the licenses cleanly separated by a **process boundary**:

```
+----------------------------------+        stdin/stdout         +-------------------------------+
| Node + TypeScript (MIT)          |     JSON lines              | Python venv (AGPL-3.0)        |
|  src/index.ts                    |  <-------------------->     |  python/server.py             |
|  src/pm4py-client.ts             |                             |  /opt/pm4py-venv/lib/...      |
+----------------------------------+                             +-------------------------------+
```

- The TypeScript code **never** imports any `pm4py` symbol.
- pm4py runs in its own `python3` child process with its own venv at `/opt/pm4py-venv`.
- We communicate via JSON-line frames over `stdin`/`stdout` (`Pm4pyClient` in `src/pm4py-client.ts`).
- The Dockerfile installs pm4py in **stage 1** only; **stage 2** (Node build) and **stage 3** (runtime) never see the AGPL source, only the opaque venv directory and the `python/server.py` script.

This is the **AGPL § 13 segregation pattern**: as long as the AGPL'd code runs in a separate process and exchanges data only over IPC, the rest of the codebase is not subject to AGPL's copyleft.

**Hard rules** (enforced by code review):
- Do **not** add `pm4py` (or any AGPL dep) to `package.json`.
- Do **not** vendor any pm4py source into this package's `src/`.
- Do **not** bundle Python source into a JS bundle (tsup config excludes `python/`).

---

## How it fits into BORJIE

```
+---------------------+        MCP        +-------------------------------+
|   api-gateway       |  <-------------   |  mcp-server-process-intel     |
|                     |  (HTTP/SSE)       |                               |
|  composition/       |                   |  Node MCP server  +  pm4py    |
|  mcp-client-process |                   |                   sidecar     |
|  -intel.ts          |                   |                               |
+---------------------+                   +-------------------------------+
         |
         | registers 9 BrainToolSpecs in the
         | kernel's BrainToolRegistry under
         | the `process_intel.*` namespace
         v
   central-intelligence
   (the MD calls them)
```

When env `MCP_PROCESS_INTEL_URL` is set on the api-gateway, the composition root in `services/api-gateway/src/composition/mcp-client-process-intel.ts` spawns an MCP client connection and threads the 9 tools into the kernel's `BrainToolRegistry`. When the env is unset, the tools are registered as graceful `NOT_IMPLEMENTED` stubs so other surfaces don't break.

---

## Setup

### Local (TS only — no pm4py needed for tests)

```bash
pnpm --filter @borjie/mcp-server-process-intel install
pnpm --filter @borjie/mcp-server-process-intel typecheck
pnpm --filter @borjie/mcp-server-process-intel test
```

### Local with the Python sidecar

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements.txt
pnpm --filter @borjie/mcp-server-process-intel build
node dist/index.js  # stdio MCP server, awaits commands
```

### Docker

```bash
docker compose up --build
# MCP HTTP endpoint: http://localhost:7401
```

---

## Adding a tool

1. Create `src/tools/<tool_name>.ts` exporting a `ProcessIntelTool<I, O>` with `inputSchema`, `outputSchema`, and `execute()`.
2. Register it in `src/tools/index.ts` (add to `PROCESS_INTEL_TOOLS`).
3. Add the matching Python handler to `python/server.py`'s `_HANDLERS` dict.
4. Add `__tests__/tools/<tool_name>.test.ts` with a mocked `Pm4pyClient`.
5. (Optional) Wire it into the kernel via `services/api-gateway/src/composition/mcp-client-process-intel.ts`.

The MS PA grammar is intentionally fixed at 9 tools, so additions should be additive (e.g. namespaced as `process_intel_ext.*`).

---

## References

- Microsoft Power Automate Process Mining MCP server — https://learn.microsoft.com/en-us/power-automate/process-mining/mcp
- pm4py docs — https://pm4py.fit.fraunhofer.de/
- MCP spec — https://modelcontextprotocol.io/
