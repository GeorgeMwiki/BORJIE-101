/**
 * Helper: mint a JWT for smoke / capability probes. The secret is read
 * from the gateway's `.env.local`, defaulting to the deterministic test
 * value. Role + tenant are picked up from CLI args:
 *
 *   node scripts/smoke/mint.cjs ADMIN
 *   node scripts/smoke/mint.cjs OWNER 00000000-0000-0000-0000-000000000001
 */
const jwt = require('jsonwebtoken')
const fs = require('node:fs')
const path = require('node:path')

function loadSecret() {
  try {
    const env = fs.readFileSync(path.resolve(__dirname, '../../.env.local'), 'utf8')
    const m = env.match(/^JWT_SECRET\s*=\s*(\S+)\s*$/m)
    if (m) return m[1]
  } catch {
    // ignore — falls back below
  }
  return 'test-secret-for-dev-only-32chars'
}

const role = process.argv[2] || 'OWNER'
const tenant = process.argv[3] || '00000000-0000-0000-0000-000000000001'
const subject = role === 'ADMIN' ? 'admin-user' : 'demo-owner'
const token = jwt.sign(
  {
    sub: subject,
    userId: subject,
    tenantId: tenant,
    role,
    permissions: [],
    propertyAccess: ['*'],
    exp: Math.floor(Date.now() / 1000) + 3600,
  },
  loadSecret(),
  { algorithm: 'HS256' },
)
process.stdout.write(token)
