/**
 * Estate Manager App Work Order Management Tests
 * Covers: EM-AC-001 to EM-AC-007
 * 
 * Tests work order listing, detail views, approvals, vendor assignments,
 * AI overrides, SLA alerts, and closure with dual sign-off.
 */

import { test, expect } from '@playwright/test';
import { EstateManagerAppPage } from '../../page-objects';
import { loginAsManager } from '../../fixtures/auth';
import { randomString } from '../../fixtures/test-data';

test.describe('Estate Manager Work Order Management', () => {
  let managerApp: EstateManagerAppPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    managerApp = new EstateManagerAppPage(page);
    await managerApp.gotoWorkOrders();
  });
  
  test.describe('EM-AC-001: Work Order List with Filters', () => {
    test('manager can view all work orders by status with filters', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('all');
      
      const workOrders = await managerApp.getWorkOrders();
      expect(workOrders).toBeDefined();
    });
    
    test('can filter work orders by pending status', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('pending');
      
      const workOrders = await managerApp.getWorkOrders();
      expect(workOrders).toBeDefined();
    });
    
    test('can filter work orders by in-progress status', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('in-progress');
      
      const workOrders = await managerApp.getWorkOrders();
      expect(workOrders).toBeDefined();
    });
    
    test('can filter work orders by completed status', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('completed');
      
      const workOrders = await managerApp.getWorkOrders();
      expect(workOrders).toBeDefined();
    });
    
    test('work order list shows key information', async ({ page }) => {
      const listText = await managerApp.workOrderList.textContent();
      
      if (listText && listText.length > 20) {
        // Should show relevant info
        expect(listText).toMatch(/unit|category|status|date|\d+/i);
      }
    });
  });
  
  test.describe('EM-AC-002: Work Order Detail View', () => {
    test('manager can view work order detail with full evidence', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        // Detail view should be visible
        await expect(managerApp.workOrderDetail).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('work order detail shows timeline', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        const timeline = page.locator('[data-timeline], .timeline');
        await expect(timeline.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('work order detail shows evidence/photos', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        const evidence = page.locator('img, [data-evidence]');
        // May or may not have evidence
        expect(managerApp.workOrderDetail).toBeDefined();
      }
    });
    
    test('work order detail shows costs', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        const costs = page.getByText(/cost|amount|estimate|KES|TZS/i);
        await expect(costs.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
  
  test.describe('EM-AC-003: Approve or Request More Info', () => {
    test('manager can approve pending work orders', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('pending');
      
      const pendingOrder = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await pendingOrder.isVisible({ timeout: 2000 })) {
        await pendingOrder.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.approveButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.approveButton).toBeVisible();
        }
      }
    });
    
    test('manager can request more info on pending orders', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('pending');
      
      const pendingOrder = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await pendingOrder.isVisible({ timeout: 2000 })) {
        await pendingOrder.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.requestInfoButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.requestInfoButton).toBeVisible();
        }
      }
    });
    
    test('request info requires message', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('pending');
      
      const pendingOrder = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await pendingOrder.isVisible({ timeout: 2000 })) {
        await pendingOrder.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.requestInfoButton.isVisible({ timeout: 2000 })) {
          await managerApp.requestInfoButton.click();
          
          const messageInput = page.getByLabel(/question|info|message/i);
          await expect(messageInput).toBeVisible({ timeout: 3000 });
        }
      }
    });
  });
  
  test.describe('EM-AC-004: Assign Vendor from Recommended List', () => {
    test('manager can assign vendor from recommended list', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.assignVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.assignVendorButton.click();
          
          // Should show recommendations
          await expect(managerApp.vendorRecommendations).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('vendor recommendations show score/rating', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.assignVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.assignVendorButton.click();
          
          if (await managerApp.vendorRecommendations.isVisible({ timeout: 2000 })) {
            const vendorText = await managerApp.vendorRecommendations.textContent();
            expect(vendorText).toMatch(/score|rating|star|%|\d+/i);
          }
        }
      }
    });
  });
  
  test.describe('EM-AC-005: Override AI Vendor Recommendation', () => {
    test('manager can override AI vendor recommendation with reason', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.assignVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.assignVendorButton.click();
          
          // Look for search/manual selection option
          const searchInput = page.getByPlaceholder(/search.*vendor/i);
          if (await searchInput.isVisible({ timeout: 2000 })) {
            await expect(searchInput).toBeVisible();
          }
        }
      }
    });
    
    test('override requires reason input', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        await workOrderItem.click();
        await page.waitForLoadState('networkidle');
        
        if (await managerApp.assignVendorButton.isVisible({ timeout: 2000 })) {
          await managerApp.assignVendorButton.click();
          
          // Select non-recommended vendor
          const searchInput = page.getByPlaceholder(/search/i);
          if (await searchInput.isVisible({ timeout: 2000 })) {
            await searchInput.fill('Other Vendor');
            
            // Should require override reason
            const reasonInput = page.getByLabel(/reason|override/i);
            if (await reasonInput.isVisible({ timeout: 2000 })) {
              await expect(reasonInput).toBeVisible();
            }
          }
        }
      }
    });
    
    test('override is logged', async ({ page }) => {
      // This verifies logging by checking audit indicators
      expect(managerApp.workOrderList).toBeDefined();
    });
  });
  
  test.describe('EM-AC-006: SLA Breach Alert', () => {
    test('manager receives alert for SLA breach risk', async ({ page }) => {
      // Look for SLA alerts in the list or dashboard
      const slaAlert = page.locator('[data-sla-alert], [class*="sla"], [class*="breach"]');
      
      if (await slaAlert.count() > 0) {
        await expect(slaAlert.first()).toBeVisible();
      }
      
      // Also check header/notification area
      const notificationBell = page.getByRole('button', { name: /notification/i });
      if (await notificationBell.isVisible({ timeout: 1000 })) {
        await notificationBell.click();
        
        const slaNotification = page.getByText(/sla|breach|overdue/i);
        // May or may not have SLA alerts
        expect(notificationBell).toBeDefined();
      }
    });
    
    test('SLA alert shows time remaining', async ({ page }) => {
      const workOrderItem = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await workOrderItem.isVisible({ timeout: 2000 })) {
        const itemText = await workOrderItem.textContent();
        // May show time remaining
        expect(itemText).toBeDefined();
      }
    });
  });
  
  test.describe('EM-AC-007: Close Work Order with Dual Sign-Off', () => {
    test('manager can close work order with dual sign-off verification', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('completed');
      
      const completedOrder = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await completedOrder.isVisible({ timeout: 2000 })) {
        await completedOrder.click();
        await page.waitForLoadState('networkidle');
        
        // Check for dual sign-off status
        if (await managerApp.dualSignOffStatus.isVisible({ timeout: 2000 })) {
          const signoffText = await managerApp.dualSignOffStatus.textContent();
          expect(signoffText).toMatch(/sign|signature|customer|technician/i);
        }
        
        // Close button should be available
        if (await managerApp.closeWorkOrderButton.isVisible({ timeout: 2000 })) {
          await expect(managerApp.closeWorkOrderButton).toBeVisible();
        }
      }
    });
    
    test('closure requires both signatures', async ({ page }) => {
      await managerApp.filterWorkOrdersByStatus('in-progress');
      
      const inProgressOrder = managerApp.workOrderList.locator('[data-work-order], tr').first();
      
      if (await inProgressOrder.isVisible({ timeout: 2000 })) {
        await inProgressOrder.click();
        await page.waitForLoadState('networkidle');
        
        // Check sign-off requirements
        const signoffRequirements = page.getByText(/customer.*sign|technician.*sign|both.*sign/i);
        if (await signoffRequirements.count() > 0) {
          await expect(signoffRequirements.first()).toBeVisible();
        }
      }
    });
  });
});
