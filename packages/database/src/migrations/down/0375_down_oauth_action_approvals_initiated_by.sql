-- Down for 0375: drop oauth_action_approvals.initiated_by.
-- Dev/staging only. Reverses the ADD COLUMN so the table shape matches
-- its pre-0375 state. The column carried the four-eye initiator identity;
-- dropping it forfeits durable separation-of-duties recovery for any
-- pending rows, so run only in non-production environments.
ALTER TABLE oauth_action_approvals
  DROP COLUMN IF EXISTS initiated_by;
