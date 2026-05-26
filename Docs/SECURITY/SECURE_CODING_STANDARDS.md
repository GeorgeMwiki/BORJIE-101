# BORJIE — Secure Coding Standards

Persona: **Mr. Mwikila** (SEC-2)
Last reviewed: 2026-05-26
Status: living document, enforced by ESLint, Semgrep, CodeQL, and PR review.

> **Read this before opening a PR.** The rules below are not stylistic preferences — every one is wired to a CI gate or a runtime probe. Violations either block the PR or page the on-call.

---

## 0. Universal principles

1. **TS strict ON**. No `@ts-nocheck`. No `@ts-ignore` without a one-line comment explaining *why* and a linked issue.
2. **Prefer `unknown` over `any`**. `any` is permitted only at trust boundaries (LLM output, third-party JSON) and must be narrowed within one function.
3. **Validate at the boundary**. Every request body, query string, env var, LLM output, and webhook body is parsed with `zod` before it leaves the entry-point file.
4. **Immutable by default**. Never mutate a parameter; always return a new object. (Mutation = bugs you'll find at 3am.)
5. **No mutation of shared state across async boundaries**. Use Redis locks, DB row locks, or a single-writer pattern.
6. **No secrets in code, ever**. Not in tests, not in fixtures, not "just for the demo". Use env vars. Tests use `<api-key-redacted>` placeholders.
7. **One responsibility per file**. < 400 lines typical, < 800 hard cap.
8. **No `console.log` in committed code**. Use the package logger (`packages/observability`).
9. **Live-test only**. No recorded fixtures pretending to be live in production paths.

---

## 1. Input validation — the foundation

### 1.1 Use zod, always

```ts
// CORRECT
import { z } from 'zod';

const CreateListingSchema = z.object({
  tenant_id: z.string().uuid(),
  title: z.string().min(3).max(120),
  price_micro: z.number().int().nonnegative(),
  currency: z.enum(['TZS', 'KES', 'UGX', 'NGN', 'USD', 'EUR']),
});
type CreateListing = z.infer<typeof CreateListingSchema>;

export async function createListing(req: Request, res: Response) {
  const body = CreateListingSchema.parse(req.body); // throws ZodError on invalid input
  // ... use `body` with full type safety
}
```

```ts
// WRONG — type assertion instead of validation
const body = req.body as CreateListing; // attacker controls this; the cast does nothing
```

Coverage is enforced by `scripts/audit-zod-coverage.mjs`.

### 1.2 Validate env vars at startup

```ts
// CORRECT — packages/config/src/env.ts
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'staging', 'production']),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  ANTHROPIC_API_KEY: z.string().startsWith('sk-ant-'),
});
export const env = EnvSchema.parse(process.env); // throws on boot, not at runtime
```

---

## 2. Authentication & authorization

### 2.1 Authentication

- JWT TTL = 15 minutes for access tokens.
- Refresh tokens rotate on every use.
- Verify `iss`, `aud`, `exp`, `nbf`, `jti`. Reject on any failure.
- MFA mandatory for `tenant_admin` and `super_admin`.

### 2.2 Authorization

```ts
// CORRECT — every route declares its policy
import { authorize } from '@borjie/authz-policy';

router.post('/api/v1/listings', authorize('listing.create'), async (req, res) => {
  // ...
});
```

```ts
// WRONG — implicit "anyone authenticated"
router.post('/api/v1/listings', requireAuth, async (req, res) => { /* ... */ });
```

`borjie-security-route-coverage.yml` proves every route has a declared policy.

### 2.3 Tenant scoping

```ts
// CORRECT — explicit tenant scope on every query
const listings = await prisma.listing.findMany({
  where: { tenant_id: req.user.tenant_id, /* ... */ },
});
```

```ts
// WRONG — no tenant filter; relies on RLS only (defense-in-depth requires both)
const listings = await prisma.listing.findMany();
```

`scripts/audit-rls-coverage.mjs` proves the DB-level enforcement; the app-level enforcement is checked by Semgrep rule `borjie.no-tenant-bypass`.

---

## 3. SQL & database access

### 3.1 Use Prisma, not raw SQL

```ts
// CORRECT
const user = await prisma.user.findUnique({ where: { id } });
```

```ts
// WRONG — raw SQL with interpolation
const user = await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE id = '${id}'`);
```

If you must use raw SQL, use `Prisma.sql` template tag which parameterises:

```ts
// CORRECT — parameterised
const users = await prisma.$queryRaw(Prisma.sql`SELECT * FROM users WHERE id = ${id}`);
```

### 3.2 No `findMany()` without a limit

```ts
// WRONG — unbounded read; can OOM the pod
await prisma.listing.findMany({ where: { tenant_id } });
```

```ts
// CORRECT — paginate
await prisma.listing.findMany({
  where: { tenant_id },
  take: limit,
  skip: offset,
  orderBy: { created_at: 'desc' },
});
```

Caught by `.semgrep/borjie-rules.yml` rule `borjie.unbounded-findMany`.

---

## 4. Output handling & XSS

### 4.1 React

React escapes by default. Do not bypass it.

```tsx
// CORRECT
<div>{user.name}</div>
```

```tsx
// WRONG
<div dangerouslySetInnerHTML={{ __html: user.bio }} />
```

`dangerouslySetInnerHTML` is banned by ESLint rule. Exceptions require a `// eslint-disable-next-line` with justification + sanitisation via DOMPurify.

### 4.2 Express/Fastify error responses

```ts
// CORRECT — uniform envelope, no stack
res.status(500).json({ ok: false, error_code: 'INTERNAL_ERROR', request_id: req.id });
```

```ts
// WRONG — leaks stack + internal paths
res.status(500).json({ error: err.message, stack: err.stack });
```

Enforced by `eslint-rules/no-raw-error-envelope.js` + Semgrep.

---

## 5. Logging

### 5.1 Never log secrets, PII, or full request bodies

```ts
// CORRECT — use the package logger with PII scrubbing built in
import { logger } from '@borjie/observability';
logger.info('listing.created', { tenant_id, listing_id }); // no PII, no secrets
```

```ts
// WRONG
console.log('Login attempt', { email, password, jwt: token });
```

`console.log` in committed code is a hard block. The package logger redacts `password`, `token`, `authorization`, `cookie`, `secret`, `api_key`, `kra_pin`, `nida_num`, `mpesa_msisdn`, `email`, `phone`.

### 5.2 No PII in analytics events

PII never leaves the app boundary. Pseudonymise user IDs before sending to analytics.

---

## 6. HTTP outbound

### 6.1 Use the wrapped client

```ts
// CORRECT — wrapper enforces egress allowlist, timeout, retry policy
import { httpClient } from '@borjie/connectors';
const data = await httpClient.get('https://api.example.com/data', { timeoutMs: 5000 });
```

```ts
// WRONG — raw fetch
const data = await fetch(url).then((r) => r.json());
```

SSRF protection: `scripts/audit-ssrf-coverage.mjs` proves every outbound HTTP goes through the wrapped client.

### 6.2 Validate the host before fetching attacker-supplied URLs

```ts
// CORRECT
const url = new URL(userProvidedUrl);
if (!ALLOWED_HOSTS.has(url.hostname)) throw new Error('Host not allowed');
```

---

## 7. File operations & paths

### 7.1 Never trust user-supplied paths

```ts
// WRONG — path traversal
const file = fs.readFileSync(`./uploads/${req.params.filename}`);
```

```ts
// CORRECT — resolve and check
import path from 'node:path';
const root = path.resolve('./uploads');
const target = path.resolve(root, req.params.filename);
if (!target.startsWith(root + path.sep)) throw new Error('Invalid path');
const file = fs.readFileSync(target);
```

### 7.2 Never execute user input

```ts
// WRONG — RCE
eval(userInput);
new Function(userInput)();
```

`eval` and `new Function()` are banned by `eslint-plugin-security`.

---

## 8. Cryptography

### 8.1 Use Node `crypto`, not hand-rolled

```ts
// CORRECT
import { randomBytes, timingSafeEqual, createHmac } from 'node:crypto';

const token = randomBytes(32).toString('base64url');
const ok = timingSafeEqual(Buffer.from(a), Buffer.from(b));
```

```ts
// WRONG — string comparison is timing-unsafe
if (providedHmac === expectedHmac) { /* ... */ }
```

### 8.2 No MD5, no SHA1 for security purposes

SHA-256 minimum for hashing. bcrypt or argon2 for passwords.

---

## 9. LLM / Agent-specific

### 9.1 Every LLM output goes through the output guard

```ts
// CORRECT
import { guardLlmOutput } from '@borjie/ai-copilot/security/output-guard';
const safe = guardLlmOutput(rawCompletion);
```

### 9.2 Strip indirect instructions from any fetched-then-prompted content

```ts
// CORRECT
import { stripIndirectInstructions } from '@borjie/ai-copilot/security/strip-indirect-instructions';
const cleaned = stripIndirectInstructions(scrapedHtml);
const summary = await llm.complete({ messages: [{ role: 'user', content: cleaned }] });
```

### 9.3 Tool registry is the only callable surface

Never let the LLM construct a function name dynamically. Tools are registered at startup with a `zod` schema for arguments.

### 9.4 Every write is a proposed action

```ts
// CORRECT — propose, do not execute
const proposed = await mwikila.propose({
  tool: 'm-pesa-transfer',
  args: { msisdn, amount_micro, currency: 'TZS' },
});
// human confirms in UI -> server executes
```

---

## 10. Concurrency & money

### 10.1 Atomic balance checks

```ts
// WRONG — race condition
const balance = await getBalance(userId);
if (balance >= amount) await withdraw(userId, amount);
```

```ts
// CORRECT — single transaction with row lock
await prisma.$transaction(async (tx) => {
  const row = await tx.$queryRaw<Array<{ balance_micro: bigint }>>`
    SELECT balance_micro FROM balances WHERE user_id = ${userId} FOR UPDATE
  `;
  if (row[0].balance_micro < amount) throw new Error('Insufficient funds');
  await tx.balance.update({
    where: { user_id: userId },
    data: { balance_micro: { decrement: amount } },
  });
  await tx.ledgerEntry.create({ data: { /* ... */ } });
});
```

### 10.2 Idempotency keys for any state change initiated externally

Every webhook handler and every client-initiated payment endpoint requires an `Idempotency-Key` header. Persist `(provider, event_id)` uniqueness in the DB.

### 10.3 Never use floating point for money

```ts
// WRONG
const total = unitPrice * qty; // float drift
```

```ts
// CORRECT
const total_micro = unitPriceMicro * BigInt(qty); // integer micros
```

---

## 11. Per-package callouts

### 11.1 `services/api-gateway`

- Every route declares a policy (see §2.2).
- Every route has a rate-limit decorator (verified by `scripts/audit-rate-limit-coverage.mjs`).
- Helmet + CSP + CORS allowlist enabled at app boot.
- Error envelopes uniform; never leak stack.

### 11.2 `services/voice-agent`

- PII scrub *before* the LLM call, not after.
- Raw audio retained ≤ 7 days, transcribed copy ≤ 90 days (purger in `services/scheduler`).
- No high-stakes action on voice alone — out-of-band confirmation required.

### 11.3 `services/research-orchestrator`

- Wrap every outbound API behind `@borjie/connectors`.
- Apply `stripIndirectInstructions` to every fetched body.
- Persist SHA-256 + fetched-at for every source.

### 11.4 `packages/agent-platform` + Mr. Mwikila

- Tool registry registration happens at startup, not at request time.
- Every tool argument validated with `zod`.
- Audit hash chain entry per tool call.
- Proposed-action flow for every write.

### 11.5 `services/connectors-*` and `packages/connectors`

- Every webhook handler verifies HMAC before parsing.
- Every adapter takes `tenant_id` as a typed arg.
- Credentials in vault, never in env file at rest.

### 11.6 `services/payments-ledger` + `packages/payments-event-store`

- Ledger is append-only; `UPDATE`/`DELETE` at DB role level (separate `admin_dba` role).
- Idempotency key required on every state-changing endpoint.
- Atomic transactions with row lock for balance changes.

### 11.7 `apps/admin-web` + `apps/owner-web`

- Anti-CSRF token on every state change.
- CSP with nonce; no inline scripts.
- `dangerouslySetInnerHTML` banned by ESLint.

### 11.8 `apps/buyer-mobile` + `apps/workforce-mobile`

- Tokens in OS Keychain/Keystore.
- Certificate pinning to BORJIE issuer.
- Play Integrity / App Attest at session start.

### 11.9 `packages/database`

- Migrations reviewed by `migration-safety-check.yml`.
- Destructive operations (DROP, TRUNCATE, DELETE without WHERE) blocked.
- RLS policies on every multi-tenant table.

### 11.10 `packages/audit-hash-chain`

- Hash chain entries are append-only.
- Nightly `audit-chain-verify.mjs` raises Sev2 on mismatch.
- Never expose chain entries to the LLM context — they are forensic, not conversational.

### 11.11 `packages/observability` / logging

- Redaction baseline in pino: `password`, `token`, `authorization`, `cookie`, `secret`, `api_key`, `kra_pin`, `nida_num`, `mpesa_msisdn`, `email`, `phone`.
- Add to the baseline (don't remove). PRs reducing redaction are blocked.

### 11.12 `packages/authz-policy`

- Policies are source-of-truth. Routes refer to policy IDs.
- No inline `if (user.role === 'admin')` in route handlers — call the policy.

---

## 12. ESLint & Semgrep rule inventory (enforced)

This list is the ground truth of what blocks a PR.

- `eslint-plugin-security` baseline rules
- `eslint-plugin-no-secrets` baseline rules
- `eslint-rules/no-raw-error-envelope.js`
- `eslint-rules/csrf-required.js`
- `eslint-rules/no-console.js` (deny `console.log`/`info`/`warn` in committed code)
- `eslint-rules/no-dangerouslyset.js`
- `.semgrep/borjie-rules.yml` — cross-tenant lookup, unbounded findMany, PII in logs, raw SQL with interpolation
- `borjie-zero-hardcoded.yml` — no hardcoded jurisdictional/tax/currency literals
- `borjie-zero-hardcoded.yml` — no hardcoded role names, route paths, module lists

If a finding is wrong (false positive), open an exception in `.audit/` with `reason:` and `next_review:`.

---

## 13. The "don't do this" gallery

A handful of patterns that have hurt us in past incidents. Memorise them.

```ts
// 1. NEVER trust the LLM with a tool name string
await tools[llm.output.tool_name](args); // RCE-equivalent; the LLM picks the function

// 2. NEVER bypass zod on a fast-path
const body = req.body; // attacker decides the shape, your types lie

// 3. NEVER catch-and-swallow
try { /* ... */ } catch (_) {} // bugs disappear into the void; alarms never fire

// 4. NEVER write `// @ts-nocheck`
// If TS is wrong, fix the type. If you must suppress, do it line-by-line with `@ts-expect-error` + a comment.

// 5. NEVER store secrets in tests
const apiKey = 'sk-prod-...'; // even in a test, this becomes a real key the day someone copy-pastes

// 6. NEVER log full request bodies
logger.info('inbound', { body: req.body }); // the body may contain a password or a NIDA

// 7. NEVER rely on client-side validation alone
<input pattern="\d+" /> // attackers don't use your form

// 8. NEVER use Math.random for security purposes
const token = Math.random().toString(36); // predictable; use crypto.randomBytes

// 9. NEVER concatenate strings into HTML / SQL / shell
const html = `<div>${userInput}</div>`; // XSS
exec(`grep ${pattern} file.txt`); // shell injection

// 10. NEVER store mutable shared state across async boundaries without a lock
let balance = await getBalance(); // by the time you write back, two writers have raced
```

---

## 14. Review checklist (paste into PR)

```
## Security checklist
- [ ] All inputs validated with zod
- [ ] All routes declare an authz policy
- [ ] No console.log in committed code
- [ ] No secrets in code or tests
- [ ] No `as any` outside trust boundaries
- [ ] No `@ts-nocheck`
- [ ] Error envelopes uniform (no stack leak)
- [ ] LLM outputs go through output guard
- [ ] Outbound HTTP uses wrapped client
- [ ] DB writes inside transactions when touching money
- [ ] HMAC verification on inbound webhooks
- [ ] Tests added for the security-sensitive path
```

If any box is unchecked, the PR is blocked. Mr. Mwikila reviews security-sensitive paths personally.

---

— Mr. Mwikila
