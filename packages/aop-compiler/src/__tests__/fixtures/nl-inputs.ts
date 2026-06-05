/**
 * Natural-language inputs that should compile to the three reference AOPs.
 *
 * Used by parser tests: the test injects a stub LLM that, given any of these
 * inputs, returns the corresponding fixture AST encoded as JSON.
 */

export const ROYALTY_ARREARS_CHASE_NL = `
Every month, on day 25 at 9am Dar es Salaam time, look at all buyers whose
royalty payment is 7+ days outstanding. For each, send a friendly reminder.
If they don't pay within 3 days, escalate to a phone call. If still no
payment in 7 days, ask me to approve drafting a supply-suspension notice.
`.trim();

export const OFFTAKE_RENEWAL_NL = `
60 days before any offtake agreement ends, draft a renewal offer. Ask me to
approve. If approved, send to the buyer. If they sign within 30 days, record
the new agreement. If they don't sign in 30 days, escalate by calling.
`.trim();

export const TRA_FILING_NL = `
On day 5 of each month at 6am Dar es Salaam time, compile the previous
month's royalty-return batch and file it via the TRA MCP. When TRA confirms
(within 24h), send a success notification to the owner. If filing fails, send
a high-priority failure notification.
`.trim();
