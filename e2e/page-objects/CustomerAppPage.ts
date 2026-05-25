/**
 * Page Object Model for Customer App (Mobile-First PWA).
 * Covers onboarding, payments, maintenance, documents, and communication.
 */

import { type Locator, type Page, expect } from '@playwright/test';

export class CustomerAppPage {
  readonly page: Page;
  
  // Navigation
  readonly homeNav: Locator;
  readonly paymentsNav: Locator;
  readonly maintenanceNav: Locator;
  readonly documentsNav: Locator;
  readonly messagesNav: Locator;
  readonly profileNav: Locator;
  
  // Onboarding elements
  readonly progressIndicator: Locator;
  readonly uploadIdButton: Locator;
  readonly cameraButton: Locator;
  readonly galleryButton: Locator;
  readonly documentQualityFeedback: Locator;
  readonly inspectionChecklist: Locator;
  readonly eSignatureCanvas: Locator;
  readonly welcomePack: Locator;
  
  // Payment elements
  readonly currentBalance: Locator;
  readonly dueDate: Locator;
  readonly payMpesaButton: Locator;
  readonly payBankButton: Locator;
  readonly paymentHistory: Locator;
  readonly requestPlanButton: Locator;
  readonly receiptDownload: Locator;
  
  // Maintenance elements
  readonly submitRequestButton: Locator;
  readonly requestDescription: Locator;
  readonly attachPhotoButton: Locator;
  readonly attachVideoButton: Locator;
  readonly voiceNoteButton: Locator;
  readonly requestStatus: Locator;
  readonly slaEstimate: Locator;
  readonly confirmCompletionButton: Locator;
  readonly disputeButton: Locator;
  readonly ratingStars: Locator;
  
  // Document elements
  readonly leaseDocument: Locator;
  readonly houseRules: Locator;
  readonly renewalOffer: Locator;
  readonly acceptRenewalButton: Locator;
  readonly moveOutNoticeButton: Locator;
  
  // Communication elements
  readonly chatInput: Locator;
  readonly sendMessageButton: Locator;
  readonly notificationCenter: Locator;
  readonly notificationPreferences: Locator;
  
  constructor(page: Page) {
    this.page = page;
    
    // Navigation (mobile bottom nav or sidebar)
    this.homeNav = page.getByRole('link', { name: /home/i }).or(page.getByTestId('nav-home'));
    this.paymentsNav = page.getByRole('link', { name: /pay|payments/i }).or(page.getByTestId('nav-payments'));
    this.maintenanceNav = page.getByRole('link', { name: /maintenance|repair|request/i }).or(page.getByTestId('nav-maintenance'));
    this.documentsNav = page.getByRole('link', { name: /documents|files/i }).or(page.getByTestId('nav-documents'));
    this.messagesNav = page.getByRole('link', { name: /messages|chat/i }).or(page.getByTestId('nav-messages'));
    this.profileNav = page.getByRole('link', { name: /profile|settings/i }).or(page.getByTestId('nav-profile'));
    
    // Onboarding
    this.progressIndicator = page.getByTestId('onboarding-progress').or(page.locator('[data-progress]'));
    this.uploadIdButton = page.getByRole('button', { name: /upload.*id|id.*document/i });
    this.cameraButton = page.getByRole('button', { name: /camera|take.*photo/i });
    this.galleryButton = page.getByRole('button', { name: /gallery|choose.*file/i });
    this.documentQualityFeedback = page.getByTestId('quality-feedback').or(page.locator('[data-quality]'));
    this.inspectionChecklist = page.getByTestId('inspection-checklist').or(page.locator('[data-checklist]'));
    this.eSignatureCanvas = page.locator('canvas').or(page.getByTestId('signature-pad'));
    this.welcomePack = page.getByTestId('welcome-pack').or(page.getByText(/welcome.*pack/i));
    
    // Payments
    this.currentBalance = page.getByTestId('current-balance').or(page.locator('[data-balance]'));
    this.dueDate = page.getByTestId('due-date').or(page.locator('[data-due-date]'));
    this.payMpesaButton = page.getByRole('button', { name: /m-pesa|mpesa|mobile.*money/i });
    this.payBankButton = page.getByRole('button', { name: /bank|transfer/i });
    this.paymentHistory = page.getByTestId('payment-history').or(page.locator('[data-section="history"]'));
    this.requestPlanButton = page.getByRole('button', { name: /payment.*plan|plan|installment/i });
    this.receiptDownload = page.getByRole('button', { name: /receipt|download/i });
    
    // Maintenance
    this.submitRequestButton = page.getByRole('button', { name: /submit.*request|new.*request|report.*issue/i });
    this.requestDescription = page.getByLabel(/description|issue|problem/i).or(page.locator('textarea'));
    this.attachPhotoButton = page.getByRole('button', { name: /photo|image/i });
    this.attachVideoButton = page.getByRole('button', { name: /video/i });
    this.voiceNoteButton = page.getByRole('button', { name: /voice|record|microphone/i });
    this.requestStatus = page.getByTestId('request-status').or(page.locator('[data-status]'));
    this.slaEstimate = page.getByTestId('sla-estimate').or(page.locator('[data-sla]'));
    this.confirmCompletionButton = page.getByRole('button', { name: /confirm.*complete|yes.*resolved/i });
    this.disputeButton = page.getByRole('button', { name: /dispute|not.*resolved/i });
    this.ratingStars = page.getByTestId('rating-stars').or(page.locator('[data-rating]'));
    
    // Documents
    this.leaseDocument = page.getByText(/lease.*agreement|rental.*agreement/i);
    this.houseRules = page.getByText(/house.*rules|property.*rules/i);
    this.renewalOffer = page.getByTestId('renewal-offer').or(page.locator('[data-renewal]'));
    this.acceptRenewalButton = page.getByRole('button', { name: /accept.*renewal|renew/i });
    this.moveOutNoticeButton = page.getByRole('button', { name: /move.*out|notice.*vacate/i });
    
    // Communication
    this.chatInput = page.getByRole('textbox', { name: /message/i }).or(page.locator('input[type="text"], textarea').last());
    this.sendMessageButton = page.getByRole('button', { name: /send/i });
    this.notificationCenter = page.getByTestId('notification-center').or(page.getByRole('button', { name: /notifications/i }));
    this.notificationPreferences = page.getByTestId('notification-preferences').or(page.locator('[data-preferences]'));
  }
  
  // ============================================================================
  // NAVIGATION
  // ============================================================================
  
  async gotoHome() {
    await this.homeNav.click();
    await this.page.waitForURL(/\/home|\/$|\/dashboard/i);
  }
  
  async gotoPayments() {
    await this.paymentsNav.click();
    await this.page.waitForURL(/\/pay|\/payments/i);
  }
  
  async gotoMaintenance() {
    await this.maintenanceNav.click();
    await this.page.waitForURL(/\/maintenance|\/requests/i);
  }
  
  async gotoDocuments() {
    await this.documentsNav.click();
    await this.page.waitForURL(/\/documents|\/files/i);
  }
  
  async gotoMessages() {
    await this.messagesNav.click();
    await this.page.waitForURL(/\/messages|\/chat/i);
  }
  
  // ============================================================================
  // ONBOARDING (CA-AC-001 to CA-AC-007)
  // ============================================================================
  
  async getOnboardingProgress(): Promise<number> {
    const progressText = await this.progressIndicator.textContent();
    const match = progressText?.match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }
  
  async uploadIdDocument(filePath: string) {
    await this.uploadIdButton.click();
    
    // Handle file input
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles(filePath);
    
    // Wait for upload and quality check
    await this.page.waitForLoadState('networkidle');
    
    // Check for quality feedback
    await expect(this.documentQualityFeedback).toBeVisible({ timeout: 10000 });
  }
  
  async captureIdWithCamera() {
    await this.uploadIdButton.click();
    await this.cameraButton.click();
    
    // In test environment, we mock camera capture
    // This would trigger a file selection in real implementation
    await this.page.waitForLoadState('networkidle');
  }
  
  async getDocumentQualityFeedback(): Promise<string> {
    return await this.documentQualityFeedback.textContent() ?? '';
  }
  
  async completeMoveInInspection() {
    // Navigate through guided inspection
    const rooms = ['Living Room', 'Bedroom', 'Kitchen', 'Bathroom'];
    
    for (const room of rooms) {
      await this.page.getByText(new RegExp(room, 'i')).click();
      
      // Take photos for each room
      await this.attachPhotoButton.click();
      const fileInput = this.page.locator('input[type="file"]');
      await fileInput.setInputFiles('./e2e/fixtures/test-photo.jpg');
      await this.page.waitForLoadState('networkidle');
      
      // Add notes
      await this.page.getByLabel(/notes|condition/i).fill(`E2E test: ${room} in good condition`);
      
      // Next room
      await this.page.getByRole('button', { name: /next|continue/i }).click();
    }
    
    // Submit inspection
    await this.page.getByRole('button', { name: /submit|complete/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async signDocument() {
    // Draw signature on canvas
    const canvas = this.eSignatureCanvas;
    await canvas.scrollIntoViewIfNeeded();
    
    const box = await canvas.boundingBox();
    if (box) {
      await this.page.mouse.move(box.x + 20, box.y + 20);
      await this.page.mouse.down();
      await this.page.mouse.move(box.x + 100, box.y + 40);
      await this.page.mouse.move(box.x + 150, box.y + 30);
      await this.page.mouse.up();
    }
    
    await this.page.getByRole('button', { name: /sign|confirm|submit/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async expectWelcomePackDelivered() {
    await expect(this.welcomePack).toBeVisible({ timeout: 15000 });
  }
  
  // ============================================================================
  // PAYMENTS (CA-AC-010 to CA-AC-016)
  // ============================================================================
  
  async getBalance() {
    return await this.currentBalance.textContent();
  }
  
  async getDueDate() {
    return await this.dueDate.textContent();
  }
  
  async payWithMpesa(phoneNumber?: string) {
    await this.payMpesaButton.click();
    
    if (phoneNumber) {
      await this.page.getByLabel(/phone/i).fill(phoneNumber);
    }
    
    await this.page.getByRole('button', { name: /pay|confirm/i }).click();
    
    // Wait for STK push simulation
    await this.page.waitForLoadState('networkidle');
    
    // In test environment, payment should auto-complete
    await expect(this.page.getByText(/payment.*success|received/i)).toBeVisible({ timeout: 30000 });
  }
  
  async payWithBankTransfer() {
    await this.payBankButton.click();
    
    // Expect bank details to be displayed
    await expect(this.page.getByText(/account.*number|bank.*details/i)).toBeVisible();
    await expect(this.page.getByText(/reference/i)).toBeVisible();
  }
  
  async getPaymentHistory() {
    await this.gotoPayments();
    await this.paymentHistory.scrollIntoViewIfNeeded();
    return await this.paymentHistory.locator('[data-payment], .payment-item, tr').allTextContents();
  }
  
  async downloadReceipt(paymentRef: string) {
    await this.gotoPayments();
    const paymentRow = this.paymentHistory.locator('tr', { hasText: paymentRef }).or(
      this.paymentHistory.locator('[data-payment]', { hasText: paymentRef })
    );
    
    const [download] = await Promise.all([
      this.page.waitForEvent('download'),
      paymentRow.getByRole('button', { name: /receipt|download/i }).click(),
    ]);
    
    return download;
  }
  
  async requestPaymentPlan(message: string) {
    await this.gotoPayments();
    await this.requestPlanButton.click();
    
    await this.page.getByLabel(/message|reason/i).fill(message);
    await this.page.getByRole('button', { name: /submit|request/i }).click();
    
    await this.page.waitForLoadState('networkidle');
    await expect(this.page.getByText(/request.*submitted|received/i)).toBeVisible();
  }
  
  // ============================================================================
  // MAINTENANCE (CA-AC-020 to CA-AC-026)
  // ============================================================================
  
  async submitMaintenanceRequest(data: {
    description: string;
    photoPath?: string;
    videoPath?: string;
  }) {
    await this.gotoMaintenance();
    await this.submitRequestButton.click();
    
    await this.requestDescription.fill(data.description);
    
    if (data.photoPath) {
      await this.attachPhotoButton.click();
      const fileInput = this.page.locator('input[type="file"]');
      await fileInput.setInputFiles(data.photoPath);
      await this.page.waitForLoadState('networkidle');
    }
    
    if (data.videoPath) {
      await this.attachVideoButton.click();
      const fileInput = this.page.locator('input[type="file"]');
      await fileInput.setInputFiles(data.videoPath);
      await this.page.waitForLoadState('networkidle');
    }
    
    await this.page.getByRole('button', { name: /submit/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async recordVoiceNote() {
    await this.voiceNoteButton.click();
    
    // In test environment, mock voice recording
    await this.page.waitForTimeout(2000);
    
    await this.page.getByRole('button', { name: /stop|done/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async getMaintenanceRequestStatus(requestId: string) {
    await this.gotoMaintenance();
    await this.page.getByText(requestId).click();
    
    return await this.requestStatus.textContent();
  }
  
  async getSlaEstimate() {
    return await this.slaEstimate.textContent();
  }
  
  async confirmRequestCompletion() {
    await this.confirmCompletionButton.click();
    await this.page.waitForLoadState('networkidle');
    
    // Rate service
    await this.ratingStars.locator('button, [data-star]').nth(4).click(); // 5 stars
    await this.page.getByRole('button', { name: /submit|done/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async disputeCompletion(reason: string) {
    await this.disputeButton.click();
    await this.page.getByLabel(/reason/i).fill(reason);
    await this.page.getByRole('button', { name: /submit/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async rateService(stars: 1 | 2 | 3 | 4 | 5) {
    await this.ratingStars.locator('button, [data-star]').nth(stars - 1).click();
    await this.page.getByRole('button', { name: /submit|done/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
  
  // ============================================================================
  // DOCUMENTS (CA-AC-030 to CA-AC-034)
  // ============================================================================
  
  async viewLeaseDocument() {
    await this.gotoDocuments();
    await this.leaseDocument.click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async viewHouseRules() {
    await this.gotoDocuments();
    await this.houseRules.click();
    await this.page.waitForLoadState('networkidle');
  }
  
  async acceptRenewalOffer() {
    await this.gotoDocuments();
    await this.renewalOffer.click();
    await this.acceptRenewalButton.click();
    
    // E-sign renewal
    await this.signDocument();
    
    await expect(this.page.getByText(/renewal.*accepted|confirmed/i)).toBeVisible();
  }
  
  async submitMoveOutNotice(moveOutDate: string, reason: string) {
    await this.gotoDocuments();
    await this.moveOutNoticeButton.click();
    
    await this.page.getByLabel(/move.*out.*date|vacate.*date/i).fill(moveOutDate);
    await this.page.getByLabel(/reason/i).fill(reason);
    
    await this.page.getByRole('button', { name: /submit|confirm/i }).click();
    await this.page.waitForLoadState('networkidle');
    
    await expect(this.page.getByText(/notice.*submitted|received/i)).toBeVisible();
  }
  
  // ============================================================================
  // COMMUNICATION (CA-AC-040 to CA-AC-043)
  // ============================================================================
  
  async sendChatMessage(message: string) {
    await this.gotoMessages();
    await this.chatInput.fill(message);
    await this.sendMessageButton.click();
    await this.page.waitForLoadState('networkidle');
    
    // Verify message appears in chat
    await expect(this.page.getByText(message)).toBeVisible();
  }
  
  async getAnnouncements() {
    await this.notificationCenter.click();
    await this.page.waitForLoadState('networkidle');
    
    return await this.page.locator('[data-announcement], .announcement-item').allTextContents();
  }
  
  async setNotificationPreferences(preferences: {
    email?: boolean;
    sms?: boolean;
    push?: boolean;
    whatsapp?: boolean;
  }) {
    await this.profileNav.click();
    await this.page.getByText(/notification.*preferences|notification.*settings/i).click();
    
    for (const [channel, enabled] of Object.entries(preferences)) {
      const toggle = this.page.getByLabel(new RegExp(channel, 'i'));
      if (enabled) {
        await toggle.check();
      } else {
        await toggle.uncheck();
      }
    }
    
    await this.page.getByRole('button', { name: /save/i }).click();
    await this.page.waitForLoadState('networkidle');
  }
}

export default CustomerAppPage;
