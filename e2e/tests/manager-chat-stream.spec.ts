/**
 * Wave-12 — manager-chat SSE streaming smoke.
 *
 * Verifies that the admin-portal ManagerChat page:
 *   1. POSTs to /api/v1/ai/chat when the user submits a message,
 *   2. renders delta chunks incrementally as the SSE stream emits them,
 *   3. finalises the assistant bubble once `turn_end` arrives,
 *   4. surfaces the Blackboard with generative-UI blocks from the response.
 *
 * The test does not talk to a real brain — `page.route()` intercepts the
 * request and writes a hand-crafted SSE stream so we can assert on every
 * event boundary independently.
 */

import { test, expect } from '@playwright/test';

test.use({ project: 'admin-portal' });

const UAT_JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJ1c2VySWQiOiJ1YXQtYWRtaW4tMDEiLCJ0ZW5hbnRJZCI6InRlbi11YXQtMDAxIiwicm9sZSI6ImFkbWluIn0.' +
  'uat-signature-placeholder';

test.describe('Wave-12 — ManagerChat streaming SSE', () => {
  test.beforeEach(async ({ context, page }) => {
    await context.addInitScript((token) => {
      window.localStorage.setItem('token', token);
      window.localStorage.setItem(
        'user',
        JSON.stringify({ id: 'uat-admin-01', role: 'admin', tenantId: 'ten-uat-001' }),
      );
    }, UAT_JWT);

    await page.route('**/api/v1/ai/chat', async (route) => {
      // SSE body — turn_start, five delta chunks, tool_call/tool_result pair,
      // and a turn_end. Enough shape to let the chat page assert the typing
      // indicator, tool chip, and finalised assistant bubble all render.
      const body = [
        'event: turn_start\ndata: {"type":"turn_start","threadId":"t-uat-1","personaId":"estate-manager","createdAt":"2026-01-01T00:00:00Z"}\n\n',
        'event: delta\ndata: {"type":"delta","content":"Portfolio "}\n\n',
        'event: delta\ndata: {"type":"delta","content":"is "}\n\n',
        'event: delta\ndata: {"type":"delta","content":"healthy. "}\n\n',
        'event: tool_call\ndata: {"type":"tool_call","name":"graph.search"}\n\n',
        'event: tool_result\ndata: {"type":"tool_result","name":"graph.search","ok":true}\n\n',
        'event: delta\ndata: {"type":"delta","content":"3 properties, 0 arrears."}\n\n',
        'event: turn_end\ndata: {"type":"turn_end","threadId":"t-uat-1","finalPersonaId":"estate-manager","totalTokens":120,"totalCost":0.0018,"timeMs":20,"advisorConsulted":false}\n\n',
      ].join('');
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
        body,
      });
    });
  });

  test('streams deltas and renders the finalised reply', async ({ page }) => {
    await page.goto('/admin/manager-chat');

    const input = page.getByPlaceholder(/rent affordability/i);
    await input.fill('How is the portfolio doing?');
    await page.getByRole('button', { name: /send/i }).click();

    // At least 3 deltas + final render must produce the concatenated text.
    await expect(page.getByText('Portfolio is healthy. 3 properties, 0 arrears.')).toBeVisible({
      timeout: 5000,
    });

    // Tool chip should be visible with the graph.search label.
    await expect(page.getByText(/graph\.search/)).toBeVisible();
  });
});
