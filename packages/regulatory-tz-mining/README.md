# @borjie/regulatory-tz-mining

Tanzania mining-regulator rule engine adapter. Bundles rule sets for
NEMC (EPP / EIA), Tumemadini / Mining Commission (PML / PL / SML /
ML), Bank of Tanzania (gold window + FX), TRA (royalty, corporate,
withholding tax), and GePG (Government electronic Payment Gateway).
Reads licence registry, EIA approvals, gold-window receipts, tax
filings, and GePG control-number history from the LMBM and emits a
compliance verdict per rule plus prioritised actions. Pure rule
evaluation — no I/O — caller wires LMBM and logger ports.

Rule content is intentionally minimal in this scaffold; many rules
carry TODO markers pointing at the underlying regulator citation that
still needs to be looked up and encoded.
