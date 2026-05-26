/**
 * /api/v1/owner/messaging/{broadcasts,campaigns,templates} — owner-portal
 * Communications page skeletons.
 *
 * Wave-2 commit 0ee27a0 converted three communications pages to
 * `MissingBackendNotice` components with these endpoints:
 *
 *   GET /api/v1/owner/messaging/broadcasts  (CommunicationsBroadcastsPage)
 *   GET /api/v1/owner/messaging/campaigns   (CommunicationsCampaignsPage)
 *   GET /api/v1/owner/messaging/templates   (CommunicationsTemplatesPage)
 *
 * The owner-portal already has working `/owner/messaging/conversations*`
 * endpoints (resident <-> manager DMs). The three new surfaces
 * (broadcasts, campaigns, templates) target a *different* domain — bulk
 * outbound communication — that doesn't have a backing service yet.
 *
 * Each handler returns an empty list + `X-Backend-Status: degraded`.
 * Mounted at `/owner` in index.ts so paths line up with the FE.
 *
 * Follow-up api-gateway, COMMS-001 (#33): wire bulk-comms domain.
 *   Concrete next-step:
 *     1. Add migrations: `comms_broadcasts`, `comms_campaigns`,
 *        `comms_templates` (all tenantId-scoped, with status enum +
 *        scheduled-at + audit fields).
 *     2. Add `CommunicationsService` in @borjie/domain-services
 *        with `listBroadcasts/listCampaigns/listTemplates(tenantId)`.
 *     3. Replace the degraded payloads with real queries.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/hono-auth';
import { requireRole } from '../../middleware/authorization';
import { UserRole } from '../../types/user-role';
import { buildDegradedList, isFlagOn, markDegraded, notImplementedFlagged } from './degraded-shape';

const BROADCASTS_NEXT_STEP =
  'create comms_broadcasts table + CommunicationsService.listBroadcasts(tenantId) and replace this skeleton';
const CAMPAIGNS_NEXT_STEP =
  'create comms_campaigns table + CommunicationsService.listCampaigns(tenantId) and replace this skeleton';
const TEMPLATES_NEXT_STEP =
  'create comms_templates table + CommunicationsService.listTemplates(tenantId) and replace this skeleton';

const FLAG_BROADCASTS = 'flag.bff.owner_messaging.broadcasts';
const FLAG_CAMPAIGNS = 'flag.bff.owner_messaging.campaigns';
const FLAG_TEMPLATES = 'flag.bff.owner_messaging.templates';

const app = new Hono();
app.use('*', authMiddleware);
app.use(
  '*',
  requireRole(
    UserRole.OWNER,
    UserRole.TENANT_ADMIN,
    UserRole.ADMIN,
    UserRole.SUPER_ADMIN,
  ),
);

app.get('/broadcasts', async (c) => {
  const auth = c.get('auth');
  if (!(await isFlagOn(c, FLAG_BROADCASTS))) {
    return notImplementedFlagged(c, FLAG_BROADCASTS, BROADCASTS_NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, BROADCASTS_NEXT_STEP));
});

app.get('/campaigns', async (c) => {
  const auth = c.get('auth');
  if (!(await isFlagOn(c, FLAG_CAMPAIGNS))) {
    return notImplementedFlagged(c, FLAG_CAMPAIGNS, CAMPAIGNS_NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, CAMPAIGNS_NEXT_STEP));
});

app.get('/templates', async (c) => {
  const auth = c.get('auth');
  if (!(await isFlagOn(c, FLAG_TEMPLATES))) {
    return notImplementedFlagged(c, FLAG_TEMPLATES, TEMPLATES_NEXT_STEP);
  }
  markDegraded(c);
  return c.json(buildDegradedList(auth.tenantId, TEMPLATES_NEXT_STEP));
});

export const ownerMessagingRouter = app;
