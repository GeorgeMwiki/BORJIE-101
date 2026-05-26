/**
 * LPMS import router — TODO(#29) disabled.
 *
 * The legacy Land & Property Management System adapters lived in
 * `@borjie/lpms-connector`, which was removed with the rest of the
 * property domain. The mining-equivalent will accept commodity-lab
 * assay dumps and survey CSVs from third-party mine-management
 * software and live under a new `@borjie/mining-data-connector`
 * package. Until then every route returns 410 Gone so accidental
 * clients learn fast.
 */
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/hono-auth';

const app = new Hono();
app.use('*', authMiddleware);

app.all('*', (c) =>
  c.json(
    {
      error: 'lpms_import_unavailable',
      message:
        'LPMS importers were property-domain; mining-domain connectors land with the marketplace milestone.',
    },
    410,
  ),
);

export const lpmsRouter = app;
export default app;
