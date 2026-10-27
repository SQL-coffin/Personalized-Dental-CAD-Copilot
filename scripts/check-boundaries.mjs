#!/usr/bin/env node
/**
 * Module boundary check. Enforces the dependency direction recorded in
 * docs/architecture/adr/0001-workspace-modules.md:
 *
 *   contracts ← data ← agent-tools ← runtime → research → data
 *                            ↑
 *                     integrations
 *   apps/web/src/ui  → contracts only
 *   apps/web/src/app → contracts, runtime, integrations (composition root)
 *
 * Checks, for every source file:
 *   1. @cadcopilot/* imports are allowed for the file's layer;
 *   2. relative imports do not leave the layer's directory;
 *   3. third-party imports are on the layer's allow-list (domain packages
 *      may import only `vitest`, and only from test files);
 *   4. every @cadcopilot/* import is declared in the owning package.json.
 *
 * Usage: node scripts/check-boundaries.mjs
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const WEB_THIRD_PARTY = ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'];
const WEB_TEST_THIRD_PARTY = ['vitest', '@testing-library/react', '@testing-library/user-event', '@testing-library/jest-dom', '@testing-library/jest-dom/vitest'];

/** Ordered from most to least specific directory. */
const LAYERS = [
  { name: 'contracts', dir: 'packages/contracts/src', manifest: 'packages/contracts/package.json', internal: [] },
  { name: 'data', dir: 'packages/data/src', manifest: 'packages/data/package.json', internal: ['@cadcopilot/contracts'] },
  {
    name: 'agent-tools',
    dir: 'packages/agent-tools/src',
    manifest: 'packages/agent-tools/package.json',
    internal: ['@cadcopilot/contracts', '@cadcopilot/data'],
  },
  {
    name: 'research',
    dir: 'packages/research/src',
    manifest: 'packages/research/package.json',
    internal: ['@cadcopilot/contracts', '@cadcopilot/data'],
  },
  {
    name: 'runtime',
    dir: 'packages/runtime/src',
    manifest: 'packages/runtime/package.json',
    internal: ['@cadcopilot/contracts', '@cadcopilot/data', '@cadcopilot/agent-tools', '@cadcopilot/research'],
  },
  {
    name: 'integrations',
    dir: 'packages/integrations/src',
    manifest: 'packages/integrations/package.json',
    internal: ['@cadcopilot/contracts', '@cadcopilot/agent-tools'],
  },
  {
    name: 'web/ui',
    dir: 'apps/web/src/ui',
    manifest: 'apps/web/package.json',
    internal: ['@cadcopilot/contracts'],
    thirdParty: WEB_THIRD_PARTY,
    testThirdParty: WEB_TEST_THIRD_PARTY,
  },
  {
    name: 'web/app',
    dir: 'apps/web/src/app',
    manifest: 'apps/web/package.json',
    internal: ['@cadcopilot/contracts', '@cadcopilot/runtime', '@cadcopilot/integrations'],
    thirdParty: WEB_THIRD_PARTY,
    testThirdParty: WEB_TEST_THIRD_PARTY,
    // The composition root renders the product UI.
    relativeAlso: ['apps/web/src/ui'],
  },
  {
    name: 'web/entry',
    dir: 'apps/web/src',
    manifest: 'apps/web/package.json',
    internal: [],
    thirdParty: WEB_THIRD_PARTY,
    testThirdParty: WEB_TEST_THIRD_PARTY,
    relativeAlso: [],
  },
];

const SOURCE = /\.(ts|tsx|mts|mjs)$/;
const isTestFile = (file) => /\.test\.(ts|tsx)$/.test(file) || file.includes(`${sep}test${sep}`);

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SOURCE.test(entry)) out.push(full);
  }
  return out;
}

function specifiers(source) {
  const found = new Set();
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const patterns = [
    /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,]+?\s+from\s+)?['"]([^'"]+)['"]/g,
    /import\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of stripped.matchAll(re)) found.add(m[1]);
  return [...found];
}

function layerOf(file) {
  const rel = relative(ROOT, file).split(sep).join('/');
  return LAYERS.find((l) => rel === l.dir || rel.startsWith(`${l.dir}/`));
}

const violations = [];
const declared = new Map();

for (const layer of LAYERS) {
  const files = walk(join(ROOT, layer.dir)).filter((f) => layerOf(f) === layer);
  if (files.length === 0) continue;
  const manifest = JSON.parse(readFileSync(join(ROOT, layer.manifest), 'utf8'));
  const deps = { ...manifest.dependencies, ...manifest.devDependencies };
  for (const file of files) {
    const rel = relative(ROOT, file);
    const test = isTestFile(file);
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const target = relative(ROOT, resolve(dirname(file), spec)).split(sep).join('/');
        const allowedRoots = [layer.dir, ...(layer.relativeAlso ?? [])];
        // The web entry layer (main.tsx, test setup) may reach into app/ui.
        const entryOk = layer.name === 'web/entry' && target.startsWith('apps/web/src/');
        if (!entryOk && !allowedRoots.some((r) => target === r || target.startsWith(`${r}/`))) {
          violations.push(`${rel}: relative import "${spec}" leaves ${layer.dir}`);
        }
        continue;
      }
      if (spec.startsWith('node:')) {
        violations.push(`${rel}: Node built-in "${spec}" is not allowed in shared source`);
        continue;
      }
      if (spec.startsWith('@cadcopilot/')) {
        const pkg = spec.split('/').slice(0, 2).join('/');
        if (!layer.internal.includes(pkg)) {
          violations.push(`${rel}: ${layer.name} may not import ${pkg}`);
        } else if (!deps[pkg]) {
          violations.push(`${rel}: imports ${pkg} but ${layer.manifest} does not declare it`);
        }
        if (!test) declared.set(layer.manifest, new Set([...(declared.get(layer.manifest) ?? []), pkg]));
        continue;
      }
      const allowed = [...(layer.thirdParty ?? []), ...(test ? (layer.testThirdParty ?? ['vitest']) : [])];
      if (!allowed.includes(spec)) {
        violations.push(`${rel}: third-party import "${spec}" is not allowed in ${layer.name}${test ? ' tests' : ''}`);
      }
    }
  }
}

// A package must not declare internal dependencies its layer is not allowed to use.
for (const layer of LAYERS.filter((l) => l.dir.startsWith('packages/'))) {
  const path = join(ROOT, layer.manifest);
  if (!existsSync(path)) continue;
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (dep.startsWith('@cadcopilot/') && !layer.internal.includes(dep)) {
      violations.push(`${layer.manifest}: declares ${dep}, which ${layer.name} may not depend on`);
    }
  }
}

if (violations.length > 0) {
  console.error(`Module boundary check failed (${violations.length}):`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
const checked = LAYERS.filter((l) => existsSync(join(ROOT, l.dir))).map((l) => l.name);
console.log(`Module boundaries OK (${checked.join(', ')})`);
