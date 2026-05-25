/**
 * estate-department-advisor router smoke tests.
 *
 * Verifies the router is mounted and auth gates anonymous callers.
 * Full `buildDepartmentHealthReport` behaviour lives in the
 * `@borjie/estate-department-advisor` package tests.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import estateDepartmentAdvisorRouter from '../estate-department-advisor.router.js';

function mount(): Hono {
  const app = new Hono();
  app.route('/estate-department-advisor', estateDepartmentAdvisorRouter);
  return app;
}

describe('estate-department-advisor router — auth gates', () => {
  it('rejects POST /department-health-report without a token', async () => {
    const res = await mount().request(
      '/estate-department-advisor/department-health-report',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: { 'content-type': 'application/json' },
      },
    );
    expect(res.status).toBe(401);
  });

  it('rejects POST /department-health-report with an invalid token', async () => {
    const res = await mount().request(
      '/estate-department-advisor/department-health-report',
      {
        method: 'POST',
        body: JSON.stringify({}),
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer not-a-real-jwt',
        },
      },
    );
    expect(res.status).toBe(401);
  });
});
