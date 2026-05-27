/**
 * Graph Initialization Script
 *
 * Run once to set up Neo4j constraints, indexes, and fulltext search.
 * Idempotent — safe to run multiple times.
 *
 * Usage: pnpm --filter @borjie/graph-sync graph:init
 */

import { createNeo4jClient } from '../client/neo4j-client.js';
import { applyConstraintsAndIndexes } from '../schema/constraints.js';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════'); // eslint-disable-line no-console -- init script CLI banner
  console.log('  Borjie — Canonical Property Graph Initialization'); // eslint-disable-line no-console -- init script CLI banner
  console.log('═══════════════════════════════════════════════════════════════'); // eslint-disable-line no-console -- init script CLI banner
  console.log('');

  const client = createNeo4jClient();

  // Verify connectivity
  console.log('Connecting to Neo4j...');
  const connected = await client.verifyConnectivity();
  if (!connected) {
    console.error('Failed to connect to Neo4j. Check your connection settings.');
    process.exit(1);
  }

  const health = await client.healthCheck();
  console.log(`Connected to Neo4j (protocol: ${health.serverVersion}, database: ${health.database})`);
  console.log('');

  // Apply constraints and indexes
  console.log('Applying constraints and indexes...');
  try {
    // SCHEMA-MGMT: admin-bootstrap, not tenant-scoped — DO NOT use for data-plane queries
    // Pass the Neo4jClient directly so every DDL statement routes through
    // `runSchemaQuery` (explicit tenant-bypass) instead of a bare session.
    const result = await applyConstraintsAndIndexes(client);

    console.log('');
    console.log('Results:');
    console.log(`  Uniqueness constraints: ${result.constraintsCreated}`);
    console.log(`  Performance indexes:    ${result.indexesCreated}`);
    console.log(`  Fulltext indexes:       ${result.fulltextIndexesCreated}`);

    if (result.errors.length > 0) {
      console.log('');
      console.log('Warnings:');
      for (const err of result.errors) {
        console.log(`  ⚠ ${err}`);
      }
    }

    console.log('');
    console.log('Graph initialization complete.');
  } finally {
    await client.close();
  }
}

main().catch(err => {
  console.error('Initialization failed:', err);
  process.exit(1);
});
