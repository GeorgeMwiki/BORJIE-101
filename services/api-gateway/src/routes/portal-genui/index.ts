/**
 * Public surface for the portal-genui router family.
 *
 * The api-gateway `index.ts` mounts this at `/portal-genui` under
 * the `/v1` Hono — once mounted the URLs are:
 *
 *   POST   /api/v1/portal-genui/detect
 *   POST   /api/v1/portal-genui/generate
 *   POST   /api/v1/portal-genui/tabs
 *   GET    /api/v1/portal-genui/tabs
 *   GET    /api/v1/portal-genui/tabs/:id
 *   DELETE /api/v1/portal-genui/tabs/:id
 */

export { default as portalGenUIRouter } from './portal-genui.router.js';
