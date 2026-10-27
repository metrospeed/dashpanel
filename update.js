#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Updater } from './lib/updater.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const allowed = new Set(['--check', '--service', '--docker', '--request', '--help']);
const usage = 'Usage: node update.js [--check | --service | --docker]\n\nFetch the latest GitHub main branch without overwriting local changes.\n  --check    Check GitHub without changing any files\n  --service  Update, then restart dashpanel.service (run as root)\n  --docker   Update, then rebuild with Docker Compose (run on the host)\n\nDASHPANEL_BRANCH selects another branch (default: main).';

async function main() {
  if ([...args].some((arg) => !allowed.has(arg))) throw new Error(usage);
  if (args.has('--help')) { console.log(usage); return; }
  if (['--check', '--service', '--docker', '--request'].filter((arg) => args.has(arg)).length > 1) throw new Error(usage);
  if (args.has('--service')) {
    // The installed unit runs Git as the service user, keeping checkout ownership intact.
    execFileSync('systemctl', ['start', 'dashpanel-update.service'], { stdio: 'inherit' });
    console.log('dashpanel updated and restarted.');
    return;
  }
  const updater = new Updater(root);
  if (args.has('--check')) {
    const info = await updater.check();
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  const statusFile = path.join(root, '.cache', 'update-status.json');
  const status = (data) => {
    if (!args.has('--request')) return;
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    const tmp = `${statusFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...data, time: Date.now() }));
    fs.renameSync(tmp, statusFile);
  };
  // Consume the request before doing network work; path units retry while it exists.
  if (args.has('--request')) fs.rmSync(path.join(root, '.cache', 'update-request'), { force: true });
  try {
    status({ state: 'running' });
    const result = await updater.install();
    console.log(result.updated ? `Updated to ${result.current.slice(0, 7)}.` : 'Already up to date.');
    if (args.has('--docker')) {
      execFileSync('docker', ['compose', 'up', '-d', '--build'], { cwd: root, stdio: 'inherit', windowsHide: true });
    } else if (!args.has('--request')) {
      console.log('Restart dashpanel to load the updated code.');
    }
    status({ state: 'complete', ...result });
  } catch (err) {
    status({ state: 'failed', error: err.message });
    throw err;
  }
}

main().catch((err) => { console.error(`Update failed: ${err.message}`); process.exitCode = 1; });
