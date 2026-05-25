/**
 * Page Object Model for Owner Portal.
 * Covers dashboard, financial statements, maintenance oversight, documents, and messaging.
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class OwnerPortalPage {
  readonly page: Page;
  
  // Navigation
  readonly dashboardNav: Locator;
  readonly financialNav: Locator;
  readonly maintenanceNav: Locator;
  readonly documentsNav: Locator;
  readonly messagesNav: Locator;
  readonly settingsNav: Locator;
  
  // Dashboard elements
  readonly portfolioValue: Locator;
  readonly occupancyRate: Locator;
  readonly collectionRate: Locator;
  readonly arrearsAgingTable: Locator;
  readonly propertyFilter: Locator;
  readonly dateRangeFilter: Locator;
  readonly unitTypeFilter: Locator;
  
  // Financial elements
  readonly incomeStatement: Locator;
  readonly statementPeriodSelect: Locator;
  readonly downloadPdfButton: Locator;
  readonly downloadExcelButton: Locator;
  readonly disbursementHistory: Locator;
  readonly transactionDetails: Locator;
  
  // Maintenance elements
  readonly workOrderList: Locator;
  readonly workOrderStatusFilter: Locator;
  readonly workOrderApproveButton: Locator;
  readonly maintenanceCostTrends: Locator;
  
  // Documents elements
  readonly documentList: Locator;
  readonly documentDownloadButton: Locator;
  readonly documentBundleButton: Locator;
  readonly eSignButton: Locator;
  readonly versionHistory: Locator;
  
  // Messaging elements
  readonly messageCompose: Locator;
  readonly messageHistory: Locator;
  readonly sendButton: Locator;
  
  constructor(page: Page) {
    this.page = page;
    
    // Navigation
    this.dashboardNav = page.getByRole('link', { name: /dashboard|overview/i });
    this.financialNav = page.getByRole('link', { name: /financial|statements|finance/i });
    this.maintenanceNav = page.getByRole('link', { name: /maintenance|repairs/i });
    this.documentsNav = page.getByRole('link', { name: /documents|files/i });
    this.messagesNav = page.getByRole('link', { name: /messages|communication/i });
    this.settingsNav = page.getByRole('link', { name: /settings/i });
    
    // Dashboard
    this.portfolioValue = page.getByTestId('portfolio-value').or(page.locator('[data-metric="portfolio-value"]'));
    this.occupancyRate = page.getByTestId('occupancy-rate').or(page.locator('[data-metric="occupancy-rate"]'));
    this.collectionRate = page.getByTestId('collection-rate').or(page.locator('[data-metric="collection-rate"]'));
    this.arrearsAgingTable = page.getByTestId('arrears-aging').or(page.locator('table').filter({ hasText: /arrears|aging/i }));
    this.propertyFilter = page.getByLabel(/property/i).or(page.getByTestId('property-filter'));
    this.dateRangeFilter = page.getByLabel(/date.*range/i).or(page.getByTestId('date-range-filter'));
    this.unitTypeFilter = page.getByLabel(/unit.*type/i).or(page.getByTestId('unit-type-filter'));
    
    // Financial
    this.incomeStatement = page.getByTestId('income-statement').or(page.locator('[data-section="income-statement"]'));
    this.statementPeriodSelect = page.getByLabel(/period|month/i).or(page.getByTestId('statement-period'));
    this.downloadPdfButton = page.getByRole('button', { name: /pdf|download.*pdf/i });
    this.downloadExcelButton = page.getByRole('button', { name: /excel|download.*excel|csv/i });
    this.disbursementHistory = page.getByTestId('disbursement-history').or(page.locator('[data-section="disbursements"]'));
    this.transactionDetails = page.getByTestId('transaction-details').or(page.locator('[data-section="transactions"]'));
    
    // Maintenance
    this.workOrderList = page.getByTestId('work-order-list').or(page.locator('[data-section="work-orders"]'));
    this.workOrderStatusFilter = page.getByLabel(/status/i).or(page.getByTestId('status-filter'));
    this.workOrderApproveButton = page.getByRole('button', { name: /approve/i });
    this.maintenanceCostTrends = page.getByTestId('cost-trends').or(page.locator('[data-chart="maintenance-costs"]'));
    
    // Documents
    this.documentList = page.getByTestId('document-list').or(page.locator('[data-section="documents"]'));
    this.documentDownloadButton = page.getByRole('button', { name: /download/i });
    this.documentBundleButton = page.getByRole('button', { name: /bundle|download.*all/i });
    this.eSignButton = page.getByRole('button', { name: /sign|e-sign/i });
    this.versionHistory = page.getByTestId('version-history').or(page.locator('[data-section="versions"]'));
    
    // Messaging
    this.messageCompose = page.getByRole('textbox', { name: /message|compose/i }).or(page.locator('textarea[placeholder*="message"]'));
    this.messageHistory = page.getByTestId('message-history').or(page.locator('[data-section="messages"]'));
    this.sendButton = page.getByRole('button', { name: /send/i });
  }
  
  // ============================================================================
  // NAVIGATION
  // ============================================================================
  
  async gotoDashboard() {
    await this.dashboardNav.click();
    await this.page.waitForURL(/\/(dashboard|overview|home)/i);
  }
  
  async gotoFinancial() {
    await this.financialNav.click();
    await this.page.waitForURL(/\/financial|\/statements|\/finance/i);
  }
  
  async gotoMaintenance() {
    await this.maintenanceNav.click();
    await this.page.waitForURL(/\/maintenance|\/repairs/i);
  }
  
  async gotoDocuments() {
    await this.documentsNav.click();
    await this.page.waitForURL(/\/documents|\/files/i);
  }
  
  async gotoMessages() {
    await this.messagesNav.click();
    await this.page.waitForURL(/\/messages|\/communication/i);
  }
  
  // ============================================================================
  // DASHBOARD ACTIONS (OP-AC-010 to OP-AC-014)
  // ============================================================================
  
  async getDashboardMetrics() {
    return {
      portfolioValue: await this.portfolioValue.textContent(),
      occupancyRate: await this.occupancyRate.textContent(),
      collectionRate: await this.collectionRate.textContent(),
    };
  }
  
  async filterByProperty(propertyName: string) {
    await this.propertyFilter.click();
    await this.page.getByRole('option', { name: new RegExp(propertyName, 'i') }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async filterByDateRange(start: string, end: string) {
    await this.dateRangeFilter.click();
    // Fill start and end dates
    const startInput = this.page.getByLabel(/start|from/i);
    const endInput = this.page.getByLabel(/end|to/i);
    await startInput.fill(start);
    await endInput.fill(end);
    await this.page.getByRole('button', { name: /apply/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async filterByUnitType(unitType: string) {
    await this.unitTypeFilter.click();
    await this.page.getByRole('option', { name: new RegExp(unitType, 'i') }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getArrearsAgingBuckets() {
    const buckets = await this.arrearsAgingTable.locator('tr').allTextContents();
    return {
      '0-7': buckets.find(b => /0-7/i.test(b)),
      '8-14': buckets.find(b => /8-14/i.test(b)),
      '15-30': buckets.find(b => /15-30/i.test(b)),
      '31-60': buckets.find(b => /31-60/i.test(b)),
      '60+': buckets.find(b => /60\+/i.test(b)),
    };
  }
  
  async clickMetricForDrillDown(metric: 'portfolio' | 'occupancy' | 'collection' | 'arrears') {
    const metricMap = {
      portfolio: this.portfolioValue,
      occupancy: this.occupancyRate,
      collection: this.collectionRate,
      arrears: this.arrearsAgingTable,
    };
    await metricMap[metric].click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // FINANCIAL ACTIONS (OP-AC-020 to OP-AC-024)
  // ============================================================================
  
  async selectStatementPeriod(period: string) {
    await this.statementPeriodSelect.click();
    await this.page.getByRole('option', { name: new RegExp(period, 'i') }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getStatementLineItems() {
    const rows = await this.incomeStatement.locator('tr').allTextContents();
    return rows;
  }
  
  async downloadStatementAsPdf() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.downloadPdfButton.click(),
    ]);
    return download;
  }
  
  async downloadStatementAsExcel() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.downloadExcelButton.click(),
    ]);
    return download;
  }
  
  async viewTransactionDetail(reference: string) {
    await this.transactionDetails.getByText(reference).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getDisbursements() {
    return await this.disbursementHistory.locator('tr').allTextContents();
  }
  
  // ============================================================================
  // MAINTENANCE ACTIONS (OP-AC-030 to OP-AC-034)
  // ============================================================================
  
  async filterWorkOrdersByStatus(status: 'open' | 'in-progress' | 'closed' | 'all') {
    await this.workOrderStatusFilter.click();
    await this.page.getByRole('option', { name: new RegExp(status, 'i') }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getWorkOrders() {
    return await this.workOrderList.locator('[data-work-order], .work-order-item, tr').allTextContents();
  }
  
  async viewWorkOrderDetail(id: string) {
    await this.workOrderList.getByText(id).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async approveWorkOrder(id: string) {
    await this.viewWorkOrderDetail(id);
    await this.workOrderApproveButton.click();
    await this.page.getByRole('button', { name: /confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async viewMaintenanceCostTrends() {
    await this.maintenanceCostTrends.scrollIntoViewIfNeeded();
    await expect(this.maintenanceCostTrends).toBeVisible();
  }
  
  // ============================================================================
  // DOCUMENT ACTIONS (OP-AC-040 to OP-AC-043)
  // ============================================================================
  
  async getDocuments() {
    return await this.documentList.locator('[data-document], .document-item, tr').allTextContents();
  }
  
  async downloadDocument(name: string) {
    const row = this.documentList.locator('tr', { hasText: name }).or(
      this.documentList.locator('[data-document]', { hasText: name })
    );
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      row.getByRole('button', { name: /download/i }).click(),
    ]);
    return download;
  }
  
  async downloadDocumentBundle() {
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      this.documentBundleButton.click(),
    ]);
    return download;
  }
  
  async signDocument(name: string) {
    const row = this.documentList.locator('tr', { hasText: name }).or(
      this.documentList.locator('[data-document]', { hasText: name })
    );
    await row.getByRole('button', { name: /sign|e-sign/i }).click();
    
    // Complete e-sign flow
    await this.page.waitForLoadState('networkidle');
    const signatureCanvas = this.page.locator('canvas').or(this.page.getByTestId('signature-pad'));
    if (await signatureCanvas.isVisible({ timeout: 2000 })) {
      // Draw signature
      const box = await signatureCanvas.boundingBox();
      if (box) {
        await this.page.mouse.move(box.x + 50, box.y + 25);
        await this.page.mouse.down();
        await this.page.mouse.move(box.x + 150, box.y + 50);
        await this.page.mouse.up();
      }
    }
    
    await this.page.getByRole('button', { name: /submit|confirm|sign/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async viewDocumentVersions(name: string) {
    const row = this.documentList.locator('tr', { hasText: name }).or(
      this.documentList.locator('[data-document]', { hasText: name })
    );
    await row.getByRole('button', { name: /versions|history/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // MESSAGING ACTIONS (OP-AC-050 to OP-AC-052)
  // ============================================================================
  
  async sendMessage(message: string) {
    await this.messageCompose.fill(message);
    await this.sendButton.click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getMessageHistory() {
    return await this.messageHistory.locator('[data-message], .message-item').allTextContents();
  }
  
  async expectMessageSent(messageText: string) {
    await expect(this.messageHistory.getByText(messageText)).toBeVisible();
  }
}

export default OwnerPortalPage;
