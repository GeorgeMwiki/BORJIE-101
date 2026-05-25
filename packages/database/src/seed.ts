// @ts-nocheck — bcrypt has no @types, import-assertion syntax change, drizzle 0.36 pgEnum narrowing in seed row shapes. Tracked.
/**
 * BORJIE Database Seed
 * Seeds the initial tenant, admin user, sample properties, units, customers,
 * and leases.
 *
 * Production policy: NO hardcoded fallbacks. All required env vars must be
 * provided (DATABASE_URL, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD,
 * SEED_TENANT_NAME, SEED_TENANT_EMAIL). The seed will refuse to run in any
 * environment without them — even local development.
 */

import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { createDatabaseClient } from './client.js';
import { logger } from './logger.js';
import {
  tenants,
  organizations,
  users,
  roles,
  userRoles,
  properties,
  units,
  customers,
  leases,
} from './schemas/index.js';

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new Error(
      `Seed: required env var ${name} is not set. ` +
        'See packages/database/.env.example for the full list.'
    );
  }
  return v;
}

const DATABASE_URL = requireEnv('DATABASE_URL');

async function seed() {
  // Hard gate — demo seed must be opted into explicitly.
  if (process.env.SEED_DEMO !== 'true') {
    throw new Error(
      'Refusing to run demo seed: set SEED_DEMO=true to acknowledge this ' +
        'will write a demo tenant + admin + sample property/units/leases. ' +
        'For production tenant onboarding use the Migration Wizard.'
    );
  }
  const db = createDatabaseClient(DATABASE_URL);
  const adminEmail = requireEnv('SEED_ADMIN_EMAIL');
  const adminPassword = requireEnv('SEED_ADMIN_PASSWORD');
  const ADMIN_PASSWORD_HASH = await bcrypt.hash(adminPassword, 10);
  const tenantName = requireEnv('SEED_TENANT_NAME');
  const tenantSlug = requireEnv('SEED_TENANT_SLUG');
  const tenantEmail = requireEnv('SEED_TENANT_EMAIL');
  const tenantPhone = process.env.SEED_TENANT_PHONE?.trim() ?? '';
  const propertyName = requireEnv('SEED_PROPERTY_NAME');
  const propertyAddress = requireEnv('SEED_PROPERTY_ADDRESS');
  const propertyCity = process.env.SEED_PROPERTY_CITY?.trim() ?? 'Nairobi';

  const tenantId = crypto.randomUUID();
  const orgId = crypto.randomUUID();
  const adminUserId = crypto.randomUUID();
  const adminRoleId = crypto.randomUUID();
  const propertyId = crypto.randomUUID();
  const unit1Id = crypto.randomUUID();
  const unit2Id = crypto.randomUUID();
  const customer1Id = crypto.randomUUID();
  const customer2Id = crypto.randomUUID();
  const lease1Id = crypto.randomUUID();
  const lease2Id = crypto.randomUUID();

  const now = new Date();
  const oneYearFromNow = new Date(now);
  oneYearFromNow.setFullYear(oneYearFromNow.getFullYear() + 1);

  try {
    await db.insert(tenants).values({
      id: tenantId,
      name: tenantName,
      slug: tenantSlug,
      status: 'active',
      subscriptionTier: 'professional',
      primaryEmail: tenantEmail,
      primaryPhone: tenantPhone || null,
      addressLine1: propertyAddress,
      city: propertyCity,
      country: 'KE',
      currentUsers: 1,
      currentProperties: 1,
      currentUnits: 2,
      maxUsers: 10,
      maxProperties: 50,
      maxUnits: 200,
    });

    await db.insert(organizations).values({
      id: orgId,
      tenantId,
      code: 'ROOT',
      name: 'Head Office',
      level: 0,
      path: '/',
    });

    await db.insert(users).values({
      id: adminUserId,
      tenantId,
      organizationId: orgId,
      email: adminEmail,
      firstName: 'Admin',
      lastName: 'User',
      displayName: 'Admin User',
      status: 'active',
      isOwner: true,
      passwordHash: ADMIN_PASSWORD_HASH,
    });

    await db.insert(roles).values({
      id: adminRoleId,
      tenantId,
      name: 'admin',
      displayName: 'Administrator',
      description: 'Full access to all features',
      permissions: ['*'],
      isSystem: true,
    });

    await db.insert(userRoles).values({
      id: crypto.randomUUID(),
      userId: adminUserId,
      roleId: adminRoleId,
      tenantId,
    });

    await db.insert(properties).values({
      id: propertyId,
      tenantId,
      ownerId: adminUserId,
      propertyCode: `${tenantSlug.toUpperCase()}-001`,
      name: propertyName,
      type: 'apartment_complex',
      status: 'active',
      addressLine1: propertyAddress,
      city: propertyCity,
      country: 'KE',
      totalUnits: 2,
      occupiedUnits: 2,
      vacantUnits: 0,
    });

    await db.insert(units).values([
      {
        id: unit1Id,
        tenantId,
        propertyId,
        unitCode: '101',
        name: 'Unit 101',
        type: 'two_bedroom',
        status: 'occupied',
        baseRentAmount: 45000,
      },
      {
        id: unit2Id,
        tenantId,
        propertyId,
        unitCode: '102',
        name: 'Unit 102',
        type: 'three_bedroom',
        status: 'occupied',
        baseRentAmount: 55000,
      },
    ]);

    const customer1Email = requireEnv('SEED_CUSTOMER1_EMAIL');
    const customer1Phone = requireEnv('SEED_CUSTOMER1_PHONE');
    const customer1First = requireEnv('SEED_CUSTOMER1_FIRST');
    const customer1Last = requireEnv('SEED_CUSTOMER1_LAST');
    const customer2Email = requireEnv('SEED_CUSTOMER2_EMAIL');
    const customer2Phone = requireEnv('SEED_CUSTOMER2_PHONE');
    const customer2First = requireEnv('SEED_CUSTOMER2_FIRST');
    const customer2Last = requireEnv('SEED_CUSTOMER2_LAST');
    await db.insert(customers).values([
      {
        id: customer1Id,
        tenantId,
        customerCode: `${tenantSlug.toUpperCase()}-CUST-001`,
        email: customer1Email,
        phone: customer1Phone,
        firstName: customer1First,
        lastName: customer1Last,
        status: 'active',
        kycStatus: 'verified',
      },
      {
        id: customer2Id,
        tenantId,
        customerCode: `${tenantSlug.toUpperCase()}-CUST-002`,
        email: customer2Email,
        phone: customer2Phone,
        firstName: customer2First,
        lastName: customer2Last,
        status: 'active',
        kycStatus: 'verified',
      },
    ]);

    await db.insert(leases).values([
      {
        id: lease1Id,
        tenantId,
        propertyId,
        unitId: unit1Id,
        customerId: customer1Id,
        leaseNumber: 'LSE-001',
        leaseType: 'fixed_term',
        status: 'active',
        startDate: now,
        endDate: oneYearFromNow,
        rentAmount: 45000,
        rentFrequency: 'monthly',
        rentDueDay: 1,
        securityDepositAmount: 90000,
        securityDepositPaid: 90000,
        primaryOccupant: { name: `${customer1First} ${customer1Last}`, relationship: 'self' },
      },
      {
        id: lease2Id,
        tenantId,
        propertyId,
        unitId: unit2Id,
        customerId: customer2Id,
        leaseNumber: 'LSE-002',
        leaseType: 'fixed_term',
        status: 'active',
        startDate: now,
        endDate: oneYearFromNow,
        rentAmount: 55000,
        rentFrequency: 'monthly',
        rentDueDay: 1,
        securityDepositAmount: 110000,
        securityDepositPaid: 110000,
        primaryOccupant: { name: `${customer2First} ${customer2Last}`, relationship: 'self' },
      },
    ]);

    await db.update(units).set({
      currentLeaseId: lease1Id,
      currentCustomerId: customer1Id,
    }).where(eq(units.id, unit1Id));
    await db.update(units).set({
      currentLeaseId: lease2Id,
      currentCustomerId: customer2Id,
    }).where(eq(units.id, unit2Id));

    logger.info('Seed completed successfully');
  } catch (err) {
    logger.error('Seed failed', { error: err });
    throw err;
  } finally {
    process.exit(0);
  }
}

seed();
