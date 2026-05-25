-- BORJIE Initial Schema Migration
-- Creates core tables: tenants, organizations, users, roles, properties, units, customers, leases, invoices, payments, transactions, work_orders, vendors

-- ============================================================================
-- Enums
-- ============================================================================

CREATE TYPE tenant_status AS ENUM ('active', 'suspended', 'pending', 'trial', 'cancelled');
CREATE TYPE subscription_tier AS ENUM ('starter', 'professional', 'enterprise', 'custom');
CREATE TYPE user_status AS ENUM ('pending_activation', 'active', 'suspended', 'deactivated');
CREATE TYPE session_status AS ENUM ('active', 'expired', 'revoked');
CREATE TYPE property_type AS ENUM ('apartment_complex', 'single_family', 'multi_family', 'townhouse', 'commercial', 'mixed_use', 'estate', 'other');
CREATE TYPE property_status AS ENUM ('draft', 'active', 'inactive', 'under_maintenance', 'sold', 'archived');
CREATE TYPE unit_type AS ENUM ('studio', 'one_bedroom', 'two_bedroom', 'three_bedroom', 'four_plus_bedroom', 'penthouse', 'duplex', 'loft', 'commercial_retail', 'commercial_office', 'warehouse', 'parking', 'storage', 'other');
CREATE TYPE unit_status AS ENUM ('vacant', 'occupied', 'reserved', 'under_maintenance', 'not_available');
CREATE TYPE customer_status AS ENUM ('prospect', 'applicant', 'approved', 'active', 'former', 'blacklisted');
CREATE TYPE id_document_type AS ENUM ('national_id', 'passport', 'driving_license', 'military_id', 'voter_id', 'work_permit', 'other');
CREATE TYPE kyc_status AS ENUM ('pending', 'in_review', 'verified', 'rejected', 'expired');
CREATE TYPE lease_status AS ENUM ('draft', 'pending_approval', 'approved', 'active', 'expiring_soon', 'expired', 'terminated', 'renewed', 'cancelled');
CREATE TYPE lease_type AS ENUM ('fixed_term', 'month_to_month', 'short_term', 'corporate', 'student', 'subsidized');
CREATE TYPE rent_frequency AS ENUM ('weekly', 'bi_weekly', 'monthly', 'quarterly', 'semi_annually', 'annually');
CREATE TYPE termination_reason AS ENUM ('end_of_term', 'mutual_agreement', 'tenant_request', 'landlord_request', 'non_payment', 'lease_violation', 'property_sale', 'property_damage', 'eviction', 'other');
CREATE TYPE invoice_status AS ENUM ('draft', 'pending', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'cancelled', 'void', 'written_off');
CREATE TYPE invoice_type AS ENUM ('rent', 'deposit', 'utilities', 'maintenance', 'late_fee', 'other');
CREATE TYPE payment_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'partially_refunded');
CREATE TYPE payment_method AS ENUM ('mpesa', 'bank_transfer', 'card', 'cash', 'cheque', 'other');
CREATE TYPE transaction_type AS ENUM ('charge', 'payment', 'credit', 'adjustment', 'refund', 'write_off', 'deposit_hold', 'deposit_release');
CREATE TYPE work_order_priority AS ENUM ('low', 'medium', 'high', 'urgent', 'emergency');
CREATE TYPE work_order_status AS ENUM ('submitted', 'triaged', 'assigned', 'scheduled', 'in_progress', 'pending_parts', 'completed', 'verified', 'reopened', 'cancelled');
CREATE TYPE work_order_category AS ENUM ('plumbing', 'electrical', 'hvac', 'appliance', 'structural', 'pest_control', 'landscaping', 'cleaning', 'security', 'other');
CREATE TYPE work_order_source AS ENUM ('customer_request', 'inspection', 'preventive', 'emergency', 'manager_created');
CREATE TYPE vendor_status AS ENUM ('active', 'inactive', 'probation', 'suspended', 'blacklisted');

-- ============================================================================
-- Updated_at Trigger Function
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Tenants
-- ============================================================================

CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status tenant_status NOT NULL DEFAULT 'pending',
  subscription_tier subscription_tier NOT NULL DEFAULT 'starter',
  primary_email TEXT NOT NULL,
  primary_phone TEXT,
  address_line1 TEXT,
  address_line2 TEXT,
  city TEXT,
  state TEXT,
  postal_code TEXT,
  country TEXT DEFAULT 'KE',
  settings JSONB DEFAULT '{}',
  billing_settings JSONB DEFAULT '{}',
  max_users INTEGER DEFAULT 5,
  max_properties INTEGER DEFAULT 10,
  max_units INTEGER DEFAULT 100,
  current_users INTEGER DEFAULT 0,
  current_properties INTEGER DEFAULT 0,
  current_units INTEGER DEFAULT 0,
  trial_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ,
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX tenants_slug_idx ON tenants(slug);
CREATE INDEX tenants_status_idx ON tenants(status);
CREATE INDEX tenants_created_at_idx ON tenants(created_at);

CREATE TRIGGER tenants_updated_at
  BEFORE UPDATE ON tenants
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Organizations
-- ============================================================================

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  level INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX organizations_tenant_idx ON organizations(tenant_id);
CREATE UNIQUE INDEX organizations_code_tenant_idx ON organizations(tenant_id, code);
CREATE INDEX organizations_parent_idx ON organizations(parent_id);
CREATE INDEX organizations_path_idx ON organizations(path);

CREATE TRIGGER organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Users
-- ============================================================================

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  organization_id TEXT REFERENCES organizations(id),
  email TEXT NOT NULL,
  phone TEXT,
  password_hash TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  status user_status NOT NULL DEFAULT 'pending_activation',
  is_owner BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  mfa_secret TEXT,
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  password_changed_at TIMESTAMPTZ,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  invitation_token TEXT,
  invitation_expires_at TIMESTAMPTZ,
  invited_by TEXT,
  last_login_at TIMESTAMPTZ,
  last_activity_at TIMESTAMPTZ,
  last_login_ip TEXT,
  preferences JSONB DEFAULT '{}',
  timezone TEXT DEFAULT 'UTC',
  locale TEXT DEFAULT 'en',
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX users_tenant_idx ON users(tenant_id);
CREATE UNIQUE INDEX users_email_tenant_idx ON users(tenant_id, email);
CREATE INDEX users_org_idx ON users(organization_id);
CREATE INDEX users_status_idx ON users(status);
CREATE UNIQUE INDEX users_invitation_token_idx ON users(invitation_token) WHERE invitation_token IS NOT NULL;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Roles
-- ============================================================================

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '[]',
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX roles_tenant_idx ON roles(tenant_id);
CREATE UNIQUE INDEX roles_name_tenant_idx ON roles(tenant_id, name);
CREATE INDEX roles_system_idx ON roles(is_system);

CREATE TRIGGER roles_updated_at
  BEFORE UPDATE ON roles
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- User Roles
-- ============================================================================

CREATE TABLE user_roles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by TEXT
);

CREATE UNIQUE INDEX user_roles_user_role_idx ON user_roles(user_id, role_id);
CREATE INDEX user_roles_tenant_idx ON user_roles(tenant_id);

-- ============================================================================
-- Sessions
-- ============================================================================

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status session_status NOT NULL DEFAULT 'active',
  ip_address TEXT NOT NULL,
  user_agent TEXT,
  device_info JSONB DEFAULT '{}',
  mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  revoked_by TEXT
);

CREATE INDEX sessions_tenant_idx ON sessions(tenant_id);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_status_idx ON sessions(status);
CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);

-- ============================================================================
-- Properties
-- ============================================================================

CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id),
  property_code TEXT NOT NULL,
  name TEXT NOT NULL,
  type property_type NOT NULL,
  status property_status NOT NULL DEFAULT 'draft',
  description TEXT,
  address_line1 TEXT NOT NULL,
  address_line2 TEXT,
  city TEXT NOT NULL,
  state TEXT,
  postal_code TEXT,
  country TEXT NOT NULL DEFAULT 'KE',
  latitude DECIMAL(10, 8),
  longitude DECIMAL(11, 8),
  total_units INTEGER NOT NULL DEFAULT 0,
  occupied_units INTEGER NOT NULL DEFAULT 0,
  vacant_units INTEGER NOT NULL DEFAULT 0,
  default_currency TEXT NOT NULL DEFAULT 'KES',
  amenities JSONB DEFAULT '[]',
  features JSONB DEFAULT '{}',
  manager_id TEXT REFERENCES users(id),
  management_notes TEXT,
  images JSONB DEFAULT '[]',
  documents JSONB DEFAULT '[]',
  year_built INTEGER,
  acquired_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX properties_tenant_idx ON properties(tenant_id);
CREATE UNIQUE INDEX properties_code_tenant_idx ON properties(tenant_id, property_code);
CREATE INDEX properties_owner_idx ON properties(owner_id);
CREATE INDEX properties_status_idx ON properties(status);
CREATE INDEX properties_type_idx ON properties(type);
CREATE INDEX properties_city_idx ON properties(city);

CREATE TRIGGER properties_updated_at
  BEFORE UPDATE ON properties
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Units
-- ============================================================================

CREATE TABLE units (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_code TEXT NOT NULL,
  name TEXT NOT NULL,
  type unit_type NOT NULL,
  status unit_status NOT NULL DEFAULT 'vacant',
  description TEXT,
  floor INTEGER,
  building TEXT,
  wing TEXT,
  square_meters DECIMAL(10, 2),
  bedrooms INTEGER DEFAULT 0,
  bathrooms DECIMAL(3, 1) DEFAULT 0,
  base_rent_amount INTEGER NOT NULL,
  base_rent_currency TEXT NOT NULL DEFAULT 'KES',
  deposit_amount INTEGER,
  amenities JSONB DEFAULT '[]',
  features JSONB DEFAULT '{}',
  furnishing TEXT DEFAULT 'unfurnished',
  utilities_included JSONB DEFAULT '[]',
  images JSONB DEFAULT '[]',
  floor_plan TEXT,
  current_lease_id TEXT,
  current_customer_id TEXT,
  last_inspection_date TIMESTAMPTZ,
  next_inspection_due TIMESTAMPTZ,
  inspection_notes TEXT,
  available_from TIMESTAMPTZ,
  minimum_lease_term INTEGER,
  maximum_lease_term INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX units_tenant_idx ON units(tenant_id);
CREATE INDEX units_property_idx ON units(property_id);
CREATE UNIQUE INDEX units_code_property_idx ON units(property_id, unit_code);
CREATE INDEX units_status_idx ON units(status);
CREATE INDEX units_type_idx ON units(type);
CREATE INDEX units_current_lease_idx ON units(current_lease_id);

CREATE TRIGGER units_updated_at
  BEFORE UPDATE ON units
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Customers
-- ============================================================================

CREATE TABLE customers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_code TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  alternate_phone TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  middle_name TEXT,
  date_of_birth TIMESTAMPTZ,
  nationality TEXT,
  occupation TEXT,
  employer TEXT,
  employer_address TEXT,
  monthly_income INTEGER,
  income_currency TEXT DEFAULT 'KES',
  status customer_status NOT NULL DEFAULT 'prospect',
  kyc_status kyc_status NOT NULL DEFAULT 'pending',
  kyc_verified_at TIMESTAMPTZ,
  kyc_verified_by TEXT,
  kyc_expires_at TIMESTAMPTZ,
  kyc_notes TEXT,
  id_document_type id_document_type,
  id_document_number TEXT,
  id_document_expires_at TIMESTAMPTZ,
  id_document_front_url TEXT,
  id_document_back_url TEXT,
  current_address_line1 TEXT,
  current_address_line2 TEXT,
  current_city TEXT,
  current_state TEXT,
  current_postal_code TEXT,
  current_country TEXT,
  emergency_contact_name TEXT,
  emergency_contact_relationship TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_email TEXT,
  "references" JSONB DEFAULT '[]',
  blacklisted_at TIMESTAMPTZ,
  blacklisted_reason TEXT,
  blacklisted_by TEXT,
  preferred_contact_method TEXT DEFAULT 'email',
  marketing_opt_in BOOLEAN DEFAULT FALSE,
  sms_notifications BOOLEAN DEFAULT TRUE,
  email_notifications BOOLEAN DEFAULT TRUE,
  portal_access_enabled BOOLEAN DEFAULT TRUE,
  portal_last_login TIMESTAMPTZ,
  avatar_url TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX customers_tenant_idx ON customers(tenant_id);
CREATE UNIQUE INDEX customers_code_tenant_idx ON customers(tenant_id, customer_code);
CREATE UNIQUE INDEX customers_email_tenant_idx ON customers(tenant_id, email);
CREATE INDEX customers_phone_tenant_idx ON customers(tenant_id, phone);
CREATE INDEX customers_status_idx ON customers(status);
CREATE INDEX customers_kyc_status_idx ON customers(kyc_status);
CREATE INDEX customers_name_idx ON customers(first_name, last_name);

CREATE TRIGGER customers_updated_at
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Vendors
-- ============================================================================

CREATE TABLE vendors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  vendor_code TEXT NOT NULL,
  company_name TEXT NOT NULL,
  status vendor_status NOT NULL DEFAULT 'active',
  specializations JSONB DEFAULT '[]',
  service_areas JSONB DEFAULT '[]',
  contacts JSONB DEFAULT '[]',
  rate_cards JSONB DEFAULT '[]',
  performance_metrics JSONB DEFAULT '{}',
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  emergency_available BOOLEAN NOT NULL DEFAULT FALSE,
  license_number TEXT,
  insurance_expiry_date TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX vendors_tenant_idx ON vendors(tenant_id);
CREATE UNIQUE INDEX vendors_code_tenant_idx ON vendors(tenant_id, vendor_code);
CREATE INDEX vendors_status_idx ON vendors(status);
CREATE INDEX vendors_preferred_idx ON vendors(is_preferred);
CREATE INDEX vendors_emergency_idx ON vendors(emergency_available);

CREATE TRIGGER vendors_updated_at
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Leases
-- ============================================================================

CREATE TABLE leases (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  customer_id TEXT NOT NULL REFERENCES customers(id),
  lease_number TEXT NOT NULL,
  lease_type lease_type NOT NULL DEFAULT 'fixed_term',
  status lease_status NOT NULL DEFAULT 'draft',
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  move_in_date TIMESTAMPTZ,
  move_out_date TIMESTAMPTZ,
  rent_amount INTEGER NOT NULL,
  rent_currency TEXT NOT NULL DEFAULT 'KES',
  rent_frequency rent_frequency NOT NULL DEFAULT 'monthly',
  rent_due_day INTEGER NOT NULL DEFAULT 1,
  grace_period_days INTEGER NOT NULL DEFAULT 5,
  late_fee_type TEXT DEFAULT 'fixed',
  late_fee_amount INTEGER DEFAULT 0,
  late_fee_percentage DECIMAL(5, 2) DEFAULT 0,
  max_late_fee INTEGER,
  security_deposit_amount INTEGER NOT NULL DEFAULT 0,
  security_deposit_paid INTEGER NOT NULL DEFAULT 0,
  security_deposit_refunded INTEGER DEFAULT 0,
  deposit_refund_date TIMESTAMPTZ,
  deposit_refund_notes TEXT,
  primary_occupant JSONB NOT NULL,
  additional_occupants JSONB DEFAULT '[]',
  max_occupants INTEGER DEFAULT 4,
  pets_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  pet_deposit INTEGER DEFAULT 0,
  pet_rent INTEGER DEFAULT 0,
  pet_details JSONB DEFAULT '[]',
  utilities_included_in_rent JSONB DEFAULT '[]',
  utility_responsibility TEXT DEFAULT 'tenant',
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  renewal_term_months INTEGER DEFAULT 12,
  renewal_rent_increase DECIMAL(5, 2) DEFAULT 0,
  renewal_notice_required INTEGER DEFAULT 30,
  terminated_at TIMESTAMPTZ,
  termination_reason termination_reason,
  termination_notes TEXT,
  terminated_by TEXT,
  notice_given_date TIMESTAMPTZ,
  notice_period_days INTEGER DEFAULT 30,
  move_out_inspection_date TIMESTAMPTZ,
  move_out_inspection_notes TEXT,
  deductions_from_deposit INTEGER DEFAULT 0,
  deduction_details JSONB DEFAULT '[]',
  lease_document_url TEXT,
  signed_by_tenant BOOLEAN DEFAULT FALSE,
  tenant_signed_at TIMESTAMPTZ,
  signed_by_landlord BOOLEAN DEFAULT FALSE,
  landlord_signed_at TIMESTAMPTZ,
  signature_method TEXT,
  previous_lease_id TEXT REFERENCES leases(id),
  special_terms TEXT,
  custom_clauses JSONB DEFAULT '[]',
  current_balance INTEGER DEFAULT 0,
  last_payment_date TIMESTAMPTZ,
  last_payment_amount INTEGER,
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  activated_at TIMESTAMPTZ,
  activated_by TEXT,
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX leases_tenant_idx ON leases(tenant_id);
CREATE UNIQUE INDEX leases_number_tenant_idx ON leases(tenant_id, lease_number);
CREATE INDEX leases_property_idx ON leases(property_id);
CREATE INDEX leases_unit_idx ON leases(unit_id);
CREATE INDEX leases_customer_idx ON leases(customer_id);
CREATE INDEX leases_status_idx ON leases(status);
CREATE INDEX leases_start_date_idx ON leases(start_date);
CREATE INDEX leases_end_date_idx ON leases(end_date);

CREATE TRIGGER leases_updated_at
  BEFORE UPDATE ON leases
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Invoices
-- ============================================================================

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  lease_id TEXT REFERENCES leases(id),
  property_id TEXT REFERENCES properties(id),
  unit_id TEXT REFERENCES units(id),
  invoice_number TEXT NOT NULL,
  invoice_type invoice_type NOT NULL DEFAULT 'rent',
  status invoice_status NOT NULL DEFAULT 'draft',
  issue_date TIMESTAMPTZ NOT NULL,
  due_date TIMESTAMPTZ NOT NULL,
  period_start TIMESTAMPTZ,
  period_end TIMESTAMPTZ,
  subtotal_amount INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  discount_amount INTEGER NOT NULL DEFAULT 0,
  total_amount INTEGER NOT NULL,
  paid_amount INTEGER NOT NULL DEFAULT 0,
  balance_amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  tax_rate DECIMAL(5, 2) DEFAULT 0,
  tax_type TEXT,
  line_items JSONB NOT NULL DEFAULT '[]',
  description TEXT,
  notes TEXT,
  customer_notes TEXT,
  sent_at TIMESTAMPTZ,
  viewed_at TIMESTAMPTZ,
  reminders_sent INTEGER DEFAULT 0,
  last_reminder_at TIMESTAMPTZ,
  first_payment_at TIMESTAMPTZ,
  paid_in_full_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancelled_by TEXT,
  cancellation_reason TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX invoices_tenant_idx ON invoices(tenant_id);
CREATE UNIQUE INDEX invoices_number_tenant_idx ON invoices(tenant_id, invoice_number);
CREATE INDEX invoices_customer_idx ON invoices(customer_id);
CREATE INDEX invoices_lease_idx ON invoices(lease_id);
CREATE INDEX invoices_status_idx ON invoices(status);
CREATE INDEX invoices_due_date_idx ON invoices(due_date);
CREATE INDEX invoices_type_idx ON invoices(invoice_type);

CREATE TRIGGER invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Payments
-- ============================================================================

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  invoice_id TEXT REFERENCES invoices(id),
  lease_id TEXT REFERENCES leases(id),
  payment_number TEXT NOT NULL,
  external_reference TEXT,
  status payment_status NOT NULL DEFAULT 'pending',
  payment_method payment_method NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  fee_amount INTEGER DEFAULT 0,
  net_amount INTEGER,
  refunded_amount INTEGER DEFAULT 0,
  payer_name TEXT,
  payer_phone TEXT,
  payer_email TEXT,
  payer_account TEXT,
  provider TEXT,
  provider_transaction_id TEXT,
  provider_response JSONB DEFAULT '{}',
  received_by TEXT,
  receipt_number TEXT,
  initiated_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_reason TEXT,
  reconciled_at TIMESTAMPTZ,
  reconciled_by TEXT,
  reconciled_amount INTEGER,
  description TEXT,
  internal_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT
);

CREATE INDEX payments_tenant_idx ON payments(tenant_id);
CREATE UNIQUE INDEX payments_number_tenant_idx ON payments(tenant_id, payment_number);
CREATE INDEX payments_customer_idx ON payments(customer_id);
CREATE INDEX payments_invoice_idx ON payments(invoice_id);
CREATE INDEX payments_lease_idx ON payments(lease_id);
CREATE INDEX payments_status_idx ON payments(status);
CREATE INDEX payments_method_idx ON payments(payment_method);
CREATE UNIQUE INDEX payments_provider_tx_idx ON payments(provider, provider_transaction_id) WHERE provider IS NOT NULL AND provider_transaction_id IS NOT NULL;
CREATE INDEX payments_completed_at_idx ON payments(completed_at);

CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Transactions (Ledger)
-- ============================================================================

CREATE TABLE transactions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id TEXT NOT NULL REFERENCES customers(id),
  lease_id TEXT REFERENCES leases(id),
  property_id TEXT REFERENCES properties(id),
  unit_id TEXT REFERENCES units(id),
  invoice_id TEXT REFERENCES invoices(id),
  payment_id TEXT REFERENCES payments(id),
  transaction_number TEXT NOT NULL,
  journal_id TEXT,
  transaction_type transaction_type NOT NULL,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'KES',
  balance_before INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  effective_date TIMESTAMPTZ NOT NULL,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  description TEXT NOT NULL,
  reference TEXT,
  sequence_number INTEGER NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX transactions_tenant_idx ON transactions(tenant_id);
CREATE UNIQUE INDEX transactions_number_tenant_idx ON transactions(tenant_id, transaction_number);
CREATE INDEX transactions_customer_idx ON transactions(customer_id);
CREATE INDEX transactions_lease_idx ON transactions(lease_id);
CREATE INDEX transactions_invoice_idx ON transactions(invoice_id);
CREATE INDEX transactions_payment_idx ON transactions(payment_id);
CREATE INDEX transactions_journal_idx ON transactions(journal_id);
CREATE INDEX transactions_type_idx ON transactions(transaction_type);
CREATE INDEX transactions_effective_date_idx ON transactions(effective_date);
CREATE INDEX transactions_sequence_idx ON transactions(customer_id, sequence_number);

-- ============================================================================
-- Work Orders
-- ============================================================================

CREATE TABLE work_orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  customer_id TEXT REFERENCES customers(id) ON DELETE SET NULL,
  vendor_id TEXT REFERENCES vendors(id) ON DELETE SET NULL,
  work_order_number TEXT NOT NULL,
  priority work_order_priority NOT NULL DEFAULT 'medium',
  status work_order_status NOT NULL DEFAULT 'submitted',
  category work_order_category NOT NULL,
  source work_order_source NOT NULL DEFAULT 'customer_request',
  title TEXT NOT NULL,
  description TEXT,
  location TEXT,
  attachments JSONB DEFAULT '[]',
  response_due_at TIMESTAMPTZ,
  resolution_due_at TIMESTAMPTZ,
  response_breached BOOLEAN NOT NULL DEFAULT FALSE,
  resolution_breached BOOLEAN NOT NULL DEFAULT FALSE,
  paused_at TIMESTAMPTZ,
  paused_minutes INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ,
  scheduled_start_at TIMESTAMPTZ,
  scheduled_end_at TIMESTAMPTZ,
  assigned_at TIMESTAMPTZ,
  assigned_by TEXT,
  estimated_cost INTEGER,
  actual_cost INTEGER,
  currency TEXT NOT NULL DEFAULT 'KES',
  completed_at TIMESTAMPTZ,
  completed_by TEXT,
  verified_at TIMESTAMPTZ,
  verified_by TEXT,
  completion_notes TEXT,
  rating INTEGER,
  feedback TEXT,
  timeline JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by TEXT,
  updated_by TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by TEXT
);

CREATE INDEX work_orders_tenant_idx ON work_orders(tenant_id);
CREATE UNIQUE INDEX work_orders_number_tenant_idx ON work_orders(tenant_id, work_order_number);
CREATE INDEX work_orders_property_idx ON work_orders(property_id);
CREATE INDEX work_orders_unit_idx ON work_orders(unit_id);
CREATE INDEX work_orders_customer_idx ON work_orders(customer_id);
CREATE INDEX work_orders_vendor_idx ON work_orders(vendor_id);
CREATE INDEX work_orders_status_idx ON work_orders(status);
CREATE INDEX work_orders_priority_idx ON work_orders(priority);
CREATE INDEX work_orders_category_idx ON work_orders(category);
CREATE INDEX work_orders_source_idx ON work_orders(source);
CREATE INDEX work_orders_scheduled_at_idx ON work_orders(scheduled_at);
CREATE INDEX work_orders_response_due_at_idx ON work_orders(response_due_at);
CREATE INDEX work_orders_resolution_due_at_idx ON work_orders(resolution_due_at);
CREATE INDEX work_orders_created_at_idx ON work_orders(created_at);

CREATE TRIGGER work_orders_updated_at
  BEFORE UPDATE ON work_orders
  FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS)
-- ============================================================================

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE units ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE work_orders ENABLE ROW LEVEL SECURITY;

-- Tenant isolation: all tenant-scoped tables must match current setting
CREATE POLICY tenants_tenant_isolation ON tenants
  FOR ALL USING (TRUE); -- Tenants table is system-level, admin only

CREATE POLICY organizations_tenant_isolation ON organizations
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY users_tenant_isolation ON users
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY roles_tenant_isolation ON roles
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY user_roles_tenant_isolation ON user_roles
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY sessions_tenant_isolation ON sessions
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY properties_tenant_isolation ON properties
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY units_tenant_isolation ON units
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY customers_tenant_isolation ON customers
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY leases_tenant_isolation ON leases
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY vendors_tenant_isolation ON vendors
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY invoices_tenant_isolation ON invoices
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY payments_tenant_isolation ON payments
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY transactions_tenant_isolation ON transactions
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);

CREATE POLICY work_orders_tenant_isolation ON work_orders
  FOR ALL USING (tenant_id = current_setting('app.current_tenant_id', TRUE)::TEXT);
