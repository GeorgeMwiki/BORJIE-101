/**
 * Vitest global test setup — runs in each fork BEFORE any test-file
 * imports so module-level singletons in database.ts / hono-auth.ts see
 * the correct env flags and never attempt a real Postgres/Supabase
 * connection during unit tests.
 *
 * WHY this file exists:
 *   Vitest automatically loads the repo-root `.env` file (via Vite's env
 *   loading) before spawning test forks. That file contains a real
 *   DATABASE_URL. When database.ts is imported it captures DATABASE_URL
 *   at the top of the module (const DATABASE_URL = process.env.DATABASE_URL)
 *   and decides whether to create a live pool based on USE_MOCK_DATA.
 *   Because ES module `import` statements are hoisted and run BEFORE the
 *   test-file body, any `process.env.USE_MOCK_DATA = 'true'` inside the
 *   test body is too late — database.ts has already initialized.
 *
 *   By hooking this file as a setupFile, Vitest guarantees it runs
 *   synchronously BEFORE any test-file's imports are resolved.
 */

// Prevent index.ts dotenv loading (it would override our flags below).
process.env.BORJIE_SKIP_DOTENV = 'true';

// Force mock-data mode so database.ts never creates a real pool.
// Tests that need a real DB must bring their own client via vi.mock or
// context injection.
process.env.USE_MOCK_DATA = 'true';

// Ensure NODE_ENV is 'test' so database.ts skips the 503 guard.
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
