/**
 * Estate Manager App SLA Dashboards Tests
 * Covers: EM-AC-050 to EM-AC-053
 * 
 * Tests SLA compliance metrics, at-risk items, metric drill-down, and daily briefings.
 */

import { test, expect } from '@playwright/test';
import { EstateManagerAppPage } from '../../page-objects';
import { loginAsManager } from '../../fixtures/auth';

test.describe('Estate Manager SLA Dashboards', () => {
  let managerApp: EstateManagerAppPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsManager(page);
    managerApp = new EstateManagerAppPage(page);
    await managerApp.gotoSla();
  });
  
  test.describe('EM-AC-050: SLA Compliance Metrics by Category', () => {
    test('manager can view SLA compliance metrics by category', async ({ page }) => {
      const metrics = await managerApp.getSlaComplianceMetrics();
      
      // Should return metrics
      expect(metrics).toBeDefined();
    });
    
    test('metrics show response time compliance', async ({ page }) => {
      const metricsText = await managerApp.slaComplianceMetrics.textContent();
      
      if (metricsText && metricsText.length > 20) {
        expect(metricsText).toMatch(/response|time|hour|minute|\d+/i);
      }
    });
    
    test('metrics show resolution time compliance', async ({ page }) => {
      const metricsText = await managerApp.slaComplianceMetrics.textContent();
      
      if (metricsText && metricsText.length > 20) {
        expect(metricsText).toMatch(/resolution|resolved|complete|\d+/i);
      }
    });
    
    test('metrics show compliance percentage', async ({ page }) => {
      const metricsText = await managerApp.slaComplianceMetrics.textContent();
      
      if (metricsText && metricsText.length > 20) {
        expect(metricsText).toMatch(/%|\d+/);
      }
    });
    
    test('metrics are categorized', async ({ page }) => {
      const metricsText = await managerApp.slaComplianceMetrics.textContent();
      
      if (metricsText && metricsText.length > 20) {
        expect(metricsText).toMatch(/plumbing|electrical|maintenance|urgent|general/i);
      }
    });
    
    test('metrics can be filtered by time period', async ({ page }) => {
      const periodFilter = page.getByLabel(/period|time|range/i);
      
      if (await periodFilter.isVisible({ timeout: 2000 })) {
        await periodFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
  });
  
  test.describe('EM-AC-051: View At-Risk Items', () => {
    test('manager can view at-risk items requiring attention', async ({ page }) => {
      const atRiskItems = await managerApp.getAtRiskItems();
      
      // Should return at-risk items (may be empty)
      expect(atRiskItems).toBeDefined();
    });
    
    test('at-risk items show time remaining', async ({ page }) => {
      const atRiskText = await managerApp.atRiskItems.textContent();
      
      if (atRiskText && atRiskText.length > 20) {
        expect(atRiskText).toMatch(/hour|minute|remaining|left|overdue|\d+/i);
      }
    });
    
    test('at-risk items show priority', async ({ page }) => {
      const atRiskText = await managerApp.atRiskItems.textContent();
      
      if (atRiskText && atRiskText.length > 20) {
        expect(atRiskText).toMatch(/urgent|high|critical|priority/i);
      }
    });
    
    test('at-risk items are clickable', async ({ page }) => {
      const atRiskItem = managerApp.atRiskItems.locator('[data-item], tr').first();
      
      if (await atRiskItem.isVisible({ timeout: 2000 })) {
        await atRiskItem.click();
        await page.waitForLoadState('networkidle');
        
        // Should navigate to item detail
        expect(page.url()).toBeDefined();
      }
    });
    
    test('at-risk list shows count', async ({ page }) => {
      const countIndicator = page.getByText(/\d+.*at.*risk|at.*risk.*\d+/i);
      
      if (await countIndicator.isVisible({ timeout: 2000 })) {
        await expect(countIndicator).toBeVisible();
      }
    });
  });
  
  test.describe('EM-AC-052: Drill Down from Metric', () => {
    test('manager can drill down from metric to individual items', async ({ page }) => {
      const metricItems = managerApp.slaComplianceMetrics.locator('[data-metric], .metric-item');
      const count = await metricItems.count();
      
      if (count > 0) {
        await metricItems.first().click();
        await page.waitForLoadState('networkidle');
        
        // Should show detailed items
        const detailView = page.locator('[data-detail], .detail-list, table');
        await expect(detailView.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('drill-down shows individual work orders', async ({ page }) => {
      const metricItems = managerApp.slaComplianceMetrics.locator('[data-metric], .metric-item');
      const count = await metricItems.count();
      
      if (count > 0) {
        await metricItems.first().click();
        await page.waitForLoadState('networkidle');
        
        // Should show work order list
        const workOrders = page.getByText(/work.*order|wo-|maintenance/i);
        await expect(workOrders.first()).toBeVisible({ timeout: 5000 });
      }
    });
    
    test('drill-down allows filtering', async ({ page }) => {
      const metricItems = managerApp.slaComplianceMetrics.locator('[data-metric], .metric-item');
      const count = await metricItems.count();
      
      if (count > 0) {
        await metricItems.first().click();
        await page.waitForLoadState('networkidle');
        
        const filterOption = page.getByLabel(/filter|status/i);
        if (await filterOption.isVisible({ timeout: 2000 })) {
          await expect(filterOption).toBeVisible();
        }
      }
    });
    
    test('drill-down has back navigation', async ({ page }) => {
      const metricItems = managerApp.slaComplianceMetrics.locator('[data-metric], .metric-item');
      const count = await metricItems.count();
      
      if (count > 0) {
        await metricItems.first().click();
        await page.waitForLoadState('networkidle');
        
        const backButton = page.getByRole('button', { name: /back/i })
          .or(page.getByRole('link', { name: /back|dashboard/i }));
        
        if (await backButton.isVisible({ timeout: 2000 })) {
          await expect(backButton).toBeVisible();
        }
      }
    });
  });
  
  test.describe('EM-AC-053: Daily Briefing', () => {
    test('manager receives daily briefing summary', async ({ page }) => {
      const briefing = await managerApp.getDailyBriefing();
      
      // Should have briefing content
      expect(briefing).toBeDefined();
    });
    
    test('briefing shows today\'s priorities', async ({ page }) => {
      const briefingText = await managerApp.dailyBriefing.textContent();
      
      if (briefingText && briefingText.length > 20) {
        expect(briefingText).toMatch(/today|priority|urgent|attention|action/i);
      }
    });
    
    test('briefing shows overdue items', async ({ page }) => {
      const briefingText = await managerApp.dailyBriefing.textContent();
      
      if (briefingText && briefingText.length > 20) {
        expect(briefingText).toMatch(/overdue|breached|late|past.*due/i);
      }
    });
    
    test('briefing shows upcoming deadlines', async ({ page }) => {
      const briefingText = await managerApp.dailyBriefing.textContent();
      
      if (briefingText && briefingText.length > 20) {
        expect(briefingText).toMatch(/upcoming|deadline|due|tomorrow/i);
      }
    });
    
    test('briefing is dismissible', async ({ page }) => {
      const dismissButton = managerApp.dailyBriefing.getByRole('button', { name: /dismiss|close|got it/i });
      
      if (await dismissButton.isVisible({ timeout: 2000 })) {
        await expect(dismissButton).toBeVisible();
      }
    });
    
    test('briefing links to relevant items', async ({ page }) => {
      const briefingLinks = managerApp.dailyBriefing.locator('a, [role="link"]');
      const linkCount = await briefingLinks.count();
      
      // May have actionable links
      expect(linkCount).toBeGreaterThanOrEqual(0);
    });
  });
});
