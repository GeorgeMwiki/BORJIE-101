// Eviction Notice — Tanzania (TZ)
//
// Statutory basis:
//   * Land Act, 1999 (Cap. 113) — see s.53 (notice requirements).
//   * Land (Forms) Regulations 2001 — prescribed-form references.
//   * Rent Restriction Act, Cap. 339 (where still applicable).
//
// Constitution clause: BORJIE_CONSTITUTION_V1 / C01-EVICTION-NOTICE
// (advisory only — requires human approval before service).
//
// Data is injected via `--input data=<json>` from
// `packages/document-studio/src/renderers/typst-renderer.ts`.
//
// Required fields (validated by data-schema.ts):
//   landlord.name, landlord.address
//   tenant.name, tenant.unit, tenant.address
//   property.name
//   breach.reason, breach.amountInArrears, breach.currencyCode
//   notice.dateIssued, notice.cureDeadline, notice.servedBy
//   citations[i].claim, citations[i].source.ref

#let data = json(bytes(sys.inputs.at("data", default: "{}")))

#set page(paper: "a4", margin: 2.5cm)
#set text(font: "Liberation Serif", size: 11pt, lang: "en", region: "TZ")
#set par(justify: true, leading: 0.65em)

#align(center)[
  #text(weight: "bold", size: 14pt)[NOTICE TO TERMINATE TENANCY]
  #v(0.5em)
  #text(size: 10pt)[Issued under the Land Act, 1999 (Cap. 113) — Tanzania]
]

#v(1em)

*Date:* #data.notice.dateIssued
#h(1fr) *Reference:* TZ-EVICT-#data.tenant.unit

#v(1em)

*To:* #data.tenant.name \
#data.tenant.address \
Unit #data.tenant.unit, #data.property.name

#v(1em)

*From:* #data.landlord.name \
#data.landlord.address

#v(1.5em)

Dear #data.tenant.name,

You are hereby given notice to terminate your tenancy of the premises
described above, on the grounds set out below, in accordance with
Section 53 of the Land Act, 1999.

== Grounds for termination

The reason for this notice is:

#text(weight: "bold")[#data.breach.reason]

#if "amountInArrears" in data.breach and data.breach.amountInArrears > 0 [
  The amount in arrears as of the date of this notice is
  *#data.breach.currencyCode #data.breach.amountInArrears.*
]

== Cure period

You have until *#data.notice.cureDeadline* to remedy the breach
described above. If the breach is not remedied within that period,
the landlord will take steps to recover possession of the premises
under the procedures laid down in the Land Act, 1999 and any
applicable regulations.

== Tenant's rights

Nothing in this notice waives any right you may have to apply to the
Resident Magistrate's Court or the District Land and Housing Tribunal
for relief, or to dispute the grounds set out above.

#v(2em)

Issued at Dar es Salaam this #data.notice.dateIssued by:

#v(2em)

\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ \
#data.notice.servedBy \
for and on behalf of #data.landlord.name

#v(1.5em)

#line(length: 100%)
#text(size: 8pt)[
  *Citations and sources*

  #for (idx, c) in data.citations.enumerate() [
    [##{idx + 1}] #c.claim — #c.source.ref \
  ]

  This notice is generated under the BORJIE Constitution clause
  C01-EVICTION-NOTICE (advisory only; requires human approval before service).
]
