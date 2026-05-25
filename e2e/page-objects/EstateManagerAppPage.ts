/**
 * Page Object Model for Estate Manager App (Mobile-First PWA).
 * Covers work orders, inspections, occupancy, collections, vendors, and SLA dashboards.
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class EstateManagerAppPage {
  readonly page: Page;
  
  // Navigation
  readonly workOrdersNav: Locator;
  readonly inspectionsNav: Locator;
  readonly occupancyNav: Locator;
  readonly collectionsNav: Locator;
  readonly vendorsNav: Locator;
  readonly slaNav: Locator;
  
  // Work Order elements
  readonly workOrderList: Locator;
  readonly workOrderStatusFilter: Locator;
  readonly workOrderDetail: Locator;
  readonly approveButton: Locator;
  readonly requestInfoButton: Locator;
  readonly assignVendorButton: Locator;
  readonly vendorRecommendations: Locator;
  readonly overrideReasonInput: Locator;
  readonly slaBreachAlert: Locator;
  readonly closeWorkOrderButton: Locator;
  readonly dualSignOffStatus: Locator;
  
  // Inspection elements
  readonly initiateInspectionButton: Locator;
  readonly inspectionChecklist: Locator;
  readonly capturePhotoButton: Locator;
  readonly meterReadingInput: Locator;
  readonly customerSignature: Locator;
  readonly baselineComparison: Locator;
  
  // Occupancy elements
  readonly occupancyDashboard: Locator;
  readonly unitStatusList: Locator;
  readonly updateStatusButton: Locator;
  readonly customerProfile: Locator;
  readonly initiateOnboardingButton: Locator;
  
  // Collections elements
  readonly arrearsList: Locator;
  readonly sendReminderButton: Locator;
  readonly approvePaymentPlanButton: Locator;
  readonly escalateToLegalButton: Locator;
  readonly waiveFeeButton: Locator;
  
  // Vendor elements
  readonly vendorScorecards: Locator;
  readonly contactVendorButton: Locator;
  readonly approveInvoiceButton: Locator;
  readonly flagVendorButton: Locator;
  
  // SLA elements
  readonly slaComplianceMetrics: Locator;
  readonly atRiskItems: Locator;
  readonly dailyBriefing: Locator;
  
  constructor(page: Page) {
    this.page = page;
    
    // Navigation
    this.workOrdersNav = page.getByRole('link', { name: /work.*order|maintenance/i }).or(page.getByTestId('nav-work-orders'));
    this.inspectionsNav = page.getByRole('link', { name: /inspection/i }).or(page.getByTestId('nav-inspections'));
    this.occupancyNav = page.getByRole('link', { name: /occupancy|units/i }).or(page.getByTestId('nav-occupancy'));
    this.collectionsNav = page.getByRole('link', { name: /collection|arrears/i }).or(page.getByTestId('nav-collections'));
    this.vendorsNav = page.getByRole('link', { name: /vendor/i }).or(page.getByTestId('nav-vendors'));
    this.slaNav = page.getByRole('link', { name: /sla|dashboard/i }).or(page.getByTestId('nav-sla'));
    
    // Work Orders
    this.workOrderList = page.getByTestId('work-order-list').or(page.locator('[data-section="work-orders"]'));
    this.workOrderStatusFilter = page.getByLabel(/status/i).or(page.getByTestId('status-filter'));
    this.workOrderDetail = page.getByTestId('work-order-detail').or(page.locator('[data-section="work-order-detail"]'));
    this.approveButton = page.getByRole('button', { name: /approve/i });
    this.requestInfoButton = page.getByRole('button', { name: /request.*info|more.*info/i });
    this.assignVendorButton = page.getByRole('button', { name: /assign.*vendor/i });
    this.vendorRecommendations = page.getByTestId('vendor-recommendations').or(page.locator('[data-recommendations]'));
    this.overrideReasonInput = page.getByLabel(/reason|override.*reason/i);
    this.slaBreachAlert = page.getByTestId('sla-breach-alert').or(page.locator('[data-alert="sla"]'));
    this.closeWorkOrderButton = page.getByRole('button', { name: /close.*order|complete/i });
    this.dualSignOffStatus = page.getByTestId('dual-signoff').or(page.locator('[data-signoff]'));
    
    // Inspections
    this.initiateInspectionButton = page.getByRole('button', { name: /start.*inspection|new.*inspection/i });
    this.inspectionChecklist = page.getByTestId('inspection-checklist').or(page.locator('[data-checklist]'));
    this.capturePhotoButton = page.getByRole('button', { name: /photo|capture/i });
    this.meterReadingInput = page.getByLabel(/meter.*reading|reading/i);
    this.customerSignature = page.getByTestId('customer-signature').or(page.locator('canvas'));
    this.baselineComparison = page.getByTestId('baseline-comparison').or(page.locator('[data-comparison]'));
    
    // Occupancy
    this.occupancyDashboard = page.getByTestId('occupancy-dashboard').or(page.locator('[data-section="occupancy"]'));
    this.unitStatusList = page.getByTestId('unit-status-list').or(page.locator('[data-section="units"]'));
    this.updateStatusButton = page.getByRole('button', { name: /update.*status/i });
    this.customerProfile = page.getByTestId('customer-profile').or(page.locator('[data-profile]'));
    this.initiateOnboardingButton = page.getByRole('button', { name: /start.*onboarding|onboard/i });
    
    // Collections
    this.arrearsList = page.getByTestId('arrears-list').or(page.locator('[data-section="arrears"]'));
    this.sendReminderButton = page.getByRole('button', { name: /send.*reminder|remind/i });
    this.approvePaymentPlanButton = page.getByRole('button', { name: /approve.*plan/i });
    this.escalateToLegalButton = page.getByRole('button', { name: /escalate|legal/i });
    this.waiveFeeButton = page.getByRole('button', { name: /waive/i });
    
    // Vendors
    this.vendorScorecards = page.getByTestId('vendor-scorecards').or(page.locator('[data-section="scorecards"]'));
    this.contactVendorButton = page.getByRole('button', { name: /contact|message/i });
    this.approveInvoiceButton = page.getByRole('button', { name: /approve.*invoice/i });
    this.flagVendorButton = page.getByRole('button', { name: /flag|review/i });
    
    // SLA
    this.slaComplianceMetrics = page.getByTestId('sla-metrics').or(page.locator('[data-section="sla-metrics"]'));
    this.atRiskItems = page.getByTestId('at-risk-items').or(page.locator('[data-section="at-risk"]'));
    this.dailyBriefing = page.getByTestId('daily-briefing').or(page.locator('[data-section="briefing"]'));
  }
  
  // ============================================================================
  // NAVIGATION
  // ============================================================================
  
  async gotoWorkOrders() {
    await this.workOrdersNav.click();
    await this.page.waitForURL(/\/work-orders|\/maintenance/i);
  }
  
  async gotoInspections() {
    await this.inspectionsNav.click();
    await this.page.waitForURL(/\/inspections/i);
  }
  
  async gotoOccupancy() {
    await this.occupancyNav.click();
    await this.page.waitForURL(/\/occupancy|\/units/i);
  }
  
  async gotoCollections() {
    await this.collectionsNav.click();
    await this.page.waitForURL(/\/collections|\/arrears/i);
  }
  
  async gotoVendors() {
    await this.vendorsNav.click();
    await this.page.waitForURL(/\/vendors/i);
  }
  
  async gotoSla() {
    await this.slaNav.click();
    await this.page.waitForURL(/\/sla|\/dashboard/i);
  }
  
  // ============================================================================
  // WORK ORDER MANAGEMENT (EM-AC-001 to EM-AC-007)
  // ============================================================================
  
  async filterWorkOrdersByStatus(status: 'all' | 'pending' | 'approved' | 'in-progress' | 'completed') {
    await this.gotoWorkOrders();
    await this.workOrderStatusFilter.click();
    await this.page.getByRole('option', { name: new RegExp(status, 'i') }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getWorkOrders() {
    return await this.workOrderList.locator('[data-work-order], .work-order-item, tr').allTextContents();
  }
  
  async viewWorkOrderDetail(workOrderId: string) {
    await this.workOrderList.getByText(workOrderId).click();
    await this.page.waitForLoadState('networkidle');
    
    return {
      timeline: await this.page.locator('[data-timeline], .timeline-item').allTextContents(),
      evidence: await this.page.locator('[data-evidence], .evidence-item, img').count(),
      costs: await this.page.locator('[data-cost], .cost-item').allTextContents(),
    };
  }
  
  async approveWorkOrder(workOrderId: string) {
    await this.viewWorkOrderDetail(workOrderId);
    await this.approveButton.click();
    
    await this.page.getByRole('button', { name: /confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async requestMoreInfo(workOrderId: string, questions: string) {
    await this.viewWorkOrderDetail(workOrderId);
    await this.requestInfoButton.click();
    
    await this.page.getByLabel(/questions|info.*needed/i).fill(questions);
    await this.page.getByRole('button', { name: /send|submit/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async assignVendorFromRecommendations(workOrderId: string, vendorIndex = 0) {
    await this.viewWorkOrderDetail(workOrderId);
    await this.assignVendorButton.click();
    
    // Select from AI recommendations
    const vendors = this.vendorRecommendations.locator('[data-vendor], .vendor-option');
    await vendors.nth(vendorIndex).click();
    
    await this.page.getByRole('button', { name: /assign|confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async overrideVendorRecommendation(workOrderId: string, vendorName: string, reason: string) {
    await this.viewWorkOrderDetail(workOrderId);
    await this.assignVendorButton.click();
    
    // Search for specific vendor
    await this.page.getByPlaceholder(/search.*vendor/i).fill(vendorName);
    await this.page.getByText(vendorName).click();
    
    // Provide override reason
    await this.overrideReasonInput.fill(reason);
    
    await this.page.getByRole('button', { name: /assign|confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async expectSlaBreachAlert(workOrderId: string) {
    await this.viewWorkOrderDetail(workOrderId);
    await expect(this.slaBreachAlert).toBeVisible();
  }
  
  async closeWorkOrder(workOrderId: string) {
    await this.viewWorkOrderDetail(workOrderId);
    
    // Verify dual sign-off
    const signoffStatus = await this.dualSignOffStatus.textContent();
    expect(signoffStatus).toMatch(/complete|verified/i);
    
    await this.closeWorkOrderButton.click();
    await this.page.getByRole('button', { name: /confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // INSPECTION WORKFLOWS (EM-AC-010 to EM-AC-015)
  // ============================================================================
  
  async initiateMoveInInspection(customerName: string, unitNumber: string) {
    await this.gotoInspections();
    await this.initiateInspectionButton.click();
    
    await this.page.getByLabel(/customer|tenant/i).fill(customerName);
    await this.page.getByLabel(/unit/i).fill(unitNumber);
    await this.page.getByLabel(/type/i).click();
    await this.page.getByRole('option', { name: /move.*in/i }).click();
    
    await this.page.getByRole('button', { name: /start|begin/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async conductInspection(areas: string[]) {
    for (const area of areas) {
      // Select area
      await this.inspectionChecklist.getByText(new RegExp(area, 'i')).click();
      
      // Capture photo
      await this.capturePhotoButton.click();
      const fileInput = this.page.locator('input[type="file"]');
      await fileInput.setInputFiles('./e2e/fixtures/test-photo.jpg');
      await this.page.waitForLoadState('networkidle');
      
      // Mark condition
      await this.page.getByLabel(/condition/i).click();
      await this.page.getByRole('option', { name: /good/i }).click();
      
      // Add notes
      await this.page.getByLabel(/notes/i).fill(`E2E inspection: ${area}`);
      
      // Save area
      await this.page.getByRole('button', { name: /save|next/i }).click();
    }
  }
  
  async recordMeterReading(meterType: string, reading: string) {
    await this.page.getByText(new RegExp(meterType, 'i')).click();
    await this.meterReadingInput.fill(reading);
    
    // Capture photo of meter
    await this.capturePhotoButton.click();
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles('./e2e/fixtures/test-photo.jpg');
    
    await this.page.getByRole('button', { name: /save/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async completeInspectionWithSignature() {
    // Get customer signature
    const canvas = this.customerSignature;
    await canvas.scrollIntoViewIfNeeded();
    
    const box = await canvas.boundingBox();
    if (box) {
      await this.page.mouse.move(box.x + 20, box.y + 20);
      await this.page.mouse.down();
      await this.page.mouse.move(box.x + 100, box.y + 40);
      await this.page.mouse.up();
    }
    
    await this.page.getByRole('button', { name: /complete|submit/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async initiateMoveOutInspection(customerName: string, unitNumber: string) {
    await this.gotoInspections();
    await this.initiateInspectionButton.click();
    
    await this.page.getByLabel(/customer|tenant/i).fill(customerName);
    await this.page.getByLabel(/unit/i).fill(unitNumber);
    await this.page.getByLabel(/type/i).click();
    await this.page.getByRole('option', { name: /move.*out/i }).click();
    
    await this.page.getByRole('button', { name: /start|begin/i }).click();
    await this.page.waitForLoadState('networkidle');
    
    // Verify baseline comparison is shown
    await expect(this.baselineComparison).toBeVisible();
  }
  
  // ============================================================================
  // OCCUPANCY OPERATIONS (EM-AC-020 to EM-AC-023)
  // ============================================================================
  
  async getOccupancyStatus() {
    await this.gotoOccupancy();
    return await this.unitStatusList.locator('[data-unit], .unit-item, tr').allTextContents();
  }
  
  async updateUnitStatus(unitNumber: string, newStatus: 'occupied' | 'vacant' | 'turnover' | 'maintenance') {
    await this.gotoOccupancy();
    await this.unitStatusList.getByText(unitNumber).click();
    
    await this.updateStatusButton.click();
    await this.page.getByRole('option', { name: new RegExp(newStatus, 'i') }).click();
    
    await this.page.getByRole('button', { name: /save|update/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async viewCustomerProfile(customerName: string) {
    await this.gotoOccupancy();
    await this.page.getByText(customerName).click();
    
    await this.page.waitForLoadState('networkidle');
    
    return {
      name: await this.customerProfile.locator('[data-name]').textContent(),
      unit: await this.customerProfile.locator('[data-unit]').textContent(),
      lease: await this.customerProfile.locator('[data-lease]').textContent(),
      balance: await this.customerProfile.locator('[data-balance]').textContent(),
    };
  }
  
  async initiateCustomerOnboarding(customerData: {
    name: string;
    phone: string;
    unitNumber: string;
  }) {
    await this.gotoOccupancy();
    await this.initiateOnboardingButton.click();
    
    await this.page.getByLabel(/name/i).fill(customerData.name);
    await this.page.getByLabel(/phone/i).fill(customerData.phone);
    await this.page.getByLabel(/unit/i).fill(customerData.unitNumber);
    
    await this.page.getByRole('button', { name: /start|begin/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // COLLECTIONS WORKFLOWS (EM-AC-030 to EM-AC-034)
  // ============================================================================
  
  async getArrearsList() {
    await this.gotoCollections();
    return await this.arrearsList.locator('[data-arrear], .arrear-item, tr').allTextContents();
  }
  
  async sendReminder(customerName: string) {
    await this.gotoCollections();
    await this.arrearsList.getByText(customerName).click();
    
    await this.sendReminderButton.click();
    
    // Select channel (defaults to customer's preferred channel)
    await this.page.getByRole('button', { name: /send/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async approvePaymentPlan(customerName: string, installments: number, amount: number) {
    await this.gotoCollections();
    await this.arrearsList.getByText(customerName).click();
    
    await this.approvePaymentPlanButton.click();
    
    await this.page.getByLabel(/installments/i).fill(String(installments));
    await this.page.getByLabel(/amount/i).fill(String(amount));
    
    await this.page.getByRole('button', { name: /approve/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async escalateToLegal(customerName: string, notes: string) {
    await this.gotoCollections();
    await this.arrearsList.getByText(customerName).click();
    
    await this.escalateToLegalButton.click();
    
    await this.page.getByLabel(/notes|reason/i).fill(notes);
    
    // Confirm escalation
    await this.page.getByRole('button', { name: /escalate|confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async waiveFee(customerName: string, feeType: string, reason: string) {
    await this.gotoCollections();
    await this.arrearsList.getByText(customerName).click();
    
    await this.page.getByText(new RegExp(feeType, 'i')).click();
    await this.waiveFeeButton.click();
    
    await this.page.getByLabel(/reason/i).fill(reason);
    
    await this.page.getByRole('button', { name: /waive|confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // VENDOR COORDINATION (EM-AC-040 to EM-AC-043)
  // ============================================================================
  
  async getVendorScorecards() {
    await this.gotoVendors();
    return await this.vendorScorecards.locator('[data-vendor], .vendor-card, tr').allTextContents();
  }
  
  async contactVendor(vendorName: string, message: string) {
    await this.gotoVendors();
    await this.vendorScorecards.getByText(vendorName).click();
    
    await this.contactVendorButton.click();
    
    await this.page.getByLabel(/message/i).fill(message);
    await this.page.getByRole('button', { name: /send/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async approveVendorInvoice(vendorName: string, invoiceId: string) {
    await this.gotoVendors();
    await this.vendorScorecards.getByText(vendorName).click();
    
    await this.page.getByRole('tab', { name: /invoices/i }).click();
    await this.page.getByText(invoiceId).click();
    
    await this.approveInvoiceButton.click();
    await this.page.getByRole('button', { name: /confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async flagVendorForReview(vendorName: string, reason: string) {
    await this.gotoVendors();
    await this.vendorScorecards.getByText(vendorName).click();
    
    await this.flagVendorButton.click();
    
    await this.page.getByLabel(/reason/i).fill(reason);
    await this.page.getByRole('button', { name: /submit|flag/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // SLA DASHBOARDS (EM-AC-050 to EM-AC-053)
  // ============================================================================
  
  async getSlaComplianceMetrics() {
    await this.gotoSla();
    return await this.slaComplianceMetrics.locator('[data-metric], .metric-item').allTextContents();
  }
  
  async getAtRiskItems() {
    await this.gotoSla();
    return await this.atRiskItems.locator('[data-item], .risk-item, tr').allTextContents();
  }
  
  async drillDownFromMetric(metricName: string) {
    await this.gotoSla();
    await this.slaComplianceMetrics.getByText(new RegExp(metricName, 'i')).click();
    await this.page.waitForLoadState('networkidle');
    
    return await this.page.locator('[data-detail], .detail-item, tr').allTextContents();
  }
  
  async getDailyBriefing() {
    await this.gotoSla();
    return await this.dailyBriefing.textContent();
  }
}

export default EstateManagerAppPage;
