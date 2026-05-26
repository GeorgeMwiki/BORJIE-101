
/**
 * /api/v1/admin/jarvis — agency CEO/admin's personal Jarvis.
 *
 * The original wave-of-Phase-A endpoint. Kept as a thin re-export of
 * the surface-specific router from jarvis-router-factory so the
 * existing mount path keeps working while we add per-user-type
 * surfaces (tenant, owner, manager, platform HQ).
 */

import { orgAdminJarvisRouter } from './jarvis-router-factory';

export default orgAdminJarvisRouter;
