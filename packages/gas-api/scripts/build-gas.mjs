#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const entryPoint = path.join(pkgRoot, 'src/main.ts');
const mockEntry = path.join(pkgRoot, 'src/testing/MockSpreadsheetApp.ts');
const distDir = path.join(pkgRoot, 'dist');
const outFile = path.join(distDir, 'Code.gs');
const localMockBundle = path.join(distDir, 'mock-env.mjs');
const manifestSrc = path.join(pkgRoot, 'appsscript.json');
const manifestDest = path.join(distDir, 'appsscript.json');

fs.mkdirSync(distDir, { recursive: true });

await build({
  entryPoints: [entryPoint],
  bundle: true,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2020',
  format: 'iife',
  globalName: '__AppIcolGas',
  charset: 'utf8',
  outfile: outFile,
  footer: {
    js: [
      'function doGet(e) { return __AppIcolGas.handleDoGet(e); }',
      'function doPost(e) { return __AppIcolGas.handleDoPost(e); }',
      'function inspectSheetStructure() { return __AppIcolGas.inspectSheetStructureImpl(); }',
    ].join('\n'),
  },
});

if (fs.existsSync(mockEntry)) {
  await build({
    entryPoints: [mockEntry],
    bundle: true,
    platform: 'neutral',
    mainFields: ['module', 'main'],
    target: 'es2020',
    format: 'esm',
    charset: 'utf8',
    outfile: localMockBundle,
  });
}

if (fs.existsSync(manifestSrc)) {
  fs.copyFileSync(manifestSrc, manifestDest);
}

const bundled = fs.readFileSync(outFile, 'utf8');
if (
  !bundled.includes('function doPost(e)') ||
  !bundled.includes('function inspectSheetStructure()')
) {
  throw new Error(
    'Invalid GAS bundle: missing top-level doPost(e) or inspectSheetStructure() declarations.',
  );
}

console.log(`[gas-api] Built ${path.relative(process.cwd(), outFile)} (${bundled.length} bytes)`);
