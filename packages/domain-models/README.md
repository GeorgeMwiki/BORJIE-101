# @borjie/domain-models

Shared TypeScript types and Zod schemas for the Borjie mining-estate domain (MiningSite, MiningUnit, Offtake, Counterparty, Payment, Royalty/Regulatory, Inspection, etc.). Consumed by services, API client, and frontends so every boundary speaks the same shape.

## Usage

```ts
import { Offtake, type Offtake as OfftakeType } from '@borjie/domain-models'

const offtake: OfftakeType = Offtake.createOfftake(/* … */)
```

## Regulatory rule sets

Per-jurisdiction mining statutes (TZ Mining Act 2010, KE Mining Act 2016) live under `src/regulatory/` as pure data and are exported via `REGULATORY_RULE_SETS` for the kernel's regulatory-mirror policy gate.
