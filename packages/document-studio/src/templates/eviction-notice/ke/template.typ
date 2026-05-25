// Eviction Notice — Kenya (KE)
//
// Statutory basis:
//   * Land Act, 2012 (No. 6 of 2012) — s.152 (notice to terminate
//     periodic tenancies of agricultural and other land).
//   * Distress for Rent Act, Cap. 293 (recovery of unpaid rent).
//   * Landlord and Tenant (Shops, Hotels & Catering Establishments)
//     Act, Cap. 301 — for protected business tenancies (notice 60 days).
//
// Constitution clause: C01-EVICTION-NOTICE
// (advisory only — requires human approval before service).
//
// Minimum notice periods (residential periodic tenancy):
//   * Monthly tenancy: 30 days written notice.
//   * Weekly tenancy: 1 week written notice.

#let data = json(bytes(sys.inputs.at("data", default: "{}")))

#set page(paper: "a4", margin: 2.5cm)
#set text(font: "Liberation Serif", size: 11pt, lang: "en", region: "KE")
#set par(justify: true, leading: 0.65em)

#align(center)[
  #text(weight: "bold", size: 14pt)[NOTICE TO TERMINATE TENANCY]
  #v(0.4em)
  #text(size: 10pt)[Issued under the Land Act, 2012 (s.152) — Republic of Kenya]
]

#v(1em)

*Date issued:* #data.notice.dateIssued
#h(1fr) *Reference:* KE-EVICT-#data.tenant.unit

#v(1em)

*To:* #data.tenant.name \
#data.tenant.address \
Unit #data.tenant.unit, #data.property.name

#v(1em)

*From:* #data.landlord.name \
#data.landlord.address

#v(1.5em)

Dear #data.tenant.name,

TAKE NOTICE that the tenancy under which you occupy the above premises
is hereby terminated. You are required to give up vacant possession
of the premises on or before the date set out below.

== Grounds

#text(weight: "bold")[#data.breach.reason]

#if "amountInArrears" in data.breach and data.breach.amountInArrears > 0 [
  Outstanding rent as at #data.notice.dateIssued:
  *#data.breach.currencyCode #data.breach.amountInArrears.*
  This amount remains due and recoverable under the Distress for Rent
  Act, Cap. 293, in addition to vacant possession of the premises.
]

== Cure period and possession

You have until *#data.notice.cureDeadline* to remedy the breach. If the
breach is not cured by that date, the landlord intends to apply to
the Environment and Land Court (or the Business Premises Rent
Tribunal where applicable) for an order for vacant possession,
together with all costs, mesne profits and interest.

== Your rights

You have the right to be heard. You may apply to the Environment and
Land Court for relief from forfeiture, or to dispute any factual
matter set out above, within the statutory time limits.

#v(2em)

DATED at Nairobi this #data.notice.dateIssued.

#v(2em)

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ \
#data.notice.servedBy \
duly authorised on behalf of #data.landlord.name

#v(1.5em)

#line(length: 100%)
#text(size: 8pt)[
  *Citations and sources*

  #for (idx, c) in data.citations.enumerate() [
    [##{idx + 1}] #c.claim — #c.source.ref \
  ]

  Generated under BORJIE Constitution clause C01-EVICTION-NOTICE
  (advisory only; requires human approval before service).
]
