# @borjie/mcp-server

> The Model Context Protocol (MCP) server for Borjie. Exposes the
> kernel's tools + prompts + resources to external MCP clients (Claude
> Desktop, Cursor, third-party agents) over the 2025-11-25 MCP spec
> (Tasks, Sampling, URL Elicitation).

## Why this package exists

The kernel's HQ tool catalogue is the most powerful surface Borjie
ships. Internally it powers the Central Command brain. Externally,
the MCP server exposes a curated subset to:

- Tenant power users via Claude Desktop
- Partner integrations via custom MCP clients
- Borjie's own staff for ad-hoc tooling

Every external invocation passes the same identity + tier + policy
gates as an internal kernel turn. There is no privileged backdoor.

## Surface

### Tools

Defined in `src/tool-registry.ts`. Each tool has:

- A canonical name (e.g. `platform.list_tenants`, `lease.summarize`)
- Zod-schema validated input
- Risk tier (read / mutate / destroy / billing / external-comm)
- Tenant-scope enforcement at the adapter

External clients see only tools the calling identity is authorised for.

### Prompts

Defined in `src/prompts.ts`. Curated workflows for common
multi-step interactions:

- `monthly-close-review` — walk an admin through reviewing a close
- `tenant-onboarding-kyc` — guide KYC capture
- `lease-renegotiation-draft` — produce a counter-offer draft

Prompts are templated; MCP clients fill placeholders before send.

### Resources

Defined in `src/mcp-resources.ts`. Read-only context surfaces:

- `tenant://current` — current tenant context
- `lease://{leaseId}` — lease document + history
- `report://{reportId}` — generated report bundle

## Tier router

`src/tier-router.ts` enforces per-API-key tier ceilings:

| Tier | Monthly request budget | Max risk tier exposed | Use case |
|---|---|---|---|
| `free` | 100 | `read` only | Demo / evaluation |
| `standard` | 10,000 | `read` + `mutate` | Routine tenant integration |
| `premium` | 100,000 | + `external-comm` | High-volume partner |
| `enterprise` | unlimited | + `destroy` + `billing` (with four-eye) | Strategic partner |

Requests exceeding the tier cap surface 429. Budget reset is per
calendar month (UTC).

## Adding a new MCP tool

1. **Define the tool** in `src/tool-registry.ts`:

   ```ts
   export const myToolSpec = {
     name: "domain.action",
     description: "What it does.",
     inputSchema: z.object({ ... }),
     riskTier: "read" as const,
     handler: async (input, ctx) => { ... }
   };
   ```

2. **Wire to the kernel adapter** in `src/universal-tool-adapter.ts`
   so the same tool is callable internally and externally.

3. **Add tier mapping** in `src/tier-router.ts` if the new tier
   should constrain access.

4. **Document the cost** in `src/cost-persistence.ts` — track
   monthly spend per API key.

5. **Add tests** in `src/__tests__/`. Required:
   - Happy path with valid input
   - Auth failure (wrong API key)
   - Tier-cap violation (over budget)
   - Tenant-isolation cross-check

6. **Document in `Docs/API_SPEC.yaml`** so OpenAPI ships the route.

## Authentication

API keys via `MCP_API_KEY` (single key) or `MCP_API_KEYS`
(comma-separated for multi-tenant). Per-key HMAC verification in
`src/mcp-auth.ts`. Keys map to `(tenantId, tier, scopes)` triples in
the `mcp_api_keys` table.

Rotation: generate new key, dual-write for 7 days, retire old.

## Configuration

```bash
MCP_ENABLED=true
MCP_API_KEY=<single-key>                    # OR
MCP_API_KEYS=<comma-separated>
MCP_RATE_LIMIT=30                           # requests per minute per key
MCP_DEFAULT_TIER=standard
MCP_MONTHLY_BUDGET_USD=500                  # cost ceiling
MCP_HEALTH_CHECK_INTERVAL_S=300
```

## Testing

```bash
pnpm -F @borjie/mcp-server test
```

End-to-end against a local Claude Desktop install: see
`Docs/UAT_WALKTHROUGH.md` § "MCP smoke".

## Related

- `Docs/API_SPEC.yaml`
- `packages/central-intelligence/README.md` — kernel-side tools
- `Docs/RATE_LIMITS.md`
- `Docs/COMPLIANCE/DPA_TEMPLATE.md` (sub-processor / API-key auditability)
