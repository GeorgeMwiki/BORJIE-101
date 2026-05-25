/**
 * Natural-language inputs that should compile to the three reference AOPs.
 *
 * Used by parser tests: the test injects a stub LLM that, given any of these
 * inputs, returns the corresponding fixture AST encoded as JSON.
 */

export const ARREARS_CHASE_NL = `
Every month, on day 25 at 9am Nairobi time, look at all tenants whose rent
is 7+ days late. For each, send a friendly reminder. If they don't pay
within 3 days, escalate to a phone call. If still no payment in 7 days,
ask me to approve drafting an eviction notice.
`.trim();

export const LEASE_RENEWAL_NL = `
60 days before any lease ends, draft a renewal offer. Ask me to approve.
If approved, send to the tenant. If they sign within 30 days, record the
new lease. If they don't sign in 30 days, escalate by calling.
`.trim();

export const KRA_FILING_NL = `
On day 5 of each month at 6am Nairobi time, compile the previous month's
MRI batch and file it via the KRA MCP. When KRA confirms (within 24h),
send a success notification to the owner. If filing fails, send a
high-priority failure notification.
`.trim();
