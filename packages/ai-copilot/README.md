# @borjie/ai-copilot

AI persona runtime for Borjie. Owns prompt templates, provider adapters (Anthropic by default), deterministic-before-LLM gates, and the `BrainRegistry` that domain services pull personas from.

## Usage

```ts
import { BrainRegistry } from '@borjie/ai-copilot'

const brain = BrainRegistry.forTenant(orgId)
const result = await brain.persona('negotiation').run({ input, policy })
```

See `src/providers/` for provider adapters and `src/services/migration/` for the CSV/XLSX ingest copilot.
