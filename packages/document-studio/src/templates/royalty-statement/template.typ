// Mineral Royalty Statement — per-shipment royalty computation.
//
// MINING document class (Borjie is a mining-estate OS). Royalty assessed
// under the Mining Act, 2010 (Tanzania). Per-shipment royalty +
// inspection-fee and the totals are computed in the BUILDER; this
// template only lays out the result.
//
// SINGLE-LANGUAGE BY CONSTRUCTION (EN/SW absolute-toggle hard rail): ALL
// prose comes from `data.labels.*`, chosen by the builder per locale.
// Every monetary figure arrives pre-formatted via formatCurrency.
//
// Data injected via `--input data=<json>` (see
// packages/document-studio/src/renderers/typst-renderer.ts).

#let data = json(bytes(sys.inputs.at("data", default: "{}")))
#let L = data.labels

#set page(paper: "a4", margin: 2.2cm)
#set text(font: "Liberation Serif", size: 11pt, lang: data.locale, region: "TZ")
#set par(justify: true, leading: 0.65em)
#set heading(numbering: none)

#align(center)[
  #text(weight: "bold", size: 15pt)[#L.title]
  #v(0.3em)
  #text(size: 10pt)[#L.statuteLine]
]

#v(0.6em)

#grid(
  columns: (1fr, 1fr),
  [*#L.statementNo:* #data.statement.statementNo \
   *#L.period:* #data.statement.periodStart — #data.statement.periodEnd],
  [#align(right)[*#L.dateIssued:* #data.statement.dateIssued]],
)

#v(0.3em)
#line(length: 100%)

== #L.secProducer

#L.name: *#data.producer.name* \
#L.licenceNo: #data.producer.licenceNo \
#L.tin: #data.producer.tin \
#L.address: #data.producer.address

== #L.secShipments

#text(size: 9pt)[
  #table(
    columns: (auto, auto, auto, auto, auto, auto, auto),
    align: (left, left, left, right, right, right, right),
    [*#L.colRef*], [*#L.colDate*], [*#L.colMineral*], [*#L.colQuantity*],
    [*#L.colGrossValue*], [*#L.colRate*], [*#L.colRoyalty*],
    ..data.shipments.map(s => (
      [#s.ref], [#s.date], [#s.mineral], [#s.quantity],
      [#s.grossValue], [#s.rate], [#s.royalty],
    )).flatten()
  )
]

== #L.secTotals

#let totalRows = (
  ([#L.totalGrossValue], [#data.totals.totalGrossValue]),
  ([#L.totalRoyalty], [#data.totals.totalRoyalty]),
)
#let inspRows = if data.hasInspection {
  (([#L.totalInspection], [#data.totals.totalInspection]),)
} else { () }
#let allRows = totalRows + inspRows

#table(
  columns: (1fr, auto),
  align: (left, right),
  ..allRows.flatten(),
  [*#L.totalPayable*], [*#data.totals.totalPayable*],
)

#v(1.4em)
#L.issuedBy: #data.statement.issuedBy

#v(1.8em)
#grid(
  columns: (1fr, 1fr),
  gutter: 1.5em,
  [#line(length: 90%) \ #L.signature],
  [#line(length: 90%) \ #L.dateIssued],
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
