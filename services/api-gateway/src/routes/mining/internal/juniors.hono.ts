/**
 * /api/v1/mining/internal/juniors — junior-template registry list.
 *
 * SUPER_ADMIN / ADMIN only. Reads the static `JUNIOR_REGISTRY` from
 * `@borjie/ai-copilot/juniors/executor-registry`, projects:
 *   - name
 *   - whether the input schema parses an empty object (hard-vs-soft
 *     required-fields hint)
 *   - schema field count
 *
 * The admin-web `JuniorsPage` consumes this list to render one
 * `JuniorActions` card per junior with "Run with sample input" /
 * "Inspect schema" affordances.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { JUNIOR_REGISTRY } from '@borjie/ai-copilot/juniors/executor-registry';
import { authMiddleware, requireRole } from '../../../middleware/hono-auth';
import { UserRole } from '../../../types/user-role';

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));

interface JuniorListItem {
  readonly name: string;
  readonly schemaFieldCount: number;
  readonly acceptsEmptyInput: boolean;
  readonly status: 'ready';
}

function describeJunior(name: string, entry: (typeof JUNIOR_REGISTRY)[string]): JuniorListItem {
  const shape = (entry.schema as unknown as { _def?: { shape?: () => Record<string, unknown> } })._def;
  const fields = typeof shape?.shape === 'function' ? shape.shape() : {};
  const fieldCount = Object.keys(fields).length;
  const acceptsEmpty = entry.schema.safeParse({}).success;
  return {
    name,
    schemaFieldCount: fieldCount,
    acceptsEmptyInput: acceptsEmpty,
    status: 'ready',
  };
}

app.get('/', async (c) => {
  const data = Object.entries(JUNIOR_REGISTRY).map(([name, entry]) =>
    describeJunior(name, entry),
  );
  data.sort((a, b) => a.name.localeCompare(b.name));
  return c.json(
    {
      success: true as const,
      data,
      meta: { count: data.length },
    },
    200,
  );
});

export const miningInternalJuniorsRouter = app;
