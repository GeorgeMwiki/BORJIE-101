# @borjie/capacity-expansion-advisor

Capacity-expansion advisor. Reads current production, current capex
spent, and forward LMBM forecasts. Models three named expansion
scenarios — sinking a new shaft, opening a new site, processing-plant
upgrade — discounting cash flows to compute NPV, IRR, and payback for
each. Writes a ranked recommendation with evidence per scenario.
Pure; ports for LMBM and logger.
