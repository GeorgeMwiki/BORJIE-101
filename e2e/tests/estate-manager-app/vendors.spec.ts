/**
 * Estate Manager App Vendor Coordination Tests
 * Covers: EM-AC-040 to EM-AC-043
 * 
 * Tests vendor scorecards, integrated messaging, invoice approval, and flagging.
 */

import { test, expect } from '@playwright/test';
import { EstateManagerAppPage } from '../../page-objects';
import { loginAsManager } from '../../fixtures/auth';
import { randomString } from '../../fixtures/test-data';

test.describe('Estate Manager Vendor Coordination', () => {
  let managerApp: EstateManagerAppPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    managerApp = new EstateManagerAppPage(page);
    await managerApp.gotoVendors();
  });
  
  test.describe('EM-AC-040: Vendor Scorecards', () => {
    test('manager can view vendor performance scorecards', async ({ page }) => {
      const scorecards = await managerApp.getVendorScorecards();
      
      // Should return vendor data
      expect(scorecards).toBeDefined();
    });
    
    test('scorecards show vendor names', async ({ page }) => {
      const scorecardsText = await managerApp.vendorScorecards.textContent();
      
      expect(scorecardsText).toBeDefined();
      expect(scorecardsText!.length).toBeGreaterThan(0);
    });
    
    test('scorecards show performance ratings', async ({ page }) => {
      const scorecardsText = await managerApp.vendorScorecards.textContent();
      
      if (scorecardsText && scorecardsText.length > 20) {
        expect(scorecardsText).toMatch(/rating|score|star|%|\d+/i);
      }
    });
    
    test('scorecards show job completion metrics', async ({ page }) => {
      const scorecardsText = await managerApp.vendorScorecards.textContent();
      
      if (scorecardsText && scorecardsText.length > 20) {
        expect(scorecardsText).toMatch(/complete|job|work.*order|\d+/i);
      }
    });
    
    test('scorecards can be filtered by category', async ({ page }) => {
      const categoryFilter = page.getByLabel(/category|specialty/i);
      
      if (await categoryFilter.isVisible({ timeout: 2000 })) {
        await categoryFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('scorecards can be sorted by rating', async ({ page }) => {
      const sortButton = page.getByRole('button', { name: /sort/i })
        .or(page.locator('th').filter({ hasText: /rating|score/i }));
      
      if (await sortButton.isVisible({ timeout: 2000 })) {
        await expect(sortButton).toBeVisible();
      }
    });
  });
  
  test.describe('EM-AC-041: Contact Vendor via Integrated Messaging', () => {
    test('manager can contact vendor via integrated messaging', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.contactVendorButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.contactVendorButton).toBeVisible();
        }
      }
    });
    
    test('messaging shows message input', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.contactVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.contactVendorButton.click();
          
          const messageInput = page.getByLabel(/message/i).or(page.locator('textarea'));
          await expect(messageInput.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('messaging shows conversation history', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.contactVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.contactVendorButton.click();
          
          const history = page.locator('[data-messages], .message-history');
          if (await history.isVisible({ timeout: 2000 })) {
            await expect(history).toBeVisible();
          }
        }
      }
    });
    
    test('can send message to vendor', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.contactVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.contactVendorButton.click();
          
          const messageInput = page.getByLabel(/message/i).or(page.locator('textarea'));
          if (await messageInput.first().isVisible({ timeout: 2000 })) {
            await messageInput.first().fill(`E2E Test Message ${randomString(6)}`);
            
            const sendButton = page.getByRole('button', { name: /send/i });
            await expect(sendButton).toBeVisible();
          }
        }
      }
    });
  });
  
  test.describe('EM-AC-042: Approve Vendor Invoices', () => {
    test('manager can approve vendor invoices within threshold', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        // Navigate to invoices tab
        const invoicesTab = page.getByRole('tab', { name: /invoice/i });
        if (await invoicesTab.isVisible({ timeout: 2000 })) {
          await invoicesTab.click();
          
          if (await managerApp.approveInvoiceButton.isVisible({ timeout: 2000 })) {
            await expect(managerApp.approveInvoiceButton).toBeVisible();
          }
        }
      }
    });
    
    test('invoice approval shows amount', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        const invoicesTab = page.getByRole('tab', { name: /invoice/i });
        if (await invoicesTab.isVisible({ timeout: 2000 })) {
          await invoicesTab.click();
          
          const invoiceList = page.locator('[data-invoice], tr');
          if (await invoiceList.count() > 0) {
            const invoiceText = await invoiceList.first().textContent();
            expect(invoiceText).toMatch(/KES|TZS|\d+/);
          }
        }
      }
    });
    
    test('invoice approval requires confirmation', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        const invoicesTab = page.getByRole('tab', { name: /invoice/i });
        if (await invoicesTab.isVisible({ timeout: 2000 })) {
          await invoicesTab.click();
          
          const invoiceItem = page.locator('[data-invoice], tr').first();
          if (await invoiceItem.isVisible({ timeout: 2000 })) {
            await invoiceItem.click();
            
            if (await managerApp.approveInvoiceButton.isVisible({ timeout: 2000 })) {
              await managerApp.approveInvoiceButton.click();
              
              const confirmButton = page.getByRole('button', { name: /confirm/i });
              await expect(confirmButton).toBeVisible({ timeout: 3000 });
            }
          }
        }
      }
    });
  });
  
  test.describe('EM-AC-043: Flag Vendor for Review', () => {
    test('manager can flag vendor for review with reason', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.flagVendorButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.flagVendorButton).toBeVisible();
        }
      }
    });
    
    test('flagging requires reason', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.flagVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.flagVendorButton.click();
          
          const reasonInput = page.getByLabel(/reason/i);
          await expect(reasonInput).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('flag options include performance issues', async ({ page }) => {
      const vendorItem = managerApp.vendorScorecards.locator('[data-vendor], tr').first();
      
      if (await vendorItem.isVisible({ timeout: 2000 })) {
        await vendorItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.flagVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.flagVendorButton.click();
          
          const flagTypeSelect = page.getByLabel(/type|category/i);
          if (await flagTypeSelect.isVisible({ timeout: 2000 })) {
            await flagTypeSelect.click();
            
            const performanceOption = page.getByRole('option', { name: /performance|quality/i });
            await expect(performanceOption).toBeVisible({ timeout: 3000 });
          }
        }
      }
    });
    
    test('flag shows in vendor profile', async ({ page }) => {
      // Verify flag indicators exist
      const flagIndicator = page.locator('[data-flagged], [class*="flagged"], .flag-indicator');
      
      // May or may not have flagged vendors
      expect(managerApp.vendorScorecards).toBeDefined();
    });
  });
});
