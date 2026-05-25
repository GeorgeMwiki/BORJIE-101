/**
 * Test data generators for BORJIE E2E tests.
 */

export const testData = {
  property: {
    name: () => `E2E Property ${Date.now()}`,
    address: () => ({
      street: '123 Test Street',
      city: 'Nairobi',
      country: 'Kenya',
    }),
    type: 'APARTMENT' as const,
  },

  lease: {
    tenantName: () => `E2E Tenant ${Date.now()}`,
    unitNumber: () => `U-${Math.floor(Math.random() * 1000)}`,
    monthlyRent: 45000,
    startDate: () => new Date().toISOString().split('T')[0],
    endDate: () => {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 1);
      return d.toISOString().split('T')[0];
    },
  },

  workOrder: {
    title: () => `E2E Work Order ${Date.now()}`,
    description: () => 'E2E test maintenance request description',
    category: 'plumbing' as const,
    priority: 'medium' as const,
  },

  payment: {
    amount: 15000,
    currency: 'KES' as const,
    phone: '+254712345678',
  },

  auth: {
    admin: {
      email: 'admin@borjie.com',
      password: 'admin123',
    },
    owner: {
      email: 'owner@borjie.com',
      password: 'demo123',
    },
    customer: {
      phone: '+254712345678',
    },
  },
};

/**
 * Generate a random string for unique test IDs.
 */
export function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}
