import { type Locator, type Page } from '@playwright/test';

/**
 * Dashboard page object - estate manager, admin, owner, or customer dashboards.
 */
export class DashboardPage {
  readonly page: Page;
  readonly title: Locator;
  readonly propertiesLink: Locator;
  readonly workOrdersLink: Locator;
  readonly createWorkOrderLink: Locator;
  readonly receivePaymentLink: Locator;
  readonly leasesLink: Locator;
  readonly addCustomerLink: Locator;

  constructor(page: Page) {
    this.page = page;
    this.title = page.getByRole('heading', { level: 1 }).or(page.getByText('Dashboard'));
    this.propertiesLink = page.getByRole('link', { name: /propert/i }).first();
    this.workOrdersLink = page.getByRole('link', { name: /work order/i }).first();
    this.createWorkOrderLink = page.getByRole('link', { name: /create work order/i });
    this.receivePaymentLink = page.getByRole('link', { name: /receive payment/i });
    this.leasesLink = page.getByRole('link', { name: /lease/i }).first();
    this.addCustomerLink = page.getByRole('link', { name: /add customer/i });
  }

  async goto(path = '/') {
    await this.page.goto(path || '/');
  }

  async expectDashboardLoaded() {
    await this.title.waitFor({ state: 'visible', timeout: 10000 });
  }

  async clickProperties() {
    await this.propertiesLink.click();
  }

  async clickWorkOrders() {
    await this.workOrdersLink.click();
  }

  async clickCreateWorkOrder() {
    await this.createWorkOrderLink.click();
  }

  async clickReceivePayment() {
    await this.receivePaymentLink.click();
  }

  async clickLeases() {
    await this.leasesLink.click();
  }

  async clickAddCustomer() {
    await this.addCustomerLink.click();
  }
}
