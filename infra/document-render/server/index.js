// BORJIE document-render entry point — boots all three services
// in-process. Each service binds its own port; one container, three
// listeners. Keeps the docker-compose simple.
//
// Refs:
//   - Carbone server contract: https://carbone.io/api-reference.html
//   - Typst CLI: https://github.com/typst/typst
//   - Puppeteer page.pdf: https://pptr.dev/api/puppeteer.page.pdf

import { startCarbone } from './carbone-server.js';
import { startTypst } from './typst-server.js';
import { startPuppeteer } from './puppeteer-server.js';

const PORT_CARBONE = Number(process.env.CARBONE_PORT ?? 4000);
const PORT_TYPST = Number(process.env.TYPST_PORT ?? 8001);
const PORT_PUPPETEER = Number(process.env.PUPPETEER_PORT ?? 8002);

const servers = await Promise.all([
  startCarbone(PORT_CARBONE),
  startTypst(PORT_TYPST),
  startPuppeteer(PORT_PUPPETEER),
]);

console.log(
  `[document-render] Carbone:${PORT_CARBONE} Typst:${PORT_TYPST} Puppeteer:${PORT_PUPPETEER}`,
);

function shutdown(signal) {
  console.log(`[document-render] ${signal} — closing listeners`);
  let pending = servers.length;
  for (const s of servers) {
    s.close(() => {
      pending -= 1;
      if (pending === 0) process.exit(0);
    });
  }
  // Hard exit after 10s in case something is wedged.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
