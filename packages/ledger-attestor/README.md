# @borjie/ledger-attestor (LP-19)

Tamper-evidence control for the royalty/treasury **ledger** and the AI
**audit chain**. It folds a hash-chain segment into a single Merkle
root, signs the root, and publishes the signed checkpoint to a
write-once external store. An attacker who later edits a ledger row
cannot also rewrite the historical signed roots that would expose the
edit — so any tampering becomes detectable after the fact.

Builds on [`@borjie/audit-hash-chain`](../audit-hash-chain) (reuses its
`canonicalJson` so the Merkle leaves and the signed checkpoint are
byte-stable across both packages).

## What it does

1. **Merkle root** (`computeMerkleRoot`) — binary SHA-256 tree with RFC
   6962 leaf/node domain separation (`0x00`/`0x01` prefixes), lone-tail
   promotion (no CVE-2012-2459 duplicate-last-node). Leaves are the
   per-row `rowHash` (audit chain) or `this_hash` (ledger) in append
   order.
2. **Sign** (`SignerPort`) — the canonical checkpoint bytes are signed.
   A zero-dependency Ed25519 signer ships for dev/test
   (`createEd25519Signer`); **production injects a KMS/HSM-backed
   `SignerPort`** so the private key never lives in process memory.
3. **Publish** (`ExternalSinkPort`) — pluggable WORM sink. Ships an S3
   Object-Lock sink (`createS3ObjectLockSink`) whose actual `PutObject`
   is injected (`ObjectPutPort`), so this package stays free of the AWS
   SDK. The same port shape fits a transparency-log adapter (Rekor /
   Trillian) — fan out to several sinks at once.

`runAttestation` is pure orchestration over those ports: it verifies
leaf contiguity before signing, **skips chains whose root has not
advanced** (cheap idempotent re-runs), chains `prevRoot` across runs,
and **isolates per-chain failures** so one bad chain never poisons the
batch.

## Cron wiring (runs hourly)

The attestor is a **read-only periodic job** (LITFIN
`ARCHITECTURE-LEDGER-ISOLATION.md`, Step 4). In Borjie it runs inside
the **consolidation-worker** (`services/consolidation-worker`), the
same supervisor that already runs the OCR poll and owner-brief crons
via `setInterval` in `src/index.ts`. Add a `ChainSourcePort` that reads
`ledger_entries` (and/or `ai_audit_chain`) **against the primary DB,
read-only**, plus a durable `CheckpointStorePort` (a new
`ledger_attestations` table) and a real S3/KMS adapter, then:

```ts
// services/consolidation-worker/src/tasks/ledger-attestor-cron.ts
import {
  runAttestation,
  createS3ObjectLockSink,
  type ChainSourcePort,
  type ObjectPutPort,
  type SignerPort,
  type CheckpointStorePort,
} from '@borjie/ledger-attestor';
import { logger } from '../logger.js';

export interface LedgerAttestorCronDeps {
  readonly source: ChainSourcePort;          // SELECT id, account_id, sequence_number, this_hash
                                              //   FROM ledger_entries ORDER BY account_id, sequence_number
                                              //   (read replica / read-only role)
  readonly signer: SignerPort;                // KMS/HSM signer in prod
  readonly objectPut: ObjectPutPort;          // wraps @aws-sdk/client-s3 PutObjectCommand
                                              //   with ObjectLockMode + ObjectLockRetainUntilDate
  readonly store: CheckpointStorePort;        // ledger_attestations append/latestFor
}

export async function runLedgerAttestorCron(deps: LedgerAttestorCronDeps) {
  const sink = createS3ObjectLockSink(deps.objectPut, {
    bucket: process.env.LEDGER_ATTEST_BUCKET ?? '',
    prefix: 'ledger-attestations',
    retentionDays: 365 * 7,        // regulator retention
    retentionMode: 'COMPLIANCE',   // immutable even to root
  });
  const result = await runAttestation({
    source: deps.source,
    signer: deps.signer,
    sinks: [sink],
    store: deps.store,
    logger,
  });
  if (result.failed > 0) {
    logger.error({ result }, 'ledger-attestor: one or more chains FAILED attestation');
  } else {
    logger.info(
      { attested: result.attested, skipped: result.skippedUnchanged, scanned: result.scanned },
      'ledger-attestor: tick complete',
    );
  }
  return result;
}
```

Register it on an **hourly** interval next to the existing crons in
`services/consolidation-worker/src/index.ts`:

```ts
import { runLedgerAttestorCron } from './tasks/ledger-attestor-cron.js';

const ATTEST_INTERVAL_MS = 60 * 60 * 1000; // hourly
const attestorHandle = setInterval(
  () => void runLedgerAttestorCron(attestorDeps).catch((err) =>
    logger.error({ err }, 'ledger-attestor cron threw'),
  ),
  ATTEST_INTERVAL_MS,
);
attestorHandle.unref?.();
// fire once on boot so a fresh deploy has an immediate checkpoint
void runLedgerAttestorCron(attestorDeps).catch(() => undefined);
```

> The `source` MUST connect with a **read-only** DB role (replica or a
> read-only grant) — the attestor never writes ledger rows. The only
> mutation it performs is `store.append` into `ledger_attestations`.

## Registration

This is a new workspace package. Other `@borjie/*` packages resolve
each other via pnpm workspace symlinks
(`node_modules/@borjie/<pkg> -> ../../../<pkg>`). After merge, run
`pnpm install` at the repo root so the lockfile records
`@borjie/ledger-attestor` and any consumer (the consolidation-worker)
can `import` it. Add `@borjie/ledger-attestor: "workspace:*"` to the
consumer's `package.json` dependencies.

## Verification

```
tsc        # clean
vitest run # 26 passing (merkle, ed25519, attestor, s3-object-lock)
```
