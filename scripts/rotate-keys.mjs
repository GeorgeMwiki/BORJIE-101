#!/usr/bin/env node
/**
 * rotate-keys.mjs — generate a new HMAC root and print the rollout
 * choreography for the dual-key rotation pattern documented in
 * `Docs/SECRETS_ROTATION.md`.
 *
 * This script does NOT mutate live secret stores by itself — that
 * step is operator-controlled (kubectl / vault / GitHub Actions
 * secrets / .env). It produces:
 *
 *   1. A new high-entropy secret value (32 bytes, base64url).
 *   2. The exact `kubectl` / `gh secret set` / shell-export commands
 *      to enact the 4-phase rotation: pre-stage / cut-over / soak /
 *      retire.
 *   3. A JSON manifest written to stdout (or to a `--out=<file>`
 *      argument) so the rotation can be tracked / audited.
 *
 * Usage:
 *   node scripts/rotate-keys.mjs --name=AUDIT_HMAC_KEY
 *   node scripts/rotate-keys.mjs --name=WEBHOOK_SIGNING_KEY --bytes=64
 *   node scripts/rotate-keys.mjs --name=AUDIT_HMAC_KEY --out=rotation.json
 *
 * Exit codes:
 *   0 — manifest printed successfully
 *   1 — usage / argument error
 *   2 — crypto / FS failure
 */

import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';

const USAGE = `Usage:
  node scripts/rotate-keys.mjs --name=<ENV_VAR> [--bytes=32] [--out=<file>] [--encoding=base64url|hex]

Flags:
  --name        REQUIRED. Env var name for the HMAC root (e.g. AUDIT_HMAC_KEY).
  --bytes       Optional. Number of random bytes (default 32 — 256 bits).
  --out         Optional. Path to write the JSON rotation manifest.
                When omitted, the manifest is printed to stdout.
  --encoding    Optional. base64url (default) or hex.
`;

function parseArgs(argv) {
  const args = {};
  for (const raw of argv.slice(2)) {
    if (!raw.startsWith('--')) continue;
    const eq = raw.indexOf('=');
    if (eq === -1) {
      args[raw.slice(2)] = true;
    } else {
      args[raw.slice(2, eq)] = raw.slice(eq + 1);
    }
  }
  return args;
}

const args = parseArgs(argv);

if (args.help || args.h) {
  stdout.write(USAGE);
  exit(0);
}

const name = args.name;
if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
  process.stderr.write(`ERROR: --name must be a SCREAMING_SNAKE env var\n\n`);
  process.stderr.write(USAGE);
  exit(1);
}

const bytes = Number.parseInt(args.bytes ?? '32', 10);
if (!Number.isFinite(bytes) || bytes < 16 || bytes > 128) {
  process.stderr.write(
    `ERROR: --bytes must be an integer in [16, 128] (got ${args.bytes})\n`,
  );
  exit(1);
}

const encoding = (args.encoding ?? 'base64url').toLowerCase();
if (encoding !== 'base64url' && encoding !== 'hex') {
  process.stderr.write(
    `ERROR: --encoding must be 'base64url' or 'hex' (got ${args.encoding})\n`,
  );
  exit(1);
}

let newSecret;
try {
  newSecret = randomBytes(bytes).toString(encoding);
} catch (err) {
  process.stderr.write(`ERROR: crypto.randomBytes failed: ${err.message}\n`);
  exit(2);
}

const prevName = `${name}_PREV`;
const generatedAt = new Date().toISOString();
const soakEndsAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
const retireAfter = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

const manifest = {
  schemaVersion: '1.0.0',
  envVarName: name,
  prevEnvVarName: prevName,
  generatedAt,
  soakEndsAt,
  retireAfter,
  bytes,
  encoding,
  newSecret,
  // NEVER include the previous secret here — the operator copies it
  // out of the live secret store at pre-stage time. Including it
  // would create a single artefact that contains both keys.
  rollout: {
    phase1_preStage: [
      `# Copy the CURRENT value of ${name} into ${prevName}`,
      `# (replace 'CURRENT_VALUE_FROM_LIVE_STORE' with the actual value)`,
      `kubectl create secret generic borjie-secrets \\`,
      `  --dry-run=client -o yaml \\`,
      `  --from-literal=${prevName}="CURRENT_VALUE_FROM_LIVE_STORE" \\`,
      `  --from-literal=${name}="${newSecret}" \\`,
      `  | kubectl apply -n borjie -f -`,
      '',
      `# GitHub Actions:`,
      `gh secret set ${prevName} --body "CURRENT_VALUE_FROM_LIVE_STORE"`,
      `gh secret set ${name} --body "${newSecret}"`,
    ],
    phase2_cutOver: [
      `# Trigger a rolling restart so all replicas pick up both env vars`,
      `kubectl rollout restart deployment -n borjie`,
      `# New signatures are written with the new key.`,
      `# Verify reads accept either current OR previous key.`,
    ],
    phase3_soak: [
      `# 24h overlap window — until ${soakEndsAt}`,
      `# Monitor:`,
      `#   - audit-log verification failures (rate must be 0)`,
      `#   - webhook signature failures (rate must be 0)`,
      `#   - JWT verify failures (rate must be 0)`,
    ],
    phase4_retire: [
      `# After soak window (>= ${retireAfter}) — remove the previous key.`,
      `kubectl create secret generic borjie-secrets \\`,
      `  --dry-run=client -o yaml \\`,
      `  --from-literal=${name}="${newSecret}" \\`,
      `  | kubectl apply -n borjie -f -`,
      `gh secret delete ${prevName}`,
    ],
  },
  verificationCommands: [
    `# Confirm both keys are live during soak:`,
    `kubectl exec -n borjie deploy/api-gateway -- env | grep ${name}`,
    `# Should show both ${name} and ${prevName} during phases 2-3.`,
  ],
};

const out = JSON.stringify(manifest, null, 2) + '\n';

if (args.out) {
  try {
    writeFileSync(args.out, out, { mode: 0o600 });
    stdout.write(
      `Wrote rotation manifest to ${args.out} (chmod 600).\n` +
        `New ${name} value is stored ONLY in that file — protect it.\n`,
    );
  } catch (err) {
    process.stderr.write(`ERROR: failed to write ${args.out}: ${err.message}\n`);
    exit(2);
  }
} else {
  stdout.write(out);
}

stdout.write(
  `\nNext steps:\n` +
    `  1. Pre-stage: copy live ${name} -> ${prevName}, set ${name} = new value (phase1 commands).\n` +
    `  2. Cut-over:  rolling restart (phase2 commands).\n` +
    `  3. Soak:      24h overlap; monitor verify-failure metrics.\n` +
    `  4. Retire:    drop ${prevName} after ${retireAfter} (phase4 commands).\n` +
    `\nSee Docs/SECRETS_ROTATION.md for the full runbook.\n`,
);

exit(0);
