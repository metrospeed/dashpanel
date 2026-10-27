#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ConfigStore, slugify } from './lib/config.js';
import { Monitor } from './lib/monitor.js';
import { resolveCheck, runCheck } from './lib/checks.js';
import { categorize, parseBookmarks, urlKey } from './lib/bookmark-import.js';
import { Updater, requestUpdate } from './lib/updater.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const CACHE = path.join(ROOT, '.cache');
const PORT = Number(process.env.PORT) || 7676;
// No host = listen on all interfaces, IPv6 and IPv4, so "localhost" never waits on an IPv6 fallback.
const HOST = process.env.HOST || undefined;
const TOKEN = process.env.DASHPANEL_TOKEN || '';
const CONFIG_FILE = process.env.DASHPANEL_CONFIG || path.join(ROOT, 'config', 'dashboard.json');
// Uploaded background images live next to the config so Docker volumes keep them.
const BG_DIR = path.join(path.dirname(path.resolve(CONFIG_FILE)), 'backgrounds');
const ICON_CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';
const updater = new Updater(ROOT);
const updateMode = process.env.DASHPANEL_UPDATE_MODE || 'manual';
const runningRevision = await updater.revision();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'image/avif': '.avif' };

const store = new ConfigStore(CONFIG_FILE);
const monitor = new Monitor();
const clients = new Set();

store.on('change', (config) => {
  monitor.sync(config);
  broadcast('config', { config, configError: store.error });
});
monitor.on('status', (id, state) => broadcast('status', { id, state }));
store.load();
store.watch();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000).unref();

const state = () => ({ config: store.config, configError: store.error, statuses: monitor.snapshot() });

// ---------------------------------------------------------------- helpers

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

function send(res, status, body, headers = {}) {
  const isBuffer = Buffer.isBuffer(body) || typeof body === 'string';
  res.writeHead(status, {
    'content-type': isBuffer ? 'text/plain; charset=utf-8' : 'application/json',
    ...headers,
  });
  res.end(isBuffer ? body : JSON.stringify(body));
}

async function readJson(req, limit = 1024 * 1024) {
  if (!/application\/json/.test(req.headers['content-type'] || '')) {
    throw new HttpError(415, 'Content-Type must be application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Body too large');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Writes need the token when DASHPANEL_TOKEN is set; otherwise they're only
 * accepted from this machine. Cross-site requests are always refused.
 */
function requireWrite(req) {
  const origin = req.headers.origin;
  if (origin && origin !== 'null') {
    let originHost;
    try { originHost = new URL(origin).host; } catch { /* fall through */ }
    if (originHost !== req.headers.host) throw new HttpError(403, 'Cross-origin request refused');
  }
  if (TOKEN) {
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers['x-dashpanel-token'] || '';
    if (!given || !safeEqual(String(given), TOKEN)) throw new HttpError(401, 'Missing or invalid token', { needsToken: true });
    return;
  }
  const hostname = (req.headers.host || '').replace(/:\d+$/, '');
  if (!LOOPBACK.has(req.socket.remoteAddress) || !LOCAL_HOSTS.has(hostname)) {
    throw new HttpError(403, 'Editing is only allowed from localhost. Set DASHPANEL_TOKEN to edit remotely.', { needsToken: true });
  }
}

function findIndex(list, id, kind) {
  const i = list.findIndex((x) => x.id === id);
  if (i === -1) throw new HttpError(404, `No ${kind} with id "${id}"`);
  return i;
}

function freshId(list, name, requested) {
  const taken = new Set(list.map((x) => x.id));
  const base = slugify(requested || name);
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  return id;
}

/** Move list[i] to `position` (0-based) when a position was requested. */
function place(list, i, position) {
  if (position === undefined || position === null) return;
  const [item] = list.splice(i, 1);
  list.splice(Math.max(0, Math.min(Number(position), list.length)), 0, item);
}

function mergeItem(current, patch) {
  const { position, id, ...rest } = patch;
  const next = { ...current, ...rest };
  if (rest.check) next.check = { ...current.check, ...rest.check };
  // null clears an optional field
  for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
  if (next.check) for (const [k, v] of Object.entries(next.check)) if (v === null) delete next.check[k];
  return next;
}

function crud(kind, key) {
  return {
    async create(req) {
      const body = await readJson(req);
      if (!body.name) throw new HttpError(400, 'name is required');
      const item = store.mutate((c) => {
        const { position, ...rest } = body;
        const entry = { ...rest, id: freshId(c[key], body.name, body.id) };
        c[key].push(entry);
        place(c[key], c[key].length - 1, position);
        return entry.id;
      });
      return store.config[key].find((x) => x.id === item);
    },
    async update(req, id) {
      const patch = await readJson(req);
      store.mutate((c) => {
        const i = findIndex(c[key], id, kind);
        c[key][i] = mergeItem(c[key][i], patch);
        place(c[key], i, patch.position);
      });
      return store.config[key].find((x) => x.id === id);
    },
    remove(id) {
      return store.mutate((c) => {
        const i = findIndex(c[key], id, kind);
        return c[key].splice(i, 1)[0];
      });
    },
  };
}

const services = crud('service', 'services');
const bookmarks = crud('bookmark', 'bookmarks');

/**
 * POST /api/bookmarks/import
 *   { source, autoSort?, onlyPopular?, dryRun? } parses a browser export / pasted links;
 *   { items: [{ name, url, group }] } saves an already reviewed list.
 * Links that are already bookmarked are never added twice.
 */
async function importBookmarks(req) {
  const body = await readJson(req, 25 * 1024 * 1024);
  let items;
  let skipped = 0;
  let format = 'items';
  if (Array.isArray(body.items)) {
    items = body.items;
  } else if (typeof body.source === 'string') {
    const parsed = parseBookmarks(body.source);
    format = parsed.format;
    ({ items, skipped } = categorize(parsed.items, {
      autoSort: body.autoSort !== false,
      onlyPopular: Boolean(body.onlyPopular),
      existing: store.config.bookmarks,
    }));
    if (body.dryRun) return { format, items, skipped };
  } else {
    throw new HttpError(400, 'Pass "source" (bookmark HTML, Chromium Bookmarks JSON or a list of URLs) or "items"');
  }

  const groups = {};
  let duplicates = 0;
  store.mutate((c) => {
    const taken = new Set(c.bookmarks.map((b) => urlKey(b.url)));
    for (const { name, url, group } of items) {
      if (!name || !url || taken.has(urlKey(url))) { duplicates++; continue; }
      taken.add(urlKey(url));
      const g = group || 'Imported';
      c.bookmarks.push({ id: freshId(c.bookmarks, name), name, url, group: g });
      groups[g] = (groups[g] || 0) + 1;
    }
  });
  const added = Object.values(groups).reduce((a, b) => a + b, 0);
  return { format, added, duplicates, skipped, groups };
}

// ---------------------------------------------------------------- icon cache

const misses = new Map(); // key -> timestamp; avoid hammering the CDN for unknown icons
const inflight = new Map();

async function cachedFetch(key, file, candidates) {
  const hit = ['.svg', '.png', '.webp', '.ico'].map((ext) => file + ext).find((f) => fs.existsSync(f));
  if (hit) return hit;
  if (Date.now() - (misses.get(key) ?? 0) < 3600_000) return null;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    for (const [url, ext] of candidates) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + ext, buf);
        return file + ext;
      } catch { /* try next */ }
    }
    misses.set(key, Date.now());
    return null;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

async function serveIcon(res, url) {
  const name = url.searchParams.get('name');
  const domain = url.searchParams.get('domain');
  let file;
  if (name && /^[a-z0-9-]+$/.test(name)) {
    file = await cachedFetch(`icon:${name}`, path.join(CACHE, 'icons', name),
      ['svg', 'png', 'webp'].map((ext) => [`${ICON_CDN}/${ext}/${name}.${ext}`, `.${ext}`]));
  } else if (domain && /^[a-z0-9.-]+$/i.test(domain)) {
    const d = domain.toLowerCase();
    file = await cachedFetch(`fav:${d}`, path.join(CACHE, 'favicons', d),
      [[`https://icons.duckduckgo.com/ip3/${d}.ico`, '.ico']]);
  } else {
    throw new HttpError(400, 'Pass ?name=<dashboard-icon> or ?domain=<host>');
  }
  if (!file) return send(res, 404, 'Icon not found', { 'cache-control': 'public, max-age=3600' });
  res.writeHead(200, { 'content-type': MIME[path.extname(file)], 'cache-control': 'public, max-age=604800' });
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------- pages

function assetVersion() {
  return ['app.js', 'style.css']
    .map((f) => fs.statSync(path.join(PUBLIC, f)).mtimeMs.toString(36))
    .join('');
}

/** Theme attributes for <html>, so the first paint already has the right look. */
function appearanceAttrs({ theme, accent, background: bg }) {
  const style = [
    `--accent:${accent}`,
    `--bg-color:${bg.color}`,
    `--bg-image:${bg.type === 'image' && bg.image ? `url(${JSON.stringify(bg.image)})` : 'none'}`,
    `--bg-dim:${bg.dim}%`,
    `--bg-blur:${bg.blur}px`,
  ].join(';');
  return `data-theme="${escapeHtml(theme)}" data-bg="${escapeHtml(bg.type)}" style="${escapeHtml(style)}"`;
}

function serveIndex(res) {
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
    .replaceAll('{{v}}', assetVersion())
    .replace('{{appearance}}', () => appearanceAttrs(store.config.settings))
    .replace('{{title}}', () => escapeHtml(store.config.title))
    // Inline the current state so the first paint needs no extra round trip.
    .replace('{{state}}', () => JSON.stringify(state()).replace(/</g, '\\u003c'));
  res.writeHead(200, { 'content-type': MIME['.html'], 'cache-control': 'no-store' });
  res.end(html);
}

function serveStatic(res, pathname, versioned) {
  const background = pathname.startsWith('/backgrounds/');
  const base = background ? BG_DIR : PUBLIC;
  const file = path.normalize(path.join(base, decodeURIComponent(pathname.slice(background ? '/backgrounds'.length : 0))));
  if (!file.startsWith(base + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    return send(res, 404, 'Not found');
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] || 'application/octet-stream',
    // Uploaded backgrounds are content-hashed, so they never change either.
    'cache-control': versioned || background ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
  });
  fs.createReadStream(file).pipe(res);
}

/** POST /api/background { data: "data:image/jpeg;base64,..." } -> { url } */
async function uploadBackground(req) {
  const { data } = await readJson(req, 20 * 1024 * 1024);
  const match = /^data:(image\/[\w+.-]+);base64,(.+)$/s.exec(String(data ?? ''));
  const ext = match && IMAGE_EXT[match[1]];
  if (!ext) throw new HttpError(400, 'Send a JPEG, PNG, WebP, GIF or AVIF image as a base64 data URL');
  const buf = Buffer.from(match[2], 'base64');
  const name = `${crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16)}${ext}`;
  fs.mkdirSync(BG_DIR, { recursive: true });
  fs.writeFileSync(path.join(BG_DIR, name), buf);
  return { url: `/backgrounds/${name}` };
}

/** Delete uploaded backgrounds that the config no longer points at. */
function pruneBackgrounds() {
  const current = path.basename(store.config.settings.background.image || '');
  let files = [];
  try { files = fs.readdirSync(BG_DIR); } catch { return; }
  for (const f of files) if (f !== current) fs.rmSync(path.join(BG_DIR, f), { force: true });
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function openEvents(req, res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 3000\nevent: state\ndata: ${JSON.stringify(state())}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
}

// ---------------------------------------------------------------- router

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const { pathname } = url;
  const method = req.method;
  const [, api, resource, id] = pathname.split('/').map((p) => (p ? decodeURIComponent(p) : p));

  if (api !== 'api') {
    if (method !== 'GET' && method !== 'HEAD') return send(res, 405, 'Method not allowed');
    if (pathname === '/' || pathname === '/index.html') return serveIndex(res);
    return serveStatic(res, pathname, url.searchParams.has('v'));
  }

  const write = () => requireWrite(req);
  const key = `${method} ${resource}${id ? '/:id' : ''}`;
  switch (key) {
    case 'POST updates/:id': {
      write();
      await readJson(req);
      if (id === 'check') {
        return send(res, 200, { ...await updater.check(), mode: updateMode });
      }
      if (id === 'install') {
        if (updateMode !== 'systemd') throw new HttpError(409, 'Update from the host using node update.js; Docker installs need --docker.');
        requestUpdate(ROOT);
        return send(res, 202, { state: 'queued' });
      }
      break;
    }
    case 'GET updates': {
      write();
      let result = { state: 'idle' };
      try { result = JSON.parse(fs.readFileSync(path.join(CACHE, 'update-status.json'), 'utf8')); } catch { /* no update yet */ }
      if (fs.existsSync(path.join(CACHE, 'update-request'))) result = { state: 'queued' };
      return send(res, 200, { ...result, runningRevision }, { 'cache-control': 'no-store' });
    }
    case 'GET state': return send(res, 200, state());
    case 'GET events': return openEvents(req, res);
    case 'GET icon': return serveIcon(res, url);
    case 'GET config': return send(res, 200, store.config);
    case 'POST check': {
      const body = req.headers['content-type'] ? await readJson(req) : {};
      if (body.id) {
        if (!monitor.entries.has(body.id)) throw new HttpError(404, `No service with id "${body.id}"`);
        return send(res, 200, { [body.id]: await monitor.run(body.id) });
      }
      return send(res, 200, await monitor.runAll());
    }
    case 'POST test-check': {
      write();
      const body = await readJson(req);
      const service = { url: body.url, check: { type: body.url ? 'http' : 'none', ...body.check } };
      const check = resolveCheck(service, store.config.settings);
      return send(res, 200, { check, result: await runCheck(check) });
    }
    case 'PUT config': write(); return send(res, 200, store.save(await readJson(req)));
    case 'PATCH settings': {
      write();
      const { title, ...settings } = await readJson(req);
      store.mutate((c) => {
        if (title !== undefined) c.title = title;
        // background is merged too, so { background: { dim: 20 } } keeps the image
        c.settings = { ...c.settings, ...settings, background: { ...c.settings.background, ...settings.background } };
      });
      pruneBackgrounds();
      return send(res, 200, { title: store.config.title, settings: store.config.settings });
    }
    case 'POST background': write(); return send(res, 201, await uploadBackground(req));
    case 'POST services': write(); return send(res, 201, await services.create(req));
    case 'PATCH services/:id': write(); return send(res, 200, await services.update(req, id));
    case 'DELETE services/:id': write(); return send(res, 200, services.remove(id));
    case 'POST bookmarks': write(); return send(res, 201, await bookmarks.create(req));
    case 'PATCH bookmarks/:id': write(); return send(res, 200, await bookmarks.update(req, id));
    case 'DELETE bookmarks/:id': write(); return send(res, 200, bookmarks.remove(id));
    case 'POST bookmarks/:id':
      if (id !== 'import') break;
      write();
      return send(res, 200, await importBookmarks(req));
  }
  return send(res, 404, { error: `No route for ${method} ${pathname}` });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((err) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) {
      send(res, status, { error: err.message, ...(err.details && { details: err.details }), ...(err.needsToken && { needsToken: true }) });
    } else {
      res.end();
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`dashpanel running at http://localhost:${PORT}`);
  console.log(`config: ${store.file}`);
  if (!TOKEN) console.log('editing: localhost only (set DASHPANEL_TOKEN to allow remote edits)');
});
