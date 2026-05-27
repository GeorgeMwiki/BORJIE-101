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

function isWithinRange(dateValue: any, start: Date, end: Date) {
  if (!dateValue) return false;
  const value = new Date(dateValue);
  return value >= start && value <= end;
}

function formatMonth(dateValue: any) {
  return new Date(dateValue).toLocaleDateString('en', {
    month: 'short',
    year: 'numeric',
  });
}

function buildMonthSeries(items: any[], getDate: (item: any) => any, getValue: (item: any) => any, months = 7) {
  const now = new Date();
  const buckets: Array<{ key: string; label: string; fullLabel: string; value: number }> = [];

  for (let index = months - 1; index >= 0; index -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - index, 1);
    buckets.push({
      key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`,
      label: date.toLocaleDateString('en', { month: 'short' }),
      fullLabel: date.toLocaleDateString('en', { month: 'short', year: 'numeric' }),
      value: 0,
    });
  }

  const bucketMap = new Map<string, { key: string; label: string; fullLabel: string; value: number }>(
    buckets.map((bucket) => [bucket.key, bucket])
  );

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

async function getScopedOwnerData(auth: any, repos: any) {
  const propertyResult = await repos.properties.findMany(auth.tenantId, {
    limit: 1000,
    offset: 0,
  });
  const allProperties = propertyResult.items;
  const properties = auth.propertyAccess?.includes('*')
    ? allProperties
    : allProperties.filter((property: any) => auth.propertyAccess?.includes(property.id));

  const propertyIds = new Set(properties.map((property: any) => property.id));

  const [unitsResult, leasesResult, invoicesResult, paymentsResult, workOrdersResult] =
    await Promise.all([
      repos.units.findMany(auth.tenantId, { limit: 1000, offset: 0 }),
      repos.leases.findMany(auth.tenantId, { limit: 1000, offset: 0 }),
      repos.invoices.findMany(auth.tenantId, 5000, 0),
      repos.payments.findMany(auth.tenantId, 5000, 0),
      repos.workOrders.findMany(auth.tenantId, 5000, 0),
    ]);

  const scopedUnits = unitsResult.items.filter((unit: any) => propertyIds.has(unit.propertyId));
  const scopedUnitIds = new Set(scopedUnits.map((unit: any) => unit.id));

  const scopedLeases = leasesResult.items.filter(
    (lease: any) => propertyIds.has(lease.propertyId) || scopedUnitIds.has(lease.unitId)
  );
  const scopedLeaseIds = new Set(scopedLeases.map((lease: any) => lease.id));
  const scopedCustomerIds = new Set(scopedLeases.map((lease: any) => lease.customerId));

  const scopedInvoices = invoicesResult.items.filter(
    (invoice: any) =>
      (invoice.leaseId && scopedLeaseIds.has(invoice.leaseId)) ||
      (invoice.customerId && scopedCustomerIds.has(invoice.customerId))
  );

  const scopedPayments = paymentsResult.items.filter(
    (payment: any) =>
      (payment.leaseId && scopedLeaseIds.has(payment.leaseId)) ||
      (payment.customerId && scopedCustomerIds.has(payment.customerId)) ||
      (payment.invoiceId && scopedInvoices.some((invoice: any) => invoice.id === payment.invoiceId))
  );

  const scopedWorkOrders = workOrdersResult.items.filter((workOrder: any) =>
    propertyIds.has(workOrder.propertyId)
  );

  // Wave 25 Agent V: replaced per-id `findById` fan-out with batched
  // `findByIds` (single IN-query each). Previously fetched N customers
  // and V vendors as 1+N+V round-trips; now 1+2.
  const customerIdList = Array.from(scopedCustomerIds);
  const vendorIdList = Array.from(
    new Set(scopedWorkOrders.map((workOrder: any) => workOrder.vendorId).filter(Boolean))
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
    customers: (customers as any[]).filter(Boolean),
    vendors: (vendors as any[]).filter(Boolean),
  };
}

function enrichInvoices(invoices: any[], leases: any[], customers: any[], units: any[], properties: any[]) {
  const leaseMap = new Map<string, any>(leases.map((lease: any) => [lease.id, lease]));
  const customerMap = new Map<string, any>(customers.map((customer: any) => [customer.id, customer]));
  const unitMap = new Map<string, any>(units.map((unit: any) => [unit.id, unit]));
  const propertyMap = new Map<string, any>(properties.map((property: any) => [property.id, property]));

  return invoices.map((row: any) => {
    const invoice = mapInvoiceRow(row);
    const lease: any = row.leaseId ? leaseMap.get(row.leaseId) : undefined;
    const unit: any = lease?.unitId ? unitMap.get(lease.unitId) : undefined;
    const property: any = lease?.propertyId ? propertyMap.get(lease.propertyId) : undefined;
    const customer: any = row.customerId ? customerMap.get(row.customerId) : undefined;

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

function enrichPayments(payments: any[], invoices: any[], leases: any[], customers: any[]) {
  const invoiceMap = new Map<string, any>(invoices.map((invoice: any) => [invoice.id, invoice]));
  const leaseMap = new Map<string, any>(leases.map((lease: any) => [lease.id, lease]));
  const customerMap = new Map<string, any>(customers.map((customer: any) => [customer.id, customer]));

  return payments.map((row: any) => {
    const payment = mapPaymentRow(row);
    const invoice: any = row.invoiceId ? invoiceMap.get(row.invoiceId) : undefined;
    const lease: any = row.leaseId
      ? leaseMap.get(row.leaseId)
      : invoice?.leaseId
      ? leaseMap.get(invoice.leaseId)
      : undefined;
    const customer: any = row.customerId
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

function buildOwnerDashboardPayload(scope: any) {
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

  const currentMonthPayments = payments.filter((payment: any) =>
    isWithinRange(payment.completedAt || payment.createdAt, currentMonthStart, currentMonthEnd)
  );
  const previousMonthPayments = payments.filter((payment: any) =>
    isWithinRange(payment.completedAt || payment.createdAt, previousMonthStart, previousMonthEnd)
  );
  const currentMonthInvoices = invoices.filter((invoice: any) =>
    isWithinRange(invoice.createdAt, currentMonthStart, currentMonthEnd)
  );
  const overdueInvoices = invoices.filter(
    (invoice: any) => invoice.status === 'OVERDUE' || (invoice.amountDue > 0 && new Date(invoice.dueDate) < now)
  );
  const currentMonthWorkOrders = workOrders.filter((workOrder: any) =>
    isWithinRange(workOrder.createdAt, currentMonthStart, currentMonthEnd)
  );

  const currentMonthRevenue = currentMonthPayments.reduce((sum: number, payment: any) => sum + payment.amount, 0);
  const previousMonthRevenue = previousMonthPayments.reduce((sum: number, payment: any) => sum + payment.amount, 0);
  const outstandingBalance = overdueInvoices.reduce((sum: number, invoice: any) => sum + invoice.amountDue, 0);
  const currentMonthInvoiced = currentMonthInvoices.reduce((sum: number, invoice: any) => sum + invoice.total, 0);
  const collectionRate =
    currentMonthInvoiced > 0 ? (currentMonthRevenue / currentMonthInvoiced) * 100 : 0;
  const totalMaintenanceCost = currentMonthWorkOrders.reduce(
    (sum: number, workOrder: any) => sum + (workOrder.actualCost || workOrder.estimatedCost || 0),
    0
  );

  const revenueChange =
    previousMonthRevenue > 0
      ? ((currentMonthRevenue - previousMonthRevenue) / previousMonthRevenue) * 100
      : currentMonthRevenue > 0
      ? 100
      : 0;

  const occupiedUnits = units.filter((unit: any) => unit.status === 'OCCUPIED').length;
  const vacantUnits = units.filter((unit: any) => unit.status !== 'OCCUPIED').length;

  const recentActivity = [
    ...payments.slice(0, 5).map((payment: any) => ({
      id: `payment-${payment.id}`,
      type: 'payment',
      title: `Payment ${payment.paymentNumber}`,
      description: `Received KES ${payment.amount.toLocaleString()}`,
      timestamp: payment.completedAt || payment.createdAt,
    })),
    ...workOrders.slice(0, 5).map((workOrder: any) => ({
      id: `work-order-${workOrder.id}`,
      type: 'maintenance',
      title: workOrder.title,
      description: `${workOrder.category} request is ${workOrder.status.toLowerCase()}`,
      timestamp: workOrder.updatedAt || workOrder.createdAt,
    })),
  ]
    .sort((left: any, right: any) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 8);

  const alerts = [
    ...overdueInvoices.slice(0, 5).map((invoice: any) => ({
      id: `invoice-${invoice.id}`,
      type: 'arrears',
      title: `Invoice ${invoice.number} overdue`,
      message: `Outstanding balance is KES ${invoice.amountDue.toLocaleString()}`,
      actionUrl: '/financial?tab=invoices&filter=overdue',
    })),
    ...workOrders
      .filter((workOrder: any) => workOrder.status === 'PENDING_APPROVAL')
      .slice(0, 5)
      .map((workOrder: any) => ({
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

  for (const invoice of overdueInvoices as any[]) {
    const ageDays = Math.floor((now.getTime() - new Date(invoice.dueDate).getTime()) / 86400000);
    if (ageDays <= 30) arrearsBuckets.overdue_30 += invoice.amountDue;
    else if (ageDays <= 60) arrearsBuckets.overdue_60 += invoice.amountDue;
    else arrearsBuckets.overdue_90_plus += invoice.amountDue;
  }

  return {
    portfolio: {
      totalProperties: properties.length,
      totalUnits: units.length,
      portfolioValue: leases.reduce((sum: number, lease: any) => sum + lease.rentAmount * 12, 0),
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
      openRequests: workOrders.filter((workOrder: any) => !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(workOrder.status)).length,
      inProgress: workOrders.filter((workOrder: any) => workOrder.status === 'IN_PROGRESS').length,
      completedThisMonth: workOrders.filter(
        (workOrder: any) =>
          workOrder.status === 'COMPLETED' &&
          isWithinRange(workOrder.completedAt || workOrder.updatedAt, currentMonthStart, currentMonthEnd)
      ).length,
      totalCostThisMonth: totalMaintenanceCost,
      pendingApprovals: workOrders.filter((workOrder: any) => workOrder.status === 'PENDING_APPROVAL').length,
    },
    occupancy: {
      occupancyRate: units.length > 0 ? Math.round((occupiedUnits / units.length) * 100) : 0,
      occupancyChange: 0,
      vacantUnits,
      totalTenants: new Set(leases.filter((lease: any) => lease.status === 'ACTIVE').map((lease: any) => lease.customerId)).size,
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

async function getAdminDashboardData(auth: any, repos: any) {
  // nosemgrep: missing-tenant-id-arg reason: platform-admin branch only — cross-tenant listing is the intent. Non-admin branch falls back to the caller's own tenant via auth.tenantId, which IS the tenant key.
  const tenantRows =
    auth.role === UserRole.SUPER_ADMIN || auth.role === UserRole.ADMIN || auth.role === UserRole.SUPPORT
      ? (await repos.tenants.findMany({ limit: 500, offset: 0 })).items
      : [await repos.tenants.findById(auth.tenantId)].filter(Boolean);

  const tenantMetrics: Array<{ tenant: any; users: any[]; properties: any[]; units: any[]; payments: any[]; invoices: any[] }> = [];

  for (const tenant of tenantRows as any[]) {
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
    metric.payments.map((payment: any) => ({ ...mapPaymentRow(payment), tenantName: metric.tenant.name }))
  );
  const allInvoices = tenantMetrics.flatMap((metric) =>
    metric.invoices.map((invoice: any) => ({ ...mapInvoiceRow(invoice), tenantName: metric.tenant.name }))
  );

  const currentMonthStart = startOfMonth();
  const currentMonthEnd = endOfMonth();
  const previousMonthStart = startOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));
  const previousMonthEnd = endOfMonth(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1));

  const currentRevenue = allPayments
    .filter((payment) => isWithinRange(payment.completedAt || payment.createdAt, currentMonthStart, currentMonthEnd))
    .reduce((sum: number, payment) => sum + payment.amount, 0);
  const previousRevenue = allPayments
    .filter((payment) => isWithinRange(payment.completedAt || payment.createdAt, previousMonthStart, previousMonthEnd))
    .reduce((sum: number, payment) => sum + payment.amount, 0);

  const growthRate =
    previousRevenue > 0 ? ((currentRevenue - previousRevenue) / previousRevenue) * 100 : 0;

  const revenueTrend = buildMonthSeries(
    allPayments,
    (payment: any) => payment.completedAt || payment.createdAt,
    (payment: any) => payment.amount
  ).map((bucket) => ({ month: bucket.month, value: bucket.value }));

  const tenantGrowthBuckets = buildMonthSeries(
    tenantRows as any[],
    (tenant: any) => tenant.createdAt,
    () => 1
  );
  let runningTenants = 0;
  const tenantGrowth = tenantGrowthBuckets.map((bucket) => {
    runningTenants += bucket.value;
    return { month: bucket.month, tenants: runningTenants };
  });

  const statusCounts = (tenantRows as any[]).reduce((acc: Record<string, number>, tenant: any) => {
    const status = String(tenant.status || 'pending');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statusPalette: Record<string, string> = {
    active: '#22c55e',
    trial: '#3b82f6',
    suspended: '#f59e0b',
    cancelled: '#ef4444',
    pending: '#6b7280',
  };

  const statusDistribution = Object.entries(statusCounts).map(([name, value]) => ({
    name: (name[0] ?? '').toUpperCase() + name.slice(1),
    value,
    color: statusPalette[name] || '#6b7280',
  }));

  const overdueInvoices = allInvoices.filter(
    (invoice) => invoice.status === 'OVERDUE' || (invoice.amountDue > 0 && new Date(invoice.dueDate) < new Date())
  );

  const alerts = [
    ...(tenantRows as any[])
      .filter((tenant: any) => tenant.status === 'suspended')
      .map((tenant: any) => ({
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
    ...(tenantRows as any[]).slice(0, 5).map((tenant: any) => ({
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
    .sort((left: any, right: any) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 8);

  return {
    kpis: {
      totalTenants: tenantRows.length,
      activeTenants: (tenantRows as any[]).filter((tenant: any) => tenant.status === 'active').length,
      totalUsers: tenantMetrics.reduce((sum: number, metric) => sum + metric.users.length, 0),
      totalProperties: tenantMetrics.reduce((sum: number, metric) => sum + metric.properties.length, 0),
      totalUnits: tenantMetrics.reduce((sum: number, metric) => sum + metric.units.length, 0),
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

  if (!([UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.SUPPORT, UserRole.TENANT_ADMIN] as UserRole[]).includes(auth.role)) {
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
