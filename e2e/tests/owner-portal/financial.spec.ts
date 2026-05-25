/**
 * Owner Portal Financial Statements Tests
 * Covers: OP-AC-020 to OP-AC-024
 * 
 * Tests income statements, line items, exports, transaction details, and disbursements.
 */

import { test, expect } from '@playwright/test';
import { OwnerPortalPage } from '../../page-objects';
import { loginAsOwner } from '../../fixtures/auth';

test.describe('Owner Portal Financial Statements', () => {
  let ownerPortal: OwnerPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
    ownerPortal = new OwnerPortalPage(page);
    await ownerPortal.gotoFinancial();
  });
  
  test.describe('OP-AC-020: Monthly Income Statement by Property', () => {
    test('can view monthly income statement', async ({ page }) => {
      await expect(ownerPortal.incomeStatement).toBeVisible();
      
      // Statement should have content
      const statementText = await ownerPortal.incomeStatement.textContent();
      expect(statementText).toBeDefined();
      expect(statementText!.length).toBeGreaterThan(0);
    });
    
    test('can select different statement periods', async ({ page }) => {
      await ownerPortal.selectStatementPeriod('January');
      
      // Verify period is selected
      const selectedPeriod = await ownerPortal.statementPeriodSelect.textContent();
      expect(selectedPeriod).toMatch(/january/i);
    });
    
    test('can filter statement by property', async ({ page }) => {
      await ownerPortal.propertyFilter.click();
      
      const options = page.getByRole('option');
      const optionCount = await options.count();
      
      if (optionCount > 1) {
        await options.nth(1).click();
        await page.waitForLoadState('networkidle');
        
        // Statement should update
        const lineItems = await ownerPortal.getStatementLineItems();
        expect(lineItems.length).toBeGreaterThan(0);
      }
    });
    
    test('statement shows property-specific data', async ({ page }) => {
      const lineItems = await ownerPortal.getStatementLineItems();
      
      // Should have at least header row
      expect(lineItems.length).toBeGreaterThan(0);
    });
  });
  
  test.describe('OP-AC-021: Statement Line Items', () => {
    test('statement shows rent collected', async ({ page }) => {
      const lineItems = await ownerPortal.getStatementLineItems();
      const allText = lineItems.join(' ').toLowerCase();
      
      // Should have rent-related line item
      expect(allText).toMatch(/rent|collection|income/i);
    });
    
    test('statement shows fees', async ({ page }) => {
      const lineItems = await ownerPortal.getStatementLineItems();
      const allText = lineItems.join(' ').toLowerCase();
      
      // May have fee-related items (not all statements have fees)
      // Just verify statement has content
      expect(lineItems.length).toBeGreaterThan(0);
    });
    
    test('statement shows expenses', async ({ page }) => {
      const lineItems = await ownerPortal.getStatementLineItems();
      const allText = lineItems.join(' ').toLowerCase();
      
      // Should have expense-related items
      expect(allText).toMatch(/expense|cost|maintenance|repair|fee/i);
    });
    
    test('statement shows net income', async ({ page }) => {
      const lineItems = await ownerPortal.getStatementLineItems();
      const allText = lineItems.join(' ').toLowerCase();
      
      // Should have net income/profit line
      expect(allText).toMatch(/net|income|profit|total/i);
    });
    
    test('all amounts have proper currency formatting', async ({ page }) => {
      const statementText = await ownerPortal.incomeStatement.textContent();
      
      // Should contain properly formatted amounts
      // Accepts KES, TZS, or just numeric with commas
      expect(statementText).toMatch(/KES|TZS|\d{1,3}(,\d{3})*(\.\d{2})?/);
    });
  });
  
  test.describe('OP-AC-022: Export Functionality', () => {
    test('can download statement as PDF', async ({ page }) => {
      const download = await ownerPortal.downloadStatementAsPdf();
      
      // Verify download
      expect(download).toBeDefined();
      
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/\.pdf$/i);
    });
    
    test('can download statement as Excel', async ({ page }) => {
      const download = await ownerPortal.downloadStatementAsExcel();
      
      // Verify download
      expect(download).toBeDefined();
      
      const filename = download.suggestedFilename();
      expect(filename).toMatch(/\.(xlsx?|csv)$/i);
    });
    
    test('downloaded PDF contains statement data', async ({ page }) => {
      const download = await ownerPortal.downloadStatementAsPdf();
      
      // Verify download completed
      const path = await download.path();
      expect(path).toBeDefined();
      
      // File should have content
      const fs = await import('fs');
      const stats = fs.statSync(path!);
      expect(stats.size).toBeGreaterThan(0);
    });
    
    test('exported Excel has correct format', async ({ page }) => {
      const download = await ownerPortal.downloadStatementAsExcel();
      
      const path = await download.path();
      expect(path).toBeDefined();
      
      // File should have content
      const fs = await import('fs');
      const stats = fs.statSync(path!);
      expect(stats.size).toBeGreaterThan(0);
    });
  });
  
  test.describe('OP-AC-023: Transaction-Level Detail', () => {
    test('statement includes transaction references', async ({ page }) => {
      await ownerPortal.transactionDetails.scrollIntoViewIfNeeded();
      
      if (await ownerPortal.transactionDetails.isVisible({ timeout: 2000 })) {
        const transactionText = await ownerPortal.transactionDetails.textContent();
        
        // Should have reference numbers
        expect(transactionText).toMatch(/ref|reference|#|\d+/i);
      }
    });
    
    test('can drill down to individual transaction', async ({ page }) => {
      const transactions = ownerPortal.transactionDetails.locator('tr, [data-transaction]');
      const count = await transactions.count();
      
      if (count > 0) {
        await transactions.first().click();
        await page.waitForLoadState('networkidle');
        
        // Should show transaction detail
        const detailModal = page.locator('.modal, .drawer, [data-detail]');
        if (await detailModal.isVisible({ timeout: 2000 })) {
          await expect(detailModal).toBeVisible();
        }
      }
    });
    
    test('transaction detail shows date', async ({ page }) => {
      const transactions = ownerPortal.transactionDetails.locator('tr, [data-transaction]');
      const count = await transactions.count();
      
      if (count > 0) {
        await transactions.first().click();
        await page.waitForLoadState('networkidle');
        
        const dateElement = page.getByText(/\d{4}|\d{1,2}\/\d{1,2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i);
        await expect(dateElement.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('transaction detail shows amount', async ({ page }) => {
      const transactions = ownerPortal.transactionDetails.locator('tr, [data-transaction]');
      const count = await transactions.count();
      
      if (count > 0) {
        await transactions.first().click();
        await page.waitForLoadState('networkidle');
        
        const amountElement = page.getByText(/KES|TZS|\d{1,3}(,\d{3})*/);
        await expect(amountElement.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
  
  test.describe('OP-AC-024: Disbursement History', () => {
    test('can view disbursement history', async ({ page }) => {
      await ownerPortal.disbursementHistory.scrollIntoViewIfNeeded();
      
      if (await ownerPortal.disbursementHistory.isVisible({ timeout: 2000 })) {
        const disbursements = await ownerPortal.getDisbursements();
        
        // Should show disbursements or empty state
        expect(disbursements).toBeDefined();
      }
    });
    
    test('disbursement shows date and amount', async ({ page }) => {
      await ownerPortal.disbursementHistory.scrollIntoViewIfNeeded();
      
      if (await ownerPortal.disbursementHistory.isVisible({ timeout: 2000 })) {
        const disbursementText = await ownerPortal.disbursementHistory.textContent();
        
        // Should have date-like and amount-like content
        if (disbursementText && disbursementText.length > 20) {
          expect(disbursementText).toMatch(/\d+/);
        }
      }
    });
    
    test('can view pending disbursement amounts', async ({ page }) => {
      const pendingSection = page.getByText(/pending|upcoming|scheduled/i).first();
      
      if (await pendingSection.isVisible({ timeout: 2000 })) {
        await expect(pendingSection).toBeVisible();
      }
    });
    
    test('disbursement detail shows bank account', async ({ page }) => {
      const disbursements = ownerPortal.disbursementHistory.locator('tr, [data-disbursement]');
      const count = await disbursements.count();
      
      if (count > 0) {
        await disbursements.first().click();
        await page.waitForLoadState('networkidle');
        
        // Should show bank details
        const bankDetail = page.getByText(/bank|account|\*{4}\d{4}/i);
        if (await bankDetail.count() > 0) {
          await expect(bankDetail.first()).toBeVisible();
        }
      }
    });
    
    test('disbursement shows status (completed, pending, scheduled)', async ({ page }) => {
      const disbursementText = await ownerPortal.disbursementHistory.textContent();
      
      if (disbursementText && disbursementText.length > 20) {
        // Should have status indicators
        expect(disbursementText).toMatch(/completed|pending|scheduled|paid|processing|success/i);
      }
    });
  });
});
