import { type Locator, type Page } from '@playwright/test';

/**
 * Properties page object - estate manager property list.
 */
export class PropertiesPage {
  readonly page: Page;
  readonly title: Locator;
  readonly addButton: Locator;
  readonly searchInput: Locator;
  readonly statusFilter: Locator;
  readonly propertyCards: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByRole('heading', { name: /properties/i });
    this.addButton = page.getByRole('link', { name: /add/i }).or(page.getByRole('button', { name: /add/i }));
    this.searchInput = page.getByPlaceholder(/search properties/i);
    this.statusFilter = page.locator('select').filter({ hasText: /all status|status/i });
    this.propertyCards = page.locator('[class*="card"]').filter({ has: page.locator('a[href*="/properties/"]') });
    this.emptyState = page.getByText(/no properties found/i);
  }

  async goto() {
    await this.page.goto('/properties');
  }

  async expectLoaded() {
    await this.title.waitFor({ state: 'visible', timeout: 10000 });
  }

  async search(query: string) {
    await this.searchInput.fill(query);
  }

  async filterByStatus(status: string) {
    await this.statusFilter.selectOption(status);
  }

  async clickAdd() {
    await this.addButton.click();
  }

  async clickProperty(name: string) {
    await this.page.getByRole('link', { name: new RegExp(name, 'i') }).first().click();
  }

  async getPropertyCount(): Promise<number> {
    return this.propertyCards.count();
  }

  async expectHasProperties(count?: number) {
    if (count !== undefined) {
      await this.page.waitForFunction(
        (n) => document.querySelectorAll('[class*="card"]').length >= n,
        count
      );
    } else {
      await this.title.waitFor({ state: 'visible' });
    }
  }
}
