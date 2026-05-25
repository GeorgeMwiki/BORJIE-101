import { type Locator, type Page } from '@playwright/test';

/**
 * Leases page object - estate manager lease list.
 */
export class LeasesPage {
  readonly page: Page;
  readonly title: Locator;
  readonly newLeaseButton: Locator;
  readonly searchInput: Locator;
  readonly statusFilter: Locator;
  readonly leaseCards: Locator;
  readonly emptyState: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByRole('heading', { name: /leases/i });
    this.newLeaseButton = page.getByRole('link', { name: /new lease/i });
    this.searchInput = page.getByPlaceholder(/search.*tenant|lease number/i);
    this.statusFilter = page.locator('select').filter({ hasText: /all|active|pending/i });
    this.leaseCards = page.locator('[class*="card"]').filter({ has: page.locator('a[href*="/leases/"]') });
    this.emptyState = page.getByText(/no leases found/i);
  }

  async goto() {
    await this.page.goto('/leases');
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

  async clickNewLease() {
    await this.newLeaseButton.click();
  }

  async clickLease(tenantName: string) {
    await this.page.getByRole('link').filter({ hasText: tenantName }).first().click();
  }

  async getLeaseCount(): Promise<number> {
    return this.leaseCards.count();
  }

  async expectHasLeases(count?: number) {
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
