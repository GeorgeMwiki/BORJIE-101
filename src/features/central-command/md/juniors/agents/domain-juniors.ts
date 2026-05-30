/**
 * Domain CSV-ingest juniors — one per TableKey (except `employees`
 * which has its own module). Each one is a thin invocation of the
 * shared factory; the only domain-specific knowledge is the static
 * column set the codebase already renders for that tab.
 *
 * Adding a new domain = one entry in this file + one TABLE_KEYS entry
 * in `schema-registry/types.ts`. No new junior module needed.
 *
 * @module features/central-command/md/juniors/agents/domain-juniors
 */

import { makeCsvIngestJunior } from "./csv-ingest-factory";
import type { MdJuniorPort } from "../types";

// ---------------------------------------------------------------------------
// Static column lists per domain. These mirror what the codebase
// hard-codes today; expand each list whenever a static column is added
// to the corresponding row type.
// ---------------------------------------------------------------------------

export const CUSTOMERS_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "name",
  "email",
  "phone",
  "company",
  "industry",
  "country",
  "tier",
  "lifetime_value",
  "joined_at",
  "last_purchase_at",
  "status",
]);

export const SUPPLIERS_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "name",
  "contact_name",
  "email",
  "phone",
  "country",
  "category",
  "payment_terms",
  "rating",
  "active",
]);

export const INVENTORY_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "sku",
  "name",
  "category",
  "quantity",
  "unit",
  "reorder_threshold",
  "unit_cost",
  "supplier_id",
  "location",
]);

export const FINANCE_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "date",
  "kind",
  "category",
  "description",
  "amount",
  "currency",
  "counterparty",
  "account",
  "tax_rate",
  "status",
]);

export const LEADS_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "name",
  "email",
  "phone",
  "company",
  "source",
  "stage",
  "owner",
  "value",
  "currency",
  "created_at",
  "last_contacted_at",
]);

export const PRODUCTS_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "sku",
  "name",
  "category",
  "price",
  "currency",
  "cost",
  "active",
  "launched_at",
]);

export const COMPLIANCE_STATIC_COLUMNS: ReadonlyArray<string> = Object.freeze([
  "id",
  "regulation",
  "jurisdiction",
  "control",
  "owner",
  "status",
  "evidence_url",
  "next_review_at",
]);

// ---------------------------------------------------------------------------
// Junior instances
// ---------------------------------------------------------------------------

export const customersCsvIngestJunior: MdJuniorPort = makeCsvIngestJunior({
  id: "sales-customers-csv-ingest",
  label: "Sales — Customers CSV ingest",
  domain: "sales",
  tableKey: "customers",
  staticColumns: CUSTOMERS_STATIC_COLUMNS,
});

export const suppliersCsvIngestJunior: MdJuniorPort = makeCsvIngestJunior({
  id: "supply-suppliers-csv-ingest",
  label: "Supply — Suppliers CSV ingest",
  domain: "supply",
  tableKey: "suppliers",
  staticColumns: SUPPLIERS_STATIC_COLUMNS,
});

export const inventoryCsvIngestJunior: MdJuniorPort = makeCsvIngestJunior({
  id: "inventory-csv-ingest",
  label: "Inventory — CSV ingest",
  domain: "inventory",
  tableKey: "inventory",
  staticColumns: INVENTORY_STATIC_COLUMNS,
});

export const financeCsvIngestJunior: MdJuniorPort = makeCsvIngestJunior({
  id: "finance-csv-ingest",
  label: "Finance — CSV ingest",
  domain: "finance",
  tableKey: "finance",
  staticColumns: FINANCE_STATIC_COLUMNS,
});

export const leadsCsvIngestJunior: MdJuniorPort = makeCsvIngestJunior({
  id: "sales-leads-csv-ingest",
  label: "Sales — Leads CSV ingest",
  domain: "sales",
  tableKey: "leads",
  staticColumns: LEADS_STATIC_COLUMNS,
});

export const productsCsvIngestJunior: MdJuniorPort = makeCsvIngestJunior({
  id: "marketing-products-csv-ingest",
  label: "Marketing — Products CSV ingest",
  domain: "marketing",
  tableKey: "products",
  staticColumns: PRODUCTS_STATIC_COLUMNS,
});

export const complianceCsvIngestJunior: MdJuniorPort = makeCsvIngestJunior({
  id: "compliance-csv-ingest",
  label: "Compliance — CSV ingest",
  domain: "compliance",
  tableKey: "compliance",
  staticColumns: COMPLIANCE_STATIC_COLUMNS,
});

export const ALL_DOMAIN_CSV_JUNIORS: ReadonlyArray<MdJuniorPort> =
  Object.freeze([
    customersCsvIngestJunior,
    suppliersCsvIngestJunior,
    inventoryCsvIngestJunior,
    financeCsvIngestJunior,
    leadsCsvIngestJunior,
    productsCsvIngestJunior,
    complianceCsvIngestJunior,
  ]);
