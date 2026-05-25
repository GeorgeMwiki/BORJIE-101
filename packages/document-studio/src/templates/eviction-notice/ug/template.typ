// Eviction Notice — Uganda (UG)
//
// Statutory basis:
//   * Rent Restriction Act, Cap. 231 — protected residential tenancies.
//   * Land Act, Cap. 227 — recovery of possession of land.
//   * Magistrates Courts Act, Cap. 16 — small-cause proceedings.
//
// Constitution clause: C01-EVICTION-NOTICE
// (advisory only — requires human approval before service).
//
// Default notice period: 30 days for monthly tenancies unless the
// written agreement specifies otherwise; longer for fixed-term
// tenancies with notice-to-quit provisions.

#let data = json(bytes(sys.inputs.at("data", default: "{}")))

#set page(paper: "a4", margin: 2.5cm)
#set text(font: "Liberation Serif", size: 11pt, lang: "en", region: "UG")
#set par(justify: true, leading: 0.65em)

#align(center)[
  #text(weight: "bold", size: 14pt)[NOTICE TO QUIT AND DELIVER UP POSSESSION]
  #v(0.4em)
  #text(size: 10pt)[
    Issued under the Rent Restriction Act, Cap. 231, and the Land Act,
    Cap. 227 — Republic of Uganda
  ]
]

#v(1em)

*Date issued:* #data.notice.dateIssued
#h(1fr) *Reference:* UG-EVICT-#data.tenant.unit

#v(1em)

*To:* #data.tenant.name \
#data.tenant.address \
Unit #data.tenant.unit, #data.property.name

#v(1em)

*From:* #data.landlord.name \
#data.landlord.address

#v(1.5em)

TAKE NOTICE that the landlord requires possession of the premises
described above. You are required to deliver up vacant possession of
the premises on or before the cure date set out below.

== Grounds

#text(weight: "bold")[#data.breach.reason]

#if "amountInArrears" in data.breach and data.breach.amountInArrears > 0 [
  Outstanding rent as at #data.notice.dateIssued:
  *#data.breach.currencyCode #data.breach.amountInArrears.*
  This amount is due and payable in addition to any costs of recovery.
]

== Cure period

You have until *#data.notice.cureDeadline* to remedy the breach. If
the breach is not cured by that date, the landlord intends to
institute proceedings before the appropriate Magistrate's Court for
an order of vacant possession together with mesne profits, costs and
interest as the court may award.

== Tenant's rights

You may apply to the court for relief against forfeiture or to
contest any allegation contained in this notice within the time
permitted by law.

#v(2em)

DATED at Kampala this #data.notice.dateIssued.

#v(2em)

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ \
#data.notice.servedBy \
on behalf of #data.landlord.name

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
