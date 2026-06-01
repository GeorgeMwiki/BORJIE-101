---
name: compile-weekly-report
description: Build a portfolio weekly report from entity-store data (royalty collected, assets producing, maintenance throughput, outstanding royalties aged). Writes a `weekly_report` entity with attribute breakdown; pure read-derive-write skill.
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

- **Royalty collected**: sum of `royalty_payment.amount` where `payment_date` in window.
- **Production utilisation**: ratio of `asset.status === 'producing'` to total assets at snapshot time.
- **Maintenance throughput**: count of `maintenance_ticket.state` transitions to `closed`.
- **Outstanding royalties aged**: by bucket (0-30, 31-60, 61-90, 90+ days).

The skill is jurisdiction-neutral — currency is preserved as recorded
(no implicit conversion). If a downstream consumer wants a single display
currency, the user-currency preference chain takes over (see global
guidance).
