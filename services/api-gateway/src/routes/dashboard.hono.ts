import { Hono } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';
import { databaseMiddleware } from '../middleware/database';
import { UserRole } from '../types/user-role';
import {
  minorToMajor,
  mapInvoiceRow,
  mapPaymentRow,
  mapWorkOrderRow,
  mapPropertyRow,
  mapUnitRow,
  mapLeaseRow,
} from './db-mappers';

function startOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function endOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

function isWithinRange(dateValue, start, end) {
  if (!dateValue) return false;
  const value = new Date(dateValue);
  return value >= start && value <= end;
}

function formatMonth(dateValue) {
  return new Date(dateValue).toLocaleDateString('en', {
    month: 'short',
    year: 'numeric',
  });
}

function buildMonthSeries(items, getDate, getValue, months = 7) {
  const now = new Date();
  const buckets = [];

  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    buckets.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en', { month: 'short' }),
      fullLabel: date.toLocaleDateString('en', { month: 'short', year: 'numeric' }),
      value: 0,
    });
  }

  const bucketMap = new Map(buckets.map((bucket) => [bucket.key, bucket]));

  for (const item of items) {
    const dateValue = getDate(item);
    if (!dateValue) continue;
    const date = new Date(dateValue);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const bucket = bucketMap.get(key);
    if (!bucket) continue;
    bucket.value += Number(getValue(item) || 0);
  }

  return buckets.map((bucket) => ({
    month: bucket.label,
    label: bucket.fullLabel,
    value: bucket.value,
  }));
}

async function getScopedOwnerData(auth, repos) {
  const propertyResult = await repos.properties.findMany(auth.tenantId, {
    limit: 1000,
    offset: 0,
  });
  const allProperties = propertyResult.items;
  const properties = auth.propertyAccess?.includes('*')
    ? allProperties
    : allProperties.filter((property) => auth.propertyAccess?.includes(property.id));

  const propertyIds = new Set(properties.map((property) => property.id));

  const [unitsResult, leasesResult, invoicesResult, paymentsResult, workOrdersResult] =
    await Promise.all([
      repos.units.findMany(auth.tenantId, { limit: 1000, offset: 0 }),
      repos.leases.findMany(auth.tenantId, { limit: 1000, offset: 0 }),
      repos.invoices.findMany(auth.tenantId, 5000, 0),
      repos.payments.findMany(auth.tenantId, 5000, 0),
      repos.workOrders.findMany(auth.tenantId, 5000, 0),
    ]);

  const scopedUnits = unitsResult.items.filter((unit) => propertyIds.has(unit.propertyId));
  const scopedUnitIds = new Set(scopedUnits.map((unit) => unit.id));

  const scopedLeases = leasesResult.items.filter(
    (lease) => propertyIds.has(lease.propertyId) || scopedUnitIds.has(lease.unitId)
  );
  const scopedLeaseIds = new Set(scopedLeases.map((lease) => lease.id));
  const scopedCustomerIds = new Set(scopedLeases.map((lease) => lease.customerId));

  const scopedInvoices = invoicesResult.items.filter(
    (invoice) =>
      (invoice.leaseId && scopedLeaseIds.has(invoice.leaseId)) ||
      (invoice.customerId && scopedCustomerIds.has(invoice.customerId))
  );

  const scopedPayments = paymentsResult.items.filter(
    (payment) =>
      (payment.leaseId && scopedLeaseIds.has(payment.leaseId)) ||
      (payment.customerId && scopedCustomerIds.has(payment.customerId)) ||
      (payment.invoiceId && scopedInvoices.some((invoice) => invoice.id === payment.invoiceId))
  );

  const scopedWorkOrders = workOrdersResult.items.filter((workOrder) =>
    propertyIds.has(workOrder.propertyId)
  );

  // Wave 25 Agent V: replaced per-id `findById` fan-out with batched
  // `findByIds` (single IN-query each). Previously fetched N customers
  // and V vendors as 1+N+V round-trips; now 1+2.
  const customerIdList = Array.from(scopedCustomerIds);
  const vendorIdList = Array.from(
    new Set(scopedWorkOrders.map((workOrder) => workOrder.vendorId).filter(Boolean))
  );
  const [customers, vendors] = await Promise.all([
    customerIdList.length === 0
      ? []
      : repos.customers.findByIds(customerIdList, auth.tenantId),
    vendorIdList.length === 0
      ? []
      : repos.vendors.findByIds(vendorIdList, auth.tenantId),
  ]);

  return {
    properties,
    units: scopedUnits,
    leases: scopedLeases,
    invoices: scopedInvoices,
    payments: scopedPayments,
    workOrders: scopedWorkOrders,
    customers: customers.filter(Boolean),
    vendors: vendors.filter(Boolean),
  };
}

function enrichInvoices(invoices, leases, customers, units, properties) {
  const leaseMap = new Map(leases.map((lease) => [lease.id, lease]));
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));
  const propertyMap = new Map(properties.map((property) => [property.id, property]));

  return invoices.map((row) => {
    const invoice = mapInvoiceRow(row);
    const lease = row.leaseId ? leaseMap.get(row.leaseId) : undefined;
    const unit = lease?.unitId ? unitMap.get(lease.unitId) : undefined;
    const property = lease?.propertyId ? propertyMap.get(lease.propertyId) : undefined;
    const customer = row.customerId ? customerMap.get(row.customerId) : undefined;

    return {
      ...invoice,
      customer: customer
        ? {
            id: customer.id,
            name: `${customer.firstName} ${customer.lastName}`.trim(),
          }
        : undefined,
      unit: unit ? { id: unit.id, unitNumber: unit.unitCode } : undefined,
      property: property ? { id: property.id, name: property.name } : undefined,
    };
  });
}

function enrichPayments(payments, invoices, leases, customers) {
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const leaseMap = new Map(leases.map((lease) => [lease.id, lease]));
  const customerMap = new Map(customers.map((customer) => [customer.id, customer]));

  return payments.map((row) => {
    const payment = mapPaymentRow(row);
    const invoice = row.invoiceId ? invoiceMap.get(row.invoiceId) : undefined;
    const lease = row.leaseId
      ? leaseMap.get(row.leaseId)
      : invoice?.leaseId
      ? leaseMap.get(invoice.leaseId)
      : undefined;
    const customer = row.customerId
      ? customerMap.get(row.customerId)
      : invoice?.customerId
      ? customerMap.get(invoice.customerId)
      : undefined;

    return {
      ...payment,
      method: payment.paymentMethod,
      reference: payment.externalReference || payment.paymentNumber,
      customer: customer
        ? {
            id: customer.id,
            name: `${customer.firstName} ${customer.lastName}`.trim(),
          }
        : undefined,
      leaseId: lease?.id ?? payment.leaseId,
    };
  });
}

function buildOwnerDashboardPayload(scope) {
  const now = new Date();
  const currentMonthStart = startOfMonth(now);
  const currentMonthEnd = endOfMonth(now);
  const previousMonthStart = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const previousMonthEnd = endOfMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1));

  const properties = scope.properties.map(mapPropertyRow);
  const units = scope.units.map(mapUnitRow);
  const leases = scope.leases.map(mapLeaseRow);
  const invoices = scope.invoices.map(mapInvoiceRow);
  const payments = scope.payments.map(mapPaymentRow);
  const workOrders = scope.workOrders.map(mapWorkOrderRow);

  const currentMonthPayments = payments.filter((payment) =>
    isWithinRange(payment.completedAt || payment.createdAt, currentMonthStart, currentMonthEnd)
  );
  const previousMonthPayments = payments.filter((payment) =>
    isWithinRange(payment.completedAt || payment.createdAt, previousMonthStart, previousMonthEnd)
  );
  const currentMonthInvoices = invoices.filter((invoice) =>
    isWithinRange(invoice.createdAt, currentMonthStart, currentMonthEnd)
  );
  const overdueInvoices = invoices.filter(
    (invoice) => invoice.status === 'OVERDUE' || (invoice.amountDue > 0 && new Date(invoice.dueDate) < now)
  );
  const currentMonthWorkOrders = workOrders.filter((workOrder) =>
    isWithinRange(workOrder.createdAt, currentMonthStart, currentMonthEnd)
  );

  const currentMonthRevenue = currentMonthPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const previousMonthRevenue = previousMonthPayments.reduce((sum, payment) => sum + payment.amount, 0);
  const outstandingBalance = overdueInvoices.reduce((sum, invoice) => sum + invoice.amountDue, 0);
  const currentMonthInvoiced = currentMonthInvoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const collectionRate =
    currentMonthInvoiced > 0 ? (currentMonthRevenue / currentMonthInvoiced) * 100 : 0;
  const totalMaintenanceCost = currentMonthWorkOrders.reduce(
    (sum, workOrder) => sum + (workOrder.actualCost || workOrder.estimatedCost || 0),
    0
  );

  const revenueChange =
    previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
      : currentMonthRevenue > 0
      ? 100
      : 0;

  const occupiedUnits = units.filter((unit) => unit.status === 'OCCUPIED').length;
  const vacantUnits = units.filter((unit) => unit.status !== 'OCCUPIED').length;

  const recentActivity = [
    ...payments.slice(0, 5).map((payment) => ({
      id: `payment-${payment.id}`,
      type: 'payment',
      title: `Payment ${payment.paymentNumber}`,
      description: `Received KES ${payment.amount.toLocaleString()}`,
      timestamp: payment.completedAt || payment.createdAt,
    })),
    ...workOrders.slice(0, 5).map((workOrder) => ({
      id: `work-order-${workOrder.id}`,
      type: 'maintenance',
      title: workOrder.title,
      description: `${workOrder.category} request is ${workOrder.status.toLowerCase()}`,
      timestamp: workOrder.updatedAt || workOrder.createdAt,
    })),
  ]
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .slice(0, 8);

  const alerts = [
    ...overdueInvoices.slice(0, 5).map((invoice) => ({
      id: `invoice-${invoice.id}`,
      type: 'arrears',
      title: `Invoice ${invoice.number} overdue`,
      message: `Outstanding balance is KES ${invoice.amountDue.toLocaleString()}`,
      actionUrl: '/financial?tab=invoices&filter=overdue',
    })),
    ...workOrders
      .filter((workOrder) => workOrder.status === 'PENDING_APPROVAL')
      .slice(0, 5)
      .map((workOrder) => ({
        id: `approval-${workOrder.id}`,
        type: 'maintenance',
        title: 'Maintenance approval pending',
        message: `${workOrder.title} requires an owner decision`,
        actionUrl: '/maintenance',
      })),
  ].slice(0, 6);

  const arrearsBuckets = {
    current: 0,
    overdue_30: 0,
    overdue_60: 0,
    overdue_90_plus: 0,
  };

  for (const invoice of overdueInvoices) {
    const ageDays = Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86400000);
    if (ageDays <= 30) arrearsBuckets.overdue_30 += invoice.amountDue;
    else if (ageDays <= 60) arrearsBuckets.overdue_60 += invoice.amountDue;
    else arrearsBuckets.overdue_90_plus += invoice.amountDue;
  }

  return {
    portfolio: {
      totalProperties: properties.length,
      totalUnits: units.length,
      portfolioValue: leases.reduce((sum, lease) => sum + lease.rentAmount * 12, 0),
    },
    financial: {
      currentMonthRevenue,
      revenueChange,
      outstandingBalance,
      collectionRate,
      collectionRateChange: revenueChange,
      noi: currentMonthRevenue - totalMaintenanceCost,
    },
    maintenance: {
      openRequests: workOrders.filter((workOrder) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(workOrder.status)).length,
      inProgress: workOrders.filter((workOrder) => workOrder.status === 'IN_PROGRESS').length,
      completedThisMonth: workOrders.filter(
        (workOrder) =>
          workOrder.status === 'COMPLETED' &&
          isWithinRange(workOrder.completedAt || workOrder.updatedAt, currentMonthStart, currentMonthEnd)
      ).length,
      totalCostThisMonth: totalMaintenanceCost,
      pendingApprovals: workOrders.filter((workOrder) => workOrder.status === 'PENDING_APPROVAL').length,
    },
    occupancy: {
      occupancyRate: units.length > 0 ? Math.round((occupiedUnits / units.length) * 100) : 0,
      occupancyChange: 0,
      vacantUnits,
      totalTenants: new Set(leases.filter((lease) => lease.status === 'ACTIVE').map((lease) => lease.customerId)).size,
    },
    arrears: [
      { bucket: 'Current', amount: arrearsBuckets.current },
      { bucket: '1-30 Days', amount: arrearsBuckets.overdue_30 },
      { bucket: '31-60 Days', amount: arrearsBuckets.overdue_60 },
      { bucket: '90+ Days', amount: arrearsBuckets.overdue_90_plus },
    ],
    recentActivity,
    alerts,
  };
}

async function getAdminDashboardData(auth, repos) {
  // nosemgrep: missing-tenant-id-arg reason: platform-admin branch only — cross-tenant listing is the intent. Non-admin branch falls back to the caller's own tenant via auth.tenantId, which IS the tenant key.
  const tenantRows =
    auth.role === UserRole.SUPER_ADMIN || auth.role === UserRole.ADMIN || auth.role === UserRole.SUPPORT
      ? (await repos.tenants.findMany({ limit: 500, offset: 0 })).items
      : [await repos.tenants.findById(auth.tenantId)].filter(Boolean);

  const tenantMetrics = [];

  for (const tenant of tenantRows) {
    const [usersResult, propertiesResult, unitsResult, paymentsResult, invoicesResult] =
      await Promise.all([
        repos.users.findMany(tenant.id, 5000, 0),
        repos.properties.findMany(tenant.id, { limit: 1000, offset: 0 }),
        repos.units.findMany(tenant.id, { limit: 1000, offset: 0 }),
        repos.payments.findMany(tenant.id, 5000, 0),
        repos.invoices.findMany(tenant.id, 5000, 0),
      ]);

    tenantMetrics.push({
      tenant,
      users: usersResult.items,
      properties: propertiesResult.items,
      units: unitsResult.items,
      payments: paymentsResult.items,
      invoices: invoicesResult.items,
    });
  }

  const allPayments = tenantMetrics.flatMap((metric) =>
    metric.payments.map((payment) => ({ ...mapPaymentRow(payment), tenantName: metric.tenant.name }))
  );
  const allInvoices = tenantMetrics.flatMap((metric) =>
    metric.invoices.map((invoice) => ({ ...mapInvoiceRow(invoice), tenantName: metric.tenant.name }))
  );

  const currentMonthStart = startOfMonth();
  const currentMonthEnd = endOfMonth();
  const previousMonthStart = startOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  const previousMonthEnd = endOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));

  const currentRevenue = allPayments
    .filter((payment) => isWithinRange(payment.completedAt || payment.createdAt, currentMonthStart, currentMonthEnd))
    .reduce((sum, payment) => sum + payment.amount, 0);
  const previousRevenue = allPayments
    .filter((payment) => isWithinRange(payment.completedAt || payment.createdAt, previousMonthStart, previousMonthEnd))
    .reduce((sum, payment) => sum + payment.amount, 0);

  const growthRate =
    previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;

  const revenueTrend = buildMonthSeries(
    allPayments,
    (payment) => payment.completedAt || payment.createdAt,
    (payment) => payment.amount
  ).map((bucket) => ({ month: bucket.month, value: bucket.value }));

  const tenantGrowthBuckets = buildMonthSeries(
    tenantRows,
    (tenant) => tenant.createdAt,
    () => 1
  );
  let runningTenants = 0;
  const tenantGrowth = tenantGrowthBuckets.map((bucket) => {
    runningTenants += bucket.value;
    return { month: bucket.month, tenants: runningTenants };
  });

  const statusCounts = tenantRows.reduce((acc, tenant) => {
    const status = String(tenant.status || 'pending');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  const statusPalette = {
    active: '#22c55e',
    trial: '#3b82f6',
    suspended: '#f59e0b',
    cancelled: '#ef4444',
    pending: '#6b7280',
  };

  const statusDistribution = Object.entries(statusCounts).map(([name, value]) => ({
    name: name[0].toUpperCase() + name.slice(1),
    value,
    color: statusPalette[name] || '#6b7280',
  }));

  const overdueInvoices = allInvoices.filter(
    (invoice) => invoice.status === 'OVERDUE' || (invoice.amountDue > 0 && new Date(invoice.dueDate) < new Date())
  );

  const alerts = [
    ...tenantRows
      .filter((tenant) => tenant.status === 'suspended')
      .map((tenant) => ({
        id: `tenant-${tenant.id}`,
        severity: 'warning',
        message: `${tenant.name} is suspended`,
        timestamp: tenant.updatedAt || tenant.createdAt,
      })),
    ...overdueInvoices.slice(0, 5).map((invoice) => ({
      id: `invoice-${invoice.id}`,
      severity: 'critical',
      message: `${invoice.tenantName}: overdue invoice ${invoice.number}`,
      timestamp: invoice.dueDate,
    })),
  ].slice(0, 6);

  const recentActivity = [
    ...tenantRows.slice(0, 5).map((tenant) => ({
      id: `tenant-${tenant.id}`,
      type: 'tenant_updated',
      description: `Tenant ${tenant.name} is ${tenant.status}`,
      timestamp: tenant.updatedAt || tenant.createdAt,
      user: tenant.primaryEmail,
    })),
    ...allPayments.slice(0, 5).map((payment) => ({
      id: `payment-${payment.id}`,
      type: 'payment_received',
      description: `${payment.tenantName} collected KES ${payment.amount.toLocaleString()}`,
      timestamp: payment.completedAt || payment.createdAt,
      user: payment.tenantName,
    })),
  ]
    .sort((left, right) => new Date(right.timestamp) - new Date(left.timestamp))
    .slice(0, 8);

  return {
    kpis: {
      totalTenants: tenantRows.length,
      activeTenants: tenantRows.filter((tenant) => tenant.status === 'active').length,
      totalUsers: tenantMetrics.reduce((sum, metric) => sum + metric.users.length, 0),
      totalProperties: tenantMetrics.reduce((sum, metric) => sum + metric.properties.length, 0),
      totalUnits: tenantMetrics.reduce((sum, metric) => sum + metric.units.length, 0),
      monthlyRevenue: currentRevenue,
      growthRate,
    },
    revenueTrend,
    tenantGrowth,
    statusDistribution,
    recentActivity,
    alerts,
  };
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

app.get('/owner', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getScopedOwnerData(auth, repos);
  return c.json({ success: true, data: buildOwnerDashboardPayload(scope) });
});

app.get('/admin', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');

  if (![UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT, UserRole.TENANT_ADMIN].includes(auth.role)) {
    return c.json(
      {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Dashboard access is not allowed for this role.',
        },
      },
      403
    );
  }

  const data = await getAdminDashboardData(auth, repos);
  return c.json({ success: true, data });
});

export const dashboardRouter = app;
