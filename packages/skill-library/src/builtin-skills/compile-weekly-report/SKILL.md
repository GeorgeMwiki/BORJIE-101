---
name: compile-weekly-report
description: Build a portfolio weekly report from entity-store data (rent collected, units occupied, maintenance throughput, arrears aged). Writes a `weekly_report` entity with attribute breakdown; pure read-derive-write skill.
when_to_use:
  - portfolio weekly recap due
  - operator asks for the weekly report
  - Friday end-of-week report
  - weekly KPI rollup
allowed_tools:
  - Read
  - Write
jurisdiction_aware: false
code_entrypoint: ./compile-weekly-report.skill.ts
version: 1.0.0
---

# Compile Weekly Report

Gathers seven-day aggregates from the entity-store across:

- **Rent collected**: sum of `rent_payment.amount` where `payment_date` in window.
- **Occupancy**: ratio of `unit.status === 'occupied'` to total units at snapshot time.
- **Maintenance throughput**: count of `maintenance_ticket.state` transitions to `closed`.
- **Arrears aged**: by bucket (0-30, 31-60, 61-90, 90+ days).

The skill is jurisdiction-neutral — currency is preserved as recorded
(no implicit conversion). If a downstream consumer wants a single display
currency, the user-currency preference chain takes over (see global
guidance).
