// Eviction Notice — Nigeria (NG)
//
// Statutory basis (Lagos State, indicative — replicate per state):
//   * Tenancy Law of Lagos State, 2011 — s.13 (statutory quit notice).
//   * Recovery of Premises Law (in states that have retained it).
//
// Statutory quit notice periods (Lagos):
//   * Tenant at will: 1 week.
//   * Weekly tenant: 1 week.
//   * Monthly tenant: 1 month.
//   * Quarterly tenant: 3 months.
//   * Half-yearly tenant: 3 months.
//   * Yearly tenant: 6 months.
//
// Followed by a 7-day notice of owner's intention to apply to the
// court for recovery of possession.
//
// Constitution clause: C01-EVICTION-NOTICE
// (advisory only — requires human approval before service).

#let data = json(bytes(sys.inputs.at("data", default: "{}")))

#set page(paper: "a4", margin: 2.5cm)
#set text(font: "Liberation Serif", size: 11pt, lang: "en", region: "NG")
#set par(justify: true, leading: 0.65em)

#align(center)[
  #text(weight: "bold", size: 14pt)[
    STATUTORY QUIT NOTICE
  ]
  #v(0.4em)
  #text(size: 10pt)[
    Issued under the Tenancy Law of Lagos State, 2011 (s.13) — Federal
    Republic of Nigeria
  ]
]

#v(1em)

*Date issued:* #data.notice.dateIssued
#h(1fr) *Reference:* NG-EVICT-#data.tenant.unit

#v(1em)

*To:* #data.tenant.name \
#data.tenant.address \
Unit #data.tenant.unit, #data.property.name

#v(1em)

*From:* #data.landlord.name \
#data.landlord.address

#v(1.5em)

TAKE NOTICE that the landlord requires you to quit and deliver up
possession of the premises described above on or before the cure
date set out below.

== Grounds

#text(weight: "bold")[#data.breach.reason]

#if "amountInArrears" in data.breach and data.breach.amountInArrears > 0 [
  Outstanding rent as at #data.notice.dateIssued:
  *#data.breach.currencyCode #data.breach.amountInArrears.*
  This sum is due and recoverable in addition to mesne profits and
  costs of recovery.
]

== Cure period

You have until *#data.notice.cureDeadline* to remedy the breach. If
you fail to do so the landlord will serve a 7-day owner's notice of
intention to apply to the Magistrate's Court for recovery of
possession in accordance with the Tenancy Law.

== Tenant's rights

You may attend court on the return date and dispute these
proceedings. Nothing in this notice prejudices any defence,
counter-claim or right of set-off you may have under the lease or at
law.

#v(2em)

DATED at Lagos this #data.notice.dateIssued.

#v(2em)

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ \
#data.notice.servedBy \
solicitor / agent for #data.landlord.name

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
