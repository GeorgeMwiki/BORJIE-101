# @borjie/domain-services

Core business-logic services: leases, inspections (FAR, conditional survey, move-out), negotiations, damage deductions, station-master routing, document rendering. Deterministic rules run first; AI personas are invoked only after policy gates pass.

## Run

```bash
pnpm --filter @borjie/domain-services dev
```

Organized by feature under `src/` (negotiation, inspections, routing, documents, cases).
