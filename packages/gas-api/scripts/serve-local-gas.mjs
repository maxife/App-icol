#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(scriptDir, '..');
const distCodeGs = path.join(pkgRoot, 'dist/Code.gs');
const distMockEnv = path.join(pkgRoot, 'dist/mock-env.mjs');
const buildScript = path.join(scriptDir, 'build-gas.mjs');

function parseCliPort(argv) {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--port' && argv[i + 1]) {
      const parsed = Number(argv[i + 1]);
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        return parsed;
      }
    }
    if (arg?.startsWith('--port=')) {
      const parsed = Number(arg.slice('--port='.length));
      if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
        return parsed;
      }
    }
  }
  const envPort = Number(process.env.PORT || '8787');
  return Number.isInteger(envPort) && envPort > 0 ? envPort : 8787;
}

function ensureBuiltArtifacts() {
  const srcMain = path.join(pkgRoot, 'src/main.ts');
  const srcRepo = path.join(pkgRoot, 'src/sheets/SheetsRepository.ts');
  const srcMock = path.join(pkgRoot, 'src/testing/MockSpreadsheetApp.ts');

  const needsBuild =
    !fs.existsSync(distCodeGs) ||
    !fs.existsSync(distMockEnv) ||
    fs.statSync(distCodeGs).mtimeMs < fs.statSync(srcMain).mtimeMs ||
    fs.statSync(distCodeGs).mtimeMs < fs.statSync(srcRepo).mtimeMs ||
    fs.statSync(distMockEnv).mtimeMs < fs.statSync(srcMock).mtimeMs;

  if (needsBuild) {
    const res = spawnSync(process.execPath, [buildScript], {
      cwd: pkgRoot,
      env: process.env,
      stdio: 'inherit',
    });
    if (res.status !== 0) {
      process.exit(res.status ?? 1);
    }
  }
}

ensureBuiltArtifacts();

const { installMockGasEnvironment } = await import(
  pathToFileURL(distMockEnv).href
);

const spreadsheetId =
  process.env.SPREADSHEET_ID ?? 'mock-vente-et-reservations-miel';
const scriptProperties = {
  SPREADSHEET_ID: spreadsheetId,
  GOOGLE_CLIENT_ID:
    process.env.GOOGLE_CLIENT_ID ??
    'app-icol-e2e-client.apps.googleusercontent.com',
  MANAGER_EMAILS:
    process.env.MANAGER_EMAILS ??
    'gestionnaire@app-icol.test,apiculteur@app-icol.test',
  CONTRIBUTOR_EMAILS:
    process.env.CONTRIBUTOR_EMAILS ?? 'covendeur@app-icol.test',
  ALLOW_MOCK_GIS_TOKENS: process.env.ALLOW_MOCK_GIS_TOKENS ?? 'true',
  ...(process.env.SCHEMA_OVERRIDES_JSON !== undefined
    ? { SCHEMA_OVERRIDES_JSON: process.env.SCHEMA_OVERRIDES_JSON }
    : {}),
};

installMockGasEnvironment({
  spreadsheetId,
  scriptProperties,
});

// Load the real compiled V8 Apps Script bundle (dist/Code.gs) into a VM context sharing global GAS services
const gasVmContext = vm.createContext({
  SpreadsheetApp: globalThis.SpreadsheetApp,
  PropertiesService: globalThis.PropertiesService,
  CacheService: globalThis.CacheService,
  LockService: globalThis.LockService,
  ContentService: globalThis.ContentService,
  console,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Boolean,
  RegExp,
  Error,
  TypeError,
  RangeError,
  Map,
  Set,
  Promise,
  encodeURIComponent,
  decodeURIComponent,
  parseInt,
  parseFloat,
  isNaN,
  isFinite,
});

const codeGsSource = fs.readFileSync(distCodeGs, 'utf8');
vm.runInContext(codeGsSource, gasVmContext, { filename: 'Code.gs' });

const host = process.env.HOST || '127.0.0.1';
const port = parseCliPort(process.argv.slice(2));

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url || '/', `http://${host}:${port}`);

  if (reqUrl.pathname !== '/exec') {
    res.writeHead(404, corsHeaders);
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: 'NOT_FOUND', message: `Route inconnue: ${reqUrl.pathname}` },
      }),
    );
    return;
  }

  // Real Google Apps Script Web Apps do NOT support CORS preflight OPTIONS on /exec
  if (req.method === 'OPTIONS') {
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method OPTIONS not supported on Apps Script /exec');
    return;
  }

  if (req.method === 'GET') {
    const out = gasVmContext.doGet({});
    res.writeHead(200, corsHeaders);
    res.end(out.getContent());
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, corsHeaders);
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Méthode HTTP non supportée.' },
      }),
    );
    return;
  }

  const chunks = [];
  req.on('data', (chunk) => chunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const contentType = String(req.headers['content-type'] || 'text/plain');
    try {
      const textOutput = gasVmContext.doPost({
        postData: {
          contents: rawBody,
          length: Buffer.byteLength(rawBody, 'utf8'),
          type: contentType,
          name: 'postData',
        },
        parameter: {},
        parameters: {},
        contextPath: '',
        contentLength: Buffer.byteLength(rawBody, 'utf8'),
      });
      res.writeHead(200, corsHeaders);
      res.end(textOutput.getContent());
    } catch (err) {
      res.writeHead(200, corsHeaders);
      res.end(
        JSON.stringify({
          ok: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: err instanceof Error ? err.message : String(err),
          },
        }),
      );
    }
  });
});

server.listen(port, host, () => {
  console.log(`[gas-local] Listening on http://${host}:${port}/exec`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
