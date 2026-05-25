// Docker HEALTHCHECK probe — green only when all three render
// services answer GET /health with 200.
//
// Invoked from the Dockerfile HEALTHCHECK directive. Exits 0 on
// success and 1 on any failure so docker can flip the container
// state. Times out per-probe so a single hung backend doesn't pin
// the whole healthcheck.

const ENDPOINTS = [
  { name: 'carbone', url: 'http://127.0.0.1:4000/health' },
  { name: 'typst', url: 'http://127.0.0.1:8001/health' },
  { name: 'puppeteer', url: 'http://127.0.0.1:8002/health' },
];

const TIMEOUT_MS = 3000;

async function probe({ name, url }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`${name} ${res.status}`);
    }
    return { name, ok: true };
  } catch (err) {
    return { name, ok: false, error: err.message ?? String(err) };
  } finally {
    clearTimeout(timer);
  }
}

const results = await Promise.all(ENDPOINTS.map(probe));
const failed = results.filter((r) => !r.ok);
if (failed.length > 0) {
  console.error(JSON.stringify(failed));
  process.exit(1);
}
console.log('healthy');
process.exit(0);
