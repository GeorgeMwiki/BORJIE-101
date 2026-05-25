-- =============================================================================
-- 0221: routing_rules_seed — Seed 17 platform default routing rules.
--
-- One row per (entity_type, intent) pair from
-- `Docs/architecture/PIECE_L_BRAIN_TAB_LOOP.md` §4. All rows have
-- tenant_id = NULL (platform default), hitl_required = TRUE
-- (conservative — proposals require human acceptance at Rung 2-3),
-- and min_confidence = 0.78 (matches policy_gate.autoWriteThreshold).
--
-- Tenants override these by inserting their own rows with non-NULL
-- tenant_id (and typically priority >= 200 to beat the platform
-- default's priority = 100).
-- =============================================================================

INSERT INTO routing_rules (
  id, tenant_id, entity_type, intent, module_template_id, action,
  payload_template, min_confidence, hitl_required, priority
) VALUES
  -- 1. Building × ASSET_CLAIM → ESTATE.create_lease_application
  ('rr_seed_001', NULL, 'Building', 'ASSET_CLAIM', 'ESTATE',
   'create_lease_application',
   '{"unit_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 2. Vehicle × ASSET_CLAIM → FLEET.create_assignment
  ('rr_seed_002', NULL, 'Vehicle', 'ASSET_CLAIM', 'FLEET',
   'create_assignment',
   '{"vehicle_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 3. Person × PAYMENT_OBSERVED → FINANCE.post_receipt_draft
  ('rr_seed_003', NULL, 'Person', 'PAYMENT_OBSERVED', 'FINANCE',
   'post_receipt_draft',
   '{"payer_id":"{{entity_id}}","amount":"{{amount}}"}'::jsonb,
   0.78, TRUE, 100),

  -- 4. Unit × MAINTENANCE_REPORTED → ESTATE.open_maintenance_case
  ('rr_seed_004', NULL, 'Unit', 'MAINTENANCE_REPORTED', 'ESTATE',
   'open_maintenance_case',
   '{"unit_id":"{{entity_id}}","summary":"{{summary}}"}'::jsonb,
   0.78, TRUE, 100),

  -- 5. Person × HIRE_INTENT → HR.start_onboarding_workflow
  ('rr_seed_005', NULL, 'Person', 'HIRE_INTENT', 'HR',
   'start_onboarding_workflow',
   '{"person_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 6. Person × TERMINATION_INTENT → HR.start_offboarding_workflow
  ('rr_seed_006', NULL, 'Person', 'TERMINATION_INTENT', 'HR',
   'start_offboarding_workflow',
   '{"person_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 7. Lease × RENEWAL_INTENT → ESTATE.schedule_renewal_negotiation
  ('rr_seed_007', NULL, 'Lease', 'RENEWAL_INTENT', 'ESTATE',
   'schedule_renewal_negotiation',
   '{"lease_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 8. Document × LEGAL_REVIEW_REQUEST → LEGAL.route_to_counsel
  ('rr_seed_008', NULL, 'Document', 'LEGAL_REVIEW_REQUEST', 'LEGAL',
   'route_to_counsel',
   '{"document_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 9. Building × VALUATION_TRIGGER → STRATEGY.request_valuation_run
  ('rr_seed_009', NULL, 'Building', 'VALUATION_TRIGGER', 'STRATEGY',
   'request_valuation_run',
   '{"building_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 10. Vendor × INVOICE_RECEIVED → PROCUREMENT.create_invoice_draft
  ('rr_seed_010', NULL, 'Vendor', 'INVOICE_RECEIVED', 'PROCUREMENT',
   'create_invoice_draft',
   '{"vendor_id":"{{entity_id}}","amount":"{{amount}}"}'::jsonb,
   0.78, TRUE, 100),

  -- 11. Inventory × LOW_STOCK_OBSERVED → INVENTORY.create_reorder_proposal
  ('rr_seed_011', NULL, 'Inventory', 'LOW_STOCK_OBSERVED', 'INVENTORY',
   'create_reorder_proposal',
   '{"sku_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 12. Lease × BREACH_OBSERVED → LEGAL.open_breach_case
  ('rr_seed_012', NULL, 'Lease', 'BREACH_OBSERVED', 'LEGAL',
   'open_breach_case',
   '{"lease_id":"{{entity_id}}","details":"{{summary}}"}'::jsonb,
   0.78, TRUE, 100),

  -- 13. Person × COMPLAINT_FILED → CRM.open_complaint_ticket
  ('rr_seed_013', NULL, 'Person', 'COMPLAINT_FILED', 'CRM',
   'open_complaint_ticket',
   '{"person_id":"{{entity_id}}","subject":"{{summary}}"}'::jsonb,
   0.78, TRUE, 100),

  -- 14. Person × LEAD_OBSERVED → CRM.create_lead
  ('rr_seed_014', NULL, 'Person', 'LEAD_OBSERVED', 'CRM',
   'create_lead',
   '{"person_id":"{{entity_id}}"}'::jsonb, 0.78, TRUE, 100),

  -- 15. Property × COMPLIANCE_GAP → COMPLIANCE.open_compliance_task
  ('rr_seed_015', NULL, 'Property', 'COMPLIANCE_GAP', 'COMPLIANCE',
   'open_compliance_task',
   '{"property_id":"{{entity_id}}","gap":"{{summary}}"}'::jsonb,
   0.78, TRUE, 100),

  -- 16. Date × DEADLINE_OBSERVED → STRATEGY.add_executive_calendar_item
  ('rr_seed_016', NULL, 'Date', 'DEADLINE_OBSERVED', 'STRATEGY',
   'add_executive_calendar_item',
   '{"due_date":"{{entity_id}}","title":"{{summary}}"}'::jsonb,
   0.78, TRUE, 100),

  -- 17. Amount × BUDGET_OVERRUN → FINANCE.flag_variance_alert
  ('rr_seed_017', NULL, 'Amount', 'BUDGET_OVERRUN', 'FINANCE',
   'flag_variance_alert',
   '{"variance_amount":"{{entity_id}}","period":"{{period}}"}'::jsonb,
   0.78, TRUE, 100)
ON CONFLICT (id) DO NOTHING;

-- Post-condition assertion: 17 platform default rows present (NULL tenant_id).
-- (Cannot RAISE inside an INSERT — wrapped in DO block for guarantee.)
DO $$
DECLARE
  cnt INT;
BEGIN
  SELECT COUNT(*) INTO cnt
    FROM routing_rules
    WHERE tenant_id IS NULL
      AND id LIKE 'rr_seed_%';
  IF cnt < 17 THEN
    RAISE EXCEPTION
      'routing_rules seed failed: expected ≥17 platform default rows, got %.', cnt;
  END IF;
  RAISE NOTICE 'routing_rules: % platform default rows present.', cnt;
END
$$;
