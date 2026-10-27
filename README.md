<img src="assets/icon.svg" width="64" height="64" alt="">

# dashpanel

A fast homelab start page for your browser.

- Live status for each homelab service, with icons and links.
- A search bar that switches between Google, ChatGPT and Claude.
- Bookmarks, grouped into columns. You can import them from any browser, and popular sites are sorted into categories automatically.
- Themes, accent colours, and a background that can be a gradient, a solid colour or your own image.
- An MCP server so Claude Code can add and change services for you.

No dependencies and no build step: plain Node and a small vanilla JS page. The server fills in the HTML with the current config and statuses, so the first paint needs no extra requests. Icons are cached on disk after the first fetch.

## Install

### Linux (one line)

```sh
curl -fsSL https://raw.githubusercontent.com/metrospeed/dashpanel/main/install.sh | sudo bash
```

This works on Debian, Ubuntu (a Proxmox LXC is fine), Fedora, RHEL-likes, Arch and openSUSE. The script:

- installs Node.js if it's missing or older than 18, plus `git`, `curl` and `ping`;
- puts dashpanel in `/opt/dashpanel`;
- runs it as a hardened `dashpanel` systemd service on port 7676;
- generates an edit token in `/etc/dashpanel.env`.

When it finishes, it prints the URL, the token and a ready-to-paste Claude Code command. Run the same line again to update. Your config is kept.

Options go after `bash -s --`, for example `curl -fsSL …/install.sh | sudo bash -s -- --port 8080`:

| Option | |
| --- | --- |
| `--port PORT` | Listen on another port (default 7676) |
| `--dir PATH` | Install somewhere other than `/opt/dashpanel` |
| `--docker` | Run with Docker Compose instead of systemd |
| `--no-service` | Only install the files and Node |
| `--uninstall` | Remove the service; add `--purge` to delete the files and config too |

### Docker

```sh
git clone https://github.com/metrospeed/dashpanel.git && cd dashpanel
echo "DASHPANEL_TOKEN=$(openssl rand -hex 16)" > .env
docker compose up -d --build
```

### Anywhere with Node 18+

```sh
git clone https://github.com/metrospeed/dashpanel.git && cd dashpanel
npm start            # http://localhost:7676
```

Set `http://<server>:7676` as your browser's home page. For new tabs, use an extension such as *New Tab Redirect*.

The config lives in `config/dashboard.json`. It is created from `config/dashboard.example.json` on first run and is git-ignored, so updates never overwrite it.

| Env var | Default | |
| --- | --- | --- |
| `PORT` | `7676` | |
| `HOST` | all interfaces | |
| `DASHPANEL_CONFIG` | `config/dashboard.json` | |
| `DASHPANEL_TOKEN` | *(unset)* | When it isn't set, edits are accepted only from localhost. When it is set, every edit needs the token. The browser asks for it once and remembers it. |

## Using it

- **Search**: start typing anywhere, or press `/`, and focus jumps to the search box. `Tab` / `Shift+Tab` cycle Google → ChatGPT → Claude. `Ctrl+Enter` opens in a new tab. Typing a URL or IP (`192.168.1.5:8080`, `github.com`) goes straight there.
- **Status**: each card shows latency and a bar of recent checks. Hover the dot to see the last result. The tab title shows `(n down)` while something is down.
- **Edit**: click **✎ Edit** at the bottom to add, edit or delete services and bookmarks. **Test check** tries a check before you save it. Changes appear in every open tab right away.
- **Settings**: in edit mode, click **⚙ Settings**. Changes preview live, and **Cancel** undoes them. You can change:
  - **Theme**: Midnight, Slate, Nord, Dracula or Light.
  - **Accent colour**: pick a swatch or any custom colour.
  - **Background**: an accent glow, a solid colour, or an image. For an image, give a URL or upload a file, then set how much it's dimmed and blurred.
- **Import bookmarks**: in edit mode, click **⇪ Import bookmarks**.
- **Organize bookmarks**: in edit mode, use **×** to delete a bookmark or folder. Deleting a folder asks before deleting all bookmarks inside it. Drag a bookmark's **⠿** handle to change its order or move it to another folder; the highlighted line shows where it will land. Drag a folder's handle to reorder folders. Changes save immediately and appear in other open tabs.
- **Folders**: click **+ New folder** to create an empty folder, or click a folder title in edit mode to rename it or choose its position. Empty folders stay in place until you delete them. The bookmark grid uses the full available screen width, including on large monitors.

Bookmark handles also work with touch. For keyboard editing, focus a handle and use **↑ / ↓** to reorder bookmarks, or **← / →** to move them to the previous or next folder. On a folder handle, any arrow key moves the folder one position. **Escape** cancels an active drag.

Folder names and ordering are stored in the optional top-level `bookmarkGroups` array
in `dashboard.json`. Existing configs derive that order from the bookmarks on first
load; importing or adding bookmarks automatically includes any new folders.

## Updating

Click **✎ Edit → ↑ Updates** to check GitHub and see the installed and latest commit.
Updates follow the official repository's `main` branch, matching the installer; there
are no numbered releases yet. The check runs only when you open this dialog or click
**Check again**. GitHub errors leave the running app unchanged.

**Systemd:** click **Update & restart** in the dialog. The installer sets up a separate
`dashpanel-update.service` and a path watcher, so the dashboard keeps its read-only
filesystem sandbox. The updater runs as the `dashpanel` user and systemd restarts the
dashboard after success. Existing installs need to re-run the one-line installer once
to get these units. You can also update from the host:

```sh
cd /opt/dashpanel
sudo node update.js --service
```

**Plain Node:** run `npm run update` (or `node update.js`) in your checkout, then
restart the running Node process. `node update.js --check` prints the current and
latest revisions without changing files.

**Docker:** run `node update.js --docker` in the checkout on the Docker host. This
requires Node 18+ on the host and permission to use Docker; it fetches the update and
rebuilds the container with `docker compose up -d --build`. The dashboard shows this
command because containers cannot rebuild themselves. Alternatively, re-run the
installer with `--docker`, which does not require Node on the host.

Updates refuse dirty checkouts, untracked files, detached HEADs, and local commits
that differ from GitHub. Commit or move local changes first. Git-ignored config,
uploaded backgrounds and icon caches are preserved, and updates never force-reset
your checkout. Fetch/merge failures leave the running process in place; a Docker
rebuild failure is reported after the source update, and you can retry the command.
For a non-default branch, set `DASHPANEL_BRANCH`; the installer records its `--branch`
selection in both systemd units. The checked-out branch must match it.

Update actions use the same edit-token and same-origin checks as other dashboard
writes. Troubleshoot systemd updates with `journalctl -u dashpanel-update.service`.
If an interrupted update leaves `.git/dashpanel-update.lock`, confirm no updater is
running before removing that file and trying again.

## Importing bookmarks

You can import from:

- **A browser export (HTML).** Chrome, Edge, Brave: Bookmark manager → ⋮ → *Export bookmarks*. Firefox: *Manage bookmarks → Import and Backup → Export to HTML*. Safari: *File → Export → Bookmarks*.
- **A Chromium `Bookmarks` file.** For example `~/.config/google-chrome/Default/Bookmarks` or `%LOCALAPPDATA%\Google\Chrome\User Data\Default\Bookmarks`.
- **Pasted links**, one per line. A line can be a bare URL, `Title - https://…` or `[Title](https://…)`.

With **auto-sort** on:

- About 300 popular sites are recognised and sorted into categories: AI, Dev, Homelab, Social, Media, Shopping, News, Productivity, Finance, Gaming, Learning and Tools. The most popular sites come first in each category.
- Recognised sites get clean names. For example, `Inbox (3) - me@example.com - Gmail` becomes `Gmail`, and `GitHub - owner/repo: long tagline` becomes `owner/repo`.
- Everything else keeps its browser folder name, or goes into *Other*.

Links you already have are skipped. The preview lets you untick items or whole groups and rename groups before importing.

To import only recognised sites, tick **Only recognised popular sites**. You can edit the site list in `lib/popular-sites.js`.

## Adding services

You can add services three ways:

- **Edit mode** (described above).
- **Ask Claude Code** (see below).
- **Edit `config/dashboard.json` by hand**. The server reloads the file when you save it. If the JSON is invalid, a banner shows the errors and the last good config keeps running.

```jsonc
{
  "name": "Jellyfin",
  "url": "http://192.168.1.20:8096",      // card link
  "group": "Media",                       // section; groups appear in order of first use
  "icon": "jellyfin",                     // see "Icons" below; omit to auto-match the name
  "description": "Media server",          // subtitle; defaults to the URL host
  "check": {
    "type": "http",                       // http | tcp | ping | none
    "target": "http://192.168.1.20:8096/health",  // default: the url
    "keyword": "Healthy",                 // optional: body must contain this
    "expectStatus": "200-299",            // optional, e.g. "200-299,401"
    "interval": 30,                       // seconds (default: settings.checkInterval)
    "timeout": 5000,                      // ms
    "insecure": true                      // ignore self-signed certs (default true)
  }
}
```

| Check | Up when | `target` default |
| --- | --- | --- |
| `http` | The response is 2xx/3xx/401/403, or matches `expectStatus`. Other 4xx counts as a warning. | `url` |
| `tcp` | The port accepts a connection. Use it for game servers, databases, SSH and similar. | host:port of `url` |
| `ping` | The host answers an ICMP echo. | host of `url` |
| `none` | Never checked. The card is just a link. | – |

**Icons** can be any [dashboard-icons](https://dashboardicons.com) name (`proxmox`, `home-assistant`…), an image URL, a path under `public/`, or an emoji. If you leave the icon out, services try the slug of their name and bookmarks use the site's favicon.

Appearance settings live under `settings` in the same file:

```jsonc
"settings": {
  "theme": "nord",                        // midnight | slate | nord | dracula | light
  "accent": "#3b82f6",
  "background": { "type": "image", "image": "https://…/wallpaper.jpg", "dim": 40, "blur": 4 }
}
```

## Claude Code MCP

The MCP server talks to a running dashpanel over HTTP, so changes appear live. It needs no checkout. Add it on the computer you run Claude Code on:

```sh
claude mcp add dashpanel --scope user \
  -e DASHPANEL_URL=http://192.168.1.10:7676 -e DASHPANEL_TOKEN=<token> \
  -- npx -y github:metrospeed/dashpanel
```

The installer prints this command with your real URL and token filled in. Inside a clone of this repo, `.mcp.json` already registers it against `http://localhost:7676`.

Tools: `get_dashboard`, `add_service`, `update_service`, `remove_service`, `test_check`, `check_services`, `search_icons`, `add_bookmark`, `update_bookmark`, `remove_bookmark`, `import_bookmarks`, `update_settings`, `get_config`, `replace_config`.

`import_bookmarks` accepts three kinds of source:

- `browser: "chrome" | "edge" | "brave" | "vivaldi"`: reads that browser's profile on the machine running Claude Code.
- `path`: a file path.
- `content`: raw text.

It also takes `dryRun: true` to preview the result without saving.

Example prompts:

- *"Add Sonarr at 192.168.1.20:8989 to the Media group"*. Claude tests the port, picks an icon and adds the card.
- *"Use the Proxmox MCP to find my running containers and add any web UIs that aren't on the dashboard yet"*
- *"Import my Chrome bookmarks, only the popular sites"*
- *"Switch to the Nord theme with a blurred mountain wallpaper"*
- *"Move the Games group to the top and make Claude the default search"*

## API

| | |
| --- | --- |
| `GET /api/state` · `GET /api/events` (SSE) | config + statuses, live updates |
| `POST /api/check` `{id?}` | run checks now |
| `POST /api/test-check` `{url, check}` | dry-run a check |
| `POST/PATCH/DELETE /api/services[/:id]` | manage services (`null` clears a field) |
| `POST/PATCH/DELETE /api/bookmarks[/:id]` | manage bookmarks |
| `POST /api/bookmarks/move` `{id, group, beforeId?}` | move into a folder before a bookmark; omit/null `beforeId` to append |
| `POST /api/bookmark-groups` `{name}` | create an empty folder |
| `PATCH /api/bookmark-groups` `{group, name?, beforeGroup?}` | rename/reorder a folder; null `beforeGroup` moves it to the end |
| `DELETE /api/bookmark-groups/:name` | delete the URL-encoded folder name and its bookmarks |
| `POST /api/bookmarks/import` `{source, autoSort?, onlyPopular?, dryRun?}` or `{items}` | parse + auto-sort, or save a reviewed list |
| `PATCH /api/settings` · `GET/PUT /api/config` | settings (`background` is merged) / whole config |
| `POST /api/background` `{data: "data:image/…;base64,…"}` | upload a background image |
| `POST /api/updates/check` `{}` | check the latest GitHub commit (cached for one minute) |
| `POST /api/updates/install` `{}` · `GET /api/updates` | queue a systemd update / read its status; both require edit authorization |
| `GET /api/icon?name=…` · `?domain=…` | cached dashboard-icon / favicon |

Every write needs `Content-Type: application/json`. Cross-origin requests are refused. When `DASHPANEL_TOKEN` is set, send it as `Authorization: Bearer <token>`.
