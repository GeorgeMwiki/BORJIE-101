// Mining Licence Application — Tumemadini (PML/PL) submission.
//
// MINING document class (Borjie is a mining-estate OS). Statutory basis:
// Mining Act, 2010 (Tanzania) + Mining (Mineral Rights) Regulations.
// Submitted to the Mining Commission of Tanzania (Tume ya Madini).
//
// SINGLE-LANGUAGE BY CONSTRUCTION (EN/SW absolute-toggle hard rail): ALL
// prose comes from `data.labels.*`, chosen by the builder per locale, so
// the document cannot mix languages. Every monetary figure arrives
// pre-formatted by the builder via formatCurrency — never built here.
//
// Data injected via `--input data=<json>` (see
// packages/document-studio/src/renderers/typst-renderer.ts).

#let data = json(bytes(sys.inputs.at("data", default: "{}")))
#let L = data.labels

#set page(paper: "a4", margin: 2.5cm)
#set text(font: "Liberation Serif", size: 11pt, lang: data.locale, region: "TZ")
#set par(justify: true, leading: 0.65em)
#set heading(numbering: none)

#align(center)[
  #text(weight: "bold", size: 15pt)[#L.title]
  #v(0.3em)
  #text(size: 10pt)[#L.statuteLine]
  #v(0.2em)
  #text(size: 10pt, style: "italic")[#L.commissionName]
]

#v(0.8em)

#grid(
  columns: (1fr, 1fr),
  [*#L.reference:* #data.submission.referenceNo],
  [#align(right)[*#L.date:* #data.submission.dateSubmitted]],
)
[*#L.licenceTypeLabel:* #data.licenceTypeDisplay]

#v(0.4em)
#line(length: 100%)

== #L.secApplicant

#L.name: *#data.applicant.name* \
#L.applicantTypeLabel: #data.applicantTypeDisplay \
#L.idTin: #data.applicant.idTin \
#L.nationality: #data.applicant.nationality \
#L.address: #data.applicant.address \
#if data.applicant.companyRegNo != "" [
  #L.companyRegNo: #data.applicant.companyRegNo \
]

== #L.secLicence

#L.primaryMineral: *#data.licence.primaryMineral* \
#if data.licence.otherMinerals != "" [#L.otherMinerals: #data.licence.otherMinerals \ ]
#L.area: #data.licence.areaHectares #L.hectares \
#L.duration: #data.licence.durationYears #L.years \
#L.region: #data.licence.region #h(0.6em) #L.district: #data.licence.district#if data.licence.ward != "" [ #h(0.6em) #L.ward: #data.licence.ward] \
#L.locality: #data.licence.localityDescription

== #L.secArea

#table(
  columns: (auto, 1fr, 1fr),
  align: (left, right, right),
  [*#L.colBeacon*], [*#L.colLatitude*], [*#L.colLongitude*],
  ..data.beacons.map(b => ([#b.beaconNo], [#b.latitude], [#b.longitude])).flatten()
)

== #L.secWork

#data.workProgramme.summary

#v(0.3em)
#L.proposedExpenditure: *#data.workProgramme.proposedExpenditure* \
#if data.workProgramme.equipment != "" [#L.equipment: #data.workProgramme.equipment \ ]
#if data.workProgramme.estimatedJobs != "" [#L.estimatedJobs: #data.workProgramme.estimatedJobs \ ]

== #L.secFees

#let baseRows = (
  ([#L.applicationFee], [#data.fees.applicationFee]),
  ([#L.annualRentPerHa], [#data.fees.annualRentPerHa]),
  ([#L.totalAnnualRent], [#data.fees.totalAnnualRent]),
)
#let prepRows = if data.fees.preparationFee != "" {
  (([#L.preparationFee], [#data.fees.preparationFee]),)
} else { () }
#let feeRows = baseRows + prepRows

#table(
  columns: (1fr, auto),
  align: (left, right),
  ..feeRows.flatten(),
  [*#L.totalPayable*], [*#data.fees.totalPayable*],
)

== #L.secDeclaration

#L.declarationBody

#v(1.4em)
#L.submittedBy: #data.submission.submittedBy

#v(1.8em)
#grid(
  columns: (1fr, 1fr),
  gutter: 1.5em,
  [#line(length: 90%) \ #L.signature],
  [#line(length: 90%) \ #L.date],
)

#v(1em)
#line(length: 100%)
#text(size: 8pt)[
  *#L.citationsTitle*

  #for (idx, c) in data.citations.enumerate() [
    #(idx + 1). #c.claim — #c.ref \
  ]

  #v(0.4em)
  #emph(L.advisoryNote)
]
