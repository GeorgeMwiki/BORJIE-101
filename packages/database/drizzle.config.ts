import { defineConfig } from 'drizzle-kit';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  (process.env.NODE_ENV === 'production'
    ? (() => {
        throw new Error('DATABASE_URL is required in production. Set it in .env');
      })()
    : 'postgresql://localhost:5432/borjie');

export default defineConfig({
  schema: './src/schemas/index.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: { url: DATABASE_URL },
});
