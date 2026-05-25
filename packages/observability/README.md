# @borjie/observability

Centralized logger, metrics, and tracing primitives. Every service imports its logger from here so tenant-id, request-id, and trace-id flow consistently through logs and metrics.

## Usage

```ts
import { createLogger, counter, span } from '@borjie/observability'

const log = createLogger({ service: 'payments', orgId })
log.info('payment.received', { amount, currency })

const paymentsProcessed = counter('payments_processed_total', ['provider', 'status'])
paymentsProcessed.inc({ provider: 'mpesa', status: 'success' })

await span('payments.reconcile', async () => { /* ... */ })
```
