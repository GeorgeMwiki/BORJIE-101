# @borjie/fx-treasury-advisor

FX + treasury advisor for the Borjie mining stack. Reads cash balances
by currency, inflows / outflows by counterparty, off-take pricing
schedule, and BoT gold-window obligations from the LMBM. Produces a
cash-runway projection, FX-exposure map (TZS vs USD vs EUR), a
sell-vs-stockpile decision per ore stockpile, and a 27-Mar USD-cliff
remediation playbook (FX hedge, partial sell, accelerated invoice,
inter-account transfer). Writes back recommendations + a runway model
fact every time `analyze` is called. All numerics pure; ports for
LMBM, brain, FX rate feed, logger.
