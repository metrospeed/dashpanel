import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalize, ConfigStore } from '../lib/config.js';
import { createBookmarkGroup, updateBookmarkGroup, deleteBookmarkGroup, moveBookmark } from '../lib/bookmark-layout.js';

function config() {
  return normalize({ bookmarks: [
    { id: 'a', name: 'A', group: 'Dev', url: 'https://a.example', icon: 'custom' },
    { id: 'b', name: 'B', group: 'Daily', url: 'https://b.example' },
    { id: 'c', name: 'C', group: 'Dev', url: 'https://c.example' },
  ] }).config;
}
const ids = (c, group) => c.bookmarks.filter((b) => b.group === group).map((b) => b.id);

test('old configs inherit folder order; explicit ordering and empty folders survive normalization', () => {
  const c = config();
  assert.deepEqual(c.bookmarkGroups, ['Dev', 'Daily']);
  c.bookmarkGroups = ['Empty', 'Daily', 'Daily'];
  const normalized = normalize(c);
  assert.deepEqual(normalized.errors, []);
  assert.deepEqual(normalized.config.bookmarkGroups, ['Empty', 'Daily', 'Dev']);
  assert.ok(normalize({ bookmarkGroups: 'wrong' }).errors.length);
  assert.ok(normalize({ bookmarkGroups: [''] }).errors.length);
  assert.ok(normalize({ bookmarks: [{ name: 'Bad', url: 'https://a.example', group: {} }] }).errors.length);
});

test('moves bookmarks within and between folders without changing their other fields', () => {
  const c = config();
  moveBookmark(c, { id: 'c', group: 'Dev', beforeId: 'a' });
  assert.deepEqual(ids(c, 'Dev'), ['c', 'a']);
  moveBookmark(c, { id: 'c', group: 'Dev' });
  assert.deepEqual(ids(c, 'Dev'), ['a', 'c']);
  moveBookmark(c, { id: 'a', group: 'Daily', beforeId: 'b' });
  assert.deepEqual(ids(c, 'Daily'), ['a', 'b']);
  assert.equal(c.bookmarks.find((b) => b.id === 'a').icon, 'custom');
  createBookmarkGroup(c, 'Empty');
  moveBookmark(c, { id: 'c', group: 'Empty' });
  assert.deepEqual(ids(c, 'Empty'), ['c']);
  assert.deepEqual(ids(c, 'Dev'), []);
  assert.deepEqual(c.bookmarkGroups, ['Dev', 'Daily', 'Empty']);
});

test('reorders and renames folders, including empty folders, then deletes only the selected folder', () => {
  const c = config();
  createBookmarkGroup(c, 'Empty');
  updateBookmarkGroup(c, { group: 'Empty', beforeGroup: 'Dev' });
  assert.deepEqual(c.bookmarkGroups, ['Empty', 'Dev', 'Daily']);
  updateBookmarkGroup(c, { group: 'Dev', name: 'Work / <tools>', beforeGroup: null });
  assert.deepEqual(c.bookmarkGroups, ['Empty', 'Daily', 'Work / <tools>']);
  assert.deepEqual(ids(c, 'Work / <tools>'), ['a', 'c']);
  deleteBookmarkGroup(c, 'Work / <tools>');
  assert.deepEqual(c.bookmarkGroups, ['Empty', 'Daily']);
  assert.deepEqual(c.bookmarks.map((b) => b.id), ['b']);
  deleteBookmarkGroup(c, 'Empty');
  assert.deepEqual(c.bookmarkGroups, ['Daily']);
});

test('stale destinations and duplicate folders fail without mutating the layout', () => {
  const c = config();
  const original = structuredClone(c);
  for (const action of [
    () => createBookmarkGroup(c, 'Dev'),
    () => createBookmarkGroup(c, '  '),
    () => updateBookmarkGroup(c, { group: 'Dev', name: 'Daily' }),
    () => updateBookmarkGroup(c, { group: 'Dev', name: 'Work', beforeGroup: 'Deleted' }),
    () => deleteBookmarkGroup(c, 'Deleted'),
    () => moveBookmark(c, { id: 'missing', group: 'Dev' }),
    () => moveBookmark(c, { id: 'a', group: 'Deleted' }),
    () => moveBookmark(c, { id: 'a', group: 'Dev', beforeId: 'b' }),
  ]) {
    assert.throws(action, (error) => [400, 404, 409].includes(error.status));
    assert.deepEqual(c, original);
  }
  moveBookmark(c, { id: 'a', group: 'Dev', beforeId: 'a' });
  assert.deepEqual(c, original);
});

test('folder and bookmark edits persist across a reload of the config file', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dashpanel-bookmarks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'dashboard.json');
  const store = new ConfigStore(file);
  store.save(config());
  store.mutate((c) => createBookmarkGroup(c, 'Empty'));
  store.mutate((c) => updateBookmarkGroup(c, { group: 'Daily', beforeGroup: 'Dev' }));
  store.mutate((c) => moveBookmark(c, { id: 'a', group: 'Daily' }));
  const reloaded = new ConfigStore(file);
  reloaded.load();
  assert.deepEqual(reloaded.config.bookmarkGroups, ['Daily', 'Dev', 'Empty']);
  assert.deepEqual(ids(reloaded.config, 'Daily'), ['b', 'a']);
  assert.deepEqual(ids(reloaded.config, 'Dev'), ['c']);
});
