# @borjie/graph-sync

Event-sourced graph projection sync. Subscribes to domain events and materializes read-optimized views for dashboards and AI persona context fetches.

## Usage

```ts
import { startGraphSync } from '@borjie/graph-sync'

await startGraphSync({ consumerGroup: 'owner-portal-projections' })
```
