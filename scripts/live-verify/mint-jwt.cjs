/**
 * scripts/live-verify/mint-jwt.cjs
 *
 * Helper: mint a HS256 JWT for live-verify probes against the
 * api-gateway. Secret is read from `.env.local` (matches the running
 * gateway), falling back to the deterministic dev value.
 *
 * Roles supported: OWNER | ADMIN | MANAGER | WORKER | BUYER.
 *
 * Examples
 *   node scripts/live-verify/mint-jwt.cjs OWNER
 *   node scripts/live-verify/mint-jwt.cjs ADMIN 00000000-0000-0000-0000-000000000001
 *   node scripts/live-verify/mint-jwt.cjs MANAGER
 */
const jwt = require('jsonwebtoken')
const fs = require('node:fs')
const path = require('node:path')

const VALID_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'WORKER', 'BUYER']

function loadSecret() {
  const candidates = [
    path.resolve(__dirname, '../../.env.local'),
    path.resolve(__dirname, '../../services/api-gateway/.env.local'),
  ]
  for (const file of candidates) {
    try {
      const env = fs.readFileSync(file, 'utf8')
      const m = env.match(/^JWT_SECRET\s*=\s*(\S+)\s*$/m)
      if (m && m[1]) return m[1]
    } catch {
      // Try next file.
    }
  }
  return 'test-secret-for-dev-only-32chars'
}

function subjectFor(role) {
  switch (role) {
    case 'ADMIN':
      return 'admin-user'
    case 'MANAGER':
      return 'demo-manager'
    case 'WORKER':
      return 'demo-worker'
    case 'BUYER':
      return 'demo-buyer'
    case 'OWNER':
    default:
      return 'demo-owner'
  }
}

function mint(role, tenantId, ttlSeconds = 3600) {
  const normalised = (role || 'OWNER').toUpperCase()
  if (!VALID_ROLES.includes(normalised)) {
    throw new Error(`Unsupported role: ${role}. Use one of ${VALID_ROLES.join(', ')}`)
  }
  const subject = subjectFor(normalised)
  return jwt.sign(
    {
      sub: subject,
      userId: subject,
      tenantId: tenantId || '00000000-0000-0000-0000-000000000001',
      role: normalised,
      permissions: [],
      propertyAccess: ['*'],
      exp: Math.floor(Date.now() / 1000) + ttlSeconds,
    },
    loadSecret(),
    { algorithm: 'HS256' },
  )
}

// CLI mode
if (require.main === module) {
  const role = process.argv[2] || 'OWNER'
  const tenant = process.argv[3] || '00000000-0000-0000-0000-000000000001'
  process.stdout.write(mint(role, tenant))
}

module.exports = { mint, loadSecret, VALID_ROLES }
