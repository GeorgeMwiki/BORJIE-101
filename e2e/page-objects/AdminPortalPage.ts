/**
 * Page Object Model for Admin Portal.
 * Covers tenant management, user roles, control tower, support tooling, and billing.
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class AdminPortalPage {
  readonly page: Page;
  
  // Navigation
  readonly tenantsNav: Locator;
  readonly usersNav: Locator;
  readonly controlTowerNav: Locator;
  readonly supportNav: Locator;
  readonly billingNav: Locator;
  readonly auditNav: Locator;
  
  // Tenant management
  readonly tenantList: Locator;
  readonly createTenantButton: Locator;
  readonly tenantSearchInput: Locator;
  readonly tenantStatusFilter: Locator;
  readonly suspendButton: Locator;
  readonly reactivateButton: Locator;
  
  // User & Role management
  readonly roleList: Locator;
  readonly createRoleButton: Locator;
  readonly userList: Locator;
  readonly assignRoleButton: Locator;
  readonly permissionMatrix: Locator;
  readonly auditLogTable: Locator;
  readonly approvalMatrixConfig: Locator;
  
  // Control Tower
  readonly healthMetrics: Locator;
  readonly exceptionQueue: Locator;
  readonly aiDecisionLogs: Locator;
  readonly interventionButton: Locator;
  
  // Support Tooling
  readonly customerSearch: Locator;
  readonly activityTimeline: Locator;
  readonly escalateButton: Locator;
  readonly impersonateButton: Locator;
  
  // Billing
  readonly invoiceList: Locator;
  readonly applyCreditsButton: Locator;
  readonly usageReportButton: Locator;
  
  constructor(page: Page) {
    this.page = page;
    
    // Navigation
    this.tenantsNav = page.getByRole('link', { name: /tenants|organizations/i });
    this.usersNav = page.getByRole('link', { name: /users|roles/i });
    this.controlTowerNav = page.getByRole('link', { name: /control.*tower|operations/i });
    this.supportNav = page.getByRole('link', { name: /support/i });
    this.billingNav = page.getByRole('link', { name: /billing|subscriptions/i });
    this.auditNav = page.getByRole('link', { name: /audit/i });
    
    // Tenant management
    this.tenantList = page.getByTestId('tenant-list').or(page.locator('[data-section="tenants"]'));
    this.createTenantButton = page.getByRole('button', { name: /create.*tenant|add.*tenant|new.*tenant/i });
    this.tenantSearchInput = page.getByPlaceholder(/search.*tenant/i).or(page.getByLabel(/search/i));
    this.tenantStatusFilter = page.getByLabel(/status/i).or(page.getByTestId('status-filter'));
    this.suspendButton = page.getByRole('button', { name: /suspend/i });
    this.reactivateButton = page.getByRole('button', { name: /reactivate|activate/i });
    
    // User & Role management
    this.roleList = page.getByTestId('role-list').or(page.locator('[data-section="roles"]'));
    this.createRoleButton = page.getByRole('button', { name: /create.*role|add.*role|new.*role/i });
    this.userList = page.getByTestId('user-list').or(page.locator('[data-section="users"]'));
    this.assignRoleButton = page.getByRole('button', { name: /assign.*role/i });
    this.permissionMatrix = page.getByTestId('permission-matrix').or(page.locator('[data-section="permissions"]'));
    this.auditLogTable = page.getByTestId('audit-log').or(page.locator('table').filter({ hasText: /audit|action/i }));
    this.approvalMatrixConfig = page.getByTestId('approval-matrix').or(page.locator('[data-section="approvals"]'));
    
    // Control Tower
    this.healthMetrics = page.getByTestId('health-metrics').or(page.locator('[data-section="health"]'));
    this.exceptionQueue = page.getByTestId('exception-queue').or(page.locator('[data-section="exceptions"]'));
    this.aiDecisionLogs = page.getByTestId('ai-decisions').or(page.locator('[data-section="ai-logs"]'));
    this.interventionButton = page.getByRole('button', { name: /intervene|override/i });
    
    // Support Tooling
    this.customerSearch = page.getByPlaceholder(/search.*customer/i).or(page.getByLabel(/customer.*search/i));
    this.activityTimeline = page.getByTestId('activity-timeline').or(page.locator('[data-section="timeline"]'));
    this.escalateButton = page.getByRole('button', { name: /escalate/i });
    this.impersonateButton = page.getByRole('button', { name: /impersonate|view.*as/i });
    
    // Billing
    this.invoiceList = page.getByTestId('invoice-list').or(page.locator('[data-section="invoices"]'));
    this.applyCreditsButton = page.getByRole('button', { name: /credit|adjust/i });
    this.usageReportButton = page.getByRole('button', { name: /usage.*report|generate.*report/i });
  }
  
  // ============================================================================
  // NAVIGATION
  // ============================================================================
  
  async gotoTenants() {
    await this.tenantsNav.click();
    await this.page.waitForURL(/\/tenants|\/organizations/i);
  }
  
  async gotoUsers() {
    await this.usersNav.click();
    await this.page.waitForURL(/\/users|\/roles/i);
  }
  
  async gotoControlTower() {
    await this.controlTowerNav.click();
    await this.page.waitForURL(/\/control|\/operations/i);
  }
  
  async gotoSupport() {
    await this.supportNav.click();
    await this.page.waitForURL(/\/support/i);
  }
  
  async gotoBilling() {
    await this.billingNav.click();
    await this.page.waitForURL(/\/billing|\/subscriptions/i);
  }
  
  // ============================================================================
  // TENANT MANAGEMENT (AP-AC-001 to AP-AC-005)
  // ============================================================================
  
  async createTenant(data: {
    name: string;
    email: string;
    phone?: string;
    plan?: string;
  }) {
    await this.createTenantButton.click();
    await this.page.waitForLoadState('networkidle');
    
    await this.page.getByLabel(/name/i).fill(data.name);
    await this.page.getByLabel(/email/i).fill(data.email);
    if (data.phone) {
      await this.page.getByLabel(/phone/i).fill(data.phone);
    }
    if (data.plan) {
      await this.page.getByLabel(/plan/i).click();
      await this.page.getByRole('option', { name: new RegExp(data.plan, 'i') }).click();
    }
    
    await this.page.getByRole('button', { name: /create|save|submit/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async configurePolicyConstitution(tenantName: string, policies: Record<string, unknown>) {
    await this.searchTenant(tenantName);
    await this.tenantList.getByText(tenantName).click();
    
    // Navigate to policy configuration
    await this.page.getByRole('tab', { name: /policy|constitution/i }).click();
    
    for (const [key, value] of Object.entries(policies)) {
      const input = this.page.getByLabel(new RegExp(key, 'i'));
      if (typeof value === 'boolean') {
        if (value) {
          await input.check();
        } else {
          await input.uncheck();
        }
      } else {
        await input.fill(String(value));
      }
    }
    
    await this.page.getByRole('button', { name: /save|update/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async assignSubscriptionPlan(tenantName: string, planName: string) {
    await this.searchTenant(tenantName);
    await this.tenantList.getByText(tenantName).click();
    
    await this.page.getByRole('tab', { name: /billing|subscription/i }).click();
    await this.page.getByLabel(/plan/i).click();
    await this.page.getByRole('option', { name: new RegExp(planName, 'i') }).click();
    await this.page.getByRole('button', { name: /update|save/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getTenantUsageMetrics(tenantName: string) {
    await this.searchTenant(tenantName);
    await this.tenantList.getByText(tenantName).click();
    
    await this.page.getByRole('tab', { name: /usage|metrics/i }).click();
    await this.page.waitForLoadState('networkidle');
    
    return await this.page.locator('[data-metric]').allTextContents();
  }
  
  async suspendTenant(tenantName: string, reason: string) {
    await this.searchTenant(tenantName);
    await this.tenantList.locator('tr', { hasText: tenantName }).getByRole('button', { name: /actions|menu/i }).click();
    await this.page.getByRole('menuitem', { name: /suspend/i }).click();
    
    await this.page.getByLabel(/reason/i).fill(reason);
    await this.page.getByRole('button', { name: /confirm|suspend/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async reactivateTenant(tenantName: string) {
    await this.searchTenant(tenantName);
    await this.tenantList.locator('tr', { hasText: tenantName }).getByRole('button', { name: /actions|menu/i }).click();
    await this.page.getByRole('menuitem', { name: /reactivate|activate/i }).click();
    
    await this.page.getByRole('button', { name: /confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async searchTenant(query: string) {
    await this.tenantSearchInput.fill(query);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // USER & ROLE MANAGEMENT (AP-AC-010 to AP-AC-013)
  // ============================================================================
  
  async createRole(data: {
    name: string;
    permissions: string[];
    description?: string;
  }) {
    await this.createRoleButton.click();
    await this.page.waitForLoadState('networkidle');
    
    await this.page.getByLabel(/role.*name|name/i).fill(data.name);
    if (data.description) {
      await this.page.getByLabel(/description/i).fill(data.description);
    }
    
    // Select permissions
    for (const permission of data.permissions) {
      await this.page.getByLabel(new RegExp(permission, 'i')).check();
    }
    
    await this.page.getByRole('button', { name: /create|save/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async assignUserRole(userName: string, roleName: string, tenantName: string) {
    // Navigate to user
    await this.page.getByPlaceholder(/search.*user/i).fill(userName);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
    
    await this.userList.getByText(userName).click();
    await this.assignRoleButton.click();
    
    // Select tenant and role
    await this.page.getByLabel(/tenant|organization/i).click();
    await this.page.getByRole('option', { name: new RegExp(tenantName, 'i') }).click();
    
    await this.page.getByLabel(/role/i).click();
    await this.page.getByRole('option', { name: new RegExp(roleName, 'i') }).click();
    
    await this.page.getByRole('button', { name: /assign|save/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async viewAuditLog(filters?: { action?: string; user?: string; dateFrom?: string; dateTo?: string }) {
    await this.auditNav.click();
    await this.page.waitForURL(/\/audit/i);
    
    if (filters?.action) {
      await this.page.getByLabel(/action/i).fill(filters.action);
    }
    if (filters?.user) {
      await this.page.getByLabel(/user/i).fill(filters.user);
    }
    if (filters?.dateFrom) {
      await this.page.getByLabel(/from/i).fill(filters.dateFrom);
    }
    if (filters?.dateTo) {
      await this.page.getByLabel(/to/i).fill(filters.dateTo);
    }
    
    await this.page.getByRole('button', { name: /apply|filter/i }).click();
    await this.page.waitForLoadState('networkidle');
    
    return await this.auditLogTable.locator('tr').allTextContents();
  }
  
  async configureApprovalMatrix(tenantName: string, matrix: { threshold: number; approvers: string[] }[]) {
    await this.searchTenant(tenantName);
    await this.tenantList.getByText(tenantName).click();
    
    await this.page.getByRole('tab', { name: /approvals|matrix/i }).click();
    
    for (const rule of matrix) {
      await this.page.getByRole('button', { name: /add.*rule|new.*rule/i }).click();
      await this.page.getByLabel(/threshold/i).last().fill(String(rule.threshold));
      
      for (const approver of rule.approvers) {
        await this.page.getByLabel(/approvers/i).last().click();
        await this.page.getByRole('option', { name: new RegExp(approver, 'i') }).click();
      }
    }
    
    await this.page.getByRole('button', { name: /save/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // CONTROL TOWER (AP-AC-020 to AP-AC-023)
  // ============================================================================
  
  async getSystemHealthMetrics() {
    await this.gotoControlTower();
    await this.page.waitForLoadState('networkidle');
    
    return await this.healthMetrics.locator('[data-metric]').allTextContents();
  }
  
  async getExceptionQueue() {
    return await this.exceptionQueue.locator('[data-exception], tr').allTextContents();
  }
  
  async interveneInWorkflow(workflowId: string, action: string) {
    await this.exceptionQueue.getByText(workflowId).click();
    await this.interventionButton.click();
    
    await this.page.getByLabel(/action/i).click();
    await this.page.getByRole('option', { name: new RegExp(action, 'i') }).click();
    await this.page.getByLabel(/reason/i).fill('E2E test intervention');
    
    await this.page.getByRole('button', { name: /apply|confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async viewAiDecisionLogs(filters?: { dateFrom?: string; dateTo?: string; type?: string }) {
    await this.aiDecisionLogs.scrollIntoViewIfNeeded();
    
    if (filters) {
      if (filters.type) {
        await this.page.getByLabel(/type/i).click();
        await this.page.getByRole('option', { name: new RegExp(filters.type, 'i') }).click();
      }
      if (filters.dateFrom) {
        await this.page.getByLabel(/from/i).fill(filters.dateFrom);
      }
      if (filters.dateTo) {
        await this.page.getByLabel(/to/i).fill(filters.dateTo);
      }
      await this.page.getByRole('button', { name: /apply|filter/i }).click();
      await this.page.waitForLoadState('networkidle');
    }
    
    return await this.aiDecisionLogs.locator('[data-decision], tr').allTextContents();
  }
  
  // ============================================================================
  // SUPPORT TOOLING (AP-AC-030 to AP-AC-033)
  // ============================================================================
  
  async searchCustomer(query: string) {
    await this.gotoSupport();
    await this.customerSearch.fill(query);
    await this.page.keyboard.press('Enter');
    await this.page.waitForLoadState('networkidle');
  }
  
  async viewCustomerTimeline(customerId: string) {
    await this.searchCustomer(customerId);
    await this.page.getByText(customerId).click();
    
    await this.page.waitForLoadState('networkidle');
    return await this.activityTimeline.locator('[data-activity], .timeline-item').allTextContents();
  }
  
  async escalateCase(caseId: string, team: string, notes: string) {
    await this.page.getByText(caseId).click();
    await this.escalateButton.click();
    
    await this.page.getByLabel(/team/i).click();
    await this.page.getByRole('option', { name: new RegExp(team, 'i') }).click();
    await this.page.getByLabel(/notes/i).fill(notes);
    
    await this.page.getByRole('button', { name: /escalate|submit/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async impersonateUser(userId: string) {
    await this.searchCustomer(userId);
    await this.page.getByText(userId).click();
    
    await this.impersonateButton.click();
    await this.page.getByRole('button', { name: /confirm/i }).click();
    
    // Wait for impersonation session to start
    await this.page.waitForLoadState('networkidle');
    
    // Verify audit log entry
    await expect(this.page.getByText(/impersonation.*started/i)).toBeVisible();
  }
  
  // ============================================================================
  // BILLING (AP-AC-040 to AP-AC-042)
  // ============================================================================
  
  async getTenantInvoices(tenantName?: string) {
    await this.gotoBilling();
    
    if (tenantName) {
      await this.page.getByLabel(/tenant/i).fill(tenantName);
      await this.page.keyboard.press('Enter');
      await this.page.waitForLoadState('networkidle');
    }
    
    return await this.invoiceList.locator('tr').allTextContents();
  }
  
  async applyCredit(tenantName: string, amount: number, reason: string) {
    await this.searchTenant(tenantName);
    await this.tenantList.getByText(tenantName).click();
    
    await this.page.getByRole('tab', { name: /billing/i }).click();
    await this.applyCreditsButton.click();
    
    await this.page.getByLabel(/amount/i).fill(String(amount));
    await this.page.getByLabel(/reason/i).fill(reason);
    
    // This should trigger approval workflow
    await this.page.getByRole('button', { name: /submit|apply/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async generateUsageReport(tenantName: string, period: string) {
    await this.searchTenant(tenantName);
    await this.tenantList.getByText(tenantName).click();
    
    await this.page.getByRole('tab', { name: /usage/i }).click();
    await this.page.getByLabel(/period/i).click();
    await this.page.getByRole('option', { name: new RegExp(period, 'i') }).click();
    
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.usageReportButton.click(),
    ]);
    
    return download;
  }
}

export default AdminPortalPage;
