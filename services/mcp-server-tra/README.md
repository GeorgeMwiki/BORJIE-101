# @borjie/mcp-server-tra

Tanzania Revenue Authority MCP server. Surfaces TIN lookup, royalty + corporate-tax calculators, VAT-return submission, and outstanding-tax balance queries as Model Context Protocol tools the BORJIE mining Master Brain can call from any mode prompt.

Per the BossNyumba parity audit this replaces the deleted Nigerian `mcp-server-firs` adapter with its Tanzanian regulator equivalent. Port: **3110**.

## Tools

| # | Name | Purpose | Real / stub |
|---|---|---|---|
| 1 | `tra.lookup_tin` | TIN registry lookup (business name, status, registration date, tax office) | stub |
| 2 | `tra.compute_royalty` | Mineral royalty using Mining Act Sixth Schedule rates (gold 6 %, diamond 5 %, base metals 3 %, ...) | real computation |
| 3 | `tra.compute_corporate_tax` | CIT at 30 % standard or 25 % mining-qualifying preferential rate | real computation |
| 4 | `tra.submit_vat_return` | Submit a VAT return for a tenant + tax period (YYYY-MM); returns `VAT-YYYY-MM-XXXXXX` | stub |
| 5 | `tra.fetch_outstanding` | Outstanding tax balance for a TIN, broken down by tax head | stub |

All input + output payloads are Zod-validated. Stub payloads carry `_stub: true` and a `note` field so downstream renderers and audit logs can tell a stubbed call apart from a real one. Real computation tools carry `_stub: false`.

## Transports

| Transport | When | Endpoint |
|---|---|---|
| Hono HTTP | always (default port 3110) | `GET /healthz`, `GET /tools`, `POST /tools/:name` |
| MCP stdio | when env `MCP_TRA_STDIO=1` | stdin/stdout via `@modelcontextprotocol/sdk` |

The HTTP transport is the integration path for the api-gateway fallback in `services/api-gateway/src/composition/mining-tool-stubs.ts`. The MCP stdio transport is for when an MCP-aware client (Claude Desktop, the api-gateway MCP client) spawns the binary directly.

## Example

```bash
curl http://localhost:3110/tools | jq '.tools[].name'

curl -X POST http://localhost:3110/tools/tra.compute_royalty \
     -H 'content-type: application/json' \
     -d '{"mineral":"gold","gross_value_tzs":250000000}' | jq
```

## Tanzanian context (mock data shape)

- TIN format: `112-XXX-XXX` (the leading `112` segment is the country/issuance series).
- VAT period format: `YYYY-MM` (TRA's e-filing period code).
- Royalty rates: per the Sixth Schedule of the Mining Act CAP 123 (as amended).
- Currency: **TZS** throughout.

## Build & run

```bash
pnpm --filter @borjie/mcp-server-tra build
pnpm --filter @borjie/mcp-server-tra start

# or docker:
docker build -t borjie/mcp-server-tra:dev .
docker run --rm -p 3110:3110 borjie/mcp-server-tra:dev
```

## TODO

- Wire the real TRA e-filing endpoints (TIN, VAT, arrears) — MVP3+, see api-gateway TODO(#35).
- Add Pulumi/Helm chart once the real endpoints are mTLS-gated.
