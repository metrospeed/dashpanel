'use strict';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const slug = (s) => String(s).toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-');

const ENGINES = [
  { id: 'google', name: 'Google', icon: '/api/icon?name=google', url: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}` },
  { id: 'chatgpt', name: 'ChatGPT', icon: '/api/icon?name=chatgpt', url: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}` },
  { id: 'claude', name: 'Claude', icon: '/api/icon?name=claude-ai', url: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}` },
];

let { config, statuses, configError } = window.__STATE__;
let engine = config.settings.defaultSearch;
let editing = false;

// ------------------------------------------------------------------ render

function groupBy(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.group)) groups.set(item.group, []);
    groups.get(item.group).push(item);
  }
  return [...groups];
}

function iconHtml(icon, name, fallbackSrc) {
  const letter = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
  let src = fallbackSrc;
  if (icon && (/^https?:\/\//.test(icon) || icon.startsWith('/'))) src = icon;
  else if (icon && /^[a-z0-9-]+$/.test(icon)) src = `/api/icon?name=${icon}`;
  else if (icon) return `<span class="icon glyph">${esc(icon)}</span>`;
  if (!src) return `<span class="icon letter">${letter}</span>`;
  return `<span class="icon"><img src="${esc(src)}" alt="" decoding="async" data-letter="${letter}"></span>`;
}

// Swap broken icons for a letter tile.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (img.tagName !== 'IMG' || !img.dataset.letter) return;
  const span = img.parentElement;
  span.classList.add('letter');
  span.textContent = img.dataset.letter;
}, true);

const hostOf = (url) => {
  try { return new URL(url).host; } catch { return ''; }
};

function linkAttrs(url) {
  return `href="${esc(url)}"${config.settings.openInNewTab ? ' target="_blank" rel="noopener"' : ''}`;
}

function serviceCard(s) {
  const tag = s.url ? 'a' : 'div';
  const sub = s.description || hostOf(s.url) || s.check?.target || '';
  return `<${tag} class="card" data-kind="service" data-id="${esc(s.id)}" ${s.url ? linkAttrs(s.url) : ''}>
    ${iconHtml(s.icon, s.name, `/api/icon?name=${slug(s.name)}`)}
    <span class="card-body">
      <span class="card-name">${esc(s.name)}</span>
      <span class="card-sub">${esc(sub)}</span>
    </span>
    <span class="status" data-status="pending"><span class="lat"></span><span class="dot"></span></span>
    <span class="history"></span>
  </${tag}>`;
}

function renderServices() {
  const groups = groupBy(config.services);
  const add = (group = '') => (editing ? `<button type="button" class="card add" data-add="service" data-group="${esc(group)}">+ Add service</button>` : '');
  $('#services').innerHTML = groups.length
    ? groups.map(([group, items]) => `
      <div class="group">
        <h2>${esc(group)}</h2>
        <div class="grid">${items.map(serviceCard).join('')}${add(group)}</div>
      </div>`).join('') + (editing ? `<div class="group"><h2 class="muted">New group</h2><div class="grid">${add()}</div></div>` : '')
    : `<div class="empty">No services yet. ${editing ? add() : 'Click <b>✎ Edit</b> to add one, or ask Claude Code.'}</div>`;
  for (const s of config.services) updateStatus(s.id);
}

function renderBookmarks() {
  stopBookmarkDrag();
  const grouped = new Map(groupBy(config.bookmarks));
  const groups = config.bookmarkGroups.map((group) => [group, grouped.get(group) || []]);
  const add = (group = '') => (editing ? `<button type="button" class="bm add" data-add="bookmark" data-group="${esc(group)}">+ Add</button>` : '');
  $('#bookmarks').innerHTML = groups.length || editing
    ? `${editing ? '<p class="bm-help muted">Drag the handles to move bookmarks and folders. Use arrow keys on a handle to move it with the keyboard.</p>' : ''}
      <div class="bm-grid">${groups.map(([group, items]) => `
        <div class="bm-group" data-bm-group="${esc(group)}">
          <div class="bm-group-head">
            ${editing ? `<button type="button" class="bm-grip" data-drag-group="${esc(group)}" aria-label="Move folder ${esc(group)}" title="Drag to reorder; arrow keys also move folders">⠿</button>` : ''}
            <h3>${editing ? `<button type="button" class="bm-folder-edit" data-edit-group="${esc(group)}" title="Edit folder">${esc(group)}</button>` : esc(group)}</h3>
            ${editing ? `<button type="button" class="bm-remove" data-delete-group="${esc(group)}" aria-label="Delete folder ${esc(group)}" title="Delete folder and its bookmarks">×</button>` : ''}
          </div>
          ${items.map((b) => `<div class="bm-row" data-bookmark="${esc(b.id)}">
            ${editing ? `<button type="button" class="bm-grip" data-drag-bookmark="${esc(b.id)}" aria-label="Move bookmark ${esc(b.name)}" title="Drag to move; up/down reorder, left/right change folder">⠿</button>` : ''}
            <a class="bm" data-kind="bookmark" data-id="${esc(b.id)}" draggable="false" ${linkAttrs(b.url)}>
              ${iconHtml(b.icon, b.name, `/api/icon?domain=${encodeURIComponent(new URL(b.url).hostname)}`)}<span>${esc(b.name)}</span></a>
            ${editing ? `<button type="button" class="bm-remove" data-delete-bookmark="${esc(b.id)}" aria-label="Delete bookmark ${esc(b.name)}" title="Delete bookmark">×</button>` : ''}
          </div>`).join('')}
          ${!items.length ? `<p class="bm-empty muted">${editing ? 'Drop bookmarks here' : 'Empty folder'}</p>` : ''}
          ${add(group)}
        </div>`).join('')}
        ${editing ? '<button type="button" class="bm-new-folder" data-new-folder>+ New folder</button>' : ''}
      </div>`
    : '';
}

function updateStatus(id) {
  const card = document.querySelector(`.card[data-id="${CSS.escape(id)}"]`);
  const service = config.services.find((s) => s.id === id);
  if (!card || !service) return;
  const st = statuses[id] || { status: 'pending', history: [] };
  const el = $('.status', card);
  const status = service.check?.type === 'none' ? 'none' : st.status;
  el.dataset.status = status;
  $('.lat', el).textContent = status === 'up' || status === 'warn' ? (st.latency != null ? `${st.latency} ms` : '') : status === 'down' ? 'down' : '';
  const when = st.checkedAt ? ` · ${new Date(st.checkedAt).toLocaleTimeString()}` : '';
  el.title = `${st.message || status}${when}`;
  $('.history', card).innerHTML = (st.history || [])
    .map((h) => `<i data-status="${h.status}" title="${h.status}${h.latency != null ? ` ${h.latency} ms` : ''}"></i>`)
    .join('');
  renderSummary();
}

function renderSummary() {
  const monitored = config.services.filter((s) => s.check?.type !== 'none');
  const counts = { up: 0, warn: 0, down: 0 };
  for (const s of monitored) counts[statuses[s.id]?.status] = (counts[statuses[s.id]?.status] || 0) + 1;
  const total = monitored.length;
  let text = '';
  let tone = 'up';
  if (!total) text = '';
  else if (counts.down) { text = `${counts.down} down · ${counts.up}/${total} up`; tone = 'down'; }
  else if (counts.warn) { text = `${counts.warn} warning · ${counts.up}/${total} up`; tone = 'warn'; }
  else if (counts.up === total) text = `All ${total} services up`;
  else { text = `${counts.up}/${total} up`; tone = 'pending'; }
  const summary = $('#summary');
  summary.textContent = text;
  summary.dataset.status = tone;
  document.title = `${counts.down ? `(${counts.down} down) ` : ''}${config.title}`;
}

function renderEngines() {
  $('#engines').innerHTML = ENGINES.map((e) => `
    <button type="button" role="radio" aria-checked="${e.id === engine}" data-engine="${e.id}">
      <img src="${e.icon}" alt="" data-letter="${e.name[0]}">${e.name}
    </button>`).join('');
  const current = ENGINES.find((e) => e.id === engine);
  $('#engine-icon').src = current.icon;
  $('#q').placeholder = `Search ${current.name} or type a URL…`;
}

/** Apply theme, accent and background. The server renders the same attributes on <html> for the first paint. */
function applyAppearance(st) {
  const root = document.documentElement;
  const bg = st.background;
  root.dataset.theme = st.theme;
  root.dataset.bg = bg.type;
  root.style.setProperty('--accent', st.accent);
  root.style.setProperty('--bg-color', bg.color);
  root.style.setProperty('--bg-image', bg.type === 'image' && bg.image ? `url(${JSON.stringify(bg.image)})` : 'none');
  root.style.setProperty('--bg-dim', `${bg.dim}%`);
  root.style.setProperty('--bg-blur', `${bg.blur}px`);
}

function renderAll() {
  applyAppearance(config.settings);
  $('#title').textContent = config.title;
  const banner = $('#config-error');
  banner.hidden = !configError;
  banner.innerHTML = configError
    ? `<b>dashboard.json has errors — showing the last good version.</b><ul>${configError.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>`
    : '';
  document.body.classList.toggle('editing', editing);
  $('#edit').setAttribute('aria-pressed', editing);
  $('#edit').textContent = editing ? '✓ Done' : '✎ Edit';
  renderEngines();
  renderServices();
  renderBookmarks();
  renderSummary();
}

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  $('#date').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  setTimeout(tickClock, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()) + 20);
}

// ------------------------------------------------------------------ search

const q = $('#q');

function looksLikeUrl(text) {
  if (/\s/.test(text)) return false;
  return /^https?:\/\//i.test(text)
    || /^localhost(:\d+)?(\/.*)?$/i.test(text)
    || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(text)
    || /^([\w-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i.test(text);
}

function go(url, newTab) {
  if (newTab || config.settings.openInNewTab) window.open(url, '_blank', 'noopener');
  else location.href = url;
}

function setEngine(id) {
  engine = id;
  renderEngines();
}

function cycleEngine(step) {
  const i = ENGINES.findIndex((e) => e.id === engine);
  setEngine(ENGINES[(i + step + ENGINES.length) % ENGINES.length].id);
}

q.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    cycleEngine(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Enter') {
    e.preventDefault();
    const text = q.value.trim();
    if (!text) return;
    const url = looksLikeUrl(text)
      ? (/^https?:\/\//i.test(text) ? text : `http${/^(localhost|\d)/.test(text) ? '' : 's'}://${text}`)
      : ENGINES.find((x) => x.id === engine).url(text);
    go(url, e.ctrlKey || e.metaKey);
  } else if (e.key === 'Escape') {
    q.value ? (q.value = '') : q.blur();
  }
});
$('#search').addEventListener('submit', (e) => e.preventDefault());
$('#engines').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-engine]');
  if (!btn) return;
  setEngine(btn.dataset.engine);
  q.focus();
});

// Typing anywhere jumps into the search box.
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || $('#dialog').open) return;
  const active = document.activeElement;
  if (active && (active.matches('input, textarea, select') || active.isContentEditable)) return;
  if (e.key === '/') {
    e.preventDefault();
    q.focus();
  } else if (e.key.length === 1 && e.key !== ' ') {
    q.focus();
  }
});

// ------------------------------------------------------------------ live updates

let rendered = '';

/** Re-render only when the config actually changed; otherwise just refresh statuses. */
function applyConfig(next, error) {
  const key = JSON.stringify([next, error]);
  config = next;
  configError = error;
  if (key !== rendered) {
    rendered = key;
    renderAll();
  } else {
    for (const s of config.services) updateStatus(s.id);
  }
}

function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('state', (e) => {
    const data = JSON.parse(e.data);
    statuses = data.statuses;
    applyConfig(data.config, data.configError);
  });
  es.addEventListener('config', (e) => {
    const data = JSON.parse(e.data);
    applyConfig(data.config, data.configError);
  });
  es.addEventListener('status', (e) => {
    const { id, state } = JSON.parse(e.data);
    statuses[id] = state;
    updateStatus(id);
  });
}

$('#refresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    await fetch('/api/check', { method: 'POST' });
  } finally {
    btn.disabled = false;
  }
});

// ------------------------------------------------------------------ editing

async function api(method, path, body, retried) {
  const token = localStorage.getItem('dashpanel.token');
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried) {
    const next = prompt('This dashboard needs its DASHPANEL_TOKEN to save changes:');
    if (next) {
      localStorage.setItem('dashpanel.token', next.trim());
      return api(method, path, body, true);
    }
  }
  if (!res.ok) throw new Error([data.error || `HTTP ${res.status}`, ...(data.details || [])].join('\n'));
  return data;
}

const dialog = $('#dialog');
const form = $('#dialog-form');
let onSave = null;

function field({ name, label, type = 'text', value = '', placeholder = '', required, options, list, hint, cls = '', attrs = '' }) {
  const id = `f-${name}`;
  let input;
  if (type === 'select') {
    input = `<select id="${id}" name="${name}">${options.map(([v, l]) => `<option value="${esc(v)}"${v === value ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  } else if (type === 'checkbox') {
    return `<label class="check ${cls}"><input type="checkbox" id="${id}" name="${name}"${value ? ' checked' : ''}> ${esc(label)}</label>`;
  } else {
    input = `<input id="${id}" name="${name}" type="${type}" value="${esc(value)}" placeholder="${esc(placeholder)}"${required ? ' required' : ''}${list ? ` list="${list}"` : ''} ${attrs}>`;
  }
  return `<label class="${cls}" for="${id}"><span>${esc(label)}</span>${input}${hint ? `<small>${hint}</small>` : ''}</label>`;
}

function datalist(id, values) {
  return `<datalist id="${id}">${[...new Set(values)].map((v) => `<option value="${esc(v)}">`).join('')}</datalist>`;
}

let onClose = null;
dialog.addEventListener('close', () => {
  const fn = onClose;
  onClose = null;
  fn?.();
});

function openDialog({ title, fields, onSubmit, onDelete, onTest, onDismiss, saveLabel = 'Save', wide = false }) {
  onClose = onDismiss;
  dialog.classList.toggle('wide', wide);
  $('#dialog-save').textContent = saveLabel;
  $('#dialog-save').disabled = false;
  $('#dialog-title').textContent = title;
  $('#dialog-fields').innerHTML = fields;
  $('#dialog-msg').textContent = '';
  $('#dialog-msg').className = 'dialog-msg';
  $('#dialog-delete').hidden = !onDelete;
  $('#dialog-delete').onclick = onDelete && (() => run(onDelete));
  $('#dialog-test').hidden = !onTest;
  $('#dialog-test').onclick = onTest && (() => run(onTest, true));
  onSave = onSubmit;
  dialog.showModal();
  $('input, select', form)?.focus();
}

async function run(fn, keepOpen) {
  const msg = $('#dialog-msg');
  msg.className = 'dialog-msg';
  msg.textContent = keepOpen ? 'Working…' : '';
  try {
    const result = await fn();
    if (keepOpen) {
      msg.textContent = result;
    } else if (result !== false) { // false = the user backed out of a confirm()
      dialog.close();
    }
  } catch (err) {
    msg.className = 'dialog-msg error';
    msg.textContent = err.message;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (onSave) run(onSave);
});
$('#dialog-cancel').addEventListener('click', () => dialog.close());

const val = (name) => form.elements[name]?.value.trim() ?? '';
const optional = (name) => val(name) || null; // null tells the API to clear the field

function serviceFields(s = {}, group = '') {
  const c = s.check || { type: 'http' };
  return `
    ${field({ name: 'name', label: 'Name', value: s.name, required: true, placeholder: 'Jellyfin' })}
    ${field({ name: 'url', label: 'URL', type: 'url', value: s.url, placeholder: 'http://192.168.1.20:8096' })}
    <div class="row">
      ${field({ name: 'group', label: 'Group', value: s.group ?? group, list: 'groups', placeholder: 'Media' })}
      ${field({ name: 'icon', label: 'Icon', value: s.icon, placeholder: 'jellyfin', hint: '<a href="https://dashboardicons.com" target="_blank" rel="noopener">dashboard-icons</a> name, image URL or emoji' })}
    </div>
    ${field({ name: 'description', label: 'Description', value: s.description, placeholder: 'Optional subtitle' })}
    <fieldset>
      <legend>Status check</legend>
      <div class="row">
        ${field({ name: 'type', label: 'Type', type: 'select', value: c.type, options: [['http', 'HTTP'], ['tcp', 'TCP port'], ['ping', 'Ping'], ['none', 'None']] })}
        ${field({ name: 'interval', label: 'Interval (s)', type: 'number', value: c.interval ?? '', placeholder: String(config.settings.checkInterval) })}
      </div>
      ${field({ name: 'target', label: 'Target', value: c.target, cls: 'not-none', hint: 'Leave empty to use the URL' })}
      <div class="row http-only">
        ${field({ name: 'expectStatus', label: 'Expected status', value: c.expectStatus ?? '', placeholder: '200-299,401' })}
        ${field({ name: 'keyword', label: 'Body contains', value: c.keyword, placeholder: 'Optional' })}
      </div>
      ${field({ name: 'insecure', label: 'Ignore TLS certificate errors', type: 'checkbox', value: c.insecure !== false, cls: 'http-only' })}
    </fieldset>
    ${datalist('groups', config.services.map((x) => x.group))}`;
}

function syncCheckFields() {
  const type = val('type');
  form.querySelectorAll('.http-only').forEach((el) => { el.hidden = type !== 'http'; });
  form.querySelectorAll('.not-none').forEach((el) => { el.hidden = type === 'none'; });
  const target = form.elements.target;
  if (target) target.placeholder = { http: 'http://host:port/health', tcp: 'host:port', ping: 'host or IP' }[type] || '';
}
form.addEventListener('change', (e) => { if (e.target.name === 'type') syncCheckFields(); });

function readService() {
  const type = val('type');
  return {
    name: val('name'),
    url: optional('url'),
    group: val('group') || 'Services',
    icon: optional('icon'),
    description: optional('description'),
    check: {
      type,
      target: type === 'none' ? null : optional('target'),
      interval: val('interval') ? Number(val('interval')) : null,
      expectStatus: type === 'http' ? optional('expectStatus') : null,
      keyword: type === 'http' ? optional('keyword') : null,
      insecure: type === 'http' ? form.elements.insecure.checked : null,
    },
  };
}

function stripNulls(obj) {
  return JSON.parse(JSON.stringify(obj, (_k, v) => (v === null ? undefined : v)));
}

function editService(id, group) {
  const s = id ? config.services.find((x) => x.id === id) : undefined;
  openDialog({
    title: s ? `Edit ${s.name}` : 'Add service',
    fields: serviceFields(s, group),
    onSubmit: () => (s ? api('PATCH', `/api/services/${encodeURIComponent(s.id)}`, readService()) : api('POST', '/api/services', stripNulls(readService()))),
    onDelete: s && (() => confirm(`Delete ${s.name}?`) && api('DELETE', `/api/services/${encodeURIComponent(s.id)}`)),
    onTest: async () => {
      const { url, check } = stripNulls(readService());
      const { result: r } = await api('POST', '/api/test-check', { url, check });
      const icon = { up: '✓', warn: '!', down: '✗', none: '–' }[r.status];
      return `${icon} ${r.status}${r.latency != null ? ` · ${r.latency} ms` : ''} · ${r.message}`;
    },
  });
  syncCheckFields();
}

function editBookmark(id, group) {
  const b = id ? config.bookmarks.find((x) => x.id === id) : undefined;
  openDialog({
    title: b ? `Edit ${b.name}` : 'Add bookmark',
    fields: `
      ${field({ name: 'name', label: 'Name', value: b?.name, required: true, placeholder: 'GitHub' })}
      ${field({ name: 'url', label: 'URL', type: 'url', value: b?.url, required: true, placeholder: 'https://github.com' })}
      <div class="row">
        ${field({ name: 'group', label: 'Group', value: b?.group ?? group, list: 'bm-groups', placeholder: 'Dev' })}
        ${field({ name: 'icon', label: 'Icon', value: b?.icon, placeholder: 'Site favicon', hint: 'Optional: icon name, URL or emoji' })}
      </div>
      ${datalist('bm-groups', config.bookmarkGroups)}`,
    onSubmit: () => {
      const body = { name: val('name'), url: val('url'), group: val('group') || 'Bookmarks', icon: optional('icon') };
      return b ? api('PATCH', `/api/bookmarks/${encodeURIComponent(b.id)}`, body) : api('POST', '/api/bookmarks', stripNulls(body));
    },
    onDelete: b && (() => confirm(`Delete ${b.name}?`) && api('DELETE', `/api/bookmarks/${encodeURIComponent(b.id)}`)),
  });
}

// ------------------------------------------------------------------ bookmark organization

let bookmarkSaving = false;
let bookmarkDrag = null;
let bookmarkScrollFrame;
let bookmarkClickSuppressedUntil = 0;

function bookmarkMessage(text, error = false) {
  const message = $('#bookmark-msg');
  message.hidden = !text;
  message.textContent = text;
  message.classList.toggle('error', error);
}

async function saveBookmarkLayout(method, url, body, message = 'Bookmark layout saved.') {
  if (bookmarkSaving) return false;
  bookmarkSaving = true;
  $('#bookmarks').classList.add('saving');
  bookmarkMessage('Saving…');
  try {
    const result = await api(method, url, body);
    const next = Array.isArray(result.bookmarks) ? { ...config, ...result } : await api('GET', '/api/config');
    applyConfig(next, null);
    bookmarkMessage(message);
    return true;
  } catch (err) {
    bookmarkMessage(err.message, true);
    if (dialog.open) {
      $('#dialog-msg').className = 'dialog-msg error';
      $('#dialog-msg').textContent = err.message;
    }
    return false;
  } finally {
    bookmarkSaving = false;
    $('#bookmarks').classList.remove('saving');
  }
}

function editBookmarkGroup(group) {
  const existing = group !== undefined;
  openDialog({
    title: existing ? `Edit folder ${group}` : 'New bookmark folder',
    fields: `${field({ name: 'name', label: 'Folder name', value: group, required: true })}
      ${existing ? field({ name: 'beforeGroup', label: 'Place before', type: 'select', value: config.bookmarkGroups[config.bookmarkGroups.indexOf(group) + 1] || '', options: [...config.bookmarkGroups.filter((g) => g !== group).map((g) => [g, g]), ['', 'End of folders']] }) : ''}`,
    onSubmit: async () => (await saveBookmarkLayout(existing ? 'PATCH' : 'POST', '/api/bookmark-groups', existing
      ? { group, name: val('name'), beforeGroup: val('beforeGroup') || null }
      : { name: val('name') }, 'Folder saved.')) || false,
    onDelete: existing && (() => removeBookmarkGroup(group)),
  });
}

async function removeBookmarkGroup(group) {
  const count = config.bookmarks.filter((b) => b.group === group).length;
  if (!confirm(`Delete folder "${group}"${count ? ` and ${count === 1 ? 'its bookmark' : `all ${count} bookmarks in it`}` : ''}? This cannot be undone.`)) return false;
  return saveBookmarkLayout('DELETE', `/api/bookmark-groups/${encodeURIComponent(group)}`, undefined, 'Folder deleted.');
}

function clearBookmarkDropTargets() {
  $('#bookmarks').querySelectorAll('.drop-before, .drop-after, .drop-folder, .folder-before, .folder-after')
    .forEach((el) => el.classList.remove('drop-before', 'drop-after', 'drop-folder', 'folder-before', 'folder-after'));
}

function stopBookmarkDrag() {
  const drag = bookmarkDrag;
  bookmarkDrag = null;
  cancelAnimationFrame(bookmarkScrollFrame);
  document.body.classList.remove('bookmark-dragging');
  clearBookmarkDropTargets();
  if (!drag) return;
  drag.source.classList.remove('dragging');
  if (drag.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
  if (drag.active) {
    bookmarkClickSuppressedUntil = Date.now() + 300;
    bookmarkMessage('');
  }
}

function updateBookmarkDropTarget() {
  const drag = bookmarkDrag;
  if (!drag?.active) return;
  clearBookmarkDropTargets();
  drag.target = null;
  const folder = document.elementFromPoint(drag.x, drag.y)?.closest('[data-bm-group]');
  if (!folder) return;
  const group = folder.dataset.bmGroup;
  if (drag.kind === 'group') {
    if (group === drag.id) return;
    const rect = folder.getBoundingClientRect();
    const after = drag.x > rect.left + rect.width / 2;
    const groups = config.bookmarkGroups.filter((g) => g !== drag.id);
    drag.target = { group: drag.id, beforeGroup: after ? groups[groups.indexOf(group) + 1] || null : group };
    folder.classList.add(after ? 'folder-after' : 'folder-before');
  } else {
    const rows = [...folder.querySelectorAll('[data-bookmark]')].filter((row) => row.dataset.bookmark !== drag.id);
    const before = rows.find((row) => drag.y < row.getBoundingClientRect().top + row.getBoundingClientRect().height / 2);
    drag.target = { id: drag.id, group, beforeId: before?.dataset.bookmark || null };
    folder.classList.add('drop-folder');
    (before || rows.at(-1))?.classList.add(before ? 'drop-before' : 'drop-after');
  }
}

function scrollBookmarkDrag() {
  if (!bookmarkDrag?.active) return;
  const y = bookmarkDrag.y;
  const speed = y < 64 ? -14 : y > innerHeight - 64 ? 14 : 0;
  if (speed) { window.scrollBy(0, speed); updateBookmarkDropTarget(); }
  bookmarkScrollFrame = requestAnimationFrame(scrollBookmarkDrag);
}

$('#bookmarks').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('[data-drag-bookmark], [data-drag-group]');
  if (!editing || bookmarkSaving || !handle || e.button !== 0 || !e.isPrimary) return;
  e.preventDefault();
  handle.focus({ preventScroll: true });
  const kind = handle.hasAttribute('data-drag-group') ? 'group' : 'bookmark';
  bookmarkDrag = { handle, kind, id: kind === 'group' ? handle.dataset.dragGroup : handle.dataset.dragBookmark,
    source: handle.closest(kind === 'group' ? '[data-bm-group]' : '[data-bookmark]'),
    pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, active: false };
  handle.setPointerCapture(e.pointerId);
});

$('#bookmarks').addEventListener('pointermove', (e) => {
  const drag = bookmarkDrag;
  if (!drag || e.pointerId !== drag.pointerId) return;
  drag.x = e.clientX;
  drag.y = e.clientY;
  if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 6) {
    drag.active = true;
    drag.source.classList.add('dragging');
    document.body.classList.add('bookmark-dragging');
    bookmarkMessage('Drop to save the new position. Press Escape to cancel.');
    scrollBookmarkDrag();
  }
  if (drag.active) { e.preventDefault(); updateBookmarkDropTarget(); }
});

$('#bookmarks').addEventListener('pointerup', async (e) => {
  if (!bookmarkDrag || e.pointerId !== bookmarkDrag.pointerId) return;
  bookmarkDrag.x = e.clientX;
  bookmarkDrag.y = e.clientY;
  updateBookmarkDropTarget();
  const { target, kind } = bookmarkDrag;
  stopBookmarkDrag();
  if (target) await saveBookmarkLayout(kind === 'group' ? 'PATCH' : 'POST', kind === 'group' ? '/api/bookmark-groups' : '/api/bookmarks/move', target);
});
$('#bookmarks').addEventListener('pointercancel', stopBookmarkDrag);
$('#bookmarks').addEventListener('lostpointercapture', () => { if (bookmarkDrag) stopBookmarkDrag(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bookmarkDrag) { e.preventDefault(); stopBookmarkDrag(); } });

$('#bookmarks').addEventListener('keydown', async (e) => {
  const handle = e.target.closest('[data-drag-bookmark], [data-drag-group]');
  if (!editing || !handle || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
  e.preventDefault();
  if (bookmarkSaving || bookmarkDrag) return;
  const backwards = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  const group = handle.dataset.dragGroup;
  if (group !== undefined) {
    const index = config.bookmarkGroups.indexOf(group);
    if (backwards && index === 0 || !backwards && index === config.bookmarkGroups.length - 1) return;
    await saveBookmarkLayout('PATCH', '/api/bookmark-groups', { group, beforeGroup: config.bookmarkGroups[index + (backwards ? -1 : 2)] || null });
  } else {
    const id = handle.dataset.dragBookmark;
    const item = config.bookmarks.find((b) => b.id === id);
    if (!item) return;
    let group = item.group;
    let beforeId = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      group = config.bookmarkGroups[config.bookmarkGroups.indexOf(group) + (backwards ? -1 : 1)];
      if (group === undefined) return;
    } else {
      const items = config.bookmarks.filter((b) => b.group === group);
      const index = items.findIndex((b) => b.id === id);
      if (backwards && index === 0 || !backwards && index === items.length - 1) return;
      beforeId = items[index + (backwards ? -1 : 2)]?.id || null;
    }
    await saveBookmarkLayout('POST', '/api/bookmarks/move', { id, group, beforeId });
  }
  const attribute = group !== undefined ? 'data-drag-group' : 'data-drag-bookmark';
  $(`[${attribute}="${CSS.escape(handle.getAttribute(attribute))}"]`)?.focus({ preventScroll: true });
});

$('#bookmarks').addEventListener('click', async (e) => {
  if (!editing) return;
  if (Date.now() < bookmarkClickSuppressedUntil) { e.preventDefault(); e.stopPropagation(); return; }
  const remove = e.target.closest('[data-delete-bookmark], [data-delete-group]');
  const folder = e.target.closest('[data-edit-group], [data-new-folder]');
  if (!remove && !folder) return;
  e.preventDefault();
  e.stopPropagation();
  if (bookmarkSaving) return;
  if (folder) { editBookmarkGroup(folder.dataset.editGroup); return; }
  if (remove.hasAttribute('data-delete-group')) { await removeBookmarkGroup(remove.dataset.deleteGroup); return; }
  const item = config.bookmarks.find((b) => b.id === remove.dataset.deleteBookmark);
  if (item && confirm(`Delete bookmark "${item.name}"?`)) {
    await saveBookmarkLayout('DELETE', `/api/bookmarks/${encodeURIComponent(item.id)}`, undefined, 'Bookmark deleted.');
  }
});

const THEMES = [['midnight', 'Midnight'], ['slate', 'Slate'], ['nord', 'Nord'], ['dracula', 'Dracula'], ['light', 'Light']];
const ACCENTS = ['#ea580c', '#e11d48', '#d946ef', '#8b5cf6', '#3b82f6', '#06b6d4', '#10b981', '#84cc16', '#eab308'];

function readAppearance() {
  return {
    theme: val('theme'),
    accent: val('accent'),
    background: {
      type: val('bgType'),
      color: val('bgColor'),
      image: val('bgImage'),
      dim: Number(val('bgDim')),
      blur: Number(val('bgBlur')),
    },
  };
}

function syncBackgroundFields() {
  const type = val('bgType');
  form.querySelectorAll('.bg-solid').forEach((el) => { el.hidden = type !== 'solid'; });
  form.querySelectorAll('.bg-image').forEach((el) => { el.hidden = type !== 'image'; });
  $('#bg-dim-out').textContent = `${val('bgDim')}%`;
  $('#bg-blur-out').textContent = `${val('bgBlur')}px`;
  form.querySelectorAll('[data-swatch]').forEach((el) => el.setAttribute('aria-pressed', el.dataset.swatch === val('accent')));
}

function editSettings() {
  const st = config.settings;
  const bg = st.background;
  openDialog({
    title: 'Settings',
    fields: `
      ${field({ name: 'title', label: 'Title', value: config.title })}
      <div class="row">
        ${field({ name: 'defaultSearch', label: 'Default search', type: 'select', value: st.defaultSearch, options: ENGINES.map((e) => [e.id, e.name]) })}
        ${field({ name: 'checkInterval', label: 'Check every (s)', type: 'number', value: st.checkInterval })}
        ${field({ name: 'timeout', label: 'Timeout (ms)', type: 'number', value: st.timeout })}
      </div>
      ${field({ name: 'openInNewTab', label: 'Open links in a new tab', type: 'checkbox', value: st.openInNewTab })}
      <fieldset>
        <legend>Appearance</legend>
        <div class="row">
          ${field({ name: 'theme', label: 'Theme', type: 'select', value: st.theme, options: THEMES })}
          ${field({ name: 'bgType', label: 'Background', type: 'select', value: bg.type, options: [['gradient', 'Accent glow'], ['solid', 'Solid colour'], ['image', 'Image']] })}
        </div>
        <div class="stack"><span>Accent colour</span>
          <span class="accent-row">
            <input id="f-accent" name="accent" type="color" value="${esc(st.accent)}" aria-label="Custom accent colour">
            ${ACCENTS.map((c) => `<button type="button" class="swatch" data-swatch="${c}" style="--c:${c}" aria-label="Accent ${c}"></button>`).join('')}
          </span>
        </div>
        ${field({ name: 'bgColor', label: 'Background colour', type: 'color', value: bg.color, cls: 'bg-solid' })}
        <div class="bg-image">
          <div class="stack"><span>Image</span>
            <span class="upload-row">
              <input id="f-bgImage" name="bgImage" type="text" value="${esc(bg.image)}" placeholder="https://… or upload" aria-label="Image URL">
              <label class="file-btn">Upload…<input type="file" id="bg-file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden></label>
            </span>
          </div>
          <div class="row">
            <label for="f-bgDim"><span>Dim <output id="bg-dim-out"></output></span><input id="f-bgDim" name="bgDim" type="range" min="0" max="90" step="5" value="${bg.dim}"></label>
            <label for="f-bgBlur"><span>Blur <output id="bg-blur-out"></output></span><input id="f-bgBlur" name="bgBlur" type="range" min="0" max="30" step="1" value="${bg.blur}"></label>
          </div>
        </div>
      </fieldset>`,
    onSubmit: async () => {
      const saved = await api('PATCH', '/api/settings', {
        title: val('title'),
        defaultSearch: val('defaultSearch'),
        checkInterval: Number(val('checkInterval')),
        timeout: Number(val('timeout')),
        openInNewTab: form.elements.openInNewTab.checked,
        ...readAppearance(),
      });
      // Update now so closing the dialog doesn't flash the old look before the SSE update lands.
      config = { ...config, title: saved.title, settings: saved.settings };
    },
    // Closing without saving undoes the live preview.
    onDismiss: () => applyAppearance(config.settings),
  });

  syncBackgroundFields();
  const preview = () => {
    syncBackgroundFields();
    applyAppearance({ ...st, ...readAppearance() });
  };
  $('#dialog-fields').addEventListener('input', preview);
  $('#dialog-fields').addEventListener('change', preview);
  $('#dialog-fields').addEventListener('click', (e) => {
    const swatch = e.target.closest('[data-swatch]');
    if (!swatch) return;
    form.elements.accent.value = swatch.dataset.swatch;
    preview();
  });
  $('#bg-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const msg = $('#dialog-msg');
    msg.className = 'dialog-msg';
    msg.textContent = 'Uploading…';
    try {
      const data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
      });
      const { url } = await api('POST', '/api/background', { data });
      form.elements.bgImage.value = url;
      msg.textContent = '';
      preview();
    } catch (err) {
      msg.className = 'dialog-msg error';
      msg.textContent = err.message;
    }
  });
}

// Browser exports embed every favicon as a data URI; drop them before uploading.
const stripIcons = (text) => text.replace(/\s(ICON|ICON_URI)\s*=\s*"[^"]*"/gi, '');

function importBookmarks() {
  let source = '';
  let preview = null;
  let timer;

  openDialog({
    title: 'Import bookmarks',
    wide: true,
    saveLabel: 'Import',
    fields: `
      <label for="f-file"><span>Bookmarks file</span>
        <input id="f-file" name="file" type="file" accept=".html,.htm,.json,.txt,.md,text/html,application/json,text/plain">
        <small>Chrome / Edge / Brave: Bookmark manager → ⋮ → Export bookmarks. Firefox: Bookmarks → Manage → Import and Backup → Export to HTML. Chromium's raw <code>Bookmarks</code> file works too.</small>
      </label>
      <label for="f-paste"><span>…or paste links (one per line) or bookmark HTML</span>
        <textarea id="f-paste" name="paste" rows="3" placeholder="https://github.com&#10;Proxmox docs - https://pve.proxmox.com/wiki"></textarea>
      </label>
      <div class="row">
        ${field({ name: 'autoSort', label: 'Auto-sort popular sites into categories', type: 'checkbox', value: true })}
        ${field({ name: 'onlyPopular', label: 'Only recognised popular sites', type: 'checkbox', value: false })}
      </div>
      <div id="import-preview" class="import-preview"></div>`,
    onSubmit: () => {
      const items = selectedItems();
      if (!items.length) throw new Error('Nothing selected to import.');
      return api('POST', '/api/bookmarks/import', { items });
    },
  });
  const box = $('#import-preview');
  updateSaveButton();

  async function refresh() {
    clearTimeout(timer);
    preview = null;
    if (!source.trim()) {
      box.innerHTML = '';
      updateSaveButton();
      return;
    }
    box.innerHTML = '<p class="muted">Reading…</p>';
    try {
      preview = await api('POST', '/api/bookmarks/import', {
        source: stripIcons(source),
        autoSort: form.elements.autoSort.checked,
        onlyPopular: form.elements.onlyPopular.checked,
        dryRun: true,
      });
      renderPreview();
    } catch (err) {
      box.innerHTML = `<p class="dialog-msg error">${esc(err.message)}</p>`;
    }
    updateSaveButton();
  }

  function renderPreview() {
    const { items, skipped } = preview;
    if (!items.length) {
      box.innerHTML = `<p class="muted">No http(s) links found${skipped ? ` (${skipped} skipped)` : ''}.</p>`;
      return;
    }
    const dupes = items.filter((b) => b.duplicate).length;
    const groups = groupBy(items.map((b, i) => ({ ...b, i })));
    box.innerHTML = `
      <p class="ip-summary">${items.length} links · <b>${items.length - dupes} new</b>${dupes ? ` · ${dupes} already added` : ''}${skipped ? ` · ${skipped} skipped` : ''}</p>
      ${groups.map(([group, list], gi) => `
        <fieldset class="ip-group">
          <legend>
            <input type="checkbox" data-group-toggle="${gi}" aria-label="Select all in ${esc(group)}"${list.some((b) => !b.duplicate) ? ' checked' : ' disabled'}>
            <input class="ip-group-name" data-group-name="${gi}" value="${esc(group)}" aria-label="Group name">
            <span class="muted">${list.length}</span>
          </legend>
          ${list.map((b) => `
            <label class="ip-item${b.duplicate ? ' dup' : ''}">
              <input type="checkbox" data-i="${b.i}" data-g="${gi}"${b.duplicate ? ' disabled' : ' checked'}>
              <span class="ip-name">${esc(b.name)}</span>
              <span class="ip-host">${esc(hostOf(b.url))}</span>
              ${b.duplicate ? '<em>already added</em>' : b.popular ? '<em class="pop">popular</em>' : ''}
            </label>`).join('')}
        </fieldset>`).join('')}`;
  }

  function selectedItems() {
    if (!preview) return [];
    const names = {};
    box.querySelectorAll('[data-group-name]').forEach((el) => { names[el.dataset.groupName] = el.value.trim(); });
    return [...box.querySelectorAll('input[data-i]:checked')].map((el) => {
      const { name, url, group } = preview.items[el.dataset.i];
      return { name, url, group: names[el.dataset.g] || group };
    });
  }

  function updateSaveButton() {
    const n = selectedItems().length;
    $('#dialog-save').disabled = !n;
    $('#dialog-save').textContent = n ? `Import ${n}` : 'Import';
  }

  $('#f-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    source = await file.text();
    $('#f-paste').value = '';
    refresh();
  });
  $('#f-paste').addEventListener('input', (e) => {
    source = e.target.value;
    $('#f-file').value = '';
    clearTimeout(timer);
    timer = setTimeout(refresh, 400);
  });
  for (const name of ['autoSort', 'onlyPopular']) form.elements[name].addEventListener('change', refresh);
  // Enter while renaming a group shouldn't submit the import.
  box.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  box.addEventListener('change', (e) => {
    const toggle = e.target.dataset.groupToggle;
    if (toggle !== undefined) {
      box.querySelectorAll(`input[data-g="${toggle}"]:not(:disabled)`).forEach((el) => { el.checked = e.target.checked; });
    }
    updateSaveButton();
  });
}

$('#edit').addEventListener('click', () => {
  editing = !editing;
  renderAll();
});
$('#settings-btn').addEventListener('click', editSettings);
$('#updates-btn').addEventListener('click', showUpdates);
$('#import-btn').addEventListener('click', importBookmarks);

async function showUpdates() {
  let info;
  let closed = false;
  let timer;
  const save = $('#dialog-save');
  const fields = $('#dialog-fields');
  const msg = $('#dialog-msg');
  const fail = (err) => {
    if (closed) return;
    msg.className = 'dialog-msg error';
    msg.textContent = err.message;
    save.disabled = false;
  };
  const check = async () => {
    save.disabled = true;
    msg.textContent = '';
    try {
      const next = await api('POST', '/api/updates/check', {});
      if (closed) return;
      info = next;
      fields.innerHTML = `<p>${info.available === null ? 'Installed revision is unavailable.' : info.available ? 'A different revision is available on GitHub.' : 'You are up to date.'}</p>
        <p class="muted">Installed: ${esc(info.current?.slice(0, 7) || 'unknown')}<br>Latest (${esc(info.branch)}): <a href="${esc(info.url)}" target="_blank" rel="noopener">${esc(info.latest.slice(0, 7))}</a></p>
        <p>${info.mode === 'systemd' ? 'Updating keeps your config and restarts dashpanel. The page will reconnect automatically.' : 'Run this in the dashpanel checkout on the host to update. Local changes are kept; conflicting history blocks the update.'}</p>
        ${info.mode === 'systemd' ? '' : `<pre class="update-command">${info.mode === 'docker' ? 'node update.js --docker' : 'node update.js'}</pre>${info.mode === 'docker' ? '' : '<small>Then restart your Node process. For systemd installs, re-run install.sh once to enable the dashboard updater.</small>'}`}`;
      save.textContent = info.mode === 'systemd' && info.available ? 'Update & restart' : 'Check again';
    } catch (err) {
      if (!closed) fields.innerHTML = '<p>Could not check GitHub. Try again in a moment.</p>';
      fail(err);
    } finally { if (!closed) save.disabled = false; }
  };
  const waitForUpdate = async (deadline) => {
    if (closed) return;
    if (Date.now() > deadline) {
      fail(new Error('Update timed out. Check journalctl -u dashpanel-update.service on the host.'));
      return;
    }
    try {
      const status = await api('GET', '/api/updates');
      if (closed) return;
      if (status.state === 'failed') { fail(new Error(status.error)); return; }
      if (status.state === 'complete' && status.runningRevision === status.current) {
        location.reload();
        return;
      }
      msg.textContent = status.state === 'complete' ? 'Restarting dashpanel…' : 'Downloading the update…';
    } catch { /* Brief disconnects are expected during the restart. */ }
    timer = setTimeout(() => waitForUpdate(deadline), 2000);
  };
  openDialog({
    title: 'dashpanel updates', fields: '<p>Checking GitHub…</p>', saveLabel: 'Check again',
    onDismiss: () => { closed = true; clearTimeout(timer); },
    onSubmit: async () => {
      if (save.disabled) return false;
      if (info?.mode !== 'systemd' || !info.available) { await check(); return false; }
      save.disabled = true;
      try {
        await api('POST', '/api/updates/install', {});
        msg.className = 'dialog-msg';
        msg.textContent = 'Update queued…';
        timer = setTimeout(() => waitForUpdate(Date.now() + 300_000), 1000);
      } catch (err) { fail(err); }
      return false;
    },
  });
  await check();
}

document.addEventListener('click', (e) => {
  if (!editing) return;
  const add = e.target.closest('[data-add]');
  const item = e.target.closest('[data-kind][data-id]');
  if (add) {
    (add.dataset.add === 'service' ? editService : editBookmark)(null, add.dataset.group);
  } else if (item) {
    e.preventDefault();
    (item.dataset.kind === 'service' ? editService : editBookmark)(item.dataset.id);
  }
});

// ------------------------------------------------------------------ boot

applyConfig(config, configError);
tickClock();
connect();
