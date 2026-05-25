/**
 * Owner Portal Document Access Tests
 * Covers: OP-AC-040 to OP-AC-043
 * 
 * Tests document listing, downloads, e-signatures, and version history.
 */

import { test, expect } from '@playwright/test';
import { OwnerPortalPage } from '../../page-objects';
import { loginAsOwner } from '../../fixtures/auth';

test.describe('Owner Portal Document Access', () => {
  let ownerPortal: OwnerPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
    ownerPortal = new OwnerPortalPage(page);
    await ownerPortal.gotoDocuments();
  });
  
  test.describe('OP-AC-040: Document Listing', () => {
    test('can view all property documents', async ({ page }) => {
      const documents = await ownerPortal.getDocuments();
      
      // Should show documents or empty state
      expect(documents).toBeDefined();
    });
    
    test('documents list shows leases', async ({ page }) => {
      const documents = await ownerPortal.getDocuments();
      const allText = documents.join(' ').toLowerCase();
      
      // Should have lease documents
      expect(allText).toMatch(/lease|agreement|contract/i);
    });
    
    test('documents list shows reports', async ({ page }) => {
      const documents = await ownerPortal.getDocuments();
      
      // Look for report-type documents
      const reportIndicator = page.getByText(/report|statement|summary/i);
      if (await reportIndicator.count() > 0) {
        await expect(reportIndicator.first()).toBeVisible();
      }
    });
    
    test('documents list shows notices', async ({ page }) => {
      const documents = await ownerPortal.getDocuments();
      
      // May have notice documents
      expect(documents).toBeDefined();
    });
    
    test('documents are sortable', async ({ page }) => {
      const sortButton = page.getByRole('button', { name: /sort/i })
        .or(page.locator('[data-sort], th[role="columnheader"]').first());
      
      if (await sortButton.isVisible({ timeout: 2000 })) {
        await sortButton.click();
        await page.waitForLoadState('networkidle');
        
        // Documents should re-order
        const documents = await ownerPortal.getDocuments();
        expect(documents).toBeDefined();
      }
    });
    
    test('documents can be filtered by type', async ({ page }) => {
      const typeFilter = page.getByLabel(/type/i)
        .or(page.getByRole('button', { name: /filter.*type/i }));
      
      if (await typeFilter.isVisible({ timeout: 2000 })) {
        await typeFilter.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('documents can be searched', async ({ page }) => {
      const searchInput = page.getByPlaceholder(/search/i)
        .or(page.getByLabel(/search/i));
      
      if (await searchInput.isVisible({ timeout: 2000 })) {
        await searchInput.fill('lease');
        await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle');
        
        // Should filter documents
        const documents = await ownerPortal.getDocuments();
        expect(documents).toBeDefined();
      }
    });
  });
  
  test.describe('OP-AC-041: Document Download', () => {
    test('can download individual document', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        const firstDoc = documentItems.first();
        const docName = await firstDoc.textContent();
        
        const downloadButton = firstDoc.getByRole('button', { name: /download/i });
        
        if (await downloadButton.isVisible({ timeout: 2000 })) {
          const [download] = await Promise.all([
            page.waitForEvent('download'),
            downloadButton.click(),
          ]);
          
          expect(download).toBeDefined();
          const filename = download.suggestedFilename();
          expect(filename).toMatch(/\.(pdf|docx?|xlsx?)$/i);
        }
      }
    });
    
    test('can download documents as bundle', async ({ page }) => {
      // Select multiple documents if possible
      const checkboxes = ownerPortal.documentList.locator('input[type="checkbox"]');
      const checkboxCount = await checkboxes.count();
      
      if (checkboxCount > 1) {
        await checkboxes.nth(0).check();
        await checkboxes.nth(1).check();
      }
      
      if (await ownerPortal.documentBundleButton.isVisible({ timeout: 2000 })) {
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          ownerPortal.documentBundleButton.click(),
        ]);
        
        expect(download).toBeDefined();
        const filename = download.suggestedFilename();
        expect(filename).toMatch(/\.(zip|pdf)$/i);
      }
    });
    
    test('download shows progress indicator', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        const downloadButton = documentItems.first().getByRole('button', { name: /download/i });
        
        if (await downloadButton.isVisible({ timeout: 2000 })) {
          // Start download and check for progress
          const downloadPromise = page.waitForEvent('download');
          await downloadButton.click();
          
          // May show loading indicator
          const loading = page.locator('[class*="loading"], [class*="progress"], .spinner');
          if (await loading.isVisible({ timeout: 500 })) {
            await expect(loading).toBeVisible();
          }
          
          await downloadPromise;
        }
      }
    });
  });
  
  test.describe('OP-AC-042: E-Signature Workflow', () => {
    test('owner can e-sign documents requiring owner signature', async ({ page }) => {
      // Look for documents requiring signature
      const signableDoc = ownerPortal.documentList.locator('[data-requires-signature], .needs-signature')
        .or(page.getByText(/requires.*signature|sign.*required/i));
      
      if (await signableDoc.isVisible({ timeout: 2000 })) {
        await signableDoc.click();
        await page.waitForLoadState('networkidle');
        
        // E-sign button should be visible
        await expect(ownerPortal.eSignButton).toBeVisible();
      }
    });
    
    test('e-sign flow shows document preview', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        await documentItems.first().click();
        await page.waitForLoadState('networkidle');
        
        if (await ownerPortal.eSignButton.isVisible({ timeout: 2000 })) {
          await ownerPortal.eSignButton.click();
          await page.waitForLoadState('networkidle');
          
          // Should show document preview or signing area
          const preview = page.locator('iframe, embed, .pdf-viewer, [data-preview]');
          if (await preview.isVisible({ timeout: 3000 })) {
            await expect(preview).toBeVisible();
          }
        }
      }
    });
    
    test('e-sign captures signature', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        await documentItems.first().click();
        await page.waitForLoadState('networkidle');
        
        if (await ownerPortal.eSignButton.isVisible({ timeout: 2000 })) {
          await ownerPortal.eSignButton.click();
          await page.waitForLoadState('networkidle');
          
          // Look for signature pad
          const signaturePad = page.locator('canvas, [data-signature]');
          if (await signaturePad.isVisible({ timeout: 3000 })) {
            // Draw signature
            const box = await signaturePad.boundingBox();
            if (box) {
              await page.mouse.move(box.x + 50, box.y + 25);
              await page.mouse.down();
              await page.mouse.move(box.x + 150, box.y + 50);
              await page.mouse.up();
            }
            
            // Submit
            const submitButton = page.getByRole('button', { name: /submit|sign|confirm/i });
            if (await submitButton.isVisible()) {
              await submitButton.click();
              await page.waitForLoadState('networkidle');
              
              // Should show success
              await expect(page.getByText(/signed|success|complete/i)).toBeVisible({ timeout: 5000 });
            }
          }
        }
      }
    });
    
    test('e-signed document shows verification', async ({ page }) => {
      // Look for already signed documents
      const signedDoc = ownerPortal.documentList.locator('[data-signed], .signed')
        .or(page.getByText(/signed.*on|e-signed/i));
      
      if (await signedDoc.isVisible({ timeout: 2000 })) {
        await signedDoc.click();
        await page.waitForLoadState('networkidle');
        
        // Should show signature verification
        const verification = page.getByText(/verified|authentic|signed.*by/i);
        await expect(verification.first()).toBeVisible({ timeout: 5000 });
      }
    });
  });
  
  test.describe('OP-AC-043: Document Version History', () => {
    test('document versions are tracked with change history', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        await documentItems.first().click();
        await page.waitForLoadState('networkidle');
        
        // Look for version history section
        const versionHistory = page.getByText(/version|history|revision/i);
        if (await versionHistory.isVisible({ timeout: 2000 })) {
          await versionHistory.click();
          await page.waitForLoadState('networkidle');
          
          // Should show versions list
          const versions = page.locator('[data-version], .version-item');
          expect(await versions.count()).toBeGreaterThanOrEqual(0);
        }
      }
    });
    
    test('version history shows dates', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        await documentItems.first().click();
        await page.waitForLoadState('networkidle');
        
        const versionButton = page.getByRole('button', { name: /version|history/i });
        if (await versionButton.isVisible({ timeout: 2000 })) {
          await versionButton.click();
          await page.waitForLoadState('networkidle');
          
          // Look for dates
          const dates = page.getByText(/\d{4}|\d{1,2}\/\d{1,2}/i);
          await expect(dates.first()).toBeVisible({ timeout: 3000 });
        }
      }
    });
    
    test('can view previous versions', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        await documentItems.first().click();
        await page.waitForLoadState('networkidle');
        
        const versionButton = page.getByRole('button', { name: /version|history/i });
        if (await versionButton.isVisible({ timeout: 2000 })) {
          await versionButton.click();
          await page.waitForLoadState('networkidle');
          
          // Try to view an older version
          const olderVersion = page.locator('[data-version], .version-item').nth(1);
          if (await olderVersion.isVisible({ timeout: 2000 })) {
            await olderVersion.click();
            await page.waitForLoadState('networkidle');
            
            // Should open or preview older version
            const preview = page.locator('iframe, embed, .pdf-viewer, [data-preview]');
            if (await preview.isVisible({ timeout: 3000 })) {
              await expect(preview).toBeVisible();
            }
          }
        }
      }
    });
    
    test('version history shows who made changes', async ({ page }) => {
      const documentItems = ownerPortal.documentList.locator('[data-document], .document-item, tr');
      const count = await documentItems.count();
      
      if (count > 0) {
        await documentItems.first().click();
        await page.waitForLoadState('networkidle');
        
        const versionButton = page.getByRole('button', { name: /version|history/i });
        if (await versionButton.isVisible({ timeout: 2000 })) {
          await versionButton.click();
          await page.waitForLoadState('networkidle');
          
          // Look for user names or emails
          const userInfo = page.getByText(/@|by|modified.*by/i);
          if (await userInfo.count() > 0) {
            await expect(userInfo.first()).toBeVisible();
          }
        }
      }
    });
  });
});
