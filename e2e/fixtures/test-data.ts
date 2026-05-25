/**
 * Comprehensive test data generators for BORJIE E2E tests.
 * Provides mock users, properties, invoices, and other test fixtures.
 */

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a random string for unique test IDs.
 */
export function randomString(length = 8): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

/**
 * Generate a random number within a range.
 */
export function randomNumber(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a unique email address.
 */
export function randomEmail(prefix = 'test'): string {
  return `${prefix}-${randomString()}@e2e-test.borjie.com`;
}

/**
 * Generate a random phone number (Kenya format).
 */
export function randomPhone(): string {
  return `+2547${randomNumber(10000000, 99999999)}`;
}

/**
 * Get today's date in ISO format.
 */
export function today(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * Get a date in the future.
 */
export function futureDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Get a date in the past.
 */
export function pastDate(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
}

// ============================================================================
// STABLE IDS — match e2e/fixtures/seed.sql, used by specs that need to
// reference specific records without first having to read them back from the
// API. Keep these IN SYNC with seed.sql.
// ============================================================================

export const testIds = {
  tenantId: 'tnt_e2e_0001',
  customerUserId: 'usr_e2e_customer_0001',
  adminUserId: 'usr_e2e_admin_0001',
  propertyId: 'prp_e2e_0001',
  unitId: 'unt_e2e_0001',
  leaseId: 'lse_e2e_0001',
} as const;

// ============================================================================
// TEST USERS — use E2E_TEST_* env when set (live demo / production runs)
// ============================================================================

function e2eEnv(key: string): string | undefined {
  return process.env[key]?.trim() || undefined;
}

export const testUsers = {
  superAdmin: {
    get email() {
      return e2eEnv('E2E_TEST_ADMIN_EMAIL') ?? 'admin@borjie.com';
    },
    get password() {
      return e2eEnv('E2E_TEST_ADMIN_PASSWORD') ?? 'admin123';
    },
    name: 'Super Admin',
    role: 'super_admin',
  },

  admin: {
    get email() {
      return e2eEnv('E2E_TEST_ADMIN_EMAIL') ?? 'admin-staff@borjie.com';
    },
    get password() {
      return e2eEnv('E2E_TEST_ADMIN_PASSWORD') ?? 'admin123';
    },
    name: 'Admin Staff',
    role: 'admin',
  },

  owner: {
    get email() {
      return e2eEnv('E2E_TEST_OWNER_EMAIL') ?? 'owner@borjie.com';
    },
    get password() {
      return e2eEnv('E2E_TEST_OWNER_PASSWORD') ?? 'demo123';
    },
    name: 'Property Owner',
    role: 'owner',
  },

  manager: {
    get email() {
      return e2eEnv('E2E_TEST_MANAGER_EMAIL') ?? 'manager@borjie.com';
    },
    get password() {
      return e2eEnv('E2E_TEST_MANAGER_PASSWORD') ?? 'demo123';
    },
    name: 'Estate Manager',
    role: 'manager',
  },

  customer: {
    get phone() {
      return e2eEnv('E2E_TEST_CUSTOMER_PHONE') ?? '+254712345678';
    },
    name: 'Test Customer',
    role: 'customer',
  },

  technician: {
    email: 'tech@borjie.com',
    password: 'demo123',
    name: 'Test Technician',
    role: 'technician',
  },

  // Generate random user
  random: () => ({
    email: randomEmail('user'),
    password: 'Password123!',
    name: `Test User ${randomString(4)}`,
    phone: randomPhone(),
  }),
};

// ============================================================================
// TEST TENANTS (Organizations)
// ============================================================================

export const testTenants = {
  // Basic tenant with minimal info
  basic: () => ({
    name: `E2E Test Tenant ${randomString()}`,
    email: randomEmail('tenant'),
    phone: randomPhone(),
  }),

  // Tenant with full business details
  fullDetails: () => ({
    name: `E2E Property Management ${randomString()}`,
    email: randomEmail('company'),
    phone: randomPhone(),
    address: '123 Business Park, Nairobi, Kenya',
    taxId: `KRA${randomNumber(100000000, 999999999)}`,
    registrationNumber: `BN${randomNumber(100000, 999999)}`,
    industry: 'Real Estate',
    size: 'medium',
    website: `https://e2e-test-${randomString()}.com`,
  }),

  // Enterprise tenant
  enterprise: () => ({
    name: `E2E Enterprise Corp ${randomString()}`,
    email: randomEmail('enterprise'),
    phone: randomPhone(),
    address: 'Enterprise Tower, Westlands, Nairobi',
    taxId: `KRA${randomNumber(100000000, 999999999)}`,
    plan: 'enterprise',
    employees: randomNumber(50, 200),
    properties: randomNumber(10, 50),
  }),
};

// ============================================================================
// TEST PROPERTIES
// ============================================================================

export const testProperties = {
  // Apartment building
  apartment: () => ({
    name: `E2E Apartments ${randomString(4)}`,
    type: 'APARTMENT',
    address: {
      street: `${randomNumber(1, 999)} Test Street`,
      city: 'Nairobi',
      county: 'Nairobi',
      country: 'Kenya',
      postalCode: `${randomNumber(10000, 99999)}`,
    },
    units: randomNumber(10, 50),
    yearBuilt: randomNumber(2010, 2024),
  }),

  // Commercial building
  commercial: () => ({
    name: `E2E Commercial ${randomString(4)}`,
    type: 'COMMERCIAL',
    address: {
      street: `${randomNumber(1, 999)} Business Avenue`,
      city: 'Nairobi',
      county: 'Nairobi',
      country: 'Kenya',
      postalCode: `${randomNumber(10000, 99999)}`,
    },
    units: randomNumber(5, 20),
    floors: randomNumber(2, 10),
  }),

  // Single family home
  house: () => ({
    name: `E2E House ${randomString(4)}`,
    type: 'HOUSE',
    address: {
      street: `${randomNumber(1, 999)} Residential Road`,
      city: 'Karen',
      county: 'Nairobi',
      country: 'Kenya',
      postalCode: `${randomNumber(10000, 99999)}`,
    },
    bedrooms: randomNumber(2, 5),
    bathrooms: randomNumber(1, 3),
  }),
};

// ============================================================================
// TEST UNITS
// ============================================================================

export const testUnits = {
  // Standard apartment unit
  apartment: () => ({
    number: `A${randomNumber(100, 999)}`,
    type: 'APARTMENT',
    floor: randomNumber(1, 10),
    bedrooms: randomNumber(1, 3),
    bathrooms: randomNumber(1, 2),
    sqft: randomNumber(500, 1500),
    rent: randomNumber(25000, 75000),
    status: 'vacant',
  }),

  // Commercial office
  office: () => ({
    number: `OFF-${randomNumber(100, 999)}`,
    type: 'OFFICE',
    floor: randomNumber(1, 10),
    sqft: randomNumber(200, 2000),
    rent: randomNumber(50000, 200000),
    status: 'vacant',
  }),

  // Studio unit
  studio: () => ({
    number: `S${randomNumber(100, 999)}`,
    type: 'STUDIO',
    floor: randomNumber(1, 5),
    bedrooms: 0,
    bathrooms: 1,
    sqft: randomNumber(250, 400),
    rent: randomNumber(15000, 35000),
    status: 'vacant',
  }),
};

// ============================================================================
// TEST LEASES
// ============================================================================

export const testLeases = {
  // Standard residential lease
  residential: () => ({
    tenantName: `E2E Tenant ${randomString(4)}`,
    tenantEmail: randomEmail('leasee'),
    tenantPhone: randomPhone(),
    unitNumber: `A${randomNumber(100, 999)}`,
    monthlyRent: randomNumber(25000, 75000),
    deposit: randomNumber(25000, 150000),
    startDate: today(),
    endDate: futureDate(365),
    status: 'pending',
  }),

  // Short-term lease
  shortTerm: () => ({
    tenantName: `Short Term Tenant ${randomString(4)}`,
    tenantEmail: randomEmail('short'),
    tenantPhone: randomPhone(),
    unitNumber: `ST${randomNumber(100, 999)}`,
    monthlyRent: randomNumber(35000, 85000),
    deposit: randomNumber(35000, 85000),
    startDate: today(),
    endDate: futureDate(90),
    status: 'pending',
  }),

  // Commercial lease
  commercial: () => ({
    tenantName: `E2E Business ${randomString(4)}`,
    tenantEmail: randomEmail('business'),
    tenantPhone: randomPhone(),
    unitNumber: `OFF-${randomNumber(100, 999)}`,
    monthlyRent: randomNumber(75000, 200000),
    deposit: randomNumber(150000, 400000),
    startDate: today(),
    endDate: futureDate(730), // 2 years
    status: 'pending',
  }),
};

// ============================================================================
// TEST WORK ORDERS / MAINTENANCE
// ============================================================================

export const testWorkOrders = {
  // Plumbing issue
  plumbing: () => ({
    title: `Plumbing Issue ${randomString(4)}`,
    description: 'Leaking faucet in the kitchen - water dripping constantly',
    category: 'plumbing',
    priority: 'medium',
    status: 'open',
  }),

  // Electrical issue
  electrical: () => ({
    title: `Electrical Issue ${randomString(4)}`,
    description: 'Power outlet not working in bedroom',
    category: 'electrical',
    priority: 'high',
    status: 'open',
  }),

  // HVAC issue
  hvac: () => ({
    title: `HVAC Issue ${randomString(4)}`,
    description: 'Air conditioning not cooling properly',
    category: 'hvac',
    priority: 'medium',
    status: 'open',
  }),

  // General maintenance
  general: () => ({
    title: `General Maintenance ${randomString(4)}`,
    description: 'Door handle is loose and needs tightening',
    category: 'general',
    priority: 'low',
    status: 'open',
  }),

  // Urgent issue
  urgent: () => ({
    title: `Urgent Issue ${randomString(4)}`,
    description: 'Water pipe burst - flooding in apartment',
    category: 'plumbing',
    priority: 'urgent',
    status: 'open',
  }),
};

// ============================================================================
// TEST PAYMENTS
// ============================================================================

export const testPayments = {
  // Rent payment
  rent: () => ({
    type: 'rent',
    amount: randomNumber(25000, 75000),
    currency: 'KES',
    method: 'mpesa',
    phone: '+254712345678',
    reference: `RENT-${randomString(8).toUpperCase()}`,
  }),

  // Deposit payment
  deposit: () => ({
    type: 'deposit',
    amount: randomNumber(50000, 150000),
    currency: 'KES',
    method: 'bank_transfer',
    reference: `DEP-${randomString(8).toUpperCase()}`,
  }),

  // Utility payment
  utility: () => ({
    type: 'utility',
    amount: randomNumber(1000, 10000),
    currency: 'KES',
    method: 'mpesa',
    phone: '+254712345678',
    reference: `UTIL-${randomString(8).toUpperCase()}`,
  }),

  // Service charge
  serviceCharge: () => ({
    type: 'service_charge',
    amount: randomNumber(2000, 15000),
    currency: 'KES',
    method: 'mpesa',
    phone: '+254712345678',
    reference: `SVC-${randomString(8).toUpperCase()}`,
  }),
};

// ============================================================================
// TEST INVOICES
// ============================================================================

export const testInvoices = {
  // Rent invoice
  rent: () => ({
    type: 'rent',
    amount: randomNumber(25000, 75000),
    dueDate: futureDate(30),
    status: 'pending',
    items: [
      { description: 'Monthly Rent', amount: randomNumber(25000, 75000) },
    ],
  }),

  // Utility invoice
  utility: () => ({
    type: 'utility',
    amount: randomNumber(2000, 15000),
    dueDate: futureDate(14),
    status: 'pending',
    items: [
      { description: 'Water', amount: randomNumber(500, 2000) },
      { description: 'Electricity', amount: randomNumber(1000, 8000) },
      { description: 'Garbage Collection', amount: randomNumber(200, 500) },
    ],
  }),

  // Combined invoice
  combined: () => {
    const rent = randomNumber(25000, 75000);
    const water = randomNumber(500, 2000);
    const electricity = randomNumber(1000, 8000);
    const serviceCharge = randomNumber(2000, 5000);
    
    return {
      type: 'combined',
      amount: rent + water + electricity + serviceCharge,
      dueDate: futureDate(30),
      status: 'pending',
      items: [
        { description: 'Monthly Rent', amount: rent },
        { description: 'Water', amount: water },
        { description: 'Electricity', amount: electricity },
        { description: 'Service Charge', amount: serviceCharge },
      ],
    };
  },
};

// ============================================================================
// TEST DOCUMENTS
// ============================================================================

export const testDocuments = {
  // ID document
  id: () => ({
    type: 'national_id',
    name: `ID-${randomString(8)}.pdf`,
    mimeType: 'application/pdf',
    size: randomNumber(50000, 500000),
  }),

  // Proof of income
  income: () => ({
    type: 'proof_of_income',
    name: `PaySlip-${randomString(8)}.pdf`,
    mimeType: 'application/pdf',
    size: randomNumber(50000, 300000),
  }),

  // Bank statement
  bankStatement: () => ({
    type: 'bank_statement',
    name: `BankStatement-${randomString(8)}.pdf`,
    mimeType: 'application/pdf',
    size: randomNumber(100000, 1000000),
  }),

  // Photo
  photo: () => ({
    type: 'photo',
    name: `Photo-${randomString(8)}.jpg`,
    mimeType: 'image/jpeg',
    size: randomNumber(100000, 5000000),
  }),
};

// ============================================================================
// LEGACY EXPORTS (for backward compatibility)
// ============================================================================

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
 * @deprecated Use randomString() instead
 */
export function randomId(): string {
  return randomString();
}
