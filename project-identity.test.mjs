#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const excludedPaths = new Set([
  '.git',
  '.serena',
  '.superpowers',
  'node_modules',
  'config/profile.yml',
  'modes/_profile.md',
  'project-identity.test.mjs',
  'sources.yml',
]);
const excludedPrefixes = [
  'apps/web/dist/',
  'apps/web/vite.config.ts.timestamp-',
  'data/',
  'docs/superpowers/',
  'reports/',
];
const textExtensions = new Set(['', '.cjs', '.css', '.go', '.html', '.js', '.json', '.md', '.mjs', '.mts', '.sh', '.ts', '.tsx', '.txt', '.yml', '.yaml']);
const oldIdentity = /gig-ops|gig_ops|gigops/i;

function isExcluded(repoPath) {
  return excludedPaths.has(repoPath)
    || excludedPrefixes.some((prefix) => repoPath.startsWith(prefix));
}

function collectFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    const repoPath = relative(root, path);
    if (isExcluded(repoPath)) return [];
    if (statSync(path).isDirectory()) return collectFiles(path);
    return textExtensions.has(extname(path)) ? [path] : [];
  });
}

assert.equal(basename(root), 'gig-pilot', 'checkout directory must be named gig-pilot');
assert.equal(
  JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).name,
  'gig-pilot',
  'package name must be gig-pilot',
);

const staleReferences = collectFiles(root).flatMap((path) => {
  const repoPath = relative(root, path);
  return readFileSync(path, 'utf8').split('\n').flatMap((line, index) => (
    oldIdentity.test(line) ? [`${repoPath}:${index + 1}: ${line.trim()}`] : []
  ));
});

assert.deepEqual(staleReferences, [], `stale project identity references:\n${staleReferences.join('\n')}`);
