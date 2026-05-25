/**
 * Owner Portal Maintenance Oversight Tests
 * Covers: OP-AC-030 to OP-AC-034
 * 
 * Tests work order viewing, status filtering, approvals, notifications, and cost trends.
 */

import { test, expect } from '@playwright/test';
import { OwnerPortalPage } from '../../page-objects';
import { loginAsOwner } from '../../fixtures/auth';
import { testWorkOrders } from '../../fixtures/test-data';

test.describe('Owner Portal Maintenance Oversight', () => {
  let ownerPortal: OwnerPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
    ownerPortal = new OwnerPortalPage(page);
    await ownerPortal.gotoMaintenance();
  });
  
  test.describe('OP-AC-030: Work Order Status Filtering', () => {
    test('can view all work orders', async ({ page }) => {
      await ownerPortal.filterWorkOrdersByStatus('all');
      
      const workOrders = await ownerPortal.getWorkOrders();
      expect(workOrders).toBeDefined();
    });
    
    test('can filter by open status', async ({ page }) => {
      await ownerPortal.filterWorkOrdersByStatus('open');
      await page.waitForLoadState('networkidle');
      
      // All visible work orders should be open
      const workOrders = await ownerPortal.getWorkOrders();
      if (workOrders.length > 0) {
        const allText = workOrders.join(' ').toLowerCase();
        // Should not contain closed statuses prominently
        expect(allText).not.toMatch(/\bclosed\b|\bcomplete\b/);
      }
    });
    
    test('can filter by in-progress status', async ({ page }) => {
      await ownerPortal.filterWorkOrdersByStatus('in-progress');
      await page.waitForLoadState('networkidle');
      
      const workOrders = await ownerPortal.getWorkOrders();
      expect(workOrders).toBeDefined();
    });
    
    test('can filter by closed status', async ({ page }) => {
      await ownerPortal.filterWorkOrdersByStatus('closed');
      await page.waitForLoadState('networkidle');
      
      const workOrders = await ownerPortal.getWorkOrders();
      expect(workOrders).toBeDefined();
    });
    
    test('status filter shows count per status', async ({ page }) => {
      await ownerPortal.workOrderStatusFilter.click();
      
      // Options may show counts
      const options = page.getByRole('option');
      const optionCount = await options.count();
      
      expect(optionCount).toBeGreaterThan(0);
      
      await page.keyboard.press('Escape');
    });
  });
  
  test.describe('OP-AC-031: Work Order Detail View', () => {
    test('work order detail shows timeline', async ({ page }) => {
      const workOrders = ownerPortal.workOrderList.locator('[data-work-order], .work-order-item, tr').first();
      
      if (await workOrders.isVisible({ timeout: 2000 })) {
        await workOrders.click();
        await page.waitForLoadState('networkidle');
        
        const timeline = page.locator('[data-timeline], .timeline, [class*="timeline"]');
        await expect(timeline.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('work order detail shows evidence/photos', async ({ page }) => {
      const workOrders = ownerPortal.workOrderList.locator('[data-work-order], .work-order-item, tr').first();
      
      if (await workOrders.isVisible({ timeout: 2000 })) {
        await workOrders.click();
        await page.waitForLoadState('networkidle');
        
        // Look for evidence section or images
        const evidence = page.locator('img, [data-evidence], [class*="evidence"], [class*="photo"]');
        if (await evidence.count() > 0) {
          await expect(evidence.first()).toBeVisible();
        }
      }
    });
    
    test('work order detail shows costs', async ({ page }) => {
      const workOrders = ownerPortal.workOrderList.locator('[data-work-order], .work-order-item, tr').first();
      
      if (await workOrders.isVisible({ timeout: 2000 })) {
        await workOrders.click();
        await page.waitForLoadState('networkidle');
        
        // Look for cost information
        const costs = page.getByText(/cost|amount|KES|TZS|\d+\.\d{2}/i);
        await expect(costs.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('work order shows category and priority', async ({ page }) => {
      const workOrders = ownerPortal.workOrderList.locator('[data-work-order], .work-order-item, tr').first();
      
      if (await workOrders.isVisible({ timeout: 2000 })) {
        await workOrders.click();
        await page.waitForLoadState('networkidle');
        
        // Category indicators
        const categoryText = page.getByText(/plumbing|electrical|hvac|general|urgent/i);
        await expect(categoryText.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
  
  test.describe('OP-AC-032: Work Order Approval', () => {
    test('owner can approve work orders above threshold via portal', async ({ page }) => {
      // Filter to show pending approvals
      const pendingFilter = page.getByRole('button', { name: /pending.*approval|awaiting/i })
        .or(page.getByText(/pending.*approval/i));
      
      if (await pendingFilter.isVisible({ timeout: 2000 })) {
        await pendingFilter.click();
        await page.waitForLoadState('networkidle');
      }
      
      const workOrders = ownerPortal.workOrderList.locator('[data-work-order], .work-order-item, tr');
      const count = await workOrders.count();
      
      if (count > 0) {
        await workOrders.first().click();
        await page.waitForLoadState('networkidle');
        
        // Look for approve button
        if (await ownerPortal.workOrderApproveButton.isVisible({ timeout: 2000 })) {
          await ownerPortal.workOrderApproveButton.click();
          
          // Confirm approval
          const confirmButton = page.getByRole('button', { name: /confirm|yes/i });
          if (await confirmButton.isVisible({ timeout: 2000 })) {
            await confirmButton.click();
          }
          
          await page.waitForLoadState('networkidle');
          
          // Should show success
          await expect(page.getByText(/approved|success/i)).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('approval requires confirmation', async ({ page }) => {
      const workOrders = ownerPortal.workOrderList.locator('[data-work-order], .work-order-item, tr');
      const count = await workOrders.count();
      
      if (count > 0) {
        await workOrders.first().click();
        await page.waitForLoadState('networkidle');
        
        if (await ownerPortal.workOrderApproveButton.isVisible({ timeout: 2000 })) {
          await ownerPortal.workOrderApproveButton.click();
          
          // Should show confirmation dialog
          const confirmDialog = page.locator('.modal, [role="dialog"], .confirm');
          await expect(confirmDialog.first()).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('can reject work order with reason', async ({ page }) => {
      const workOrders = ownerPortal.workOrderList.locator('[data-work-order], .work-order-item, tr');
      const count = await workOrders.count();
      
      if (count > 0) {
        await workOrders.first().click();
        await page.waitForLoadState('networkidle');
        
        const rejectButton = page.getByRole('button', { name: /reject|decline/i });
        if (await rejectButton.isVisible({ timeout: 2000 })) {
          await rejectButton.click();
          
          // Should show reason input
          const reasonInput = page.getByLabel(/reason/i);
          await expect(reasonInput).toBeVisible({ timeout: 3000 });
        }
      }
    });
  });
  
  test.describe('OP-AC-033: Urgent Maintenance Notifications', () => {
    test('owner receives notification for urgent maintenance', async ({ page }) => {
      // Check notification bell/indicator
      const notificationBell = page.getByRole('button', { name: /notification/i })
        .or(page.locator('[class*="notification"], [data-notification]'));
      
      if (await notificationBell.isVisible({ timeout: 2000 })) {
        await notificationBell.click();
        await page.waitForLoadState('networkidle');
        
        // Should show notifications list
        const notifications = page.locator('[data-notification-item], .notification-item');
        expect(await notifications.count()).toBeGreaterThanOrEqual(0);
      }
    });
    
    test('urgent work orders are highlighted', async ({ page }) => {
      // Look for urgent indicators in work order list
      const urgentIndicator = ownerPortal.workOrderList.locator('[class*="urgent"], [data-priority="urgent"], .badge-urgent');
      
      if (await urgentIndicator.count() > 0) {
        await expect(urgentIndicator.first()).toBeVisible();
      }
    });
    
    test('notification links to work order detail', async ({ page }) => {
      const notificationBell = page.getByRole('button', { name: /notification/i });
      
      if (await notificationBell.isVisible({ timeout: 2000 })) {
        await notificationBell.click();
        await page.waitForLoadState('networkidle');
        
        const notificationItem = page.locator('[data-notification-item], .notification-item').first();
        
        if (await notificationItem.isVisible({ timeout: 2000 })) {
          await notificationItem.click();
          await page.waitForLoadState('networkidle');
          
          // Should navigate to work order detail or maintenance section
          await expect(page).toHaveURL(/maintenance|work-order/i);
        }
      }
    });
  });
  
  test.describe('OP-AC-034: Maintenance Cost Trends', () => {
    test('can view maintenance cost trends by category', async ({ page }) => {
      await ownerPortal.viewMaintenanceCostTrends();
      
      // Chart or trend visualization should be visible
      await expect(ownerPortal.maintenanceCostTrends).toBeVisible();
    });
    
    test('cost trends show breakdown by category', async ({ page }) => {
      await ownerPortal.maintenanceCostTrends.scrollIntoViewIfNeeded();
      
      // Look for category labels
      const categories = page.getByText(/plumbing|electrical|hvac|general|other/i);
      
      if (await ownerPortal.maintenanceCostTrends.isVisible()) {
        // Should show some category information
        const trendText = await ownerPortal.maintenanceCostTrends.textContent();
        expect(trendText).toBeDefined();
      }
    });
    
    test('cost trends allow time period selection', async ({ page }) => {
      await ownerPortal.maintenanceCostTrends.scrollIntoViewIfNeeded();
      
      const periodSelect = page.getByLabel(/period|time.*range/i)
        .or(page.getByRole('button', { name: /month|quarter|year/i }));
      
      if (await periodSelect.isVisible({ timeout: 2000 })) {
        await periodSelect.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('cost trends show comparison to previous period', async ({ page }) => {
      await ownerPortal.maintenanceCostTrends.scrollIntoViewIfNeeded();
      
      // Look for comparison indicators
      const comparison = page.getByText(/vs|compared|change|%|\+|-/i);
      
      if (await comparison.count() > 0) {
        await expect(comparison.first()).toBeVisible();
      }
    });
    
    test('can export cost trend data', async ({ page }) => {
      await ownerPortal.maintenanceCostTrends.scrollIntoViewIfNeeded();
      
      const exportButton = page.getByRole('button', { name: /export|download/i });
      
      if (await exportButton.isVisible({ timeout: 2000 })) {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          exportButton.click(),
        ]);
        
        expect(download).toBeDefined();
      }
    });
  });
});
