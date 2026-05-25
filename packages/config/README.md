# @borjie/config

Typed, validated environment loader. Wraps `zod` so every service consumes a strongly-typed `config` object and fails fast at boot if required env vars are missing.

## Usage

```ts
import { loadConfig } from '@borjie/config'

const config = loadConfig()
// config.DATABASE_URL, config.REDIS_URL, config.JWT_SECRET — all typed + validated
```
