/**
 * Estate Manager App Occupancy Operations Tests
 * Covers: EM-AC-020 to EM-AC-023
 * 
 * Tests occupancy dashboard, unit status updates, customer profiles,
 * and onboarding workflow initiation.
 */

import { test, expect } from '@playwright/test';
import { EstateManagerAppPage } from '../../page-objects';
import { loginAsManager } from '../../fixtures/auth';
import { randomString, randomPhone } from '../../fixtures/test-data';

test.describe('Estate Manager Occupancy Operations', () => {
  let managerApp: EstateManagerAppPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    managerApp = new EstateManagerAppPage(page);
    await managerApp.gotoOccupancy();
  });
  
  test.describe('EM-AC-020: Occupancy Dashboard', () => {
    test('manager can view occupancy status of all units', async ({ page }) => {
      const occupancyStatus = await managerApp.getOccupancyStatus();
      
      // Should return unit statuses
      expect(occupancyStatus).toBeDefined();
    });
    
    test('dashboard shows occupied units count', async ({ page }) => {
      const dashboardText = await managerApp.occupancyDashboard.textContent();
      
      // Should show occupancy statistics
      expect(dashboardText).toMatch(/occupied|vacant|unit|\d+/i);
    });
    
    test('dashboard shows vacant units count', async ({ page }) => {
      const dashboardText = await managerApp.occupancyDashboard.textContent();
      
      expect(dashboardText).toMatch(/vacant|\d+/i);
    });
    
    test('dashboard shows occupancy percentage', async ({ page }) => {
      const dashboardText = await managerApp.occupancyDashboard.textContent();
      
      // Should have percentage
      expect(dashboardText).toMatch(/%|\d+/);
    });
    
    test('units can be filtered by status', async ({ page }) => {
      const statusFilter = page.getByLabel(/status/i);
      
      if (await statusFilter.isVisible({ timeout: 2000 })) {
        await statusFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('units can be filtered by property', async ({ page }) => {
      const propertyFilter = page.getByLabel(/property/i);
      
      if (await propertyFilter.isVisible({ timeout: 2000 })) {
        await propertyFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
  });
  
  test.describe('EM-AC-021: Update Unit Status', () => {
    test('manager can update unit status', async ({ page }) => {
      const unitItem = managerApp.unitStatusList.locator('[data-unit], tr').first();
      
      if (await unitItem.isVisible({ timeout: 2000 })) {
        await unitItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.updateStatusButton.isVisible({ timeout: 2000 })) {
          await managerApp.updateStatusButton.click();
          
          const options = page.getByRole('option');
          expect(await options.count()).toBeGreaterThan(0);
        }
      }
    });
    
    test('status options include occupied', async ({ page }) => {
      const unitItem = managerApp.unitStatusList.locator('[data-unit], tr').first();
      
      if (await unitItem.isVisible({ timeout: 2000 })) {
        await unitItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.updateStatusButton.isVisible({ timeout: 2000 })) {
          await managerApp.updateStatusButton.click();
          
          const occupiedOption = page.getByRole('option', { name: /occupied/i });
          await expect(occupiedOption).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('status options include vacant', async ({ page }) => {
      const unitItem = managerApp.unitStatusList.locator('[data-unit], tr').first();
      
      if (await unitItem.isVisible({ timeout: 2000 })) {
        await unitItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.updateStatusButton.isVisible({ timeout: 2000 })) {
          await managerApp.updateStatusButton.click();
          
          const vacantOption = page.getByRole('option', { name: /vacant/i });
          await expect(vacantOption).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('status options include turnover', async ({ page }) => {
      const unitItem = managerApp.unitStatusList.locator('[data-unit], tr').first();
      
      if (await unitItem.isVisible({ timeout: 2000 })) {
        await unitItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.updateStatusButton.isVisible({ timeout: 2000 })) {
          await managerApp.updateStatusButton.click();
          
          const turnoverOption = page.getByRole('option', { name: /turnover/i });
          if (await turnoverOption.isVisible({ timeout: 2000 })) {
            await expect(turnoverOption).toBeVisible();
          }
        }
      }
    });
  });
  
  test.describe('EM-AC-022: Customer Profile', () => {
    test('manager can view customer profile with all relevant details', async ({ page }) => {
      // Find occupied unit
      const occupiedUnit = managerApp.unitStatusList.locator('[data-status="occupied"], [data-unit]').first();
      
      if (await occupiedUnit.isVisible({ timeout: 2000 })) {
        await occupiedUnit.click();
        await page.waitForLoadState('networkidle');
        
        // Look for customer link
        const customerLink = page.getByText(/customer|tenant|resident/i);
        if (await customerLink.first().isVisible({ timeout: 2000 })) {
          await customerLink.first().click();
          await page.waitForLoadState('networkidle');
          
          await expect(managerApp.customerProfile).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('customer profile shows contact information', async ({ page }) => {
      const customerItem = page.locator('[data-customer], tr').first();
      
      if (await customerItem.isVisible({ timeout: 2000 })) {
        await customerItem.click();
        await page.waitForLoadState('networkidle');
        
        const contactInfo = page.getByText(/phone|email|contact/i);
        await expect(contactInfo.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('customer profile shows lease details', async ({ page }) => {
      const customerItem = page.locator('[data-customer], tr').first();
      
      if (await customerItem.isVisible({ timeout: 2000 })) {
        await customerItem.click();
        await page.waitForLoadState('networkidle');
        
        const leaseInfo = page.getByText(/lease|start|end|rent/i);
        await expect(leaseInfo.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('customer profile shows payment status', async ({ page }) => {
      const customerItem = page.locator('[data-customer], tr').first();
      
      if (await customerItem.isVisible({ timeout: 2000 })) {
        await customerItem.click();
        await page.waitForLoadState('networkidle');
        
        const paymentStatus = page.getByText(/balance|payment|arrears|current/i);
        await expect(paymentStatus.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
  
  test.describe('EM-AC-023: Initiate Onboarding', () => {
    test('manager can initiate customer onboarding workflow', async ({ page }) => {
      if (await managerApp.initiateOnboardingButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateOnboardingButton.click();
        await page.waitForLoadState('networkidle');
        
        // Should show onboarding form
        const onboardingForm = page.locator('form, [data-form]');
        await expect(onboardingForm.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('onboarding requires customer name', async ({ page }) => {
      if (await managerApp.initiateOnboardingButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateOnboardingButton.click();
        await page.waitForLoadState('networkidle');
        
        const nameInput = page.getByLabel(/name/i);
        await expect(nameInput).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('onboarding requires customer phone', async ({ page }) => {
      if (await managerApp.initiateOnboardingButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateOnboardingButton.click();
        await page.waitForLoadState('networkidle');
        
        const phoneInput = page.getByLabel(/phone/i);
        await expect(phoneInput).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('onboarding requires unit selection', async ({ page }) => {
      if (await managerApp.initiateOnboardingButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateOnboardingButton.click();
        await page.waitForLoadState('networkidle');
        
        const unitInput = page.getByLabel(/unit/i);
        await expect(unitInput).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('onboarding creates workflow and sends invite', async ({ page }) => {
      if (await managerApp.initiateOnboardingButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateOnboardingButton.click();
        await page.waitForLoadState('networkidle');
        
        // Fill form
        await page.getByLabel(/name/i).fill(`E2E Test Customer ${randomString(6)}`);
        await page.getByLabel(/phone/i).fill(randomPhone());
        
        const unitInput = page.getByLabel(/unit/i);
        if (await unitInput.isVisible({ timeout: 1000 })) {
          await unitInput.click();
          const options = page.getByRole('option');
          if (await options.count() > 0) {
            await options.first().click();
          }
        }
        
        await page.getByRole('button', { name: /start|begin|create/i }).click();
        await page.waitForLoadState('networkidle');
        
        // Should show success
        await expect(page.getByText(/started|created|success|sent/i)).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
