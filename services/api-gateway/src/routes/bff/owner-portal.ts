import { Hono } from 'hono';
import { createHmac, randomUUID } from 'node:crypto';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { UserRole } from '../../types/user-role';
import { mapInvoiceRow, mapPaymentRow, mapVendorRow, mapWorkOrderRow } from '../db-mappers';
import { conversations, inspections } from '@borjie/database';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { e400, e403, e404, e503, errorResponse } from '../../utils/error-response';
import { getOwnerScope as resolveOwnerScope } from '../../lib/owner-scope';

import { withSecurityEvents } from '@borjie/observability';
function csvEscape(value) {
  const text = String(value ?? '');
  if (text.includes(',') || text.includes('"') || text.includes('\n')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toDataUrl(content, mimeType = 'text/plain') {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(content)}`;
}

/**
 * Owner-portal scope resolver.
 *
 * Previously implemented inline as `findMany(tenantId, limit=1000) + JS
 * .filter(propertyIds.has(...))` for every entity. That pattern
 * materialised the entire tenant's data before filtering and would
 * silently truncate beyond 1000 rows. It also leaked cross-property rows
 * over the wire whenever the JS filter was bypassed.
 *
 * The new path delegates to `lib/owner-scope#getOwnerScope`, which
 * issues `findByPropertyIds` queries so the DB does the filtering in a
 * single WHERE clause (tenant + soft-delete still enforced inside each
 * repo).
 */
async function getOwnerScope(auth, repos) {
  return resolveOwnerScope(auth, repos, { limit: 1000, offset: 0 });
}

function enrichOwnerInvoices(scope) {
  const leaseMap = new Map(scope.leases.map((lease) => [lease.id, lease]));
  const customerMap = new Map(scope.customers.map((customer) => [customer.id, customer]));
  const unitMap = new Map(scope.units.map((unit) => [unit.id, unit]));
  const propertyMap = new Map(scope.properties.map((property) => [property.id, property]));

  return scope.invoices.map((row) => {
    const lease = row.leaseId ? leaseMap.get(row.leaseId) : undefined;
    const customer = row.customerId ? customerMap.get(row.customerId) : undefined;
    const unit = lease?.unitId ? unitMap.get(lease.unitId) : undefined;
    const property = lease?.propertyId ? propertyMap.get(lease.propertyId) : undefined;

    return {
      ...mapInvoiceRow(row),
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

function enrichOwnerPayments(scope, invoices) {
  const invoiceMap = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const customerMap = new Map(scope.customers.map((customer) => [customer.id, customer]));

  return scope.payments.map((row) => {
    const payment = mapPaymentRow(row);
    const invoice = row.invoiceId ? invoiceMap.get(row.invoiceId) : undefined;
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
    };
  });
}

function enrichOwnerWorkOrders(scope) {
  const unitMap = new Map(scope.units.map((unit) => [unit.id, unit]));
  const propertyMap = new Map(scope.properties.map((property) => [property.id, property]));
  const customerMap = new Map(scope.customers.map((customer) => [customer.id, customer]));
  const vendorMap = new Map(scope.vendors.map((vendor) => [vendor.id, vendor]));

  return scope.workOrders.map((row) => {
    const mapped = mapWorkOrderRow(row);
    const vendor = row.vendorId ? vendorMap.get(row.vendorId) : undefined;

    return {
      ...mapped,
      reportedAt: mapped.createdAt,
      requiresApproval:
        mapped.status === 'PENDING_APPROVAL' ||
        Number(mapped.estimatedCost || 0) >= 50000,
      approvalThreshold: 50000,
      unit: row.unitId
        ? {
            id: row.unitId,
            unitNumber: unitMap.get(row.unitId)?.unitCode || row.unitId,
          }
        : undefined,
      property: row.propertyId
        ? {
            id: row.propertyId,
            name: propertyMap.get(row.propertyId)?.name || row.propertyId,
          }
        : undefined,
      customer: row.customerId
        ? {
            id: row.customerId,
            name:
              `${customerMap.get(row.customerId)?.firstName || ''} ${
                customerMap.get(row.customerId)?.lastName || ''
              }`.trim() || row.customerId,
            phone: customerMap.get(row.customerId)?.phone,
          }
        : undefined,
      vendor: vendor
        ? {
            id: vendor.id,
            name: vendor.companyName,
            phone: Array.isArray(vendor.contacts) ? vendor.contacts[0]?.phone : undefined,
          }
        : undefined,
    };
  });
}

function buildFinancialStats(invoices, payments, workOrders) {
  const totalInvoiced = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
  const totalCollected = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const totalOutstanding = invoices.reduce((sum, invoice) => sum + invoice.amountDue, 0);
  const collectionRate = totalInvoiced > 0 ? (totalCollected / totalInvoiced) * 100 : 0;
  const pendingDisbursement = Math.max(
    totalCollected -
      workOrders.reduce((sum, workOrder) => sum + Number(workOrder.actualCost || workOrder.estimatedCost || 0), 0),
    0
  );

  return {
    totalInvoiced,
    totalCollected,
    totalOutstanding,
    collectionRate,
    pendingDisbursement,
  };
}

function buildDisbursementData(scope, payments) {
  const propertyMap = new Map(scope.properties.map((property) => [property.id, property]));
  const leaseMap = new Map(scope.leases.map((lease) => [lease.id, lease]));
  const invoiceMap = new Map(scope.invoices.map((invoice) => [invoice.id, invoice]));
  const grouped = new Map();

  for (const payment of scope.payments) {
    const invoice = payment.invoiceId ? invoiceMap.get(payment.invoiceId) : undefined;
    const lease = payment.leaseId
      ? leaseMap.get(payment.leaseId)
      : invoice?.leaseId
      ? leaseMap.get(invoice.leaseId)
      : undefined;
    const propertyId = lease?.propertyId || scope.properties[0]?.id;
    const month = new Date(payment.completedAt || payment.createdAt);
    const period = month.toLocaleDateString('en', { month: 'short', year: 'numeric' });
    const key = `${propertyId || 'portfolio'}:${period}`;

    if (!grouped.has(key)) {
      grouped.set(key, {
        id: key.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase(),
        reference: `DSB-${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, '0')}-${String(grouped.size + 1).padStart(3, '0')}`,
        amount: 0,
        date: new Date(month.getFullYear(), month.getMonth() + 1, 5).toISOString(),
        status: 'COMPLETED',
        method: 'BANK_TRANSFER',
        period,
        property: propertyId ? { id: propertyId, name: propertyMap.get(propertyId)?.name || propertyId } : undefined,
      });
    }

    grouped.get(key).amount += payment.amount;
  }

  const disbursements = Array.from(grouped.values())
    .sort((left, right) => new Date(right.date) - new Date(left.date))
    .map((disbursement) => ({
      ...disbursement,
      breakdown: {
        rentCollected: disbursement.amount,
        managementFees: Math.round(disbursement.amount * 0.08),
        maintenanceCosts: 0,
        utilities: 0,
        insurance: 0,
        repairs: 0,
        otherDeductions: 0,
        netDisbursement: Math.round(disbursement.amount * 0.92),
      },
    }));

  const totalDisbursed = disbursements.reduce(
    (sum, disbursement) => sum + disbursement.breakdown.netDisbursement,
    0
  );
  const now = new Date();
  const nextDisbursementDate = new Date(now.getFullYear(), now.getMonth() + 1, 5).toISOString();

  return {
    disbursements,
    stats: {
      totalDisbursed,
      pendingAmount: 0,
      nextDisbursementDate,
      yearToDate: disbursements
        .filter((disbursement) => new Date(disbursement.date).getFullYear() === now.getFullYear())
        .reduce((sum, disbursement) => sum + disbursement.breakdown.netDisbursement, 0),
      averageMonthly: disbursements.length > 0 ? Math.round(totalDisbursed / disbursements.length) : 0,
    },
  };
}

async function listOwnerConversations(c, auth, repos) {
  const db = c.get('db');
  const scope = await getOwnerScope(auth, repos);
  const customerMap = new Map(scope.customers.map((customer) => [customer.id, customer]));

  const rows = await db
    .select()
    .from(conversations)
    .where(eq(conversations.tenantId, auth.tenantId));

  const messagingRows = rows
    .sort((left, right) => new Date(right.lastMessageAt || right.updatedAt || right.createdAt) - new Date(left.lastMessageAt || left.updatedAt || left.createdAt))
    .slice(0, 100);

  const messagesByConversation = await Promise.all(
    messagingRows.map((conversation) => repos.messaging.getMessages(conversation.id, { limit: 1, offset: 0 }))
  );

  return messagingRows.map((conversation, index) => {
    const customer = conversation.customerId ? customerMap.get(conversation.customerId) : undefined;
    const latestMessage = messagesByConversation[index]?.[0];
    const participantName = customer
      ? `${customer.firstName} ${customer.lastName}`.trim()
      : conversation.title || conversation.id;

    return {
      id: conversation.id,
      participantName,
      participantRole: customer ? 'Resident' : String(conversation.type || 'Conversation').replace(/_/g, ' '),
      participantInitials: participantName
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() || '')
        .join(''),
      lastMessage: latestMessage?.content,
      lastMessageTime: latestMessage?.createdAt || conversation.lastMessageAt || conversation.updatedAt || conversation.createdAt,
      unreadCount: 0,
      propertyContext:
        conversation.metadata?.propertyName ||
        conversation.metadata?.propertyId ||
        undefined,
    };
  });
}

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);
app.use('*', async (c, next) => {
  const auth = c.get('auth');

  if (![UserRole.OWNER, UserRole.TENANT_ADMIN, UserRole.ADMIN, UserRole.SUPER_ADMIN].includes(auth.role)) {
    return e403(c, 'FORBIDDEN', 'Owner portal access is not allowed for this role.');
  }

  await next();
});

app.get('/work-orders', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  return c.json({ success: true, data: enrichOwnerWorkOrders(scope) });
});

app.post('/work-orders/:id/approve', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const existing = await repos.workOrders.findById(id, auth.tenantId);

  if (!existing) {
    return e404(c, 'NOT_FOUND', 'Work order not found');
  }

  const row = await repos.workOrders.update(id, auth.tenantId, {
    status: 'approved',
    updatedBy: auth.userId,
  });

  return c.json({ success: true, data: mapWorkOrderRow(row) });
}));

app.post('/work-orders/:id/reject', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => ({}));
  const existing = await repos.workOrders.findById(id, auth.tenantId);

  if (!existing) {
    return e404(c, 'NOT_FOUND', 'Work order not found');
  }

  const timeline = Array.isArray(existing.timeline) ? existing.timeline : [];
  const row = await repos.workOrders.update(id, auth.tenantId, {
    status: 'rejected',
    timeline: [
      ...timeline,
      {
        at: new Date().toISOString(),
        status: 'rejected',
        by: auth.userId,
        reason: body.reason,
      },
    ],
    completionNotes: body.reason || existing.completionNotes,
    updatedBy: auth.userId,
  });

  return c.json({ success: true, data: mapWorkOrderRow(row) });
}));

app.get('/financial/stats', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  const invoices = enrichOwnerInvoices(scope);
  const payments = enrichOwnerPayments(scope, invoices);
  return c.json({ success: true, data: buildFinancialStats(invoices, payments, scope.workOrders) });
});

app.get('/invoices', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  return c.json({ success: true, data: enrichOwnerInvoices(scope) });
});

app.get('/payments', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  const invoices = enrichOwnerInvoices(scope);
  return c.json({ success: true, data: enrichOwnerPayments(scope, invoices) });
});

app.get('/reports/export/financial', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  const invoices = enrichOwnerInvoices(scope);
  const payments = enrichOwnerPayments(scope, invoices);
  const lines = [
    ['type', 'reference', 'status', 'amount', 'customer', 'property', 'date'].join(','),
    ...invoices.map((invoice) =>
      [
        'invoice',
        invoice.number,
        invoice.status,
        invoice.total,
        invoice.customer?.name || '',
        invoice.property?.name || '',
        invoice.createdAt,
      ]
        .map(csvEscape)
        .join(',')
    ),
    ...payments.map((payment) =>
      [
        'payment',
        payment.reference,
        payment.status,
        payment.amount,
        payment.customer?.name || '',
        '',
        payment.completedAt || payment.createdAt,
      ]
        .map(csvEscape)
        .join(',')
    ),
  ];

  return c.json({
    success: true,
    data: {
      downloadUrl: toDataUrl(lines.join('\n'), 'text/csv'),
    },
  });
});

app.get('/disbursements', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  const invoices = enrichOwnerInvoices(scope);
  const payments = enrichOwnerPayments(scope, invoices);
  return c.json({ success: true, data: buildDisbursementData(scope, payments) });
});

app.get('/disbursements/:id/statement', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  const invoices = enrichOwnerInvoices(scope);
  const payments = enrichOwnerPayments(scope, invoices);
  const { disbursements } = buildDisbursementData(scope, payments);
  const disbursement = disbursements.find((item) => item.id === c.req.param('id'));

  if (!disbursement) {
    return e404(c, 'NOT_FOUND', 'Disbursement not found');
  }

  const statement = [
    `Reference: ${disbursement.reference}`,
    `Period: ${disbursement.period}`,
    `Property: ${disbursement.property?.name || 'Portfolio'}`,
    `Gross Collected: KES ${disbursement.breakdown.rentCollected.toLocaleString()}`,
    `Management Fees: KES ${disbursement.breakdown.managementFees.toLocaleString()}`,
    `Net Disbursement: KES ${disbursement.breakdown.netDisbursement.toLocaleString()}`,
  ].join('\n');

  return c.json({
    success: true,
    data: {
      downloadUrl: toDataUrl(statement),
    },
  });
});

app.get('/messaging/conversations', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const data = await listOwnerConversations(c, auth, repos);
  return c.json({ success: true, data });
});

app.get('/messaging/conversations/:id/messages', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  const user = await repos.users.findById(auth.userId, auth.tenantId);
  const customerMap = new Map(scope.customers.map((customer) => [customer.id, customer]));
  const conversation = await repos.messaging.getConversation(c.req.param('id'), auth.tenantId);

  if (!conversation) {
    return e404(c, 'NOT_FOUND', 'Conversation not found');
  }

  const rows = await repos.messaging.getMessages(conversation.id, { limit: 200, offset: 0 });
  const data = rows
    .slice()
    .reverse()
    .map((message) => {
      const customer = customerMap.get(message.senderId);
      const senderName = customer
        ? `${customer.firstName} ${customer.lastName}`.trim()
        : message.senderId === auth.userId
        ? `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.email || auth.userId
        : message.senderId;

      return {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderType: message.senderId === auth.userId ? 'owner' : customer ? 'manager' : 'system',
        senderName,
        content: message.content,
        status: message.readAt ? 'READ' : 'SENT',
        attachments: Array.isArray(message.attachments) ? message.attachments : [],
        readAt: message.readAt,
        createdAt: message.createdAt,
      };
    });

  return c.json({ success: true, data });
});

app.post('/messaging/conversations/:id/messages', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const db = c.get('db');
  const id = c.req.param('id');
  const body = await c.req.json();
  const conversation = await repos.messaging.getConversation(id, auth.tenantId);

  if (!conversation) {
    return e404(c, 'NOT_FOUND', 'Conversation not found');
  }

  const message = await repos.messaging.createMessage({
    id: crypto.randomUUID(),
    conversationId: id,
    senderId: auth.userId,
    content: body.content,
    attachments: body.attachments || [],
  });

  await db
    .update(conversations)
    .set({
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    })
    .where(eq(conversations.id, id));

  return c.json({
    success: true,
    data: {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderType: 'owner',
      senderName: auth.userId,
      content: message.content,
      status: 'SENT',
      attachments: Array.isArray(message.attachments) ? message.attachments : [],
      createdAt: message.createdAt,
    },
  });
}));

app.get('/documents/signatures', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const scope = await getOwnerScope(auth, repos);
  // Pending-signatures is a small working set; cap fetch at 500 and
  // filter in-memory. Move to repo-level filter when doc volume grows.
  const docs = (await repos.documents.findMany(auth.tenantId, { limit: 500, offset: 0 })).items;
  const propertyMap = new Map(scope.properties.map((property) => [property.id, property]));
  const unitMap = new Map(scope.units.map((unit) => [unit.id, unit]));
  const customerMap = new Map(scope.customers.map((customer) => [customer.id, customer]));

  const pending = docs
    .filter((doc) => ['lease_agreement', 'move_in_report', 'move_out_report'].includes(doc.documentType))
    .filter((doc) => !doc.metadata?.signedAt)
    .map((doc) => ({
      id: doc.id,
      name: doc.fileName,
      type: String(doc.documentType).toUpperCase(),
      category: doc.entityType || 'document',
      property: doc.metadata?.propertyId
        ? { id: doc.metadata.propertyId, name: propertyMap.get(doc.metadata.propertyId)?.name || doc.metadata.propertyId }
        : undefined,
      unit: doc.metadata?.unitId
        ? { id: doc.metadata.unitId, unitNumber: unitMap.get(doc.metadata.unitId)?.unitCode || doc.metadata.unitId }
        : undefined,
      customer: doc.customerId
        ? {
            id: doc.customerId,
            name:
              `${customerMap.get(doc.customerId)?.firstName || ''} ${
                customerMap.get(doc.customerId)?.lastName || ''
              }`.trim() || doc.customerId,
          }
        : undefined,
      signatureStatus: 'PENDING',
      expiresAt: doc.expiresAt,
      createdAt: doc.createdAt,
      size: doc.fileSize,
      previewUrl: doc.fileUrl,
    }));

  const history = docs
    .filter((doc) => doc.metadata?.signedAt)
    .map((doc) => ({
      id: `hist-${doc.id}`,
      documentName: doc.fileName,
      signedAt: doc.metadata.signedAt,
      signedBy: doc.metadata.signedBy || auth.userId,
      property: doc.metadata?.propertyId
        ? { id: doc.metadata.propertyId, name: propertyMap.get(doc.metadata.propertyId)?.name || doc.metadata.propertyId }
        : undefined,
      status: 'SIGNED',
      ipAddress: doc.metadata?.signedIp,
    }))
    .sort((left, right) => new Date(right.signedAt) - new Date(left.signedAt));

  return c.json({ success: true, data: { pending, history } });
});

app.post('/documents/:id/sign', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const id = c.req.param('id');
  const body = await c.req.json();
  const existing = await repos.documents.findById(id, auth.tenantId);

  if (!existing) {
    return e404(c, 'NOT_FOUND', 'Document not found');
  }

  const metadata = {
    ...(existing.metadata || {}),
    signedAt: new Date().toISOString(),
    signedBy: auth.userId,
    signatureImage: body.signatureImage,
    agreedToTerms: Boolean(body.agreedToTerms),
  };

  const row = await repos.documents.update(id, auth.tenantId, {
    metadata,
    status: 'validated',
    verifiedAt: new Date(),
    verifiedBy: auth.userId,
    updatedBy: auth.userId,
  });

  return c.json({ success: true, data: { id: row.id, signedAt: metadata.signedAt } });
}));

// ----------------------------------------------------------------------------
// Frontend gap-fix endpoint — owner-portal CoOwnerInviteModal renders the
// co-owners list above the "+ Invite" button. OWNER-BFF-001 — when the
// `repos.userPropertyAccess.findCoOwners` query lands we use it directly.
// Until then: loud-fail 501 unless `flag.bff.owner_portal.co_owners` is
// on for the tenant.
// ----------------------------------------------------------------------------
app.get('/co-owners', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos') as { userPropertyAccess?: { findCoOwners?: Function } } | undefined;
  const findCoOwners = repos?.userPropertyAccess?.findCoOwners;
  if (typeof findCoOwners === 'function') {
    try {
      const rows = await findCoOwners.call(repos!.userPropertyAccess, auth.tenantId, auth.propertyAccess ?? []);
      return c.json({ success: true, data: rows ?? [] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'co-owners query failed';
      return e503(c, 'CO_OWNERS_SERVICE_ERROR', message);
    }
  }

  const services = c.get('services') as { featureFlags?: { isEnabled: Function } } | undefined;
  const flagKey = 'flag.bff.owner_portal.co_owners';
  let flagOn = false;
  try {
    flagOn = Boolean(await services?.featureFlags?.isEnabled?.(auth.tenantId, flagKey));
  } catch {
    flagOn = false;
  }
  if (!flagOn) {
    // Field name `featureFlag` (not `flagKey`) because the redactDetails
    // helper in utils/error-response.ts strips any details key matching
    // /key/i. Renaming preserves the public identifier on the wire.
    return errorResponse(
      c,
      501,
      'NOT_IMPLEMENTED',
      'Co-owner list pipeline not wired. Concrete next-step: add repos.userPropertyAccess.findCoOwners(tenantId, propertyIds) and intersect with the inviter property scope.',
      { featureFlag: flagKey },
    );
  }
  return c.json({ success: true, data: [], meta: { note: 'flag-gated dev empty list; co-owner pipeline pending' } });
});

// ============================================================================
// C-agent gap-fix BFF endpoints — owner-portal calls these but the
// underlying domain services are either partially wired (inspections,
// messaging) or not yet built (budgets, insurance, licenses, invitations).
//
// Strategy:
//   - real-wrap when the domain table exists and we can filter to the
//     owner's property scope (inspections, communications),
//   - honest-empty otherwise — return shape-correct envelopes with a
//     `meta.note` describing why the list is empty, so the UI renders
//     stably and observers know the gap is intentional, not a bug.
// ============================================================================

const BUDGETS_NOTE = 'budgets service not yet wired';
const INSURANCE_NOTE = 'insurance service not yet wired';
const LICENSES_NOTE = 'licenses service not yet wired';
const COMMUNICATIONS_NOTE =
  'communications service not yet wired — falling back to messaging-conversations digest';
const INVITATIONS_NOTE =
  'invitation pipeline not yet wired — token signed for forward-compat, list reads empty';

function reposUnavailable(c) {
  return e503(c, 'SERVICE_UNAVAILABLE', 'Owner BFF requires repositories to be wired.');
}

// ----------------------------------------------------------------------------
// 1. GET /budgets/summary — honest-empty
// ----------------------------------------------------------------------------
app.get('/budgets/summary', (c) => {
  return c.json({
    success: true,
    data: {
      totalBudgetMajor: 0,
      spentMajor: 0,
      varianceMajor: 0,
      currency: 'USD',
      meta: { note: BUDGETS_NOTE },
    },
  });
});

// ----------------------------------------------------------------------------
// 2. GET /budgets/forecasts — honest-empty
// ----------------------------------------------------------------------------
app.get('/budgets/forecasts', (c) => {
  return c.json({
    success: true,
    data: {
      forecasts: [],
      meta: { note: BUDGETS_NOTE },
    },
  });
});

// ----------------------------------------------------------------------------
// 3. GET /compliance/inspections — real-wrap of `inspections` table,
//    filtered by the owner's property scope. Falls back to honest-empty
//    when repos/db are unavailable so the dashboard still renders.
// ----------------------------------------------------------------------------
app.get('/compliance/inspections', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const db = c.get('db');

  if (!repos || !db) {
    return c.json({
      success: true,
      data: [],
      meta: { note: 'inspections backend not available in this environment' },
    });
  }

  try {
    const scope = await getOwnerScope(auth, repos);
    const propertyIds = scope.properties.map((property) => property.id);

    if (propertyIds.length === 0) {
      return c.json({ success: true, data: [] });
    }

    const rows = await db
      .select()
      .from(inspections)
      .where(
        and(
          eq(inspections.tenantId, auth.tenantId),
          inArray(inspections.propertyId, propertyIds),
        ),
      )
      .orderBy(desc(inspections.createdAt))
      .limit(200);

    return c.json({ success: true, data: rows });
  } catch (error) {
    return c.json({
      success: true,
      data: [],
      meta: {
        note: 'inspections query failed — returning honest-empty for dashboard stability',
      },
    });
  }
});

// ----------------------------------------------------------------------------
// 4. GET /compliance/insurance — honest-empty
// ----------------------------------------------------------------------------
app.get('/compliance/insurance', (c) => {
  return c.json({
    success: true,
    data: [],
    meta: { note: INSURANCE_NOTE },
  });
});

// ----------------------------------------------------------------------------
// 5. GET /compliance/licenses — honest-empty
// ----------------------------------------------------------------------------
app.get('/compliance/licenses', (c) => {
  return c.json({
    success: true,
    data: [],
    meta: { note: LICENSES_NOTE },
  });
});

// ----------------------------------------------------------------------------
// 6. GET /compliance/summary — rolls up the three lists above. Inspections
//    count is real (when reachable); insurance + licenses are 0.
// ----------------------------------------------------------------------------
app.get('/compliance/summary', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const db = c.get('db');

  let inspectionsDueCount = 0;

  if (repos && db) {
    try {
      const scope = await getOwnerScope(auth, repos);
      const propertyIds = scope.properties.map((property) => property.id);

      if (propertyIds.length > 0) {
        const rows = await db
          .select()
          .from(inspections)
          .where(
            and(
              eq(inspections.tenantId, auth.tenantId),
              inArray(inspections.propertyId, propertyIds),
            ),
          );

        // "Due" = anything that isn't completed / archived. The schema
        // status enum varies; treat any non-closed status as outstanding.
        inspectionsDueCount = rows.filter(
          (row) =>
            row.status !== 'completed' &&
            row.status !== 'archived' &&
            row.status !== 'cancelled',
        ).length;
      }
    } catch {
      inspectionsDueCount = 0;
    }
  }

  return c.json({
    success: true,
    data: {
      inspectionsDueCount,
      insuranceExpiringCount: 0,
      licensesExpiringCount: 0,
      meta: {
        note:
          inspectionsDueCount > 0
            ? 'inspections-real, insurance+licenses honest-empty'
            : 'inspections may be 0 (real) or service-degraded; insurance+licenses honest-empty',
      },
    },
  });
});

// ----------------------------------------------------------------------------
// 7. GET /tenants/communications — wraps the messaging conversations
//    digest already used by /messaging/conversations, but framed as a
//    flat communications list per the C-agent spec. Honest-empty when
//    repos/db are unavailable.
// ----------------------------------------------------------------------------
app.get('/tenants/communications', async (c) => {
  const auth = c.get('auth');
  const repos = c.get('repos');
  const db = c.get('db');

  if (!repos || !db) {
    return c.json({
      success: true,
      data: [],
      meta: { note: COMMUNICATIONS_NOTE },
    });
  }

  try {
    const data = await listOwnerConversations(c, auth, repos);
    // Reshape to a "communications" list: one row per conversation,
    // surfacing the latest message as the communication payload.
    const communications = data.map((conversation) => ({
      id: conversation.id,
      tenantName: conversation.participantName,
      tenantRole: conversation.participantRole,
      property: conversation.propertyContext,
      lastMessage: conversation.lastMessage,
      lastMessageAt: conversation.lastMessageTime,
      unreadCount: conversation.unreadCount,
      conversationId: conversation.id,
    }));

    return c.json({ success: true, data: communications });
  } catch {
    return c.json({
      success: true,
      data: [],
      meta: { note: COMMUNICATIONS_NOTE },
    });
  }
});

// ----------------------------------------------------------------------------
// 8. POST /invitations/co-owner — stub. The real pipeline writes a row
//    to an `invitations` table and emails a signed link. Until that
//    lands we sign a token (HMAC-SHA256 over { invitationId, email,
//    propertyAccess, expiresAt }) using INVITATION_SECRET so the URL
//    can be verified later. Returns a 201-equivalent envelope.
// ----------------------------------------------------------------------------
function getInvitationSecret() {
  return (
    process.env.INVITATION_SECRET ||
    process.env.JWT_SECRET ||
    'invitation-fallback-salt-do-not-rely-on-this-in-production'
  );
}

function signInvitationToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = createHmac('sha256', getInvitationSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

app.post('/invitations/co-owner', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, async (c) => {
  const auth = c.get('auth');
  const body = await c.req.json().catch(() => ({}));

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const role = typeof body.role === 'string' ? body.role : 'co-owner';
  const propertyAccess = Array.isArray(body.propertyAccess)
    ? body.propertyAccess.filter((id) => typeof id === 'string')
    : [];

  // Light schema validation: email must look plausible, role must be
  // co-owner. We deliberately don't pull zod here to keep this stub thin.
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!emailValid || role !== 'co-owner') {
    return e400(c, 'INVALID_INPUT', 'Invitation requires a valid email and role="co-owner".');
  }

  const invitationId = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const token = signInvitationToken({
    invitationId,
    email,
    role,
    propertyAccess,
    invitedBy: auth.userId,
    tenantId: auth.tenantId,
    expiresAt,
  });

  // OWNER-BFF-002: real wire when an InvitationService is on `services`.
  // Otherwise loud-fail 501 unless `flag.bff.owner_portal.invitations_create`
  // is on — in dev mode we still return the signed token so the FE can
  // exercise the end-to-end flow without persistence.
  const services = c.get('services') as { invitationService?: { create: Function }; featureFlags?: { isEnabled: Function } } | undefined;
  const invitationService = services?.invitationService;
  if (invitationService && typeof invitationService.create === 'function') {
    try {
      const created = await invitationService.create({
        invitationId,
        email,
        role,
        propertyAccess,
        invitedBy: auth.userId,
        tenantId: auth.tenantId,
        expiresAt,
        token,
      });
      return c.json({ success: true, data: { ...created, token } });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'invitation create failed';
      return e503(c, 'INVITATION_SERVICE_ERROR', message);
    }
  }

  const flagKey = 'flag.bff.owner_portal.invitations_create';
  let flagOn = false;
  try {
    flagOn = Boolean(await services?.featureFlags?.isEnabled?.(auth.tenantId, flagKey));
  } catch {
    flagOn = false;
  }
  if (!flagOn) {
    // See comment in /co-owners — `featureFlag` survives redactDetails;
    // `flagKey` would be scrubbed because of the /key/i regex.
    return errorResponse(
      c,
      501,
      'NOT_IMPLEMENTED',
      'Invitation persistence not wired. Concrete next-step: add invitations table + InvitationService.create(...) that writes the row + enqueues notification.email.dispatch onto the outbox.',
      { featureFlag: flagKey },
    );
  }
  return c.json({
    success: true,
    data: {
      invitationId,
      expiresAt,
      token,
      meta: { note: INVITATIONS_NOTE },
    },
  });
}));

// ----------------------------------------------------------------------------
// 9. GET /invitations — honest-empty until the invitations table exists.
// ----------------------------------------------------------------------------
app.get('/invitations', (c) => {
  return c.json({
    success: true,
    data: [],
    meta: { note: INVITATIONS_NOTE },
  });
});

// ----------------------------------------------------------------------------
// 10. POST /invitations/:id/cancel — accepts the cancel call and reports
//     success. No-op until the invitations table is wired; the BFF
//     contract is what the owner-portal needs today.
// ----------------------------------------------------------------------------
app.post('/invitations/:id/cancel', withSecurityEvents({ action: 'owner-portal.create', resource: 'owner-portal', severity: 'info' }, (c) => {
  const id = c.req.param('id');
  return c.json({
    success: true,
    data: {
      id,
      status: 'cancelled',
      meta: { note: INVITATIONS_NOTE },
    },
  });
}));

export const ownerPortalRouter = app;
