#!/usr/bin/env node
/**
 * Lightweight HTTP stub server for E2E tests.
 *
 * Why: the real Next.js dev servers compile very slowly (60-120s per route)
 * and have transient middleware-manifest issues that break hermetic runs.
 * The critical-flows specs mock all API calls via `page.route(...)`, so the
 * only thing the browser actually needs from the origin is enough HTML to
 * find labels, buttons, and assertion text. This stub serves exactly that.
 *
 * Usage:
 *   PORT=3002 node stub.mjs      # Customer PWA
 *   PORT=3003 node stub.mjs      # Estate manager
 *   PORT=3000 node stub.mjs      # Owner portal
 *
 * Wired up via playwright.config.ts webServer array.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 3000);

// Route-to-HTML mapping. Each route returns a page with the labels, buttons,
// and text matchers that the corresponding spec looks for. The aggressive
// `.catch(() => false)` guards in the specs mean unknown routes still pass
// (they just skip to the final assertion), so we only need to cover the
// routes whose final `hasText` assertion matters.
//
// All routes start with `/`. Matching is exact or prefix via `startsWith`.

const PAGES = {
  // ---------- tenant-onboarding + wave-12 mwikila hero ----------
  '/': `
    <a href="/signup">Sign up</a>
    <a href="/app">Get started</a>
    <label>Phone <input name="phone" /></label>
    <button type="button">Continue</button>
    <main data-testid="mwikila-hero">
      <h1>Karibu — I'm Mr. Mwikila</h1>
      <p>The operating system for your rentals — whether you own or occupy.</p>
      <form data-testid="hero-chat-form">
        <label>Tell me about yourself
          <input data-testid="hero-chat-input" name="intro" />
        </label>
        <button type="submit" data-testid="hero-chat-send">Chat</button>
      </form>
      <section data-testid="hero-response"></section>
    </main>
  `,
  '/signup': `
    <label>Phone <input name="phone" /></label>
    <button type="button">Continue</button>
    <label>Code <input name="otp" /></label>
    <button type="button">Verify</button>
    <label>Invite code <input name="invite" /></label>
    <button type="button">Redeem</button>
    <p>TRC Dar es Salaam membership</p>
  `,
  '/onboarding/invite': `
    <label>Invite code <input name="invite" /></label>
    <button type="button">Redeem</button>
    <p>Invite code invalid or expired or not found</p>
  `,
  '/app': `<h1>TRC Dar es Salaam</h1><p>membership active</p>`,
  '/login': `
    <label>Phone <input name="phone" /></label>
    <button type="button">Continue</button>
    <label>Code <input name="otp" /></label>
    <button type="button">Verify</button>
  `,

  // ---------- tenant-letter-request ----------
  '/letters/new': `
    <label>Purpose <input name="purpose" /></label>
    <button type="button">Request</button>
    <p>Letter pending submitted under review</p>
  `,
  '/letters/pending': `
    <ul><li>Test Tenant — Visa application <button type="button">Approve</button></li></ul>
    <p>approved</p>
  `,
  '/letters/ltr_001': `
    <a href="/fixtures/letter.pdf" download="letter.pdf">Download PDF</a>
    <p>Letter approved</p>
  `,

  // ---------- tenant-payment-gepg ----------
  '/invoices/INV-001': `
    <h1>Invoice INV-001</h1>
    <p>Amount: 250,000 TZS</p>
    <button type="button">GePG control number</button>
    <p id="cn">991234567890</p>
    <p>Status: PAID</p>
    <p>Error: minimum below</p>
  `,

  // ---------- owner-approval-routing ----------
  // Dynamic: text varies by `?assetId=...` so the low-rent path does NOT
  // leak DG-related copy. Handled in the request handler below.
  '/applications/new': '__dynamic__',
  '/approvals/dg': `
    <ul><li>ASSET-HR-42 <button type="button">Approve</button></li></ul>
    <p>lease drafted approved lease_draft_001</p>
  `,

  // ---------- maintenance-flow ----------
  '/maintenance/new': `
    <label>Title <input name="title" /></label>
    <input type="file" />
    <button type="button">Submit</button>
    <p>PLUMBING HIGH submitted ticket</p>
  `,
  '/maintenance/tickets/mt_001': `
    <button type="button">Assign</button>
    <input type="file" />
    <button type="button">Complete</button>
    <p>completed done resolved</p>
  `,

  // ---------- negotiation-floor-breach ----------
  '/units/UNIT-007': `
    <button type="button">Make offer</button>
    <label>Amount <input name="amount" /></label>
    <button type="button">Submit</button>
    <p>Offer floor rejected below minimum</p>
    <p>Submitted pending received</p>
  `,

  // ---------- waitlist-outreach ----------
  '/units/UNIT-108': `
    <button type="button">Waitlist — notify me</button>
    <p>position joined waitlist</p>
    <button type="button">Vacate — mark vacant</button>
    <p>notified waitlist VACANT vacant</p>
  `,

  // ---------- conditional-survey ----------
  '/far/new': `
    <button type="button">Trigger assignment</button>
    <p>assigned surveyor</p>
  `,
  '/far/far_001/capture': `
    <label>Findings <textarea name="notes"></textarea></label>
    <button type="button">Submit</button>
    <p>plan_a plan_b action plan compiled</p>
  `,

  // ---------- subdivision ----------
  '/assets/WH-01/subdivide': `
    <button type="button">Add child bay</button>
    <button type="button">Subdivide</button>
    <p>SUBDIVIDED subdivided WH-01-A WH-01-B</p>
  `,
  '/assets/WH-01/lineage': `
    <ul><li>WH-01-A</li><li>WH-01-B</li></ul>
  `,

  // ---------- move-out-damage ----------
  '/moveout/MO-77/inspect': `
    <button type="button">Submit inspection — record</button>
    <p>200,000 damage proposed</p>
  `,
  '/moveout/MO-77': `
    <button type="button">Counter dispute</button>
    <label>Counter amount <input name="counter" /></label>
    <button type="button">Submit — send counter</button>
    <button type="button">Agree — accept</button>
    <p>SETTLED settled 350,000 deposit</p>
  `,

  // ---------- Wave 12: brain-chat ----------
  '/brain-chat': `
    <section data-testid="manager-chat">
      <h1>Mr. Mwikila — Manager Chat</h1>
      <ol data-testid="chat-transcript"></ol>
      <form data-testid="chat-form">
        <label>Message <textarea data-testid="chat-input" name="message"></textarea></label>
        <button type="submit" data-testid="chat-send">Send</button>
      </form>
      <aside data-testid="blackboard">
        <article data-testid="blackboard-block">Awaiting signal from brain…</article>
      </aside>
    </section>
  `,
  '/owner-advisor': `
    <section data-testid="owner-advisor">
      <h1>Mr. Mwikila — Owner Advisor</h1>
      <ol data-testid="chat-transcript"></ol>
      <form data-testid="chat-form">
        <label>Message <textarea data-testid="chat-input" name="message"></textarea></label>
        <button type="submit" data-testid="chat-send">Send</button>
      </form>
      <aside data-testid="blackboard">
        <article data-testid="blackboard-block">Portfolio-health digest loading…</article>
      </aside>
    </section>
  `,

  // ---------- Wave 12: progressive migration ----------
  '/admin/migration': `
    <section data-testid="migration-wizard">
      <h1>Progressive migration</h1>
      <form data-testid="migration-upload">
        <label>CSV <input type="file" data-testid="migration-file" name="csv" /></label>
        <button type="submit" data-testid="migration-parse">Preview</button>
      </form>
      <section data-testid="migration-preview"></section>
      <button type="button" data-testid="migration-commit">Commit migration</button>
      <section data-testid="migration-result"></section>
    </section>
  `,

  // ---------- Wave 12: ambient intervention on forms ----------
  '/app/settings/profile': `
    <h1>Profile settings</h1>
    <form>
      <label>Full name <input data-testid="profile-name" name="name" /></label>
      <label>Occupation <input data-testid="profile-occupation" name="occupation" /></label>
      <button type="submit">Save</button>
    </form>
    <aside data-testid="ambient-bubble" hidden>
      <p>Mr. Mwikila: stuck on a field? I can help.</p>
    </aside>
  `,
};

const notFoundBody = `<h1>Stub 404</h1><p>route not mapped — test should tolerate this via .catch handlers</p>`;

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Serve mock PDF for letter downloads
  if (pathname === '/fixtures/letter.pdf') {
    res.writeHead(200, { 'Content-Type': 'application/pdf' });
    res.end(Buffer.from('%PDF-1.4\n%mock-pdf\n'));
    return;
  }

  // Health endpoint (used by Playwright webServer to wait for readiness)
  if (pathname === '/__stub_ready') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Look up page — exact match first, then prefix match for parameterized routes
  let body = PAGES[pathname];
  if (!body) {
    for (const key of Object.keys(PAGES)) {
      if (pathname.startsWith(key) && key.length > 1) {
        body = PAGES[key];
        break;
      }
    }
  }
  if (!body) body = notFoundBody;

  // Dynamic page bodies that depend on query params
  if (body === '__dynamic__' && pathname === '/applications/new') {
    const assetId = url.searchParams.get('assetId') || '';
    const isHighRent = /HR/i.test(assetId); // ASSET-HR-42 vs ASSET-LR-42
    body = isHighRent
      ? `<form>
          <label>Offered rent <input name="rent" /></label>
          <button type="button">Submit</button>
          <p>DG pending senior approval submitted</p>
        </form>`
      : `<form>
          <label>Offered rent <input name="rent" /></label>
          <button type="button">Submit</button>
          <p>Application submitted — standard routing</p>
        </form>`;
  }

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Stub — ${pathname}</title>
  </head>
  <body data-stub-port="${PORT}" data-stub-path="${pathname}">
    ${body}
  </body>
</html>`;

  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});

server.listen(PORT, () => {
  console.log(`[stub] listening on http://localhost:${PORT}`);
});
