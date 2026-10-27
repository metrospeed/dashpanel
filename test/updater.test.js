import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Updater, requestUpdate, REPOSITORY } from '../lib/updater.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashpanel-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'upstream');
  const local = path.join(dir, 'installed');
  fs.mkdirSync(source);
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=Updater Test', '-c', 'user.email=updater@example.invalid', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
  git(source, 'init', '-b', 'main');
  fs.writeFileSync(path.join(source, '.gitignore'), 'config/dashboard.json\nconfig/backgrounds/\n.cache/\n');
  fs.writeFileSync(path.join(source, 'app.txt'), 'old');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'Initial');
  git(dir, 'clone', source, local);
  const commit = (name, content) => {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), content);
    git(source, 'add', '-f', name);
    git(source, 'commit', '-m', 'Update');
    return git(source, 'rev-parse', 'HEAD');
  };
  class LocalUpdater extends Updater {
    async git(...args) {
      // Exercise real Git updates offline, substituting only the network transport.
      if (args[0] === 'fetch') {
        assert.equal(args[2], REPOSITORY);
        args[2] = source;
      }
      return super.git(...args);
    }
  }
  return { local, source, git, commit, updater: new LocalUpdater(local, { branch: 'main' }) };
}

test('fast-forwards to GitHub and keeps ignored config, backgrounds and cache', async (t) => {
  const f = fixture(t);
  for (const name of ['config/dashboard.json', 'config/backgrounds/upload.png', '.cache/icons/icon.svg']) {
    fs.mkdirSync(path.dirname(path.join(f.local, name)), { recursive: true });
    fs.writeFileSync(path.join(f.local, name), 'keep me');
  }
  const latest = f.commit('app.txt', 'new');
  const result = await f.updater.install();
  assert.equal(result.current, latest);
  assert.equal(result.updated, true);
  assert.equal(fs.readFileSync(path.join(f.local, 'app.txt'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(f.local, 'config/dashboard.json'), 'utf8'), 'keep me');
  assert.equal(fs.readFileSync(path.join(f.local, 'config/backgrounds/upload.png'), 'utf8'), 'keep me');
  assert.equal(fs.readFileSync(path.join(f.local, '.cache/icons/icon.svg'), 'utf8'), 'keep me');
  assert.equal((await f.updater.install()).updated, false);
});

test('refuses dirty tracked and untracked files without modifying HEAD', async (t) => {
  const f = fixture(t);
  const before = await f.updater.revision();
  f.commit('app.txt', 'new');
  fs.writeFileSync(path.join(f.local, 'app.txt'), 'my edits');
  await assert.rejects(f.updater.install(), /Local changes/);
  assert.equal(await f.updater.revision(), before);
  f.git(f.local, 'restore', 'app.txt');
  fs.writeFileSync(path.join(f.local, 'custom.txt'), 'my file');
  await assert.rejects(f.updater.install(), /Local changes/);
  assert.equal(await f.updater.revision(), before);
});

test('refuses a wrong branch, detached HEAD and divergent local history', async (t) => {
  const f = fixture(t);
  f.git(f.local, 'switch', '-c', 'custom');
  await assert.rejects(f.updater.install(), /Switch to main/);
  f.git(f.local, 'checkout', '--detach');
  await assert.rejects(f.updater.install());
  f.git(f.local, 'switch', 'main');
  fs.writeFileSync(path.join(f.local, 'local.txt'), 'custom');
  f.git(f.local, 'add', '.');
  f.git(f.local, 'commit', '-m', 'Local commit');
  const before = await f.updater.revision();
  f.commit('app.txt', 'upstream');
  await assert.rejects(f.updater.install(), /history differs/);
  assert.equal(await f.updater.revision(), before);
  assert.equal(fs.existsSync(path.join(f.local, '.git/dashpanel-update.lock')), false);
});

test('refuses upstream files that would overwrite ignored user config', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.local, 'config'));
  fs.writeFileSync(path.join(f.local, 'config/dashboard.json'), 'personal config');
  f.commit('config/dashboard.json', 'upstream config');
  const before = await f.updater.revision();
  await assert.rejects(f.updater.install());
  assert.equal(fs.readFileSync(path.join(f.local, 'config/dashboard.json'), 'utf8'), 'personal config');
  assert.equal(await f.updater.revision(), before);
});

test('locks concurrent installations and releases the lock after network failure', async (t) => {
  const f = fixture(t);
  const lock = path.join(f.local, '.git/dashpanel-update.lock');
  fs.writeFileSync(lock, '');
  await assert.rejects(f.updater.install(), /Another update/);
  fs.unlinkSync(lock);
  const git = f.updater.git.bind(f.updater);
  f.updater.git = (...args) => args[0] === 'fetch' ? Promise.reject(new Error('Network unavailable')) : git(...args);
  await assert.rejects(f.updater.install(), /Network unavailable/);
  assert.equal(fs.existsSync(lock), false);
});

test('checks GitHub with a timeout, caches results and handles unavailable Git', async (t) => {
  const f = fixture(t);
  const latest = f.commit('app.txt', 'new');
  let calls = 0;
  const updater = new Updater(f.local, { branch: 'main', fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/metrospeed/dashpanel/commits/main');
    assert.ok(options.signal);
    return { ok: true, json: async () => ({ sha: latest }) };
  } });
  const [a, b] = await Promise.all([updater.check(), updater.check()]);
  assert.equal(a.available, true);
  assert.deepEqual(a, b);
  await updater.check();
  assert.equal(calls, 1);
  updater.cached = null;
  updater.git = async () => { throw new Error('git missing'); };
  assert.equal((await updater.check()).available, null);
});

test('GitHub failures are explicit and can be retried', async () => {
  const updater = new Updater('.', { fetchImpl: async () => ({ ok: false, status: 403 }) });
  await assert.rejects(updater.check(), /HTTP 403/);
  updater.fetch = async () => ({ ok: true, json: async () => ({ sha: 'invalid' }) });
  await assert.rejects(updater.check(), /invalid revision/);
});

test('queues a request once and refuses requests while an update is running', (t) => {
  const f = fixture(t);
  requestUpdate(f.local);
  assert.ok(fs.existsSync(path.join(f.local, '.cache/update-request')));
  assert.throws(() => requestUpdate(f.local), /already queued/);
  fs.unlinkSync(path.join(f.local, '.cache/update-request'));
  fs.writeFileSync(path.join(f.local, '.cache/update-status.json'), JSON.stringify({ state: 'running', time: Date.now() }));
  assert.throws(() => requestUpdate(f.local), /already running/);
});
