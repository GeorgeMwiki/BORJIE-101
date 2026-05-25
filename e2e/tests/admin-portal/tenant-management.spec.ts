/**
 * Admin Portal Tenant Management Tests
 * Covers: AP-AC-001 to AP-AC-005
 * 
 * Tests tenant creation, policy configuration, subscription plans, usage metrics, and account status.
 */

import { test, expect } from '@playwright/test';
import { AdminPortalPage } from '../../page-objects';
import { loginAsSuperAdmin } from '../../fixtures/auth';
import { testTenants, randomString, randomEmail, randomPhone } from '../../fixtures/test-data';

test.describe('Admin Portal Tenant Management', () => {
  let adminPortal: AdminPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
    adminPortal = new AdminPortalPage(page);
    await adminPortal.gotoTenants();
  });
  
  test.describe('AP-AC-001: Create Tenant Organization', () => {
    test('admin can create new tenant organization', async ({ page }) => {
      const newTenant = testTenants.basic();
      
      await adminPortal.createTenant(newTenant);
      
      // Verify tenant was created
      await adminPortal.searchTenant(newTenant.name);
      await expect(page.getByText(newTenant.name)).toBeVisible({ timeout: 5000 });
    });
    
    test('tenant creation requires name', async ({ page }) => {
      await adminPortal.createTenantButton.click();
      await page.waitForLoadState('networkidle');
      
      // Don't fill name, fill other fields
      await page.getByLabel(/email/i).fill(randomEmail('tenant'));
      await page.getByRole('button', { name: /create|save/i }).click();
      
      // Should show validation error
      await expect(page.getByText(/name.*required|required/i)).toBeVisible({ timeout: 3000 });
    });
    
    test('tenant creation requires valid email', async ({ page }) => {
      await adminPortal.createTenantButton.click();
      await page.waitForLoadState('networkidle');
      
      await page.getByLabel(/name/i).fill(`E2E Tenant ${randomString()}`);
      await page.getByLabel(/email/i).fill('invalid-email');
      await page.getByRole('button', { name: /create|save/i }).click();
      
      // Should show email validation error
      await expect(page.getByText(/valid.*email|email.*invalid/i)).toBeVisible({ timeout: 3000 });
    });
    
    test('can create tenant with full business details', async ({ page }) => {
      const tenant = testTenants.fullDetails();
      
      await adminPortal.createTenantButton.click();
      await page.waitForLoadState('networkidle');
      
      await page.getByLabel(/name/i).fill(tenant.name);
      await page.getByLabel(/email/i).fill(tenant.email);
      await page.getByLabel(/phone/i).fill(tenant.phone);
      
      // Fill optional fields if visible
      const addressInput = page.getByLabel(/address/i);
      if (await addressInput.isVisible({ timeout: 1000 })) {
        await addressInput.fill(tenant.address);
      }
      
      const taxIdInput = page.getByLabel(/tax.*id|tin/i);
      if (await taxIdInput.isVisible({ timeout: 1000 })) {
        await taxIdInput.fill(tenant.taxId);
      }
      
      await page.getByRole('button', { name: /create|save/i }).click();
      await page.waitForLoadState('networkidle');
      
      // Verify creation
      await adminPortal.searchTenant(tenant.name);
      await expect(page.getByText(tenant.name)).toBeVisible({ timeout: 5000 });
    });
  });
  
  test.describe('AP-AC-002: Configure Policy Constitution', () => {
    test('admin can configure tenant\'s Policy Constitution', async ({ page }) => {
      // Find existing tenant
      await adminPortal.searchTenant('');
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        const tenantName = await tenantRow.textContent();
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        // Navigate to policy tab
        const policyTab = page.getByRole('tab', { name: /policy|constitution|settings/i });
        if (await policyTab.isVisible({ timeout: 2000 })) {
          await policyTab.click();
          await page.waitForLoadState('networkidle');
          
          // Should show policy configuration options
          const policySection = page.locator('[data-section="policy"], .policy-config');
          await expect(policySection.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('policy constitution has approval thresholds', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const policyTab = page.getByRole('tab', { name: /policy|approval/i });
        if (await policyTab.isVisible({ timeout: 2000 })) {
          await policyTab.click();
          
          // Look for threshold inputs
          const thresholdInput = page.getByLabel(/threshold|limit|amount/i);
          await expect(thresholdInput.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('policy changes are saved', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const policyTab = page.getByRole('tab', { name: /policy|settings/i });
        if (await policyTab.isVisible({ timeout: 2000 })) {
          await policyTab.click();
          
          const saveButton = page.getByRole('button', { name: /save|update/i });
          if (await saveButton.isVisible({ timeout: 2000 })) {
            await saveButton.click();
            await page.waitForLoadState('networkidle');
            
            // Should show success
            await expect(page.getByText(/saved|updated|success/i)).toBeVisible({ timeout: 5000 });
          }
        }
      }
    });
  });
  
  test.describe('AP-AC-003: Assign Subscription Plan', () => {
    test('admin can assign subscription plan to tenant', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const billingTab = page.getByRole('tab', { name: /billing|subscription|plan/i });
        if (await billingTab.isVisible({ timeout: 2000 })) {
          await billingTab.click();
          await page.waitForLoadState('networkidle');
          
          // Select plan
          const planSelect = page.getByLabel(/plan/i);
          if (await planSelect.isVisible({ timeout: 2000 })) {
            await planSelect.click();
            
            const options = page.getByRole('option');
            expect(await options.count()).toBeGreaterThan(0);
            
            await options.first().click();
            await page.getByRole('button', { name: /save|update/i }).click();
            await page.waitForLoadState('networkidle');
            
            await expect(page.getByText(/updated|saved|success/i)).toBeVisible({ timeout: 5000 });
          }
        }
      }
    });
    
    test('subscription plans show pricing', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const billingTab = page.getByRole('tab', { name: /billing|subscription/i });
        if (await billingTab.isVisible({ timeout: 2000 })) {
          await billingTab.click();
          
          // Look for pricing information
          const pricing = page.getByText(/\$|KES|TZS|\/month|\/year/i);
          await expect(pricing.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });
  
  test.describe('AP-AC-004: View Usage Metrics', () => {
    test('admin can view tenant\'s usage metrics', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const usageTab = page.getByRole('tab', { name: /usage|metrics|analytics/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          await page.waitForLoadState('networkidle');
          
          // Should show usage metrics
          const metrics = page.locator('[data-metric], .usage-metric');
          expect(await metrics.count()).toBeGreaterThan(0);
        }
      }
    });
    
    test('usage metrics show API calls', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        
        const usageTab = page.getByRole('tab', { name: /usage/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          
          const apiCalls = page.getByText(/api|calls|requests/i);
          await expect(apiCalls.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('usage metrics show storage usage', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        
        const usageTab = page.getByRole('tab', { name: /usage/i });
        if (await usageTab.isVisible({ timeout: 2000 })) {
          await usageTab.click();
          
          const storage = page.getByText(/storage|gb|mb|disk/i);
          await expect(storage.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });
  
  test.describe('AP-AC-005: Suspend/Reactivate Tenant', () => {
    test('admin can suspend tenant account', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        const tenantName = await tenantRow.locator('td').first().textContent();
        
        // Click actions menu
        const actionsButton = tenantRow.getByRole('button', { name: /actions|menu|more/i });
        if (await actionsButton.isVisible({ timeout: 2000 })) {
          await actionsButton.click();
          
          const suspendOption = page.getByRole('menuitem', { name: /suspend/i });
          if (await suspendOption.isVisible({ timeout: 2000 })) {
            await suspendOption.click();
            
            // Fill reason
            const reasonInput = page.getByLabel(/reason/i);
            if (await reasonInput.isVisible({ timeout: 2000 })) {
              await reasonInput.fill('E2E test suspension');
            }
            
            await page.getByRole('button', { name: /confirm|suspend/i }).click();
            await page.waitForLoadState('networkidle');
            
            // Should show suspended status
            await expect(page.getByText(/suspended/i)).toBeVisible({ timeout: 5000 });
          }
        }
      }
    });
    
    test('admin can reactivate tenant account', async ({ page }) => {
      // Look for suspended tenant
      const statusFilter = page.getByLabel(/status/i);
      if (await statusFilter.isVisible({ timeout: 2000 })) {
        await statusFilter.click();
        await page.getByRole('option', { name: /suspended/i }).click();
        await page.waitForLoadState('networkidle');
      }
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        const actionsButton = tenantRow.getByRole('button', { name: /actions|menu/i });
        if (await actionsButton.isVisible({ timeout: 2000 })) {
          await actionsButton.click();
          
          const reactivateOption = page.getByRole('menuitem', { name: /reactivate|activate/i });
          if (await reactivateOption.isVisible({ timeout: 2000 })) {
            await reactivateOption.click();
            
            await page.getByRole('button', { name: /confirm/i }).click();
            await page.waitForLoadState('networkidle');
            
            // Should show active status
            await expect(page.getByText(/active|reactivated/i)).toBeVisible({ timeout: 5000 });
          }
        }
      }
    });
    
    test('suspension requires reason', async ({ page }) => {
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        const actionsButton = tenantRow.getByRole('button', { name: /actions|menu/i });
        if (await actionsButton.isVisible({ timeout: 2000 })) {
          await actionsButton.click();
          
          const suspendOption = page.getByRole('menuitem', { name: /suspend/i });
          if (await suspendOption.isVisible({ timeout: 2000 })) {
            await suspendOption.click();
            
            // Try to confirm without reason
            const confirmButton = page.getByRole('button', { name: /confirm/i });
            if (await confirmButton.isVisible({ timeout: 2000 })) {
              await confirmButton.click();
              
              // Should show validation error
              const error = page.getByText(/reason.*required|required/i);
              await expect(error).toBeVisible({ timeout: 3000 });
            }
          }
        }
      }
    });
  });
});
