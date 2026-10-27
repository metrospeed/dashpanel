import { CATEGORY_ORDER, lookupSite } from './popular-sites.js';

// Browser root folders carry no meaning as a dashboard group.
const ROOT_FOLDER = /^(bookmarks?( bar| toolbar| menu)?|other bookmarks|mobile bookmarks|favou?rites( bar)?|imported( bookmarks)?( from \w+)?|speed dial|unsorted bookmarks|bookmarks_bar|other|synced)$/i;

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => String(s ?? '').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
  return ENTITIES[e.toLowerCase()] ?? m;
});

const folderOf = (stack) => [...stack].reverse().find((f) => f && !ROOT_FOLDER.test(f)) || '';

/** Netscape bookmark HTML, the export format of every major browser. */
function parseNetscape(html) {
  const items = [];
  const stack = [];
  let pending = null;
  for (const [, close, tag, attrs, text] of html.matchAll(/<(\/?)(dl|h3|a)\b([^>]*)>([^<]*)/gi)) {
    const t = tag.toLowerCase();
    if (t === 'h3' && !close) {
      pending = decode(text).trim();
    } else if (t === 'dl') {
      if (close) stack.pop();
      else { stack.push(pending); pending = null; }
    } else if (t === 'a' && !close) {
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
      if (href) items.push({ name: decode(text).trim(), url: decode(href[1] ?? href[2]), folder: folderOf(stack) });
    }
  }
  return items;
}

/** Chromium's on-disk "Bookmarks" file (Chrome, Edge, Brave, Vivaldi…). */
function parseChromium(data) {
  const items = [];
  const walk = (node, stack) => {
    if (node?.type === 'url') items.push({ name: node.name, url: node.url, folder: folderOf(stack) });
    for (const child of node?.children ?? []) walk(child, [...stack, node.name]);
  };
  for (const root of Object.values(data.roots)) walk(root, []);
  return items;
}

/** One link per line: a bare URL, "Title - URL", "Title<TAB>URL" or markdown [Title](URL). */
function parseText(text) {
  const items = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const md = /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/.exec(line);
    if (md) { items.push({ name: md[1], url: md[2] }); continue; }
    const url = /https?:\/\/[^\s<>"']+/i.exec(line)?.[0];
    if (url) {
      items.push({ name: line.replace(url, '').replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, ''), url });
    } else if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(line)) {
      items.push({ name: '', url: `https://${line}` });
    }
  }
  return items;
}

export function parseBookmarks(source) {
  const text = String(source ?? '').trim();
  if (/^[[{]/.test(text)) {
    try {
      const data = JSON.parse(text);
      if (data?.roots) return { format: 'chromium', items: parseChromium(data) };
      if (Array.isArray(data)) {
        return {
          format: 'json',
          items: data.map((b) => ({ name: b.name ?? b.title ?? '', url: b.url ?? b.href ?? '', folder: b.group ?? b.folder ?? '' })),
        };
      }
    } catch { /* not JSON after all */ }
  }
  if (/<a\s[^>]*href\s*=/i.test(text)) return { format: 'html', items: parseNetscape(text) };
  return { format: 'text', items: parseText(text) };
}

/** Comparison key that ignores scheme, www., trailing slash and #hash. */
export function urlKey(url) {
  try {
    const u = new URL(url);
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url;
  }
}

const GENERIC_TITLE = /^(inbox|home|dashboard|feed|log ?in|sign ?in|welcome|overview|client|app|untitled)$/i;
const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cleanName(name, url, site) {
  const u = new URL(url);
  if (site?.root && (u.pathname === '/' || u.pathname === '') && !u.search) return site.name;
  let n = String(name ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\(\d+\+?\)\s*/g, '') // unread counters: "Inbox (3)"
    .replace(/\s*[-–|·]\s*[^\s@]+@[^\s@]+\.\w+/g, '') // account emails
    .trim();
  if (site) {
    // "Some video - YouTube" -> "Some video", "GitHub - owner/repo" -> "owner/repo"
    const sep = '\\s*[-–—|·:]\\s*';
    const nameRe = escapeRe(site.name);
    n = n.replace(new RegExp(`${sep}${nameRe}$`, 'i'), '').trim();
    // Only drop a leading site name from long titles; "Slack | general" needs it.
    if (n.length > 30) n = n.replace(new RegExp(`^${nameRe}${sep}`, 'i'), '').trim();
    if (!n || GENERIC_TITLE.test(n)) n = site.name;
  }
  if (n.length > 40) {
    // Keep the headline of long "Title: tagline" / "Title | Site" names.
    const head = n.split(/\s+[-–—|·]\s+|:\s+/)[0].trim();
    if (head.length >= 3) n = head;
  }
  if (!n) {
    const host = u.hostname.replace(/^www\./, '');
    n = /^[\d.]+$|:/.test(host) ? u.host : host.split('.').slice(-2)[0].replace(/^./, (c) => c.toUpperCase());
  }
  return n.length > 60 ? `${n.slice(0, 57).trimEnd()}…` : n;
}

/**
 * Turn parsed links into bookmarks ready to save.
 * autoSort: popular sites go to their category (most popular first);
 *   everything else keeps its browser folder, or lands in "Other".
 * onlyPopular: drop links that aren't recognised popular sites.
 * Links already in `existing` are returned with duplicate: true.
 */
export function categorize(items, { autoSort = true, onlyPopular = false, existing = [] } = {}) {
  // Same host + same name also counts as a duplicate, so ".../mail/u/0/#inbox"
  // named "Gmail" matches an existing "Gmail" bookmark for mail.google.com.
  const nameKey = (url, name) => `${urlKey(url).split('/')[0]}|${String(name).toLowerCase()}`;
  const existingKeys = new Set(existing.flatMap((b) => [urlKey(b.url), nameKey(b.url, b.name)]));
  const seen = new Set();
  const out = [];
  let skipped = 0;
  items.forEach((item, index) => {
    const url = String(item.url ?? '').trim();
    if (!/^https?:\/\/[^/]/i.test(url)) { skipped++; return; }
    const site = lookupSite(url);
    if (onlyPopular && !site) { skipped++; return; }
    const name = cleanName(item.name, url, site);
    const keys = [urlKey(url), nameKey(url, name)];
    if (keys.some((k) => seen.has(k))) return; // the same link twice in one import
    keys.forEach((k) => seen.add(k));
    const folder = String(item.folder ?? '').trim();
    out.push({
      name,
      url,
      group: autoSort && site ? site.group : folder || (autoSort ? 'Other' : 'Imported'),
      popular: Boolean(site),
      duplicate: keys.some((k) => existingKeys.has(k)),
      rank: site ? site.rank : Infinity,
      index,
    });
  });

  if (autoSort) {
    const firstSeen = new Map();
    out.forEach((b) => { if (!firstSeen.has(b.group)) firstSeen.set(b.group, b.index); });
    const groupRank = (g) => {
      const i = CATEGORY_ORDER.indexOf(g);
      return i === -1 ? CATEGORY_ORDER.length + firstSeen.get(g) : i;
    };
    out.sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.rank - b.rank || a.index - b.index);
  }
  return { items: out.map(({ rank, index, ...b }) => b), skipped };
}
