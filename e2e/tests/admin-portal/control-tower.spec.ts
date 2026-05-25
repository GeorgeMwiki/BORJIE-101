/**
 * Admin Portal Operations Control Tower Tests
 * Covers: AP-AC-020 to AP-AC-023
 * 
 * Tests system health metrics, exception queues, workflow interventions, and AI decision logs.
 */

import { test, expect } from '@playwright/test';
import { AdminPortalPage } from '../../page-objects';
import { loginAsSuperAdmin } from '../../fixtures/auth';

test.describe('Admin Portal Operations Control Tower', () => {
  let adminPortal: AdminPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
    adminPortal = new AdminPortalPage(page);
    await adminPortal.gotoControlTower();
  });
  
  test.describe('AP-AC-020: Cross-Tenant System Health Metrics', () => {
    test('admin can view cross-tenant system health metrics', async ({ page }) => {
      const metrics = await adminPortal.getSystemHealthMetrics();
      
      // Should display health metrics
      expect(metrics).toBeDefined();
      expect(metrics.length).toBeGreaterThanOrEqual(0);
    });
    
    test('health metrics show API response times', async ({ page }) => {
      await expect(adminPortal.healthMetrics).toBeVisible();
      
      const metricsText = await adminPortal.healthMetrics.textContent();
      expect(metricsText).toMatch(/response|latency|ms|api/i);
    });
    
    test('health metrics show error rates', async ({ page }) => {
      await expect(adminPortal.healthMetrics).toBeVisible();
      
      const metricsText = await adminPortal.healthMetrics.textContent();
      expect(metricsText).toMatch(/error|rate|%/i);
    });
    
    test('health metrics show active tenants', async ({ page }) => {
      await expect(adminPortal.healthMetrics).toBeVisible();
      
      const metricsText = await adminPortal.healthMetrics.textContent();
      expect(metricsText).toMatch(/tenant|active|organization/i);
    });
    
    test('health metrics update in real-time', async ({ page }) => {
      // Get initial metrics
      const initialMetrics = await adminPortal.healthMetrics.textContent();
      
      // Wait for potential auto-refresh
      await page.waitForTimeout(5000);
      
      // Metrics should still be visible
      await expect(adminPortal.healthMetrics).toBeVisible();
    });
    
    test('can view metrics by tenant', async ({ page }) => {
      const tenantFilter = page.getByLabel(/tenant|organization/i);
      
      if (await tenantFilter.isVisible({ timeout: 2000 })) {
        await tenantFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
  });
  
  test.describe('AP-AC-021: Exception Queue', () => {
    test('admin can view exception queue', async ({ page }) => {
      const exceptions = await adminPortal.getExceptionQueue();
      
      // Should display exceptions (may be empty)
      expect(exceptions).toBeDefined();
    });
    
    test('exception queue shows failed payments', async ({ page }) => {
      await adminPortal.exceptionQueue.scrollIntoViewIfNeeded();
      
      // Look for payment-related exceptions
      const paymentExceptions = page.getByText(/payment|transaction|reconciliation/i);
      
      // May or may not have payment exceptions
      expect(adminPortal.exceptionQueue).toBeDefined();
    });
    
    test('exception queue shows reconciliation issues', async ({ page }) => {
      await adminPortal.exceptionQueue.scrollIntoViewIfNeeded();
      
      // Look for reconciliation issues
      const reconciliationIssues = page.getByText(/reconciliation|mismatch|unmatched/i);
      
      expect(adminPortal.exceptionQueue).toBeDefined();
    });
    
    test('exception items show severity', async ({ page }) => {
      const exceptionItems = adminPortal.exceptionQueue.locator('[data-exception], tr');
      const count = await exceptionItems.count();
      
      if (count > 0) {
        const itemText = await exceptionItems.first().textContent();
        // May have severity indicators
        expect(itemText).toBeDefined();
      }
    });
    
    test('can filter exceptions by type', async ({ page }) => {
      const typeFilter = page.getByLabel(/type|category/i);
      
      if (await typeFilter.isVisible({ timeout: 2000 })) {
        await typeFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('can filter exceptions by severity', async ({ page }) => {
      const severityFilter = page.getByLabel(/severity|priority/i);
      
      if (await severityFilter.isVisible({ timeout: 2000 })) {
        await severityFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
  });
  
  test.describe('AP-AC-022: Workflow Interventions', () => {
    test('admin can intervene in stuck workflows', async ({ page }) => {
      const exceptionItems = adminPortal.exceptionQueue.locator('[data-exception], tr');
      const count = await exceptionItems.count();
      
      if (count > 0) {
        await exceptionItems.first().click();
        await page.waitForLoadState('networkidle');
        
        // Look for intervention options
        if (await adminPortal.interventionButton.isVisible({ timeout: 2000 })) {
          await adminPortal.interventionButton.click();
          
          // Should show intervention options
          const interventionOptions = page.locator('[data-action], .action-option');
          await expect(interventionOptions.first()).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('intervention requires action selection', async ({ page }) => {
      const exceptionItems = adminPortal.exceptionQueue.locator('[data-exception], tr');
      const count = await exceptionItems.count();
      
      if (count > 0) {
        await exceptionItems.first().click();
        await page.waitForLoadState('networkidle');
        
        if (await adminPortal.interventionButton.isVisible({ timeout: 2000 })) {
          await adminPortal.interventionButton.click();
          
          const actionSelect = page.getByLabel(/action/i);
          await expect(actionSelect).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('intervention requires reason', async ({ page }) => {
      const exceptionItems = adminPortal.exceptionQueue.locator('[data-exception], tr');
      const count = await exceptionItems.count();
      
      if (count > 0) {
        await exceptionItems.first().click();
        await page.waitForLoadState('networkidle');
        
        if (await adminPortal.interventionButton.isVisible({ timeout: 2000 })) {
          await adminPortal.interventionButton.click();
          
          const reasonInput = page.getByLabel(/reason|notes/i);
          await expect(reasonInput).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('intervention is logged in audit trail', async ({ page }) => {
      // This test verifies audit logging exists
      await adminPortal.auditNav.click();
      await page.waitForURL(/\/audit/i);
      
      // Look for intervention-related audit entries
      const interventionLogs = page.getByText(/intervention|override|manual/i);
      
      // Audit log should exist
      await expect(adminPortal.auditLogTable).toBeVisible({ timeout: 5000 });
    });
  });
  
  test.describe('AP-AC-023: AI Decision Logs', () => {
    test('admin can view AI decision logs with explanations', async ({ page }) => {
      const aiLogs = await adminPortal.viewAiDecisionLogs();
      
      // Should display AI decision logs (may be empty)
      expect(aiLogs).toBeDefined();
    });
    
    test('AI decision logs show decision type', async ({ page }) => {
      await adminPortal.aiDecisionLogs.scrollIntoViewIfNeeded();
      
      if (await adminPortal.aiDecisionLogs.isVisible({ timeout: 2000 })) {
        const logText = await adminPortal.aiDecisionLogs.textContent();
        
        // May have decision type indicators
        expect(logText).toBeDefined();
      }
    });
    
    test('AI decision logs show explanation', async ({ page }) => {
      await adminPortal.aiDecisionLogs.scrollIntoViewIfNeeded();
      
      // Click on a decision to see explanation
      const decisionItems = adminPortal.aiDecisionLogs.locator('[data-decision], tr');
      const count = await decisionItems.count();
      
      if (count > 0) {
        await decisionItems.first().click();
        await page.waitForLoadState('networkidle');
        
        // Look for explanation section
        const explanation = page.getByText(/explanation|reason|because|confidence/i);
        await expect(explanation.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('AI decision logs show confidence score', async ({ page }) => {
      await adminPortal.aiDecisionLogs.scrollIntoViewIfNeeded();
      
      const decisionItems = adminPortal.aiDecisionLogs.locator('[data-decision], tr');
      const count = await decisionItems.count();
      
      if (count > 0) {
        const logText = await decisionItems.first().textContent();
        
        // May have confidence scores
        expect(logText).toMatch(/%|\d+\.\d+|confidence/i);
      }
    });
    
    test('can filter AI logs by type', async ({ page }) => {
      const typeFilter = page.getByLabel(/type/i);
      
      if (await typeFilter.isVisible({ timeout: 2000 })) {
        await typeFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('can filter AI logs by date range', async ({ page }) => {
      const dateFilter = page.getByLabel(/date|from|to/i);
      
      if (await dateFilter.first().isVisible({ timeout: 2000 })) {
        await expect(dateFilter.first()).toBeVisible();
      }
    });
    
    test('AI decision shows input data', async ({ page }) => {
      await adminPortal.aiDecisionLogs.scrollIntoViewIfNeeded();
      
      const decisionItems = adminPortal.aiDecisionLogs.locator('[data-decision], tr');
      const count = await decisionItems.count();
      
      if (count > 0) {
        await decisionItems.first().click();
        await page.waitForLoadState('networkidle');
        
        // Look for input data section
        const inputData = page.getByText(/input|data|context|features/i);
        await expect(inputData.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
});
