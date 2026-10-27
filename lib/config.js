import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

export const CHECK_TYPES = ['http', 'tcp', 'ping', 'none'];
export const ENGINES = ['google', 'chatgpt', 'claude'];
export const THEMES = ['midnight', 'slate', 'nord', 'dracula', 'light'];
export const BACKGROUNDS = ['gradient', 'solid', 'image'];

export const DEFAULT_SETTINGS = {
  checkInterval: 30, // seconds
  timeout: 5000, // ms
  defaultSearch: 'google',
  openInNewTab: false,
  accent: '#ea580c',
  theme: 'midnight',
  background: {
    type: 'gradient', // gradient | solid | image
    color: '#0b0d12', // used by "solid"
    image: '', // used by "image": http(s) URL or /backgrounds/<file>
    dim: 40, // % of theme colour laid over the image
    blur: 0, // px
  },
};

export function slugify(value) {
  const slug = String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'item';
}

function uniqueId(base, taken) {
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  taken.add(id);
  return id;
}

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate and fill defaults. Unknown fields are preserved so hand-written
 * extras survive a round trip through the API. Returns { config, errors }.
 */
export function normalize(raw) {
  const errors = [];
  if (!isPlainObject(raw)) return { config: null, errors: ['Config must be a JSON object'] };

  const settings = { ...DEFAULT_SETTINGS, ...(isPlainObject(raw.settings) ? raw.settings : {}) };
  if (!(Number(settings.checkInterval) >= 5)) errors.push('settings.checkInterval must be a number >= 5 (seconds)');
  if (!(Number(settings.timeout) >= 100)) errors.push('settings.timeout must be a number >= 100 (ms)');
  if (!ENGINES.includes(settings.defaultSearch)) errors.push(`settings.defaultSearch must be one of: ${ENGINES.join(', ')}`);
  settings.checkInterval = Number(settings.checkInterval);
  settings.timeout = Number(settings.timeout);
  settings.openInNewTab = Boolean(settings.openInNewTab);
  if (!/^#[\da-f]{6}$/i.test(settings.accent)) errors.push('settings.accent must be a hex colour like "#ea580c"');
  if (!THEMES.includes(settings.theme)) errors.push(`settings.theme must be one of: ${THEMES.join(', ')}`);

  const bg = { ...DEFAULT_SETTINGS.background, ...(isPlainObject(raw.settings?.background) ? raw.settings.background : {}) };
  if (!BACKGROUNDS.includes(bg.type)) errors.push(`settings.background.type must be one of: ${BACKGROUNDS.join(', ')}`);
  if (!/^#[\da-f]{6}$/i.test(bg.color)) errors.push('settings.background.color must be a hex colour');
  if (bg.image && !isHttpUrl(bg.image) && !/^\/backgrounds\/[\w.-]+$/.test(bg.image)) {
    errors.push('settings.background.image must be an http(s) URL or an uploaded /backgrounds/ file');
  }
  if (bg.type === 'image' && !bg.image) errors.push('settings.background.image is required when the background type is "image"');
  bg.dim = Math.min(90, Math.max(0, Number(bg.dim) || 0));
  bg.blur = Math.min(30, Math.max(0, Number(bg.blur) || 0));
  settings.background = bg;

  const serviceIds = new Set();
  const services = (Array.isArray(raw.services) ? raw.services : []).map((s, i) => {
    const where = `services[${i}]${s?.name ? ` (${s.name})` : ''}`;
    if (!isPlainObject(s)) {
      errors.push(`${where} must be an object`);
      return null;
    }
    if (!s.name || typeof s.name !== 'string') errors.push(`${where}: name is required`);
    if (s.url !== undefined && s.url !== '' && !isHttpUrl(s.url)) errors.push(`${where}: url must be an http(s) URL`);

    const check = isPlainObject(s.check) ? { ...s.check } : { type: s.url ? 'http' : 'none' };
    check.type ??= s.url ? 'http' : 'none';
    if (!CHECK_TYPES.includes(check.type)) {
      errors.push(`${where}: check.type must be one of: ${CHECK_TYPES.join(', ')}`);
    } else if (check.type !== 'none' && !check.target && !s.url) {
      errors.push(`${where}: a ${check.type} check needs check.target when the service has no url`);
    }
    if (check.type === 'http' && check.target && !isHttpUrl(check.target)) errors.push(`${where}: check.target must be an http(s) URL`);
    if (check.type === 'tcp' && check.target && !/^(\[[^\]]+\]|[^:\s]+):\d{1,5}$/.test(check.target)) {
      errors.push(`${where}: tcp check.target must look like host:port`);
    }
    if (check.interval !== undefined && !(Number(check.interval) >= 5)) errors.push(`${where}: check.interval must be >= 5 (seconds)`);

    const id = uniqueId(slugify(s.id || s.name), serviceIds);
    return { ...s, id, name: String(s.name ?? ''), group: s.group || 'Services', check };
  }).filter(Boolean);

  const bookmarkIds = new Set();
  const bookmarks = (Array.isArray(raw.bookmarks) ? raw.bookmarks : []).map((b, i) => {
    const where = `bookmarks[${i}]${b?.name ? ` (${b.name})` : ''}`;
    if (!isPlainObject(b)) {
      errors.push(`${where} must be an object`);
      return null;
    }
    if (!b.name || typeof b.name !== 'string') errors.push(`${where}: name is required`);
    if (!isHttpUrl(b.url)) errors.push(`${where}: url must be an http(s) URL`);
    if (b.group !== undefined && typeof b.group !== 'string') errors.push(`${where}: group must be a string`);
    const id = uniqueId(slugify(b.id || b.name), bookmarkIds);
    return { ...b, id, name: String(b.name ?? ''), group: b.group || 'Bookmarks' };
  }).filter(Boolean);

  if (raw.bookmarkGroups !== undefined && (!Array.isArray(raw.bookmarkGroups)
    || raw.bookmarkGroups.some((g) => typeof g !== 'string' || !g.trim()))) {
    errors.push('bookmarkGroups must be an array of non-empty folder names');
  }
  // Older configs derive folders from first appearance. Keep empty folders and
  // explicit ordering once the user starts organizing them.
  const bookmarkGroups = [...new Set([
    ...(Array.isArray(raw.bookmarkGroups) ? raw.bookmarkGroups.filter((g) => typeof g === 'string' && g.trim()) : []),
    ...bookmarks.map((b) => b.group),
  ])];

  return {
    config: { ...raw, title: typeof raw.title === 'string' ? raw.title : 'dashpanel', settings, services, bookmarks, bookmarkGroups },
    errors,
  };
}

/** Holds the live config, persists changes atomically and hot-reloads hand edits. */
export class ConfigStore extends EventEmitter {
  constructor(file) {
    super();
    this.file = path.resolve(file);
    this.config = null;
    this.error = null;
    this.text = null; // last text loaded or written, to skip no-op watch events
  }

  load() {
    let text;
    try {
      text = fs.readFileSync(this.file, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      const example = path.join(path.dirname(this.file), 'dashboard.example.json');
      text = fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : '{}';
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, text);
    }
    this.apply(text);
  }

  apply(text) {
    this.text = text;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return this.fail([`Invalid JSON: ${err.message}`]);
    }
    const { config, errors } = normalize(parsed);
    if (errors.length) return this.fail(errors);
    this.config = config;
    this.error = null;
    this.emit('change', config);
  }

  fail(errors) {
    // Keep serving the last good config so a typo doesn't blank the dashboard.
    this.error = errors;
    console.error(`[config] ${this.file} rejected:\n  ${errors.join('\n  ')}`);
    if (!this.config) this.config = normalize({}).config;
    this.emit('change', this.config);
  }

  watch() {
    let timer;
    // Watch the directory: editors often replace the file, which kills a file watcher.
    fs.watch(path.dirname(this.file), (_event, name) => {
      if (name && name !== path.basename(this.file)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        let text;
        try {
          text = fs.readFileSync(this.file, 'utf8');
        } catch {
          return;
        }
        if (text === this.text) return;
        console.log('[config] reloaded from disk');
        this.apply(text);
      }, 120);
    });
  }

  /** Replace the whole config. Throws with .details on validation errors. */
  save(next) {
    const { config, errors } = normalize(next);
    if (errors.length) {
      const err = new Error('Config validation failed');
      err.details = errors;
      err.status = 400;
      throw err;
    }
    const text = `${JSON.stringify(config, null, 2)}\n`;
    const tmp = `${this.file}.${process.pid}.tmp`;
    this.text = text;
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, this.file);
    } catch {
      // Rename can fail on Windows while another program holds the file open.
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(this.file, text);
    }
    this.config = config;
    this.error = null;
    this.emit('change', config);
    return config;
  }

  /** Apply fn to a deep copy of the config and save the result. */
  mutate(fn) {
    const draft = structuredClone(this.config);
    const result = fn(draft);
    this.save(draft);
    return result;
  }
}
