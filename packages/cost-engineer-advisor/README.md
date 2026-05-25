# @borjie/cost-engineer-advisor

Mining cost-engineer advisor for Borjie. Reads operational facts from
the Live Mining Business Model (LMBM) — production tonnes, OPEX
buckets (labour, fuel, consumables, royalties), CAPEX schedule, sales
prices — and produces a structured P&L, cost-per-tonne decomposition,
unit-economic ratios, and break-even sensitivity tables. Writes
back evidence-backed recommendations (e.g. "fuel cost is 38% of opex,
14% above benchmark — investigate dispatch routing") with citation
ids so downstream agents and the audit chain can verify every claim.
All numerical work is pure; brain, LMBM access, and observability are
injected as ports.
