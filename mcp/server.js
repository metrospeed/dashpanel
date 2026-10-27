#!/usr/bin/env node
// dashpanel MCP server (stdio). Lets Claude Code manage the dashboard through
// its HTTP API, so it works whether dashpanel runs locally or on the homelab.
import readline from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.DASHPANEL_URL || 'http://localhost:7676').replace(/\/+$/, '');
const TOKEN = process.env.DASHPANEL_TOKEN || '';
const ICON_TREE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/tree.json';
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

// "User Data" folders of Chromium browsers, per OS. Profiles live inside.
const home = os.homedir();
const userData = (win, mac, linux) => () => {
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), win);
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', mac);
  return path.join(home, '.config', linux);
};
const CHROMIUM_DIRS = {
  chrome: userData('Google/Chrome/User Data', 'Google/Chrome', 'google-chrome'),
  edge: userData('Microsoft/Edge/User Data', 'Microsoft Edge', 'microsoft-edge'),
  brave: userData('BraveSoftware/Brave-Browser/User Data', 'BraveSoftware/Brave-Browser', 'BraveSoftware/Brave-Browser'),
  vivaldi: userData('Vivaldi/User Data', 'Vivaldi', 'vivaldi'),
};

// ------------------------------------------------------------------ dashpanel API

async function api(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { 'content-type': 'application/json', ...(TOKEN && { authorization: `Bearer ${TOKEN}` }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new Error(`Cannot reach dashpanel at ${BASE} (${err.cause?.code || err.message}). Start it with \`npm start\` in the dashpanel folder, or set DASHPANEL_URL.`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) {
    const details = data?.details ? `\n- ${data.details.join('\n- ')}` : '';
    throw new Error(`dashpanel returned ${res.status}: ${data?.error || text}${details}`);
  }
  return data;
}

let iconNames;
async function iconList() {
  if (!iconNames) {
    const res = await fetch(ICON_TREE, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Could not load icon index (${res.status})`);
    const tree = await res.json();
    iconNames = [...new Set([...tree.svg, ...tree.png].map((f) => f.replace(/\.(svg|png)$/, '')))].sort();
  }
  return iconNames;
}

// ------------------------------------------------------------------ formatting

function fmtStatus(st) {
  if (!st) return 'pending';
  const lat = st.latency != null ? ` ${st.latency}ms` : '';
  return `${st.status}${lat} (${st.message || ''})`;
}

function fmtCheck(c = {}) {
  const parts = [c.type];
  if (c.target) parts.push(c.target);
  if (c.expectStatus) parts.push(`expect ${c.expectStatus}`);
  if (c.keyword) parts.push(`keyword "${c.keyword}"`);
  if (c.interval) parts.push(`every ${c.interval}s`);
  return parts.join(' ');
}

const json = (v) => JSON.stringify(v, null, 2);

// ------------------------------------------------------------------ tools

const checkSchema = {
  type: 'object',
  description: 'How the status is checked. Omit for an HTTP check of the url.',
  properties: {
    type: { type: 'string', enum: ['http', 'tcp', 'ping', 'none'], description: 'http = request a URL, tcp = open a port, ping = ICMP echo, none = no status' },
    target: { type: 'string', description: 'http: URL (default: service url, e.g. a /health endpoint). tcp: host:port (default: url host and port). ping: host or IP (default: url host).' },
    method: { type: 'string', enum: ['GET', 'HEAD'] },
    expectStatus: { type: 'string', description: 'HTTP codes that count as up, e.g. "200-299,401". Default: 2xx/3xx/401/403 up, other 4xx warn, 5xx down.' },
    keyword: { type: 'string', description: 'Response body must contain this text to count as up' },
    interval: { type: 'number', description: 'Seconds between checks (default from settings)' },
    timeout: { type: 'number', description: 'Timeout in milliseconds' },
    insecure: { type: 'boolean', description: 'Ignore TLS certificate errors (default true, common for self-signed homelab certs)' },
    headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra request headers' },
  },
};

const serviceProps = {
  name: { type: 'string', description: 'Display name' },
  url: { type: 'string', description: 'Link opened when the card is clicked (http/https)' },
  group: { type: 'string', description: 'Section heading, e.g. "Media", "Infrastructure". Groups appear in order of first use.' },
  icon: { type: 'string', description: 'dashboard-icons name (use search_icons), an image URL, a /path, or an emoji. Omit to auto-match the name.' },
  description: { type: 'string', description: 'Subtitle under the name (defaults to the URL host)' },
  check: checkSchema,
  position: { type: 'number', description: 'Optional 0-based index in the service list (controls ordering)' },
};

const bookmarkProps = {
  name: { type: 'string' },
  url: { type: 'string' },
  group: { type: 'string', description: 'Bookmark column, e.g. "Dev", "Daily"' },
  icon: { type: 'string', description: 'Optional; defaults to the site favicon' },
  position: { type: 'number', description: 'Optional 0-based index in the bookmark list' },
};

const tools = [
  {
    name: 'get_dashboard',
    description: 'Show the dashboard: every service with its group, URL, check config and live status, plus bookmarks and settings. Call this first to learn existing ids and groups.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      const { config, statuses, configError } = await api('GET', '/api/state');
      const lines = [`# ${config.title}  (${BASE})`];
      if (configError) lines.push(`\n⚠ dashboard.json on disk has errors (serving last good version):\n- ${configError.join('\n- ')}`);
      lines.push('\n## Services');
      for (const s of config.services) {
        lines.push(`- ${s.id} — "${s.name}" [${s.group}] ${s.url || '(no url)'} | icon: ${s.icon || 'auto'} | check: ${fmtCheck(s.check)} | status: ${fmtStatus(statuses[s.id])}`);
      }
      if (!config.services.length) lines.push('(none)');
      lines.push('\n## Bookmarks');
      for (const b of config.bookmarks) lines.push(`- ${b.id} — "${b.name}" [${b.group}] ${b.url}`);
      if (!config.bookmarks.length) lines.push('(none)');
      lines.push('\n## Settings', json(config.settings));
      return lines.join('\n');
    },
  },
  {
    name: 'test_check',
    description: 'Dry-run a status check without saving anything. Use it to find the right URL, port or health endpoint before add_service.',
    inputSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'Service URL (used as the default target)' }, check: checkSchema },
    },
    async run(args) {
      const { check, result } = await api('POST', '/api/test-check', args);
      return `${fmtCheck(check)} → ${fmtStatus(result)}${result.code ? ` [HTTP ${result.code}]` : ''}`;
    },
  },
  {
    name: 'add_service',
    description: 'Add a homelab service card with a status check. The dashboard updates live.',
    inputSchema: { type: 'object', properties: { ...serviceProps, id: { type: 'string', description: 'Optional stable id (default: slug of name)' } }, required: ['name'] },
    async run(args) {
      const s = await api('POST', '/api/services', args);
      const { [s.id]: st } = await api('POST', '/api/check', { id: s.id });
      return `Added service "${s.name}" (id: ${s.id}) in group ${s.group}. First check: ${fmtStatus(st)}`;
    },
  },
  {
    name: 'update_service',
    description: 'Change fields of an existing service. Only the given fields change; `check` is merged into the existing check. Pass null to clear an optional field.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Service id from get_dashboard' }, ...serviceProps }, required: ['id'] },
    async run({ id, ...patch }) {
      const s = await api('PATCH', `/api/services/${encodeURIComponent(id)}`, patch);
      const { [s.id]: st } = await api('POST', '/api/check', { id: s.id });
      return `Updated "${s.name}" (${s.id}): check ${fmtCheck(s.check)} → ${fmtStatus(st)}`;
    },
  },
  {
    name: 'remove_service',
    description: 'Delete a service from the dashboard.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run({ id }) {
      const s = await api('DELETE', `/api/services/${encodeURIComponent(id)}`);
      return `Removed service "${s.name}" (${s.id}).`;
    },
  },
  {
    name: 'check_services',
    description: 'Run status checks right now and return the results. Omit id to check everything.',
    inputSchema: { type: 'object', properties: { id: { type: 'string', description: 'Optional service id' } } },
    async run({ id }) {
      const results = await api('POST', '/api/check', id ? { id } : {});
      return Object.entries(results).map(([k, st]) => `- ${k}: ${fmtStatus(st)}`).join('\n') || 'No services.';
    },
  },
  {
    name: 'search_icons',
    description: 'Search the dashboard-icons catalogue (homarr-labs/dashboard-icons) for icon names to use in the icon field.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'e.g. "plex", "unifi", "nas"' } }, required: ['query'] },
    async run({ query }) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = (await iconList()).filter((n) => words.every((w) => n.includes(w)));
      if (!hits.length) return `No icons match "${query}". Try a shorter term, or use an emoji / image URL instead.`;
      return `${hits.length} match${hits.length === 1 ? '' : 'es'}${hits.length > 50 ? ' (first 50)' : ''}: ${hits.slice(0, 50).join(', ')}`;
    },
  },
  {
    name: 'add_bookmark',
    description: 'Add a website bookmark to the bookmarks section.',
    inputSchema: { type: 'object', properties: bookmarkProps, required: ['name', 'url'] },
    async run(args) {
      const b = await api('POST', '/api/bookmarks', args);
      return `Added bookmark "${b.name}" (id: ${b.id}) in ${b.group}.`;
    },
  },
  {
    name: 'update_bookmark',
    description: 'Change fields of a bookmark. Pass null to clear an optional field.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, ...bookmarkProps }, required: ['id'] },
    async run({ id, ...patch }) {
      const b = await api('PATCH', `/api/bookmarks/${encodeURIComponent(id)}`, patch);
      return `Updated bookmark "${b.name}" (${b.id}).`;
    },
  },
  {
    name: 'remove_bookmark',
    description: 'Delete a bookmark.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    async run({ id }) {
      const b = await api('DELETE', `/api/bookmarks/${encodeURIComponent(id)}`);
      return `Removed bookmark "${b.name}".`;
    },
  },
  {
    name: 'update_settings',
    description: 'Change dashboard title and global settings.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        checkInterval: { type: 'number', description: 'Default seconds between checks (>= 5)' },
        timeout: { type: 'number', description: 'Default check timeout in ms' },
        defaultSearch: { type: 'string', enum: ['google', 'chatgpt', 'claude'] },
        openInNewTab: { type: 'boolean' },
        accent: { type: 'string', description: 'Accent colour as hex, e.g. "#ea580c"' },
        theme: { type: 'string', enum: ['midnight', 'slate', 'nord', 'dracula', 'light'] },
        background: {
          type: 'object',
          description: 'Page background. Only the given fields change.',
          properties: {
            type: { type: 'string', enum: ['gradient', 'solid', 'image'], description: 'gradient = accent glow (default)' },
            color: { type: 'string', description: 'Hex colour for "solid"' },
            image: { type: 'string', description: 'Image URL for "image"' },
            dim: { type: 'number', description: 'Dim the image towards the theme colour, 0-90 (%)' },
            blur: { type: 'number', description: 'Blur the image, 0-30 (px)' },
          },
        },
      },
    },
    async run(args) {
      return json(await api('PATCH', '/api/settings', args));
    },
  },
  {
    name: 'import_bookmarks',
    description: 'Import bookmarks from a browser export (HTML), a Chromium "Bookmarks" file, a list of URLs, or straight from an installed Chromium browser. Popular sites are auto-sorted into categories (AI, Dev, Homelab, Social, Media, Shopping, News, Productivity, Finance, Gaming, Learning, Tools), most popular first; other links keep their browser folder. Already-bookmarked URLs are skipped. Firefox: export to HTML first and pass the path.',
    inputSchema: {
      type: 'object',
      properties: {
        browser: { type: 'string', enum: Object.keys(CHROMIUM_DIRS), description: 'Read bookmarks directly from this browser\'s profile on this machine' },
        profile: { type: 'string', description: 'Browser profile folder (default "Default", e.g. "Profile 1")' },
        path: { type: 'string', description: 'Path to an exported bookmarks .html, a Chromium Bookmarks file, or a text file of URLs' },
        content: { type: 'string', description: 'Raw bookmark HTML / JSON / one URL per line' },
        autoSort: { type: 'boolean', description: 'Sort popular sites into categories (default true)' },
        onlyPopular: { type: 'boolean', description: 'Import only recognised popular sites (default false)' },
        dryRun: { type: 'boolean', description: 'Preview the grouping without saving (default false)' },
      },
    },
    async run({ browser, profile = 'Default', path: file, content, autoSort = true, onlyPopular = false, dryRun = false }) {
      let source = content;
      if (browser) file = path.join(CHROMIUM_DIRS[browser](), profile, 'Bookmarks');
      if (file) {
        try {
          source = fs.readFileSync(file, 'utf8');
        } catch (err) {
          throw new Error(`Could not read ${file}: ${err.code || err.message}`);
        }
      }
      if (!source) throw new Error('Pass one of: browser, path or content.');
      source = source.replace(/\s(ICON|ICON_URI)\s*=\s*"[^"]*"/gi, '');
      const preview = await api('POST', '/api/bookmarks/import', { source, autoSort, onlyPopular, dryRun: true });
      if (dryRun) {
        const groups = {};
        for (const b of preview.items) (groups[b.group] ??= []).push(b);
        const lines = [`Preview (${preview.format}): ${preview.items.length} links, ${preview.items.filter((b) => b.duplicate).length} already bookmarked, ${preview.skipped} skipped.`];
        for (const [g, list] of Object.entries(groups)) {
          const shown = list.slice(0, 12).map((b) => `${b.name}${b.duplicate ? ' (dup)' : ''}`).join(', ');
          lines.push(`- ${g} (${list.length}): ${shown}${list.length > 12 ? ', …' : ''}`);
        }
        return lines.join('\n');
      }
      const fresh = preview.items.filter((b) => !b.duplicate).map(({ name, url, group }) => ({ name, url, group }));
      const result = await api('POST', '/api/bookmarks/import', { items: fresh });
      const groups = Object.entries(result.groups).map(([g, n]) => `${g} ${n}`).join(', ');
      return `Imported ${result.added} bookmarks${groups ? ` (${groups})` : ''}. Skipped ${preview.items.length - fresh.length + result.duplicates} already bookmarked and ${preview.skipped} non-web links.`;
    },
  },
  {
    name: 'get_config',
    description: 'Return the raw dashboard.json. Use with replace_config for bulk edits such as reordering groups.',
    inputSchema: { type: 'object', properties: {} },
    async run() {
      return json(await api('GET', '/api/config'));
    },
  },
  {
    name: 'replace_config',
    description: 'Replace the entire dashboard.json (validated before saving). Get the current one with get_config first and keep every field you are not changing.',
    inputSchema: { type: 'object', properties: { config: { type: 'object', description: 'Full config: { title, settings, services[], bookmarks[] }' } }, required: ['config'] },
    async run({ config }) {
      const saved = await api('PUT', '/api/config', config);
      return `Saved: ${saved.services.length} services, ${saved.bookmarks.length} bookmarks.`;
    },
  },
];

// ------------------------------------------------------------------ JSON-RPC over stdio

const write = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`);

async function handle(msg) {
  const { id, method, params } = msg;
  if (!method) return undefined; // a response to a request we never send
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: PROTOCOL_VERSIONS.includes(params?.protocolVersion) ? params.protocolVersion : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'dashpanel', version: '1.0.0' },
        instructions: 'Manages the dashpanel homelab start page. Call get_dashboard first. Before add_service, use test_check to confirm the URL/port responds and search_icons to pick an icon. If the Proxmox MCP is available, it can be used to discover guests and IPs to add.',
      };
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) };
    case 'tools/call': {
      const tool = tools.find((t) => t.name === params?.name);
      if (!tool) throw Object.assign(new Error(`Unknown tool: ${params?.name}`), { code: -32602 });
      try {
        return { content: [{ type: 'text', text: await tool.run(params.arguments || {}) }] };
      } catch (err) {
        return { content: [{ type: 'text', text: err.message }], isError: true };
      }
    }
    default:
      if (id === undefined) return undefined; // notification
      throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return write({ id: null, error: { code: -32700, message: 'Parse error' } });
  }
  try {
    const result = await handle(msg);
    if (msg.id !== undefined && result !== undefined) write({ id: msg.id, result });
  } catch (err) {
    if (msg.id !== undefined) write({ id: msg.id, error: { code: err.code || -32603, message: err.message } });
  }
});
