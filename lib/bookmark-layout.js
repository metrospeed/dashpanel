function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function requireGroup(config, group) {
  if (typeof group !== 'string' || !config.bookmarkGroups.includes(group)) fail(404, 'Bookmark folder no longer exists. Refresh and try again.');
}

function groupName(name) {
  if (typeof name !== 'string' || !name.trim()) fail(400, 'Folder name is required.');
  return name.trim();
}

export function createBookmarkGroup(config, name) {
  name = groupName(name);
  if (config.bookmarkGroups.includes(name)) fail(409, 'A folder with that name already exists.');
  config.bookmarkGroups.push(name);
}

export function updateBookmarkGroup(config, { group, name = group, beforeGroup }) {
  requireGroup(config, group);
  name = groupName(name);
  if (name !== group && config.bookmarkGroups.includes(name)) fail(409, 'A folder with that name already exists.');
  if (beforeGroup !== undefined && beforeGroup !== null) requireGroup(config, beforeGroup);
  config.bookmarkGroups = config.bookmarkGroups.map((g) => g === group ? name : g);
  for (const bookmark of config.bookmarks) if (bookmark.group === group) bookmark.group = name;
  if (beforeGroup !== undefined && beforeGroup !== group) {
    const groups = config.bookmarkGroups.filter((g) => g !== name);
    const index = beforeGroup === null ? groups.length : groups.indexOf(beforeGroup);
    groups.splice(index, 0, name);
    config.bookmarkGroups = groups;
  }
}

export function deleteBookmarkGroup(config, group) {
  requireGroup(config, group);
  config.bookmarkGroups = config.bookmarkGroups.filter((g) => g !== group);
  config.bookmarks = config.bookmarks.filter((b) => b.group !== group);
}

export function moveBookmark(config, { id, group, beforeId = null }) {
  requireGroup(config, group);
  const item = config.bookmarks.find((b) => b.id === id);
  if (!item) fail(404, 'Bookmark no longer exists. Refresh and try again.');
  if (beforeId !== null && !config.bookmarks.some((b) => b.id === beforeId && b.group === group)) {
    fail(409, 'The destination bookmark moved. Refresh and try again.');
  }
  if (beforeId === id) return;
  const remaining = config.bookmarks.filter((b) => b.id !== id);
  let index = beforeId === null ? -1 : remaining.findIndex((b) => b.id === beforeId);
  if (index === -1) {
    index = remaining.length;
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (remaining[i].group === group) { index = i + 1; break; }
    }
  }
  item.group = group;
  remaining.splice(index, 0, item);
  config.bookmarks = remaining;
}
