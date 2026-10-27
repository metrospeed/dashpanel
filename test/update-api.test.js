import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

test('write APIs enforce authorization and preserve bookmark moves and folder edits', { timeout: 15_000 }, async (t) => {
  const portServer = net.createServer();
  portServer.listen(0, '127.0.0.1');
  await once(portServer, 'listening');
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashpanel-api-'));
  const token = randomUUID();
  const child = spawn(process.execPath, ['server.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DASHPANEL_CONFIG: path.join(dir, 'dashboard.json'), DASHPANEL_TOKEN: token, DASHPANEL_UPDATE_MODE: 'manual' },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  t.after(async () => {
    if (child.exitCode === null) { const ended = once(child, 'exit'); child.kill(); await ended; }
    fs.rmSync(dir, { recursive: true, force: true });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server did not start')), 8000);
    child.stdout.on('data', (data) => {
      if (String(data).includes('dashpanel running')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', (err) => { clearTimeout(timer); reject(err); });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Server exited: ${code}`)); });
  });
  const base = `http://127.0.0.1:${port}`;
  const request = (route, { auth = true, origin, method = 'POST', body = {} } = {}) => fetch(`${base}${route}`, {
    method,
    headers: { 'content-type': 'application/json', ...(auth && { authorization: `Bearer ${token}` }), ...(origin && { origin }) },
    ...(method !== 'GET' && { body: JSON.stringify(body) }),
  });
  for (const route of ['/api/updates/check', '/api/updates/install']) {
    assert.equal((await request(route, { auth: false })).status, 401);
    assert.equal((await request(route, { origin: 'https://other.example' })).status, 403);
  }
  assert.equal((await request('/api/updates', { auth: false, method: 'GET' })).status, 401);
  assert.equal((await request('/api/updates', { origin: 'https://other.example', method: 'GET' })).status, 403);
  const status = await request('/api/updates', { method: 'GET' });
  assert.equal(status.status, 200);
  assert.equal(status.headers.get('cache-control'), 'no-store');
  const install = await request('/api/updates/install', { origin: base });
  assert.equal(install.status, 409);
  assert.match((await install.json()).error, /host/);

  const operations = [
    ['/api/bookmarks/move', 'POST'], ['/api/bookmark-groups', 'POST'],
    ['/api/bookmark-groups', 'PATCH'], ['/api/bookmark-groups/Alpha', 'DELETE'],
  ];
  for (const [route, method] of operations) {
    assert.equal((await request(route, { method, auth: false })).status, 401);
    assert.equal((await request(route, { method, origin: 'https://other.example' })).status, 403);
  }
  assert.equal((await request('/api/config', { method: 'PUT', body: { bookmarkGroups: ['Alpha', 'Beta', 'Empty'], bookmarks: [
    { id: 'a', name: 'A', url: 'https://a.example', group: 'Alpha' },
    { id: 'b', name: 'B', url: 'https://b.example', group: 'Alpha' },
    { id: 'c', name: 'C', url: 'https://c.example', group: 'Beta' },
  ] } })).status, 200);
  const moved = await request('/api/bookmarks/move', { body: { id: 'a', group: 'Beta', beforeId: 'c' } });
  assert.equal(moved.status, 200);
  const layout = await moved.json();
  assert.deepEqual(layout.bookmarks.filter((b) => b.group === 'Beta').map((b) => b.id), ['a', 'c']);
  assert.equal((await request('/api/bookmarks/move', { body: { id: 'a', group: 'Beta', beforeId: 'b' } })).status, 409);
  const reordered = await request('/api/bookmark-groups', { method: 'PATCH', body: { group: 'Beta', beforeGroup: 'Alpha' } });
  assert.deepEqual((await reordered.json()).bookmarkGroups, ['Beta', 'Alpha', 'Empty']);
  const specialName = 'R&D / Tools';
  const renamed = await request('/api/bookmark-groups', { method: 'PATCH', body: { group: 'Beta', name: specialName } });
  assert.deepEqual((await renamed.json()).bookmarkGroups, [specialName, 'Alpha', 'Empty']);
  const deleted = await request(`/api/bookmark-groups/${encodeURIComponent(specialName)}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.deepEqual((await deleted.json()).bookmarks.map((b) => b.id), ['b']);
  assert.equal((await request('/api/bookmarks/b', { method: 'DELETE' })).status, 200);
  const created = await request('/api/bookmark-groups', { body: { name: 'New folder' } });
  assert.equal(created.status, 201);
  assert.deepEqual((await created.json()).bookmarkGroups, ['Alpha', 'Empty', 'New folder']);
  const persisted = JSON.parse(fs.readFileSync(path.join(dir, 'dashboard.json'), 'utf8'));
  assert.deepEqual(persisted.bookmarks, []);
  assert.deepEqual(persisted.bookmarkGroups, ['Alpha', 'Empty', 'New folder']);
});
