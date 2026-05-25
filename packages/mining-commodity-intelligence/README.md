# @borjie/mining-commodity-intelligence

Mining commodity intelligence. Reads spot + forward prices via plug-in
source adapters (LME REST, Kitco gold spot) and derives trend signals,
percent-change windows, and off-take pricing-band recommendations for
the Borjie LMBM. Writes intel snapshots + recommendations with adapter
citations so every claim is traceable to a source. Adapters are stubs
in this scaffold — TODO swap to real REST clients once API keys are
provisioned.
