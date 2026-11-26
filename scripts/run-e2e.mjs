#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_SCRATCH_BASE =
  '/home/antigravity/.gemini/jetski/scratch/teamwork_tmp';
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function allocateFreeLocalPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

function hasAnySpecFiles(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && hasAnySpecFiles(fullPath)) return true;
    if (entry.isFile() && /\.spec\.[cm]?[jt]sx?$/.test(entry.name)) return true;
  }
  return false;
}

const scratchBase = process.env.APP_ICOL_SCRATCH_ROOT || DEFAULT_SCRATCH_BASE;
const runTmpDir = path.join(scratchBase, `r-${process.pid}`);
fs.mkdirSync(runTmpDir, { recursive: true, mode: 0o700 });

function cleanup() {
  try {
    fs.rmSync(runTmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup race errors
  }
}
process.on('exit', cleanup);

try {
  const extraArgs = process.argv.slice(2);
  const isListOnly = extraArgs.includes('--list');

  const e2ePort = process.env.E2E_PORT
    ? Number(process.env.E2E_PORT)
    : await allocateFreeLocalPort();
  const e2eBaseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${e2ePort}`;

  const childEnv = {
    ...process.env,
    TMPDIR: runTmpDir,
    TMP: runTmpDir,
    TEMP: runTmpDir,
    E2E_PORT: String(e2ePort),
    E2E_BASE_URL: e2eBaseUrl,
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/ms-playwright',
  };

  const webDistIndex = path.join(rootDir, 'packages/web/dist/index.html');
  const shouldBuild =
    !isListOnly &&
    (process.env.E2E_SKIP_BUILD !== '1' || !fs.existsSync(webDistIndex));

  if (shouldBuild && process.env.E2E_EXTERNAL_SERVER !== '1') {
    const buildRes = spawnSync('npm', ['run', 'build:workspaces'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: childEnv,
    });
    if (buildRes.status !== 0) {
      process.exit(buildRes.status ?? 1);
    }
  }

  const e2eDir = path.join(rootDir, 'e2e');
  if (
    extraArgs.length === 0 &&
    !hasAnySpecFiles(e2eDir) &&
    process.env.E2E_REQUIRE_TESTS !== '1'
  ) {
    console.log(
      '[run-e2e] No E2E spec files present in ./e2e yet — build verified cleanly.',
    );
    process.exit(0);
  }

  const pwRes = spawnSync('npx', ['playwright', 'test', ...extraArgs], {
    cwd: rootDir,
    stdio: 'inherit',
    env: childEnv,
  });
  process.exit(pwRes.status ?? 1);
} finally {
  cleanup();
}
