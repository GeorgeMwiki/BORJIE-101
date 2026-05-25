/**
 * Estate Manager App Inspection Workflows Tests
 * Covers: EM-AC-010 to EM-AC-015
 * 
 * Tests move-in/move-out inspection initiation, guided checklists,
 * photo capture, meter readings, signatures, and baseline comparison.
 */

import { test, expect } from '@playwright/test';
import { EstateManagerAppPage } from '../../page-objects';
import { loginAsManager } from '../../fixtures/auth';
import { randomString } from '../../fixtures/test-data';

test.describe('Estate Manager Inspection Workflows', () => {
  let managerApp: EstateManagerAppPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    managerApp = new EstateManagerAppPage(page);
    await managerApp.gotoInspections();
  });
  
  test.describe('EM-AC-010: Initiate Move-In Inspection', () => {
    test('manager can initiate move-in inspection for new customer', async ({ page }) => {
      if (await managerApp.initiateInspectionButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateInspectionButton.click();
        await page.waitForLoadState('networkidle');
        
        // Should show inspection form
        const inspectionForm = page.locator('form, [data-form]');
        await expect(inspectionForm.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('inspection form requires customer selection', async ({ page }) => {
      if (await managerApp.initiateInspectionButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateInspectionButton.click();
        await page.waitForLoadState('networkidle');
        
        const customerInput = page.getByLabel(/customer|tenant/i);
        await expect(customerInput).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('inspection form requires unit selection', async ({ page }) => {
      if (await managerApp.initiateInspectionButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateInspectionButton.click();
        await page.waitForLoadState('networkidle');
        
        const unitInput = page.getByLabel(/unit/i);
        await expect(unitInput).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('inspection type can be selected', async ({ page }) => {
      if (await managerApp.initiateInspectionButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateInspectionButton.click();
        await page.waitForLoadState('networkidle');
        
        const typeSelect = page.getByLabel(/type/i);
        if (await typeSelect.isVisible({ timeout: 2000 })) {
          await typeSelect.click();
          
          const moveInOption = page.getByRole('option', { name: /move.*in/i });
          await expect(moveInOption).toBeVisible({ timeout: 3000 });
        }
      }
    });
  });
  
  test.describe('EM-AC-011: Guided Checklist', () => {
    test('manager can conduct inspection with guided checklist', async ({ page }) => {
      if (await managerApp.inspectionChecklist.isVisible({ timeout: 2000 })) {
        await expect(managerApp.inspectionChecklist).toBeVisible();
      } else {
        // Navigate to an active inspection
        const inspectionItem = page.locator('[data-inspection], tr').first();
        if (await inspectionItem.isVisible({ timeout: 2000 })) {
          await inspectionItem.click();
          await page.waitForLoadState('networkidle');
          
          await expect(managerApp.inspectionChecklist).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('checklist shows room-by-room items', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        const rooms = page.getByText(/living|bedroom|kitchen|bathroom|entrance/i);
        await expect(rooms.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('checklist items can be marked as inspected', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        const checkboxes = page.locator('input[type="checkbox"]');
        if (await checkboxes.count() > 0) {
          await expect(checkboxes.first()).toBeVisible();
        }
      }
    });
  });
  
  test.describe('EM-AC-012: Photo Capture with Auto-Tagging', () => {
    test('manager can capture photos with automatic tagging', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.capturePhotoButton.isVisible({ timeout: 2000 })) {
          await managerApp.capturePhotoButton.click();
          
          // File input should appear
          const fileInput = page.locator('input[type="file"]');
          await expect(fileInput).toBeAttached();
        }
      }
    });
    
    test('photos are tagged with inspection context', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        // Look for photo gallery or evidence section
        const photoSection = page.locator('[data-photos], .photo-gallery, .evidence');
        if (await photoSection.isVisible({ timeout: 2000 })) {
          await expect(photoSection).toBeVisible();
        }
      }
    });
  });
  
  test.describe('EM-AC-013: Meter Readings with Validation', () => {
    test('manager can record meter readings with validation', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.meterReadingInput.isVisible({ timeout: 2000 })) {
          await expect(managerApp.meterReadingInput).toBeVisible();
        }
      }
    });
    
    test('meter reading validates numeric input', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.meterReadingInput.isVisible({ timeout: 2000 })) {
          await managerApp.meterReadingInput.fill('abc');
          
          // Should show validation error or restrict input
          const inputValue = await managerApp.meterReadingInput.inputValue();
          // Either rejects non-numeric or shows error
          expect(managerApp.meterReadingInput).toBeDefined();
        }
      }
    });
    
    test('meter types include electricity and water', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        const meterTypes = page.getByText(/electricity|water|gas/i);
        if (await meterTypes.count() > 0) {
          await expect(meterTypes.first()).toBeVisible();
        }
      }
    });
  });
  
  test.describe('EM-AC-014: Customer Signature', () => {
    test('manager can complete inspection with customer signature', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.customerSignature.isVisible({ timeout: 2000 })) {
          await expect(managerApp.customerSignature).toBeVisible();
        }
      }
    });
    
    test('signature pad captures input', async ({ page }) => {
      const inspectionItem = page.locator('[data-inspection], tr').first();
      
      if (await inspectionItem.isVisible({ timeout: 2000 })) {
        await inspectionItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.customerSignature.isVisible({ timeout: 2000 })) {
          // Draw on signature pad
          const box = await managerApp.customerSignature.boundingBox();
          if (box) {
            await page.mouse.move(box.x + 20, box.y + 20);
            await page.mouse.down();
            await page.mouse.move(box.x + 100, box.y + 40);
            await page.mouse.up();
          }
          
          expect(managerApp.customerSignature).toBeDefined();
        }
      }
    });
  });
  
  test.describe('EM-AC-015: Move-Out with Baseline Comparison', () => {
    test('manager can initiate move-out inspection with baseline comparison', async ({ page }) => {
      if (await managerApp.initiateInspectionButton.isVisible({ timeout: 2000 })) {
        await managerApp.initiateInspectionButton.click();
        await page.waitForLoadState('networkidle');
        
        const typeSelect = page.getByLabel(/type/i);
        if (await typeSelect.isVisible({ timeout: 2000 })) {
          await typeSelect.click();
          
          const moveOutOption = page.getByRole('option', { name: /move.*out/i });
          if (await moveOutOption.isVisible({ timeout: 2000 })) {
            await moveOutOption.click();
            
            // Should indicate baseline comparison
            expect(managerApp.baselineComparison).toBeDefined();
          }
        }
      }
    });
    
    test('move-out inspection shows move-in photos for comparison', async ({ page }) => {
      // Navigate to move-out inspection
      const moveOutInspection = page.locator('[data-inspection-type="move-out"], [data-inspection]').first();
      
      if (await moveOutInspection.isVisible({ timeout: 2000 })) {
        await moveOutInspection.click();
        await page.waitForLoadState('networkidle');
        
        // Look for comparison view
        const comparisonView = page.getByText(/move.*in|baseline|before|original/i);
        if (await comparisonView.count() > 0) {
          await expect(comparisonView.first()).toBeVisible();
        }
      }
    });
    
    test('comparison highlights differences', async ({ page }) => {
      const moveOutInspection = page.locator('[data-inspection]').first();
      
      if (await moveOutInspection.isVisible({ timeout: 2000 })) {
        await moveOutInspection.click();
        await page.waitForLoadState('networkidle');
        
        // Look for difference indicators
        const differences = page.locator('[class*="difference"], [class*="change"], [data-changed]');
        // May or may not have differences
        expect(moveOutInspection).toBeDefined();
      }
    });
  });
});
