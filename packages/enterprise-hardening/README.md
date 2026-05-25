# @borjie/enterprise-hardening

Cross-cutting security middleware: rate limiting, CSRF, request signing, audit logging hooks, secret rotation helpers. Mounted by the API gateway.

## Usage

```ts
import { applyHardening } from '@borjie/enterprise-hardening'

applyHardening(app, { rateLimit: { windowMs: 60_000, max: 120 } })
```
