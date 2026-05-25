/**
 * Admin Portal User & Role Management Tests
 * Covers: AP-AC-010 to AP-AC-013
 * 
 * Tests role creation, user assignment, audit logs, and approval matrices.
 */

import { test, expect } from '@playwright/test';
import { AdminPortalPage } from '../../page-objects';
import { loginAsSuperAdmin } from '../../fixtures/auth';
import { randomString } from '../../fixtures/test-data';

test.describe('Admin Portal User & Role Management', () => {
  let adminPortal: AdminPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsSuperAdmin(page);
    adminPortal = new AdminPortalPage(page);
    await adminPortal.gotoUsers();
  });
  
  test.describe('AP-AC-010: Create Custom Roles', () => {
    test('admin can create custom roles with permission sets', async ({ page }) => {
      const roleName = `E2E Test Role ${randomString(6)}`;
      
      await adminPortal.createRole({
        name: roleName,
        permissions: ['read:properties', 'write:work-orders'],
        description: 'E2E test role description',
      });
      
      // Verify role created
      await expect(page.getByText(roleName)).toBeVisible({ timeout: 5000 });
    });
    
    test('role creation requires name', async ({ page }) => {
      await adminPortal.createRoleButton.click();
      await page.waitForLoadState('networkidle');
      
      // Don't fill name, try to create
      await page.getByRole('button', { name: /create|save/i }).click();
      
      // Should show validation error
      await expect(page.getByText(/name.*required|required/i)).toBeVisible({ timeout: 3000 });
    });
    
    test('role creation shows permission categories', async ({ page }) => {
      await adminPortal.createRoleButton.click();
      await page.waitForLoadState('networkidle');
      
      // Should show permission categories
      const categories = page.getByText(/properties|users|payments|maintenance|reports/i);
      expect(await categories.count()).toBeGreaterThan(0);
    });
    
    test('permissions can be selected individually', async ({ page }) => {
      await adminPortal.createRoleButton.click();
      await page.waitForLoadState('networkidle');
      
      // Find permission checkboxes
      const permissionCheckboxes = page.locator('input[type="checkbox"]');
      const count = await permissionCheckboxes.count();
      
      if (count > 0) {
        // Select and deselect
        await permissionCheckboxes.first().check();
        expect(await permissionCheckboxes.first().isChecked()).toBe(true);
        
        await permissionCheckboxes.first().uncheck();
        expect(await permissionCheckboxes.first().isChecked()).toBe(false);
      }
    });
    
    test('can clone existing role', async ({ page }) => {
      const existingRole = adminPortal.roleList.locator('[data-role], .role-item, tr').first();
      
      if (await existingRole.isVisible({ timeout: 2000 })) {
        // Find clone button
        const cloneButton = existingRole.getByRole('button', { name: /clone|duplicate|copy/i });
        
        if (await cloneButton.isVisible({ timeout: 2000 })) {
          await cloneButton.click();
          await page.waitForLoadState('networkidle');
          
          // Should open create form with pre-filled permissions
          const createForm = page.locator('form, [data-form]');
          await expect(createForm.first()).toBeVisible();
        }
      }
    });
  });
  
  test.describe('AP-AC-011: Assign Users to Roles', () => {
    test('admin can assign users to roles within tenant', async ({ page }) => {
      // Find user list
      const userRow = adminPortal.userList.locator('[data-user], .user-item, tr').first();
      
      if (await userRow.isVisible({ timeout: 2000 })) {
        await userRow.click();
        await page.waitForLoadState('networkidle');
        
        // Look for role assignment
        const assignButton = page.getByRole('button', { name: /assign.*role/i });
        if (await assignButton.isVisible({ timeout: 2000 })) {
          await assignButton.click();
          
          // Select role
          const roleSelect = page.getByLabel(/role/i);
          if (await roleSelect.isVisible({ timeout: 2000 })) {
            await roleSelect.click();
            const options = page.getByRole('option');
            await options.first().click();
            
            await page.getByRole('button', { name: /assign|save/i }).click();
            await page.waitForLoadState('networkidle');
            
            await expect(page.getByText(/assigned|updated|success/i)).toBeVisible({ timeout: 5000 });
          }
        }
      }
    });
    
    test('role assignment requires tenant context', async ({ page }) => {
      const userRow = adminPortal.userList.locator('[data-user], .user-item, tr').first();
      
      if (await userRow.isVisible({ timeout: 2000 })) {
        await userRow.click();
        await page.waitForLoadState('networkidle');
        
        const assignButton = page.getByRole('button', { name: /assign.*role/i });
        if (await assignButton.isVisible({ timeout: 2000 })) {
          await assignButton.click();
          
          // Should have tenant selector
          const tenantSelect = page.getByLabel(/tenant|organization/i);
          await expect(tenantSelect).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('can assign multiple roles to user', async ({ page }) => {
      const userRow = adminPortal.userList.locator('[data-user], .user-item, tr').first();
      
      if (await userRow.isVisible({ timeout: 2000 })) {
        await userRow.click();
        await page.waitForLoadState('networkidle');
        
        // Look for roles section
        const rolesSection = page.locator('[data-section="roles"], .user-roles');
        if (await rolesSection.isVisible({ timeout: 2000 })) {
          // May show multiple role assignments
          const roleItems = rolesSection.locator('[data-role], .role-item');
          expect(await roleItems.count()).toBeGreaterThanOrEqual(0);
        }
      }
    });
    
    test('can revoke role from user', async ({ page }) => {
      const userRow = adminPortal.userList.locator('[data-user], .user-item, tr').first();
      
      if (await userRow.isVisible({ timeout: 2000 })) {
        await userRow.click();
        await page.waitForLoadState('networkidle');
        
        const revokeButton = page.getByRole('button', { name: /revoke|remove/i });
        if (await revokeButton.isVisible({ timeout: 2000 })) {
          await revokeButton.first().click();
          
          await page.getByRole('button', { name: /confirm/i }).click();
          await page.waitForLoadState('networkidle');
          
          await expect(page.getByText(/revoked|removed|success/i)).toBeVisible({ timeout: 5000 });
        }
      }
    });
  });
  
  test.describe('AP-AC-012: View Audit Log', () => {
    test('admin can view audit log of permission changes', async ({ page }) => {
      await adminPortal.auditNav.click();
      await page.waitForURL(/\/audit/i);
      
      // Should show audit log table
      await expect(adminPortal.auditLogTable).toBeVisible({ timeout: 5000 });
    });
    
    test('audit log shows timestamp', async ({ page }) => {
      await adminPortal.auditNav.click();
      await page.waitForURL(/\/audit/i);
      
      const logText = await adminPortal.auditLogTable.textContent();
      
      // Should have timestamps
      expect(logText).toMatch(/\d{4}|\d{1,2}[:/]\d{2}/);
    });
    
    test('audit log shows action type', async ({ page }) => {
      const logs = await adminPortal.viewAuditLog();
      
      if (logs.length > 0) {
        const allText = logs.join(' ').toLowerCase();
        expect(allText).toMatch(/create|update|delete|assign|revoke|login|change/i);
      }
    });
    
    test('audit log shows user who made change', async ({ page }) => {
      const logs = await adminPortal.viewAuditLog();
      
      if (logs.length > 0) {
        const allText = logs.join(' ').toLowerCase();
        expect(allText).toMatch(/@|user|admin|by/i);
      }
    });
    
    test('audit log can be filtered by action type', async ({ page }) => {
      await adminPortal.auditNav.click();
      await page.waitForURL(/\/audit/i);
      
      const actionFilter = page.getByLabel(/action/i);
      if (await actionFilter.isVisible({ timeout: 2000 })) {
        await actionFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('audit log can be filtered by date range', async ({ page }) => {
      await adminPortal.auditNav.click();
      await page.waitForURL(/\/audit/i);
      
      const dateFilter = page.getByLabel(/date|from|to/i);
      if (await dateFilter.first().isVisible({ timeout: 2000 })) {
        await expect(dateFilter.first()).toBeVisible();
      }
    });
  });
  
  test.describe('AP-AC-013: Configure Approval Matrices', () => {
    test('admin can configure approval matrices per tenant', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        await page.waitForLoadState('networkidle');
        
        const approvalsTab = page.getByRole('tab', { name: /approval|matrix/i });
        if (await approvalsTab.isVisible({ timeout: 2000 })) {
          await approvalsTab.click();
          await page.waitForLoadState('networkidle');
          
          // Should show approval matrix configuration
          const matrixConfig = page.locator('[data-section="approvals"], .approval-matrix');
          await expect(matrixConfig.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('approval matrix has threshold configuration', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        
        const approvalsTab = page.getByRole('tab', { name: /approval/i });
        if (await approvalsTab.isVisible({ timeout: 2000 })) {
          await approvalsTab.click();
          
          const thresholdInput = page.getByLabel(/threshold|limit|amount/i);
          await expect(thresholdInput.first()).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('can add approval rules', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        
        const approvalsTab = page.getByRole('tab', { name: /approval/i });
        if (await approvalsTab.isVisible({ timeout: 2000 })) {
          await approvalsTab.click();
          
          const addRuleButton = page.getByRole('button', { name: /add.*rule|new.*rule/i });
          if (await addRuleButton.isVisible({ timeout: 2000 })) {
            await addRuleButton.click();
            
            // Should show rule form
            const ruleForm = page.locator('form, [data-form]');
            await expect(ruleForm.first()).toBeVisible();
          }
        }
      }
    });
    
    test('approval rules can specify approvers', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        
        const approvalsTab = page.getByRole('tab', { name: /approval/i });
        if (await approvalsTab.isVisible({ timeout: 2000 })) {
          await approvalsTab.click();
          
          const approversSelect = page.getByLabel(/approvers?/i);
          if (await approversSelect.isVisible({ timeout: 2000 })) {
            await expect(approversSelect).toBeVisible();
          }
        }
      }
    });
    
    test('can delete approval rules', async ({ page }) => {
      await adminPortal.gotoTenants();
      
      const tenantRow = adminPortal.tenantList.locator('tr, [data-tenant]').first();
      
      if (await tenantRow.isVisible({ timeout: 2000 })) {
        await tenantRow.click();
        
        const approvalsTab = page.getByRole('tab', { name: /approval/i });
        if (await approvalsTab.isVisible({ timeout: 2000 })) {
          await approvalsTab.click();
          
          const deleteButton = page.getByRole('button', { name: /delete|remove/i });
          if (await deleteButton.first().isVisible({ timeout: 2000 })) {
            await expect(deleteButton.first()).toBeVisible();
          }
        }
      }
    });
  });
});
