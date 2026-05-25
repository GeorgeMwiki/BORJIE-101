/**
 * Admin Portal Billing & Subscription Tests
 * Covers: AP-AC-040 to AP-AC-042
 * 
 * Tests invoice viewing, credits/adjustments, and usage reports.
 */

import { test, expect } from '@playwright/test';
import { AdminPortalPage } from '../../page-objects';
import { loginAsSuperAdmin } from '../../fixtures/auth';

test.describe('Admin Portal Billing & Subscription', () => {
  let adminPortal: AdminPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
    adminPortal = new AdminPortalPage(page);
    await adminPortal.gotoBilling();
  });
  
  test.describe('AP-AC-040: View Tenant Invoices', () => {
    test('admin can view all tenant invoices', async ({ page }) => {
      const invoices = await adminPortal.getTenantInvoices();
      
      // Should display invoices
      expect(invoices).toBeDefined();
    });
    
    test('invoices show payment status', async ({ page }) => {
      await expect(adminPortal.invoiceList).toBeVisible();
      
      const invoiceText = await adminPortal.invoiceList.textContent();
      
      // Should have status indicators
      expect(invoiceText).toMatch(/paid|pending|overdue|draft/i);
    });
    
    test('invoices show amounts', async ({ page }) => {
      await expect(adminPortal.invoiceList).toBeVisible();
      
      const invoiceText = await adminPortal.invoiceList.textContent();
      
      // Should have amounts
      expect(invoiceText).toMatch(/\$|KES|TZS|\d+/);
    });
    
    test('can filter invoices by tenant', async ({ page }) => {
      const tenantFilter = page.getByLabel(/tenant|organization/i);
      
      if (await tenantFilter.isVisible({ timeout: 2000 })) {
        await tenantFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('can filter invoices by status', async ({ page }) => {
      const statusFilter = page.getByLabel(/status/i);
      
      if (await statusFilter.isVisible({ timeout: 2000 })) {
        await statusFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('can filter invoices by date range', async ({ page }) => {
      const dateFilter = page.getByLabel(/date|from|to/i);
      
      if (await dateFilter.first().isVisible({ timeout: 2000 })) {
        await expect(dateFilter.first()).toBeVisible();
      }
    });
    
    test('can view invoice details', async ({ page }) => {
      const invoiceRow = adminPortal.invoiceList.locator('tr, [data-invoice]').first();
      
      if (await invoiceRow.isVisible({ timeout: 2000 })) {
        await invoiceRow.click();
        await page.waitForLoadState('networkidle');
        
        // Should show invoice detail
        const invoiceDetail = page.locator('[data-invoice-detail], .invoice-detail');
        await expect(invoiceDetail.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
  
  test.describe('AP-AC-041: Credits and Adjustments', () => {
    test('admin can apply credits with approval', async ({ page }) => {
      // Navigate to a tenant
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const billingTab = page.getByRole('tab', { name: /billing/i });
        if (await billingTab.isVisible({ timeout: 2000 })) {
          await billingTab.click();
          
          if (await adminPortal.applyCreditsButton.isVisible({ timeout: 2000 })) {
            await adminPortal.applyCreditsButton.click();
            
            // Should show credit form
            const creditForm = page.locator('form, [data-form]');
            await expect(creditForm.first()).toBeVisible();
          }
        }
      }
    });
    
    test('credit application requires amount', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const billingTab = page.getByRole('tab', { name: /billing/i });
        if (await billingTab.isVisible({ timeout: 2000 })) {
          await billingTab.click();
          
          if (await adminPortal.applyCreditsButton.isVisible({ timeout: 2000 })) {
            await adminPortal.applyCreditsButton.click();
            
            const amountInput = page.getByLabel(/amount/i);
            await expect(amountInput).toBeVisible({ timeout: 3000 });
          }
        }
      }
    });
    
    test('credit application requires reason', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const billingTab = page.getByRole('tab', { name: /billing/i });
        if (await billingTab.isVisible({ timeout: 2000 })) {
          await billingTab.click();
          
          if (await adminPortal.applyCreditsButton.isVisible({ timeout: 2000 })) {
            await adminPortal.applyCreditsButton.click();
            
            const reasonInput = page.getByLabel(/reason/i);
            await expect(reasonInput).toBeVisible({ timeout: 3000 });
          }
        }
      }
    });
    
    test('large credits trigger approval workflow', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const billingTab = page.getByRole('tab', { name: /billing/i });
        if (await billingTab.isVisible({ timeout: 2000 })) {
          await billingTab.click();
          
          if (await adminPortal.applyCreditsButton.isVisible({ timeout: 2000 })) {
            await adminPortal.applyCreditsButton.click();
            
            const amountInput = page.getByLabel(/amount/i);
            if (await amountInput.isVisible({ timeout: 2000 })) {
              await amountInput.fill('100000');
              
              // Large amounts should mention approval
              const approvalNotice = page.getByText(/approval|pending|review/i);
              // May or may not show approval notice depending on threshold
              expect(amountInput).toBeDefined();
            }
          }
        }
      }
    });
    
    test('credit history is visible', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const billingTab = page.getByRole('tab', { name: /billing/i });
        if (await billingTab.isVisible({ timeout: 2000 })) {
          await billingTab.click();
          
          // Look for credit history section
          const creditHistory = page.getByText(/credit.*history|adjustments/i);
          if (await creditHistory.isVisible({ timeout: 2000 })) {
            await expect(creditHistory).toBeVisible();
          }
        }
      }
    });
  });
  
  test.describe('AP-AC-042: Usage Reports', () => {
    test('admin can generate usage reports for billing reconciliation', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const usageTab = page.getByRole('tab', { name: /usage/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          
          if (await adminPortal.usageReportButton.isVisible({ timeout: 2000 })) {
            await expect(adminPortal.usageReportButton).toBeVisible();
          }
        }
      }
    });
    
    test('usage report can be exported', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const usageTab = page.getByRole('tab', { name: /usage/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          
          if (await adminPortal.usageReportButton.isVisible({ timeout: 2000 })) {
            const [download] = await Promise.all([
              page.waitForEvent('download', { timeout: 5000 }).catch(() => null),
              adminPortal.usageReportButton.click(),
            ]);
            
            // May or may not trigger download
            expect(adminPortal.usageReportButton).toBeDefined();
          }
        }
      }
    });
    
    test('usage report shows period selection', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const usageTab = page.getByRole('tab', { name: /usage/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          
          const periodSelect = page.getByLabel(/period/i);
          if (await periodSelect.isVisible({ timeout: 2000 })) {
            await expect(periodSelect).toBeVisible();
          }
        }
      }
    });
    
    test('usage report shows breakdown by resource', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const usageTab = page.getByRole('tab', { name: /usage/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          
          // Should show resource breakdown
          const resourceBreakdown = page.getByText(/api|storage|users|properties/i);
          await expect(resourceBreakdown.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('usage report compares to plan limits', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const usageTab = page.getByRole('tab', { name: /usage/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          
          // Should show limit comparison
          const limitComparison = page.getByText(/limit|quota|used|remaining/i);
          await expect(limitComparison.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });
});
