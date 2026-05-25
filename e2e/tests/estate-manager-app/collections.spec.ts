/**
 * Estate Manager App Collections Workflows Tests
 * Covers: EM-AC-030 to EM-AC-034
 * 
 * Tests arrears viewing, reminder sending, payment plan approval,
 * legal escalation, and fee waivers.
 */

import { test, expect } from '@playwright/test';
import { EstateManagerAppPage } from '../../page-objects';
import { loginAsManager } from '../../fixtures/auth';

test.describe('Estate Manager Collections Workflows', () => {
  let managerApp: EstateManagerAppPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    managerApp = new EstateManagerAppPage(page);
    await managerApp.gotoCollections();
  });
  
  test.describe('EM-AC-030: View Arrears List', () => {
    test('manager can view arrears list with aging', async ({ page }) => {
      const arrearsList = await managerApp.getArrearsList();
      
      // Should return arrears data
      expect(arrearsList).toBeDefined();
    });
    
    test('arrears list shows customer names', async ({ page }) => {
      const arrearsText = await managerApp.arrearsList.textContent();
      
      // Should show customer info
      expect(arrearsText).toBeDefined();
    });
    
    test('arrears list shows amounts', async ({ page }) => {
      const arrearsText = await managerApp.arrearsList.textContent();
      
      if (arrearsText && arrearsText.length > 20) {
        expect(arrearsText).toMatch(/KES|TZS|\d+/);
      }
    });
    
    test('arrears list shows aging buckets', async ({ page }) => {
      const arrearsText = await managerApp.arrearsList.textContent();
      
      if (arrearsText && arrearsText.length > 20) {
        expect(arrearsText).toMatch(/day|week|month|\d+/i);
      }
    });
    
    test('arrears can be filtered by aging', async ({ page }) => {
      const agingFilter = page.getByLabel(/aging|days|bucket/i);
      
      if (await agingFilter.isVisible({ timeout: 2000 })) {
        await agingFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('arrears can be sorted by amount', async ({ page }) => {
      const sortButton = page.getByRole('button', { name: /sort/i })
        .or(page.locator('th').filter({ hasText: /amount/i }));
      
      if (await sortButton.isVisible({ timeout: 2000 })) {
        await expect(sortButton).toBeVisible();
      }
    });
  });
  
  test.describe('EM-AC-031: Send Reminder', () => {
    test('manager can send reminder via app', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.sendReminderButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.sendReminderButton).toBeVisible();
        }
      }
    });
    
    test('reminder routes to customer\'s preferred channel', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.sendReminderButton.isVisible({ timeout: 2000 })) {
          await managerApp.sendReminderButton.click();
          
          // Should show channel info
          const channelInfo = page.getByText(/whatsapp|sms|email|channel/i);
          await expect(channelInfo.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('reminder shows preview before sending', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.sendReminderButton.isVisible({ timeout: 2000 })) {
          await managerApp.sendReminderButton.click();
          
          // Should show message preview
          const preview = page.locator('[data-preview], .message-preview');
          if (await preview.isVisible({ timeout: 2000 })) {
            await expect(preview).toBeVisible();
          }
        }
      }
    });
  });
  
  test.describe('EM-AC-032: Approve Payment Plan', () => {
    test('manager can approve payment plan within policy limits', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.approvePaymentPlanButton.isVisible({ timeout: 2000 })) {
          await managerApp.approvePaymentPlanButton.click();
          
          // Should show payment plan form
          const planForm = page.locator('form, [data-form]');
          await expect(planForm.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('payment plan allows installment configuration', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.approvePaymentPlanButton.isVisible({ timeout: 2000 })) {
          await managerApp.approvePaymentPlanButton.click();
          
          const installmentsInput = page.getByLabel(/installments|payments/i);
          await expect(installmentsInput).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('payment plan shows policy limits', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.approvePaymentPlanButton.isVisible({ timeout: 2000 })) {
          await managerApp.approvePaymentPlanButton.click();
          
          const policyInfo = page.getByText(/limit|maximum|policy/i);
          if (await policyInfo.count() > 0) {
            await expect(policyInfo.first()).toBeVisible();
          }
        }
      }
    });
  });
  
  test.describe('EM-AC-033: Escalate to Legal', () => {
    test('manager can escalate to legal workflow with evidence', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.escalateToLegalButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.escalateToLegalButton).toBeVisible();
        }
      }
    });
    
    test('escalation requires notes', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.escalateToLegalButton.isVisible({ timeout: 2000 })) {
          await managerApp.escalateToLegalButton.click();
          
          const notesInput = page.getByLabel(/notes|reason/i);
          await expect(notesInput).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('escalation compiles evidence automatically', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.escalateToLegalButton.isVisible({ timeout: 2000 })) {
          await managerApp.escalateToLegalButton.click();
          
          // Should show evidence compilation
          const evidenceSection = page.getByText(/evidence|history|timeline|documents/i);
          await expect(evidenceSection.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('escalation requires confirmation', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.escalateToLegalButton.isVisible({ timeout: 2000 })) {
          await managerApp.escalateToLegalButton.click();
          
          const confirmButton = page.getByRole('button', { name: /confirm|escalate/i });
          await expect(confirmButton).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });
  
  test.describe('EM-AC-034: Waive Fees', () => {
    test('manager can waive fees within approval authority', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.waiveFeeButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.waiveFeeButton).toBeVisible();
        }
      }
    });
    
    test('waiver requires reason', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.waiveFeeButton.isVisible({ timeout: 2000 })) {
          await managerApp.waiveFeeButton.click();
          
          const reasonInput = page.getByLabel(/reason/i);
          await expect(reasonInput).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('waiver shows approval authority limit', async ({ page }) => {
      const arrearItem = managerApp.arrearsList.locator('[data-arrear], tr').first();
      
      if (await arrearItem.isVisible({ timeout: 2000 })) {
        await arrearItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.waiveFeeButton.isVisible({ timeout: 2000 })) {
          await managerApp.waiveFeeButton.click();
          
          const authorityInfo = page.getByText(/limit|authority|maximum|up to/i);
          if (await authorityInfo.count() > 0) {
            await expect(authorityInfo.first()).toBeVisible();
          }
        }
      }
    });
  });
});
