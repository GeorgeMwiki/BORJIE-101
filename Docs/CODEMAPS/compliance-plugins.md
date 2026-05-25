# Compliance Plugins Codemap

**Last Updated:** 2026-05-22
**Module:** `packages/compliance-plugins/`
**Public entry:** `packages/compliance-plugins/src/index.ts`
**Tier scope:** platform spine (country / jurisdiction layer)

## Purpose

Per-country compliance plug-ins for the property-management domain.
Each plug-in encapsulates jurisdiction-specific rules (deposit caps,
notice periods, tax IDs, ID-document validators, currency, statute
references) behind a single `CountryPlugin` interface so the rest of
the platform stays jurisdiction-neutral. Active plug-ins: Kenya,
Nigeria, South Africa, Tanzania, Uganda, USA, plus extended profiles
(Australia, Brazil, Canada, France, Germany, India, Japan, Korea,
Mexico).

## Entry points

- `src/index.ts` — exports `countryPluginRegistry`, all plug-in
  instances, validators, and the `withStateOverride()` helper.
- `core/registry.ts` — `CountryPluginRegistry` singleton.
- `core/types.ts` — `CountryPlugin` interface.
- `plugins/<country>.ts` — per-country implementations.
- `countries/index.ts` — `registerAllCountryPlugins()` boot helper.

## Internal structure

- `core/` — registry + interface types.
- `plugins/` — concrete implementations.
- `countries/` — bundled country profiles.
- `validators/` — ID-document, tax-ID, phone validators.
- `ports/` — repository ports for adapters that need persistence.
- `__tests__/` — coverage per plug-in.

## Dependencies

- Upstream: `@borjie/domain-models` (enums, schemas).
- Downstream: api-gateway, payments-ledger, central-intelligence
  (tier-policy resolver), domain-services.

## Common workflows

- **Add a new country** → create `plugins/<country>.ts` implementing
  `CountryPlugin`, register via `countries/index.ts`.
- **Resolve tenant defaults** → `getTenantCountryDefault(tenantId)`.
- **Apply state override (USA)** → `withStateOverride(plugin, state)`.

## Anti-patterns to avoid

- Never hardcode TZ/KE/NG rules in business logic — call the plug-in.
- Never bypass the registry — go via `countryPluginRegistry.get(code)`.
- Never mutate a plug-in at runtime — make a new one or override.

## Related codemaps

- [domain-models.md](./domain-models.md) — shared enums
- [database.md](./database.md) — tenant.country column
- [central-intelligence.md](./central-intelligence.md) — tier-policy resolver
