# @borjie/mine-planner-advisor

Mine-planning advisor for Borjie. Reads site polygon geometry, crew
roster + skills, and equipment fleet (with availability windows) from
the LMBM. Produces a 24-hour or multi-day shift plan, a polygon-task
match, and equipment-to-task assignment ranking. Writes plan facts +
recommendations back to the LMBM with evidence pointers (which crew
member, which excavator, which polygon). Pure functions — caller
injects LMBM and logger ports.
