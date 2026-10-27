import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);
export const REPOSITORY = 'https://github.com/metrospeed/dashpanel.git';

export class Updater {
  constructor(root, { branch = process.env.DASHPANEL_BRANCH || 'main', fetchImpl = fetch } = {}) {
    this.root = root;
    this.branch = branch;
    this.fetch = fetchImpl;
    this.pending = null;
    this.cached = null;
  }

  async git(...args) {
    const { stdout } = await exec('git', ['-c', `safe.directory=${this.root}`, ...args], {
      cwd: this.root, timeout: 120_000, maxBuffer: 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      windowsHide: true,
    });
    return stdout.trim();
  }

  async revision() {
    try { return await this.git('rev-parse', 'HEAD'); } catch { return null; }
  }

  async check() {
    if (this.cached && Date.now() - this.cached.checkedAt < 60_000) return this.cached;
    if (this.pending) return this.pending;
    this.pending = (async () => {
      const response = await this.fetch(`https://api.github.com/repos/metrospeed/dashpanel/commits/${encodeURIComponent(this.branch)}`, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'dashpanel-updater' },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}). Try again later.`);
      const commit = await response.json();
      if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('GitHub returned an invalid revision.');
      const current = await this.revision();
      this.cached = {
        current, latest: commit.sha, branch: this.branch,
        available: current ? current !== commit.sha : null,
        url: `https://github.com/metrospeed/dashpanel/commit/${commit.sha}`,
        checkedAt: Date.now(),
      };
      return this.cached;
    })().finally(() => { this.pending = null; });
    return this.pending;
  }

  async assertClean() {
    const top = await this.git('rev-parse', '--show-toplevel');
    if (fs.realpathSync(top) !== fs.realpathSync(this.root)) throw new Error('Run the updater in a dashpanel Git checkout.');
    const branch = await this.git('symbolic-ref', '--quiet', '--short', 'HEAD');
    if (branch !== this.branch) throw new Error(`Switch to ${this.branch} before updating (currently ${branch}).`);
    // Include untracked files: Git must never replace a user's local files.
    if (await this.git('status', '--porcelain', '--untracked-files=all')) {
      throw new Error('Local changes block the update. Commit or move them before trying again.');
    }
  }

  async install() {
    await this.git('check-ref-format', '--branch', this.branch);
    await this.assertClean();
    const gitDir = await this.git('rev-parse', '--absolute-git-dir');
    const lock = path.join(gitDir, 'dashpanel-update.lock');
    let handle;
    try {
      handle = fs.openSync(lock, 'wx');
    } catch (err) {
      if (err.code === 'EEXIST') throw new Error('Another update is running. If it was interrupted, remove .git/dashpanel-update.lock and retry.');
      throw err;
    }
    try {
      const before = await this.revision();
      // Fetch the official repository explicitly; don't trust a changed origin URL.
      await this.git('fetch', '--no-tags', REPOSITORY, `refs/heads/${this.branch}`);
      const latest = await this.git('rev-parse', 'FETCH_HEAD');
      // Check ancestry even when local HEAD is ahead: never report a local fork as updated.
      try { await this.git('merge-base', '--is-ancestor', before, latest); } catch {
        throw new Error('Local history differs from GitHub. Resolve it manually before updating.');
      }
      await this.assertClean();
      await this.git('merge', '--ff-only', '--no-overwrite-ignore', latest);
      this.cached = null;
      return { previous: before, current: latest, updated: before !== latest };
    } finally {
      fs.closeSync(handle);
      fs.unlinkSync(lock);
    }
  }
}

// systemd.path runs the updater outside the dashboard's read-only filesystem sandbox.
export function requestUpdate(root) {
  const file = path.join(root, '.cache', 'update-request');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let status;
  try {
    status = JSON.parse(fs.readFileSync(path.join(root, '.cache', 'update-status.json'), 'utf8'));
  } catch { /* Missing or malformed status should not block recovery. */ }
  if (status?.state === 'running' && Date.now() - status.time < 300_000) {
    throw Object.assign(new Error('An update is already running.'), { status: 409 });
  }
  try {
    fs.writeFileSync(file, `${Date.now()}\n`, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err.code === 'EEXIST') throw Object.assign(new Error('An update is already queued.'), { status: 409 });
    throw err;
  }
}
