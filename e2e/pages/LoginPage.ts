import { type Locator, type Page } from '@playwright/test';

/**
 * Login page object - supports both email/password (admin, owner) and phone (customer) flows.
 */
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly phoneInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByLabel(/email/i).or(page.locator('input#email'));
    this.passwordInput = page.getByLabel(/password/i).or(page.locator('input#password'));
    this.phoneInput = page.getByLabel(/phone/i).or(page.locator('input#phone'));
    this.submitButton = page.getByRole('button', { name: /sign in|send otp/i });
    this.errorMessage = page.locator('[class*="red"], [class*="danger"], [class*="error"]').first();
  }

  async goto(path = '/login') {
    await this.page.goto(path || '/login');
  }

  async loginWithEmail(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  async loginWithPhone(phone: string) {
    await this.phoneInput.fill(phone);
    await this.submitButton.click();
  }

  async fillDemoAccount(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async clickDemoAccount(email: string) {
    await this.page.getByRole('button', { name: new RegExp(email, 'i') }).click();
  }

  async expectError(message?: string | RegExp) {
    if (message) {
      await this.page.getByText(message).waitFor({ state: 'visible' });
    } else {
      await this.errorMessage.waitFor({ state: 'visible' });
    }
  }
}
