import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The Vercel function runs as plain Node ESM, which needs the `.js` ending on
// every relative import that is kept at run time. One missing ending stops
// the whole function from loading, so every request (sign-in too) fails
// with a 500. Type-only imports are removed when compiled and may omit it.
const IMPORT = /^(?:import|export)\s+(type\s+)?[^;]*?from\s+'(\.[^']+)'/gms;

const reachable = (entry: string) => {
  const seen = new Set<string>();
  const missing: string[] = [];
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const [, typeOnly, spec] of fs.readFileSync(file, 'utf8').matchAll(IMPORT)) {
      if (typeOnly) continue;
      if (!spec.endsWith('.js')) missing.push(`${file}: '${spec}'`);
      const base = path.join(path.dirname(file), spec.replace(/\.js$/, ''));
      const next = ['.ts', '.tsx'].map(ext => base + ext).find(f => fs.existsSync(f));
      if (next) walk(next);
    }
  };
  walk(entry);
  return { seen, missing };
};

test('everything the Vercel function loads imports with a .js ending', () => {
  const { seen, missing } = reachable('api/proxy.ts');
  assert.ok(seen.has(path.join('server', 'api.ts')));
  assert.deepEqual(missing, []);
});
