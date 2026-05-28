# Borjie Blackboard Curriculum — element vocabulary per literacy step

Mr. Mwikila's blackboard is bilingual sw/en and pulls from the
5-step mining literacy ladder. Below is the canonical move-set the
brain composes from. Each block is one `<board_add>` payload the
LLM emits inside the chat stream.

## Step 1 — ORIENT (what is Borjie, what's on my plate, who does what)

1. `diagram.flow` — ORIENT → LICENCE → ROYALTY → WORKFORCE → MARKETPLACE
   ladder, 5 nodes left to right. Tap any node to drill down.
2. `text.headline` — "Borjie is your operating system, not a tool."
   (sw: "Borjie ni mfumo wako wa uendeshaji, si kifaa.")
3. `diagram.tree` — Master Brain → 27 juniors (licence-watcher,
   royalty-drafter, FX-hedger, workforce-supervisor, NEMC-clerk,
   BoT-clerk, marketplace-matcher, …) grouped by domain.
4. `comparison` — Solo owner vs. owner-with-Borjie: "27 juniors you
   cannot afford to hire full-time".
5. `chart.donut` — Time saved per week per owner (target band 12-18h).

## Step 2 — LICENCE (PML / ML / SML calendar, Mining Commission)

6. `image` — Cross-section of a typical PML pit, labelled (overburden,
   ore zone, sump, haul road, blast zone).
7. `text.normal` — "A PML covers up to 10 hectares. Annual renewal,
   form filed 60 days before expiry."
8. `diagram.flow` — Mining Commission renewal cycle: trigger 60d
   out → PML form generation → owner signature → submission →
   acknowledgement → renewed PML.
9. `chart.bar` — Your PMLs by days-to-expiry (color-coded warning
   for ≤47d).
10. `diagram.tree` — Filing hierarchy: BRELA (entity) → Mining
    Commission (licence) → NEMC (environment) → TRA (royalty) →
    BoT (FX).

## Step 3 — ROYALTY (monthly draft mechanics, mineral codes, rates)

11. `formula` — `royalty = grade-correct rate × tonnage × spot price`.
    Variables glossed (gold 6%, gemstones 6%, polished gem 1%,
    industrial 3%, coal 3%, salt 3%).
12. `chart.bar` — Your monthly royalty draft last 12 months vs LBMA
    fix peer p50.
13. `comparison` — File today vs hold for audit (cost / risk / time).
14. `diagram.flow` — Mineral code → region code → parcel manifest →
    TRA filing → audit-chain stamp.
15. `text.emphasis` — "Filing late triggers a 5% penalty plus
    interest. Most owners lose more here than they realise."
16. `formula` — `late_penalty = 5% × royalty + interest_compounded_daily`.

## Step 4 — WORKFORCE (shifts, attendance, fuel, incidents, safety)

17. `diagram.flow` — Pit safety three-layer: blast-safety briefing →
    ICA-certified operator → daily attendance + fuel log.
18. `chart.line` — Open incidents per week (rolling 12 weeks) with
    target band.
19. `diagram.tree` — Crew roster: supervisor → drill operator → blast
    leader → haul-truck driver → loader operator.
20. `chart.donut` — Fuel consumption split: drilling / hauling /
    pumping / loading.
21. `text.normal` — "Incident reports feed the NEMC quarterly safety
    filing automatically."

## Step 5 — MARKETPLACE & TREASURY (parcels, buyers, FX, LBMA, BoT)

22. `diagram.flow` — Chain of custody: pit → assayer → smelter →
    exporter → buyer (with hash-chain stamps at every hop).
23. `chart.line` — LBMA gold fix intraday vs BoT gold-window FX
    swing (two series, last 24h).
24. `comparison` — Vetted buyer match (Borjie) vs phone-tag routing
    (ICA-Brussels manual, 2-3 weeks).
25. `formula` — `parcel_price = LBMA_fix × parcel_grade_fraction ×
    tonnage − buyer_margin`.
26. `chart.bar` — USD exposure ladder by month (un-hedged vs hedged).

## Cross-step — ESTATE & SUCCESSION (when the owner asks "wider")

27. `formula` — `net_worth = sum(estate_assets.current_value) −
    sum(encumbrances)`.
28. `diagram.tree` — Succession: principal → designated successor →
    contingency tier 1 → contingency tier 2.
29. `diagram.flow` — Intercompany flow: mining co → transport
    subsidiary → processing JV → family-office holdco.
30. `comparison` — Hold subsidiary (estate) vs sell (one-off cash).

## Highlight + arrow moves (paired with any prior element)

- `highlight.warning` on the royalty bar of the latest month if the
  draft is overdue.
- `highlight.positive` on a successfully filed PML renewal in the
  licence calendar.
- `arrow` from "you are here" PML to "expires in 47 days" annotation.
- `arrow` from LBMA-fix series to your draft royalty bar (causal
  link: "price rose, your draft jumped").

## Sketch moves (rare, used for memorable lessons)

- A hand-drawn arrow from the smelter to the BoT gold window: "this
  is where the FX clock starts".
- A circled "ICA grading" annotation on the chain-of-custody
  diagram during a teaching beat about gemstones.

## Replay anchors

Every block carries an `atMs` (relative to the user message's
arrival). The owner taps "Replay" → the renderer walks `atMs` in
order and reveals each block on schedule. The same ordered list is
exported to PDF as a one-page handout (handout-grade lesson the
owner keeps).
