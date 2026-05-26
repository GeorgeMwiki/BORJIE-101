#!/usr/bin/env node
// =============================================================================
// audit-zero-hardcoded.mjs
// =============================================================================
// Walks src/, services/ and apps/ looking for literal secret prefixes:
//   - sk-ant-      (Anthropic API key)
//   - sk-proj-     (OpenAI project key)
//   - sbp_         (Supabase service key prefix)
//   - eyJhbGci     (JWT header preamble)
// Skips .env.example and any node_modules / dist / build directories.
// Fails CI with exit 1 if any match is found.
// =============================================================================

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

const REPO_ROOT = process.cwd();
const SCAN_ROOTS = ['src', 'services', 'apps'].map((r) => join(REPO_ROOT, r));

const SECRET_PATTERNS = [
  { name: 'anthropic', re: /sk-ant-[A-Za-z0-9_\-]{8,}/g },
  { name: 'openai-proj', re: /sk-proj-[A-Za-z0-9_\-]{8,}/g },
  { name: 'supabase-sbp', re: /sbp_[A-Za-z0-9]{20,}/g },
  { name: 'jwt-header', re: /eyJhbGci[A-Za-z0-9_\-]{8,}/g },
];

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'build',
  '.next',
  '.turbo',
  '.cache',
  'coverage',
  '.git',
]);

const SKIP_FILE_NAMES = new Set(['.env.example']);

const TEXT_EXTS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.yml',
  '.yaml',
  '.md',
  '.txt',
  '.sh',
  '.env',
  '.toml',
]);

const isSkippedFile = (name) => {
  if (SKIP_FILE_NAMES.has(name)) return true;
  if (name.endsWith('.env.example')) return true;
  return false;
};

const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      return [];
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) return [];
      return walk(full);
    }
    if (!stat.isFile()) return [];
    if (isSkippedFile(entry)) return [];
    const ext = extname(entry);
    if (ext && !TEXT_EXTS.has(ext)) return [];
    return [full];
  });
};

const main = () => {
  const files = SCAN_ROOTS.flatMap((root) => walk(root));
  const findings = [];

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      const matches = content.match(re);
      if (matches) {
        findings.push({
          file: relative(REPO_ROOT, file),
          pattern: name,
          count: matches.length,
        });
      }
    }
  }

  const summary = {
    scannedFiles: files.length,
    findingCount: findings.length,
  };
  console.log(`[zero-hardcoded] summary=${JSON.stringify(summary)}`);

  if (findings.length > 0) {
    console.error('[zero-hardcoded] FAIL: literal secret prefixes detected:');
    for (const f of findings) {
      console.error(`  - ${f.file} [${f.pattern}] x${f.count}`);
    }
    console.error('[zero-hardcoded] Move secrets to environment variables and rotate any exposed keys.');
    process.exit(1);
  }

  console.log('[zero-hardcoded] OK - no literal secret prefixes found.');
  process.exit(0);
};

main();
