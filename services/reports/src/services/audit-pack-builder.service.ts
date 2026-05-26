/**
 * Audit Pack Builder Service
 * 
 * Generates comprehensive audit packs for compliance, investor reporting,
 * and internal governance requirements.
 */

import type { TenantId, PropertyId } from '../types/index.js';
import type { ReportFormat } from '../generators/index.js';
import type { IReportStorage, StoredReport } from '../storage/storage.js';
import { logger } from '../logger.js';

// ============================================================================
// Types
// ============================================================================

export type AuditPackType =
  | 'investor_report' // Quarterly/annual investor reporting
  | 'compliance_audit' // Regulatory compliance audit
  | 'internal_audit' // Internal governance audit
  | 'tax_audit' // Tax-related documentation
  | 'due_diligence' // For property sales/acquisitions
  | 'insurance_audit' // Insurance claims/renewals
  | 'bank_audit'; // Bank/lender reporting

export interface AuditPackPeriod {
  start: Date;
  end: Date;
  label: string; // e.g., "Q1 2024", "FY 2023"
}

export interface AuditPackSection {
  id: string;
  name: string;
  description: string;
  required: boolean;
  included: boolean;
  documents: AuditDocument[];
  status: 'pending' | 'generating' | 'complete' | 'error';
  error?: string;
}

export interface AuditDocument {
  id: string;
  name: string;
  type: 'report' | 'statement' | 'schedule' | 'certificate' | 'register' | 'correspondence' | 'policy';
  format: ReportFormat;
  size?: number;
  generatedAt?: Date;
  url?: string;
  storedReportId?: string;
}

export interface AuditPackConfig {
  tenantId: TenantId;
  type: AuditPackType;
  period: AuditPackPeriod;
  propertyIds?: PropertyId[];
  sections: AuditPackSectionConfig[];
  requestedBy: string;
  recipient?: {
    name: string;
    organization: string;
    email?: string;
  };
  notes?: string;
}

export interface AuditPackSectionConfig {
  sectionId: string;
  included: boolean;
  customName?: string;
}

export interface AuditPack {
  id: string;
  tenantId: TenantId;
  type: AuditPackType;
  period: AuditPackPeriod;
  propertyIds?: PropertyId[];
  status: 'draft' | 'generating' | 'complete' | 'error';
  sections: AuditPackSection[];
  totalDocuments: number;
  completedDocuments: number;
  createdAt: Date;
  completedAt?: Date;
  requestedBy: string;
  recipient?: AuditPackConfig['recipient'];
  notes?: string;
  downloadUrl?: string;
  expiresAt?: Date;
}

export interface AuditPackTemplate {
  type: AuditPackType;
  name: string;
  description: string;
  sections: AuditPackTemplateSection[];
}

export interface AuditPackTemplateSection {
  id: string;
  name: string;
  description: string;
  required: boolean;
  documents: AuditPackTemplateDocument[];
}

export interface AuditPackTemplateDocument {
  id: string;
  name: string;
  type: AuditDocument['type'];
  description: string;
  generatorId: string; // ID of the report/document generator to use
}

// ============================================================================
// Data Provider Interface
// ============================================================================

export interface IAuditPackDataProvider {
  // Financial data
  getIncomeStatement(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getBalanceSheet(tenantId: TenantId, asOfDate: Date, propertyIds?: PropertyId[]): Promise<unknown>;
  getCashFlowStatement(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getGeneralLedger(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getTrialBalance(tenantId: TenantId, asOfDate: Date, propertyIds?: PropertyId[]): Promise<unknown>;
  
  // Rent roll and occupancy
  getRentRoll(tenantId: TenantId, asOfDate: Date, propertyIds?: PropertyId[]): Promise<unknown>;
  getOccupancyHistory(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getLeaseSchedule(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<unknown>;
  
  // AR/Collections
  getAgingReport(tenantId: TenantId, asOfDate: Date, propertyIds?: PropertyId[]): Promise<unknown>;
  getBadDebtSchedule(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getCollectionHistory(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  
  // AP/Expenses
  getVendorPaymentSchedule(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getExpenseBreakdown(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  
  // Capital/Maintenance
  getCapitalExpenditures(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getMaintenanceHistory(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getAssetRegister(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<unknown>;
  
  // Compliance
  getLicenseRegister(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<unknown>;
  getInsuranceCertificates(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<unknown>;
  getComplianceChecklistStatus(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<unknown>;
  
  // Operations
  getKPISummary(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  getOperationalHighlights(tenantId: TenantId, period: AuditPackPeriod, propertyIds?: PropertyId[]): Promise<unknown>;
  
  // Property data
  getPropertySummary(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<unknown>;
  getPropertyValuations(tenantId: TenantId, propertyIds?: PropertyId[]): Promise<unknown>;
}

// ============================================================================
// Audit Pack Templates
// ============================================================================

const AUDIT_PACK_TEMPLATES: AuditPackTemplate[] = [
  {
    type: 'investor_report',
    name: 'Investor Quarterly Report',
    description: 'Comprehensive quarterly report for investors and stakeholders',
    sections: [
      {
        id: 'executive_summary',
        name: 'Executive Summary',
        description: 'High-level performance overview and key highlights',
        required: true,
        documents: [
          { id: 'exec_summary', name: 'Executive Summary', type: 'report', description: 'Performance highlights and key metrics', generatorId: 'exec_summary' },
          { id: 'kpi_dashboard', name: 'KPI Dashboard', type: 'report', description: 'Key performance indicators', generatorId: 'kpi_dashboard' },
        ],
      },
      {
        id: 'financial_statements',
        name: 'Financial Statements',
        description: 'Core financial reports',
        required: true,
        documents: [
          { id: 'income_statement', name: 'Income Statement', type: 'statement', description: 'Revenue and expense summary', generatorId: 'income_statement' },
          { id: 'balance_sheet', name: 'Balance Sheet', type: 'statement', description: 'Assets, liabilities, and equity', generatorId: 'balance_sheet' },
          { id: 'cash_flow', name: 'Cash Flow Statement', type: 'statement', description: 'Cash inflows and outflows', generatorId: 'cash_flow' },
        ],
      },
      {
        id: 'rent_roll',
        name: 'Rent Roll & Occupancy',
        description: 'Tenant and occupancy information',
        required: true,
        documents: [
          { id: 'rent_roll', name: 'Rent Roll', type: 'schedule', description: 'Current tenant listing with rent details', generatorId: 'rent_roll' },
          { id: 'occupancy_report', name: 'Occupancy Report', type: 'report', description: 'Occupancy trends and analysis', generatorId: 'occupancy_report' },
          { id: 'lease_expiry_schedule', name: 'Lease Expiry Schedule', type: 'schedule', description: 'Upcoming lease expirations', generatorId: 'lease_schedule' },
        ],
      },
      {
        id: 'collections',
        name: 'Collections & Arrears',
        description: 'Payment collection performance',
        required: true,
        documents: [
          { id: 'aging_report', name: 'Accounts Receivable Aging', type: 'report', description: 'Outstanding balance aging', generatorId: 'ar_aging' },
          { id: 'collection_summary', name: 'Collection Summary', type: 'report', description: 'Collection performance metrics', generatorId: 'collection_summary' },
        ],
      },
      {
        id: 'capital_maintenance',
        name: 'Capital & Maintenance',
        description: 'Property improvement and maintenance',
        required: false,
        documents: [
          { id: 'capex_schedule', name: 'Capital Expenditure Schedule', type: 'schedule', description: 'CapEx projects and spending', generatorId: 'capex_schedule' },
          { id: 'maintenance_summary', name: 'Maintenance Summary', type: 'report', description: 'Maintenance activity and costs', generatorId: 'maintenance_summary' },
        ],
      },
      {
        id: 'operational_highlights',
        name: 'Operational Highlights',
        description: 'Key operational achievements and challenges',
        required: false,
        documents: [
          { id: 'ops_highlights', name: 'Operational Highlights', type: 'report', description: 'Notable operational items', generatorId: 'ops_highlights' },
          { id: 'property_summary', name: 'Property Summary', type: 'report', description: 'Individual property performance', generatorId: 'property_summary' },
        ],
      },
    ],
  },
  {
    type: 'compliance_audit',
    name: 'Compliance Audit Pack',
    description: 'Documentation for regulatory compliance audits',
    sections: [
      {
        id: 'license_register',
        name: 'License & Permit Register',
        description: 'All active licenses and permits',
        required: true,
        documents: [
          { id: 'license_register', name: 'License Register', type: 'register', description: 'List of all licenses and permits', generatorId: 'license_register' },
          { id: 'license_copies', name: 'License Copies', type: 'certificate', description: 'Copies of license certificates', generatorId: 'license_copies' },
        ],
      },
      {
        id: 'insurance',
        name: 'Insurance Documentation',
        description: 'Insurance policies and certificates',
        required: true,
        documents: [
          { id: 'insurance_schedule', name: 'Insurance Schedule', type: 'schedule', description: 'List of insurance policies', generatorId: 'insurance_schedule' },
          { id: 'insurance_certs', name: 'Insurance Certificates', type: 'certificate', description: 'Certificate of insurance', generatorId: 'insurance_certs' },
        ],
      },
      {
        id: 'safety_compliance',
        name: 'Safety & Health Compliance',
        description: 'Safety inspection and compliance records',
        required: true,
        documents: [
          { id: 'safety_checklist', name: 'Safety Compliance Checklist', type: 'report', description: 'Safety compliance status', generatorId: 'safety_checklist' },
          { id: 'inspection_records', name: 'Inspection Records', type: 'register', description: 'Recent inspection reports', generatorId: 'inspection_records' },
        ],
      },
      {
        id: 'financial_records',
        name: 'Financial Records',
        description: 'Financial compliance documentation',
        required: true,
        documents: [
          { id: 'general_ledger', name: 'General Ledger', type: 'statement', description: 'Detailed accounting records', generatorId: 'general_ledger' },
          { id: 'trial_balance', name: 'Trial Balance', type: 'statement', description: 'Account balance summary', generatorId: 'trial_balance' },
          { id: 'vendor_payments', name: 'Vendor Payment Schedule', type: 'schedule', description: 'Vendor payment records', generatorId: 'vendor_payments' },
        ],
      },
      {
        id: 'tenant_records',
        name: 'Tenant Records',
        description: 'Tenant documentation and agreements',
        required: true,
        documents: [
          { id: 'lease_agreements', name: 'Lease Agreement Register', type: 'register', description: 'Active lease agreements', generatorId: 'lease_register' },
          { id: 'tenant_correspondence', name: 'Tenant Correspondence Log', type: 'register', description: 'Key tenant communications', generatorId: 'correspondence_log' },
        ],
      },
      {
        id: 'policies',
        name: 'Policies & Procedures',
        description: 'Operational policies and procedures',
        required: false,
        documents: [
          { id: 'policy_manual', name: 'Policy Manual', type: 'policy', description: 'Operational policies', generatorId: 'policy_manual' },
          { id: 'emergency_procedures', name: 'Emergency Procedures', type: 'policy', description: 'Emergency response plans', generatorId: 'emergency_procedures' },
        ],
      },
    ],
  },
  {
    type: 'tax_audit',
    name: 'Tax Audit Pack',
    description: 'Documentation for tax authority audits',
    sections: [
      {
        id: 'income_records',
        name: 'Income Records',
        description: 'All revenue documentation',
        required: true,
        documents: [
          { id: 'income_statement', name: 'Income Statement', type: 'statement', description: 'Revenue summary', generatorId: 'income_statement' },
          { id: 'rent_collected', name: 'Rent Collection Schedule', type: 'schedule', description: 'Detailed rent receipts', generatorId: 'rent_collection' },
          { id: 'other_income', name: 'Other Income Schedule', type: 'schedule', description: 'Non-rent income', generatorId: 'other_income' },
        ],
      },
      {
        id: 'expense_records',
        name: 'Expense Records',
        description: 'All expense documentation',
        required: true,
        documents: [
          { id: 'expense_breakdown', name: 'Expense Breakdown', type: 'report', description: 'Categorized expenses', generatorId: 'expense_breakdown' },
          { id: 'vendor_payments', name: 'Vendor Payment Schedule', type: 'schedule', description: 'Payment to vendors', generatorId: 'vendor_payments' },
          { id: 'utility_payments', name: 'Utility Payment Schedule', type: 'schedule', description: 'Utility expenses', generatorId: 'utility_payments' },
        ],
      },
      {
        id: 'asset_records',
        name: 'Asset Records',
        description: 'Fixed asset documentation',
        required: true,
        documents: [
          { id: 'asset_register', name: 'Fixed Asset Register', type: 'register', description: 'Property and equipment list', generatorId: 'asset_register' },
          { id: 'depreciation_schedule', name: 'Depreciation Schedule', type: 'schedule', description: 'Asset depreciation', generatorId: 'depreciation' },
          { id: 'capex_schedule', name: 'Capital Expenditure Schedule', type: 'schedule', description: 'Capital improvements', generatorId: 'capex_schedule' },
        ],
      },
      {
        id: 'bank_records',
        name: 'Bank & Payment Records',
        description: 'Bank statements and payment records',
        required: true,
        documents: [
          { id: 'cash_flow', name: 'Cash Flow Statement', type: 'statement', description: 'Cash movements', generatorId: 'cash_flow' },
          { id: 'bank_reconciliation', name: 'Bank Reconciliation', type: 'report', description: 'Bank account reconciliation', generatorId: 'bank_recon' },
        ],
      },
      {
        id: 'compliance_docs',
        name: 'Tax Compliance Documents',
        description: 'Tax returns and compliance certificates',
        required: true,
        documents: [
          { id: 'tax_returns', name: 'Tax Returns Filed', type: 'register', description: 'Filed tax returns', generatorId: 'tax_returns' },
          { id: 'withholding_summary', name: 'Withholding Tax Summary', type: 'report', description: 'Withholding taxes paid', generatorId: 'withholding' },
        ],
      },
    ],
  },
  {
    type: 'due_diligence',
    name: 'Due Diligence Pack',
    description: 'Comprehensive pack for property acquisition/sale',
    sections: [
      {
        id: 'property_overview',
        name: 'Property Overview',
        description: 'Property details and characteristics',
        required: true,
        documents: [
          { id: 'property_summary', name: 'Property Summary', type: 'report', description: 'Property details and specs', generatorId: 'property_summary' },
          { id: 'property_photos', name: 'Property Photos', type: 'report', description: 'Property photographs', generatorId: 'property_photos' },
          { id: 'site_plan', name: 'Site Plan', type: 'report', description: 'Property site layout', generatorId: 'site_plan' },
        ],
      },
      {
        id: 'financial_performance',
        name: 'Financial Performance',
        description: 'Historical and projected financials',
        required: true,
        documents: [
          { id: 'income_statement_3yr', name: '3-Year Income Statement', type: 'statement', description: 'Historical income', generatorId: 'income_3yr' },
          { id: 'operating_expenses', name: 'Operating Expense Analysis', type: 'report', description: 'Expense breakdown', generatorId: 'opex_analysis' },
          { id: 'noi_analysis', name: 'NOI Analysis', type: 'report', description: 'Net operating income', generatorId: 'noi_analysis' },
          { id: 'projections', name: 'Financial Projections', type: 'report', description: '5-year projections', generatorId: 'projections' },
        ],
      },
      {
        id: 'tenant_analysis',
        name: 'Tenant Analysis',
        description: 'Tenant profile and lease details',
        required: true,
        documents: [
          { id: 'rent_roll', name: 'Rent Roll', type: 'schedule', description: 'Current tenants', generatorId: 'rent_roll' },
          { id: 'tenant_profile', name: 'Tenant Profile Analysis', type: 'report', description: 'Tenant credit analysis', generatorId: 'tenant_profile' },
          { id: 'lease_abstracts', name: 'Lease Abstracts', type: 'schedule', description: 'Key lease terms', generatorId: 'lease_abstracts' },
          { id: 'collection_history', name: 'Collection History', type: 'report', description: 'Payment performance', generatorId: 'collection_history' },
        ],
      },
      {
        id: 'physical_condition',
        name: 'Physical Condition',
        description: 'Property condition and maintenance',
        required: true,
        documents: [
          { id: 'condition_report', name: 'Property Condition Report', type: 'report', description: 'Physical condition assessment', generatorId: 'condition_report' },
          { id: 'maintenance_history', name: 'Maintenance History', type: 'report', description: 'Historical maintenance', generatorId: 'maintenance_history' },
          { id: 'capex_needs', name: 'CapEx Requirements', type: 'report', description: 'Future capital needs', generatorId: 'capex_needs' },
        ],
      },
      {
        id: 'legal_compliance',
        name: 'Legal & Compliance',
        description: 'Title, permits, and compliance',
        required: true,
        documents: [
          { id: 'title_documents', name: 'Title Documents', type: 'certificate', description: 'Ownership documentation', generatorId: 'title_docs' },
          { id: 'zoning_compliance', name: 'Zoning & Permits', type: 'certificate', description: 'Zoning and permits', generatorId: 'zoning' },
          { id: 'insurance_summary', name: 'Insurance Summary', type: 'report', description: 'Insurance coverage', generatorId: 'insurance_summary' },
          { id: 'environmental', name: 'Environmental Report', type: 'report', description: 'Environmental assessment', generatorId: 'environmental' },
        ],
      },
      {
        id: 'market_analysis',
        name: 'Market Analysis',
        description: 'Market context and comparables',
        required: false,
        documents: [
          { id: 'market_overview', name: 'Market Overview', type: 'report', description: 'Local market analysis', generatorId: 'market_overview' },
          { id: 'comparable_analysis', name: 'Comparable Analysis', type: 'report', description: 'Market comparables', generatorId: 'comps' },
          { id: 'valuation', name: 'Valuation Summary', type: 'report', description: 'Property valuation', generatorId: 'valuation' },
        ],
      },
    ],
  },
];

// ============================================================================
// Audit Pack Builder Service
// ============================================================================

export class AuditPackBuilderService {
  private readonly auditPacks = new Map<string, AuditPack>();

  constructor(
    private readonly dataProvider: IAuditPackDataProvider,
    private readonly storage: IReportStorage
  ) {}

  /**
   * Get available audit pack templates
   */
  getTemplates(): AuditPackTemplate[] {
    return AUDIT_PACK_TEMPLATES;
  }

  /**
   * Get template by type
   */
  getTemplate(type: AuditPackType): AuditPackTemplate | null {
    return AUDIT_PACK_TEMPLATES.find((t) => t.type === type) ?? null;
  }

  /**
   * Create a new audit pack
   */
  async createAuditPack(config: AuditPackConfig): Promise<AuditPack> {
    const template = this.getTemplate(config.type);
    if (!template) {
      throw new Error(`Unknown audit pack type: ${config.type}`);
    }

    const id = `audit_${config.tenantId}_${config.type}_${Date.now()}`;

    // Build sections based on template and config
    const sections: AuditPackSection[] = template.sections.map((templateSection) => {
      const sectionConfig = config.sections.find((s) => s.sectionId === templateSection.id);
      const included = sectionConfig?.included ?? templateSection.required;

      return {
        id: templateSection.id,
        name: sectionConfig?.customName ?? templateSection.name,
        description: templateSection.description,
        required: templateSection.required,
        included,
        documents: included ? templateSection.documents.map((doc) => ({
          id: doc.id,
          name: doc.name,
          type: doc.type,
          format: 'pdf' as ReportFormat,
        })) : [],
        status: included ? 'pending' : 'complete',
      };
    });

    const totalDocuments = sections.reduce(
      (sum, section) => sum + (section.included ? section.documents.length : 0),
      0
    );

    const auditPack: AuditPack = {
      id,
      tenantId: config.tenantId,
      type: config.type,
      period: config.period,
      ...(config.propertyIds !== undefined ? { propertyIds: config.propertyIds } : {}),
      status: 'draft',
      sections,
      totalDocuments,
      completedDocuments: 0,
      createdAt: new Date(),
      requestedBy: config.requestedBy,
      recipient: config.recipient,
      ...(config.notes !== undefined ? { notes: config.notes } : {}),
    };

    this.auditPacks.set(id, auditPack);
    return auditPack;
  }

  /**
   * Generate all documents in an audit pack
   */
  async generateAuditPack(auditPackId: string): Promise<AuditPack> {
    const auditPack = this.auditPacks.get(auditPackId);
    if (!auditPack) {
      throw new Error(`Audit pack not found: ${auditPackId}`);
    }

    // Update status
    auditPack.status = 'generating';
    this.auditPacks.set(auditPackId, auditPack);

    let completedDocs = 0;

    for (const section of auditPack.sections) {
      if (!section.included) continue;

      section.status = 'generating';

      try {
        for (const doc of section.documents) {
          try {
            const content = await this.generateDocument(
              auditPack.tenantId,
              auditPack.period,
              doc.id,
              auditPack.propertyIds
            );

            // Store document
            const stored = await this.storage.save(
              auditPack.tenantId as string,
              `audit_${doc.id}` as never,
              doc.format,
              content,
              {
                auditPackId,
                sectionId: section.id,
                period: auditPack.period.label,
              }
            );

            doc.storedReportId = stored.id;
            doc.url = `/reports/${stored.id}`;
            doc.size = typeof content === 'string' ? content.length : content.length;
            doc.generatedAt = new Date();

            completedDocs++;
            auditPack.completedDocuments = completedDocs;
          } catch (docError) {
            logger.error(`Failed to generate document ${doc.id}`, { error: docError });
            // Continue with other documents
          }
        }

        section.status = 'complete';
      } catch (sectionError) {
        section.status = 'error';
        section.error = sectionError instanceof Error ? sectionError.message : String(sectionError);
      }
    }

    // Finalize
    auditPack.status = auditPack.sections.some((s) => s.status === 'error') ? 'error' : 'complete';
    auditPack.completedAt = new Date();
    auditPack.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    // Generate combined download (in production, this would create a ZIP)
    auditPack.downloadUrl = `/api/reports/audit-packs/${auditPackId}/download`;

    this.auditPacks.set(auditPackId, auditPack);
    return auditPack;
  }

  /**
   * Get audit pack by ID
   */
  getAuditPack(auditPackId: string): AuditPack | null {
    return this.auditPacks.get(auditPackId) ?? null;
  }

  /**
   * List audit packs for a tenant
   */
  listAuditPacks(
    tenantId: TenantId,
    filters?: {
      type?: AuditPackType;
      status?: AuditPack['status'];
      fromDate?: Date;
      toDate?: Date;
    }
  ): AuditPack[] {
    let packs = Array.from(this.auditPacks.values()).filter(
      (pack) => pack.tenantId === tenantId
    );

    if (filters?.type) {
      packs = packs.filter((pack) => pack.type === filters.type);
    }
    if (filters?.status) {
      packs = packs.filter((pack) => pack.status === filters.status);
    }
    if (filters?.fromDate) {
      packs = packs.filter((pack) => pack.createdAt >= filters.fromDate!);
    }
    if (filters?.toDate) {
      packs = packs.filter((pack) => pack.createdAt <= filters.toDate!);
    }

    return packs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Download a specific document from an audit pack
   */
  async getDocument(
    auditPackId: string,
    sectionId: string,
    documentId: string
  ): Promise<{ report: StoredReport; content: Buffer } | null> {
    const auditPack = this.auditPacks.get(auditPackId);
    if (!auditPack) return null;

    const section = auditPack.sections.find((s) => s.id === sectionId);
    if (!section) return null;

    const document = section.documents.find((d) => d.id === documentId);
    if (!document?.storedReportId) return null;

    return this.storage.get(document.storedReportId);
  }

  /**
   * Delete an audit pack
   */
  async deleteAuditPack(auditPackId: string): Promise<boolean> {
    const auditPack = this.auditPacks.get(auditPackId);
    if (!auditPack) return false;

    // Delete all stored documents
    for (const section of auditPack.sections) {
      for (const doc of section.documents) {
        if (doc.storedReportId) {
          await this.storage.delete?.(doc.storedReportId);
        }
      }
    }

    this.auditPacks.delete(auditPackId);
    return true;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async generateDocument(
    tenantId: TenantId,
    period: AuditPackPeriod,
    documentId: string,
    propertyIds?: PropertyId[]
  ): Promise<Buffer | string> {
    // In production, this would call the appropriate data provider method
    // and use the report generators to create the document.
    // For now, return a placeholder.

    const documentGenerators: Record<string, () => Promise<unknown>> = {
      income_statement: () => this.dataProvider.getIncomeStatement(tenantId, period, propertyIds),
      balance_sheet: () => this.dataProvider.getBalanceSheet(tenantId, period.end, propertyIds),
      cash_flow: () => this.dataProvider.getCashFlowStatement(tenantId, period, propertyIds),
      general_ledger: () => this.dataProvider.getGeneralLedger(tenantId, period, propertyIds),
      trial_balance: () => this.dataProvider.getTrialBalance(tenantId, period.end, propertyIds),
      rent_roll: () => this.dataProvider.getRentRoll(tenantId, period.end, propertyIds),
      occupancy_report: () => this.dataProvider.getOccupancyHistory(tenantId, period, propertyIds),
      lease_schedule: () => this.dataProvider.getLeaseSchedule(tenantId, propertyIds),
      ar_aging: () => this.dataProvider.getAgingReport(tenantId, period.end, propertyIds),
      bad_debt: () => this.dataProvider.getBadDebtSchedule(tenantId, period, propertyIds),
      collection_history: () => this.dataProvider.getCollectionHistory(tenantId, period, propertyIds),
      vendor_payments: () => this.dataProvider.getVendorPaymentSchedule(tenantId, period, propertyIds),
      expense_breakdown: () => this.dataProvider.getExpenseBreakdown(tenantId, period, propertyIds),
      capex_schedule: () => this.dataProvider.getCapitalExpenditures(tenantId, period, propertyIds),
      maintenance_summary: () => this.dataProvider.getMaintenanceHistory(tenantId, period, propertyIds),
      asset_register: () => this.dataProvider.getAssetRegister(tenantId, propertyIds),
      license_register: () => this.dataProvider.getLicenseRegister(tenantId, propertyIds),
      insurance_schedule: () => this.dataProvider.getInsuranceCertificates(tenantId, propertyIds),
      kpi_dashboard: () => this.dataProvider.getKPISummary(tenantId, period, propertyIds),
      property_summary: () => this.dataProvider.getPropertySummary(tenantId, propertyIds),
    };

    const generator = documentGenerators[documentId];
    if (generator) {
      const data = await generator();
      // In production, format the data using appropriate report generator
      return Buffer.from(JSON.stringify(data, null, 2));
    }

    // Return placeholder for unimplemented generators
    return Buffer.from(`Document: ${documentId}\nPeriod: ${period.label}\nGenerated: ${new Date().toISOString()}`);
  }
}
