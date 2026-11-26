#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_SCRATCH_BASE =
  '/home/antigravity/.gemini/jetski/scratch/teamwork_tmp';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/with-scratch-tmp.mjs <command> [...args]');
  process.exit(1);
}

const scratchBase = process.env.APP_ICOL_SCRATCH_ROOT || DEFAULT_SCRATCH_BASE;
const runTmpDir = path.join(scratchBase, `r-${process.pid}`);

fs.mkdirSync(runTmpDir, { recursive: true, mode: 0o700 });

let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try {
    fs.rmSync(runTmpDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup race errors on exit
  }
}

process.on('exit', cleanup);

const [command, ...commandArgs] = args;
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    TMPDIR: runTmpDir,
    TMP: runTmpDir,
    TEMP: runTmpDir,
    PLAYWRIGHT_BROWSERS_PATH:
      process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/ms-playwright',
  },
});

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (!child.killed) {
      child.kill(sig);
    }
  });
}

child.on('error', (err) => {
  console.error(`[with-scratch-tmp] Failed to start "${command}":`, err);
  cleanup();
  process.exit(1);
});

child.on('close', (code, signal) => {
  cleanup();
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 1);
});
