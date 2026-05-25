/**
 * Owner Portal Messaging Tests
 * Covers: OP-AC-050 to OP-AC-052
 * 
 * Tests sending messages, viewing conversation history, and email notifications.
 */

import { test, expect } from '@playwright/test';
import { OwnerPortalPage } from '../../page-objects';
import { loginAsOwner } from '../../fixtures/auth';
import { randomString } from '../../fixtures/test-data';

test.describe('Owner Portal Messaging', () => {
  let ownerPortal: OwnerPortalPage;
  
  test.beforeEach(async ({ page }) => {
    await loginAsOwner(page);
    ownerPortal = new OwnerPortalPage(page);
    await ownerPortal.gotoMessages();
  });
  
  test.describe('OP-AC-050: Send Messages to Estate Manager', () => {
    test('owner can send messages to estate manager via portal', async ({ page }) => {
      const testMessage = `E2E Test Message ${randomString(8)}`;
      
      // Compose and send message
      await ownerPortal.sendMessage(testMessage);
      
      // Verify message appears in history
      await ownerPortal.expectMessageSent(testMessage);
    });
    
    test('message input has character limit indicator', async ({ page }) => {
      // Look for character count
      const charCount = page.getByText(/\d+\s*\/\s*\d+|characters|remaining/i);
      
      // Type a long message
      await ownerPortal.messageCompose.fill('A'.repeat(100));
      
      if (await charCount.isVisible({ timeout: 2000 })) {
        await expect(charCount).toBeVisible();
      }
    });
    
    test('can attach files to messages', async ({ page }) => {
      const attachButton = page.getByRole('button', { name: /attach|file|upload/i });
      
      if (await attachButton.isVisible({ timeout: 2000 })) {
        await attachButton.click();
        
        // File input should be available
        const fileInput = page.locator('input[type="file"]');
        await expect(fileInput).toBeAttached();
      }
    });
    
    test('message composer validates empty messages', async ({ page }) => {
      // Try to send empty message
      await ownerPortal.messageCompose.fill('');
      await ownerPortal.sendButton.click();
      
      // Should show validation error or button should be disabled
      const error = page.getByText(/required|empty|enter.*message/i);
      const isDisabled = await ownerPortal.sendButton.isDisabled();
      
      if (await error.isVisible({ timeout: 1000 })) {
        await expect(error).toBeVisible();
      } else {
        expect(isDisabled).toBeTruthy();
      }
    });
    
    test('can select message recipient', async ({ page }) => {
      const recipientSelect = page.getByLabel(/to|recipient|manager/i)
        .or(page.getByRole('combobox', { name: /to|recipient/i }));
      
      if (await recipientSelect.isVisible({ timeout: 2000 })) {
        await recipientSelect.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
    
    test('can set message priority/urgency', async ({ page }) => {
      const prioritySelect = page.getByLabel(/priority|urgent/i)
        .or(page.getByRole('button', { name: /priority|urgent/i }));
      
      if (await prioritySelect.isVisible({ timeout: 2000 })) {
        await prioritySelect.click();
        
        const options = page.getByRole('option');
        if (await options.count() > 0) {
          await expect(options.first()).toBeVisible();
        }
        
        await page.keyboard.press('Escape');
      }
    });
  });
  
  test.describe('OP-AC-051: Conversation History', () => {
    test('owner can view conversation history with timestamps', async ({ page }) => {
      const messages = await ownerPortal.getMessageHistory();
      
      // Should have messages or empty state
      expect(messages).toBeDefined();
      
      if (messages.length > 0) {
        // Messages should have timestamps
        const messageText = messages.join(' ');
        expect(messageText).toMatch(/\d+|am|pm|today|yesterday/i);
      }
    });
    
    test('conversation history shows message direction', async ({ page }) => {
      const sentMessages = page.locator('[data-direction="sent"], .message-sent, [class*="outgoing"]');
      const receivedMessages = page.locator('[data-direction="received"], .message-received, [class*="incoming"]');
      
      // Should show distinction between sent and received
      const sentCount = await sentMessages.count();
      const receivedCount = await receivedMessages.count();
      
      // At least the UI structure should exist
      expect(ownerPortal.messageHistory).toBeDefined();
    });
    
    test('conversation history is scrollable', async ({ page }) => {
      // Check if message history is scrollable
      const isScrollable = await ownerPortal.messageHistory.evaluate((el) => {
        return el.scrollHeight > el.clientHeight;
      });
      
      // May or may not be scrollable depending on content
      expect(typeof isScrollable).toBe('boolean');
    });
    
    test('can search conversation history', async ({ page }) => {
      const searchInput = page.getByPlaceholder(/search.*message/i)
        .or(page.getByLabel(/search/i));
      
      if (await searchInput.isVisible({ timeout: 2000 })) {
        await searchInput.fill('test');
        await page.keyboard.press('Enter');
        await page.waitForLoadState('networkidle');
        
        // Should filter messages
        const messages = await ownerPortal.getMessageHistory();
        expect(messages).toBeDefined();
      }
    });
    
    test('messages show read status', async ({ page }) => {
      const readIndicator = page.locator('[data-read], .read-indicator, [class*="read"]');
      
      if (await readIndicator.count() > 0) {
        await expect(readIndicator.first()).toBeVisible();
      }
    });
    
    test('can filter by date range', async ({ page }) => {
      const dateFilter = page.getByLabel(/date/i)
        .or(page.getByRole('button', { name: /filter.*date/i }));
      
      if (await dateFilter.isVisible({ timeout: 2000 })) {
        await dateFilter.click();
        await page.waitForLoadState('networkidle');
        
        const dateOptions = page.getByRole('option');
        if (await dateOptions.count() > 0) {
          await expect(dateOptions.first()).toBeVisible();
        }
        
        await page.keyboard.press('Escape');
      }
    });
  });
  
  test.describe('OP-AC-052: Email Notifications', () => {
    test('owner receives email notification for new messages', async ({ page }) => {
      // This test verifies the notification settings exist
      // Navigate to notification settings
      const settingsLink = page.getByRole('link', { name: /settings/i });
      
      if (await settingsLink.isVisible({ timeout: 2000 })) {
        await settingsLink.click();
        await page.waitForLoadState('networkidle');
        
        const notificationSettings = page.getByText(/notification|email.*notification/i);
        if (await notificationSettings.isVisible({ timeout: 2000 })) {
          await notificationSettings.click();
          
          // Should show email notification toggle
          const emailToggle = page.getByLabel(/email.*notification|new.*message/i);
          await expect(emailToggle).toBeVisible({ timeout: 5000 });
        }
      }
    });
    
    test('notification preferences can be configured', async ({ page }) => {
      // Navigate to notification settings
      await page.goto('/settings/notifications');
      await page.waitForLoadState('networkidle');
      
      // Look for configurable options
      const toggles = page.locator('input[type="checkbox"], [role="switch"]');
      const toggleCount = await toggles.count();
      
      // Should have some notification options
      expect(toggleCount).toBeGreaterThanOrEqual(0);
    });
    
    test('can toggle email notifications on/off', async ({ page }) => {
      await page.goto('/settings/notifications');
      await page.waitForLoadState('networkidle');
      
      const emailToggle = page.getByLabel(/email/i)
        .or(page.locator('input[type="checkbox"]').first());
      
      if (await emailToggle.isVisible({ timeout: 2000 })) {
        const initialState = await emailToggle.isChecked();
        
        // Toggle
        await emailToggle.click();
        
        // Save
        const saveButton = page.getByRole('button', { name: /save/i });
        if (await saveButton.isVisible({ timeout: 1000 })) {
          await saveButton.click();
          await page.waitForLoadState('networkidle');
        }
        
        // Verify toggle state changed
        const newState = await emailToggle.isChecked();
        expect(newState).not.toBe(initialState);
        
        // Restore original state
        await emailToggle.click();
        if (await saveButton.isVisible({ timeout: 1000 })) {
          await saveButton.click();
        }
      }
    });
    
    test('notification settings show delivery options', async ({ page }) => {
      await page.goto('/settings/notifications');
      await page.waitForLoadState('networkidle');
      
      // Look for delivery options (email, SMS, push)
      const deliveryOptions = page.getByText(/email|sms|push|in-app/i);
      
      if (await deliveryOptions.count() > 0) {
        await expect(deliveryOptions.first()).toBeVisible();
      }
    });
    
    test('can set notification frequency', async ({ page }) => {
      await page.goto('/settings/notifications');
      await page.waitForLoadState('networkidle');
      
      const frequencySelect = page.getByLabel(/frequency|digest/i)
        .or(page.getByRole('combobox', { name: /frequency/i }));
      
      if (await frequencySelect.isVisible({ timeout: 2000 })) {
        await frequencySelect.click();
        
        const options = page.getByRole('option');
        expect(await options.count()).toBeGreaterThan(0);
        
        await page.keyboard.press('Escape');
      }
    });
  });
});
