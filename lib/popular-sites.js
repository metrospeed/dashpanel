// Well-known sites, grouped by category. Within a category, entries are listed
// most popular first; that order is used when sorting imported bookmarks.
// [host, display name]. A host ending in ".*" matches any TLD (amazon.co.uk).
export const CATEGORIES = {
  AI: [
    ['chatgpt.com', 'ChatGPT'], ['chat.openai.com', 'ChatGPT'], ['gemini.google.com', 'Gemini'],
    ['claude.ai', 'Claude'], ['perplexity.ai', 'Perplexity'], ['copilot.microsoft.com', 'Copilot'],
    ['grok.com', 'Grok'], ['deepseek.com', 'DeepSeek'], ['chat.deepseek.com', 'DeepSeek'],
    ['huggingface.co', 'Hugging Face'], ['poe.com', 'Poe'], ['chat.mistral.ai', 'Le Chat'],
    ['midjourney.com', 'Midjourney'], ['notebooklm.google.com', 'NotebookLM'], ['aistudio.google.com', 'AI Studio'],
    ['platform.openai.com', 'OpenAI Platform'], ['console.anthropic.com', 'Anthropic Console'],
    ['openai.com', 'OpenAI'], ['anthropic.com', 'Anthropic'], ['openrouter.ai', 'OpenRouter'],
    ['ollama.com', 'Ollama'], ['civitai.com', 'Civitai'], ['elevenlabs.io', 'ElevenLabs'],
  ],
  Dev: [
    ['github.com', 'GitHub'], ['stackoverflow.com', 'Stack Overflow'], ['gitlab.com', 'GitLab'],
    ['developer.mozilla.org', 'MDN'], ['npmjs.com', 'npm'], ['pypi.org', 'PyPI'],
    ['hub.docker.com', 'Docker Hub'], ['docs.docker.com', 'Docker Docs'], ['vercel.com', 'Vercel'],
    ['netlify.com', 'Netlify'], ['dash.cloudflare.com', 'Cloudflare'], ['cloudflare.com', 'Cloudflare'],
    ['console.aws.amazon.com', 'AWS Console'], ['aws.amazon.com', 'AWS'], ['portal.azure.com', 'Azure Portal'],
    ['console.cloud.google.com', 'Google Cloud'], ['console.firebase.google.com', 'Firebase'], ['supabase.com', 'Supabase'],
    ['digitalocean.com', 'DigitalOcean'], ['heroku.com', 'Heroku'], ['bitbucket.org', 'Bitbucket'],
    ['codepen.io', 'CodePen'], ['codesandbox.io', 'CodeSandbox'], ['replit.com', 'Replit'],
    ['regex101.com', 'regex101'], ['dev.to', 'DEV'], ['w3schools.com', 'W3Schools'],
    ['crates.io', 'crates.io'], ['pkg.go.dev', 'Go Packages'], ['go.dev', 'Go'], ['python.org', 'Python'],
    ['nodejs.org', 'Node.js'], ['rust-lang.org', 'Rust'], ['jsfiddle.net', 'JSFiddle'],
    ['leetcode.com', 'LeetCode'], ['caniuse.com', 'Can I use'], ['figma.com', 'Figma'],
  ],
  Homelab: [
    ['home-assistant.io', 'Home Assistant'], ['community.home-assistant.io', 'HA Community'],
    ['proxmox.com', 'Proxmox'], ['pve.proxmox.com', 'Proxmox Wiki'], ['forum.proxmox.com', 'Proxmox Forum'],
    ['truenas.com', 'TrueNAS'], ['unraid.net', 'Unraid'], ['tailscale.com', 'Tailscale'],
    ['login.tailscale.com', 'Tailscale Admin'], ['unifi.ui.com', 'UniFi Site Manager'], ['ui.com', 'Ubiquiti'],
    ['linuxserver.io', 'LinuxServer.io'], ['selfh.st', 'selfh.st'], ['dashboardicons.com', 'Dashboard Icons'],
    ['portainer.io', 'Portainer'], ['pi-hole.net', 'Pi-hole'], ['opnsense.org', 'OPNsense'],
    ['pfsense.org', 'pfSense'], ['nextcloud.com', 'Nextcloud'], ['servethehome.com', 'ServeTheHome'],
    ['awesome-selfhosted.net', 'Awesome Self-Hosted'], ['zigbee2mqtt.io', 'Zigbee2MQTT'], ['esphome.io', 'ESPHome'],
    ['frigate.video', 'Frigate'], ['jellyfin.org', 'Jellyfin'], ['plex.tv', 'Plex'], ['app.plex.tv', 'Plex'],
  ],
  Social: [
    ['reddit.com', 'Reddit'], ['x.com', 'X'], ['twitter.com', 'Twitter'], ['facebook.com', 'Facebook'],
    ['instagram.com', 'Instagram'], ['linkedin.com', 'LinkedIn'], ['discord.com', 'Discord'],
    ['web.whatsapp.com', 'WhatsApp'], ['tiktok.com', 'TikTok'], ['bsky.app', 'Bluesky'],
    ['threads.net', 'Threads'], ['threads.com', 'Threads'], ['pinterest.com', 'Pinterest'],
    ['messenger.com', 'Messenger'], ['web.telegram.org', 'Telegram'], ['mastodon.social', 'Mastodon'],
    ['tumblr.com', 'Tumblr'], ['quora.com', 'Quora'], ['snapchat.com', 'Snapchat'],
  ],
  Media: [
    ['youtube.com', 'YouTube'], ['netflix.com', 'Netflix'], ['twitch.tv', 'Twitch'],
    ['open.spotify.com', 'Spotify'], ['spotify.com', 'Spotify'], ['music.youtube.com', 'YouTube Music'],
    ['primevideo.com', 'Prime Video'], ['disneyplus.com', 'Disney+'], ['max.com', 'Max'], ['hulu.com', 'Hulu'],
    ['tv.apple.com', 'Apple TV'], ['music.apple.com', 'Apple Music'], ['crunchyroll.com', 'Crunchyroll'],
    ['soundcloud.com', 'SoundCloud'], ['vimeo.com', 'Vimeo'], ['paramountplus.com', 'Paramount+'],
    ['peacocktv.com', 'Peacock'], ['imdb.com', 'IMDb'], ['letterboxd.com', 'Letterboxd'],
    ['kick.com', 'Kick'], ['pandora.com', 'Pandora'], ['tidal.com', 'TIDAL'],
  ],
  Shopping: [
    ['amazon.*', 'Amazon'], ['ebay.*', 'eBay'], ['walmart.com', 'Walmart'], ['aliexpress.com', 'AliExpress'],
    ['etsy.com', 'Etsy'], ['temu.com', 'Temu'], ['target.com', 'Target'], ['bestbuy.com', 'Best Buy'],
    ['costco.com', 'Costco'], ['newegg.com', 'Newegg'], ['homedepot.com', 'Home Depot'], ['ikea.com', 'IKEA'],
    ['lowes.com', "Lowe's"], ['microcenter.com', 'Micro Center'], ['bhphotovideo.com', 'B&H'],
    ['wayfair.com', 'Wayfair'], ['shein.com', 'SHEIN'], ['craigslist.org', 'Craigslist'],
    ['facebook.com/marketplace', 'Marketplace'], ['pcpartpicker.com', 'PCPartPicker'], ['camelcamelcamel.com', 'camelcamelcamel'],
  ],
  News: [
    ['news.google.com', 'Google News'], ['news.ycombinator.com', 'Hacker News'], ['bbc.com', 'BBC'],
    ['bbc.co.uk', 'BBC'], ['cnn.com', 'CNN'], ['nytimes.com', 'New York Times'], ['theguardian.com', 'The Guardian'],
    ['reuters.com', 'Reuters'], ['apnews.com', 'AP News'], ['theverge.com', 'The Verge'],
    ['arstechnica.com', 'Ars Technica'], ['washingtonpost.com', 'Washington Post'], ['wsj.com', 'WSJ'],
    ['bloomberg.com', 'Bloomberg'], ['npr.org', 'NPR'], ['foxnews.com', 'Fox News'], ['techcrunch.com', 'TechCrunch'],
    ['wired.com', 'WIRED'], ['engadget.com', 'Engadget'], ['tomshardware.com', "Tom's Hardware"],
    ['9to5mac.com', '9to5Mac'], ['9to5google.com', '9to5Google'], ['lobste.rs', 'Lobsters'], ['slashdot.org', 'Slashdot'],
  ],
  Productivity: [
    ['mail.google.com', 'Gmail'], ['drive.google.com', 'Google Drive'], ['docs.google.com', 'Google Docs'],
    ['calendar.google.com', 'Google Calendar'], ['outlook.live.com', 'Outlook'], ['outlook.office.com', 'Outlook'],
    ['notion.so', 'Notion'], ['notion.com', 'Notion'], ['app.slack.com', 'Slack'], ['slack.com', 'Slack'],
    ['office.com', 'Microsoft 365'], ['microsoft365.com', 'Microsoft 365'], ['teams.microsoft.com', 'Teams'],
    ['dropbox.com', 'Dropbox'], ['onedrive.live.com', 'OneDrive'], ['icloud.com', 'iCloud'],
    ['photos.google.com', 'Google Photos'], ['keep.google.com', 'Google Keep'], ['sheets.google.com', 'Google Sheets'],
    ['mail.proton.me', 'Proton Mail'], ['proton.me', 'Proton'], ['mail.yahoo.com', 'Yahoo Mail'],
    ['trello.com', 'Trello'], ['todoist.com', 'Todoist'], ['zoom.us', 'Zoom'], ['canva.com', 'Canva'],
    ['miro.com', 'Miro'], ['airtable.com', 'Airtable'], ['asana.com', 'Asana'], ['linear.app', 'Linear'],
    ['monday.com', 'monday.com'], ['evernote.com', 'Evernote'], ['obsidian.md', 'Obsidian'], ['1password.com', '1Password'],
    ['bitwarden.com', 'Bitwarden'], ['vault.bitwarden.com', 'Bitwarden'],
  ],
  Finance: [
    ['paypal.com', 'PayPal'], ['chase.com', 'Chase'], ['bankofamerica.com', 'Bank of America'],
    ['wellsfargo.com', 'Wells Fargo'], ['capitalone.com', 'Capital One'], ['americanexpress.com', 'American Express'],
    ['venmo.com', 'Venmo'], ['coinbase.com', 'Coinbase'], ['robinhood.com', 'Robinhood'], ['fidelity.com', 'Fidelity'],
    ['schwab.com', 'Schwab'], ['vanguard.com', 'Vanguard'], ['creditkarma.com', 'Credit Karma'],
    ['finance.yahoo.com', 'Yahoo Finance'], ['tradingview.com', 'TradingView'], ['citi.com', 'Citi'],
    ['discover.com', 'Discover'], ['usbank.com', 'U.S. Bank'], ['binance.com', 'Binance'], ['kraken.com', 'Kraken'],
    ['wise.com', 'Wise'], ['revolut.com', 'Revolut'], ['dashboard.stripe.com', 'Stripe'], ['monarchmoney.com', 'Monarch'],
    ['ynab.com', 'YNAB'], ['app.ynab.com', 'YNAB'],
  ],
  Gaming: [
    ['store.steampowered.com', 'Steam'], ['steamcommunity.com', 'Steam Community'], ['epicgames.com', 'Epic Games'],
    ['roblox.com', 'Roblox'], ['xbox.com', 'Xbox'], ['playstation.com', 'PlayStation'], ['nintendo.com', 'Nintendo'],
    ['minecraft.net', 'Minecraft'], ['curseforge.com', 'CurseForge'], ['modrinth.com', 'Modrinth'],
    ['gog.com', 'GOG'], ['itch.io', 'itch.io'], ['humblebundle.com', 'Humble Bundle'], ['nexusmods.com', 'Nexus Mods'],
    ['chess.com', 'Chess.com'], ['lichess.org', 'lichess'], ['ign.com', 'IGN'], ['gamespot.com', 'GameSpot'],
    ['battle.net', 'Battle.net'], ['ea.com', 'EA'], ['protondb.com', 'ProtonDB'], ['steamdb.info', 'SteamDB'],
    ['howlongtobeat.com', 'HowLongToBeat'],
  ],
  Learning: [
    ['wikipedia.org', 'Wikipedia'], ['en.wikipedia.org', 'Wikipedia'], ['khanacademy.org', 'Khan Academy'],
    ['coursera.org', 'Coursera'], ['udemy.com', 'Udemy'], ['duolingo.com', 'Duolingo'], ['medium.com', 'Medium'],
    ['substack.com', 'Substack'], ['archive.org', 'Internet Archive'], ['scholar.google.com', 'Google Scholar'],
    ['edx.org', 'edX'], ['brilliant.org', 'Brilliant'], ['goodreads.com', 'Goodreads'], ['quizlet.com', 'Quizlet'],
    ['freecodecamp.org', 'freeCodeCamp'], ['wolframalpha.com', 'Wolfram|Alpha'], ['instructables.com', 'Instructables'],
  ],
  Tools: [
    ['google.*', 'Google'], ['bing.com', 'Bing'], ['duckduckgo.com', 'DuckDuckGo'], ['maps.google.com', 'Google Maps'],
    ['translate.google.com', 'Google Translate'], ['speedtest.net', 'Speedtest'], ['weather.com', 'Weather'],
    ['downdetector.com', 'Downdetector'], ['virustotal.com', 'VirusTotal'], ['haveibeenpwned.com', 'Have I Been Pwned'],
    ['photopea.com', 'Photopea'], ['remove.bg', 'remove.bg'], ['tinypng.com', 'TinyPNG'],
    ['smallpdf.com', 'Smallpdf'], ['ilovepdf.com', 'iLovePDF'], ['cyberchef.org', 'CyberChef'],
    ['gchq.github.io', 'CyberChef'], ['whatismyipaddress.com', 'What Is My IP'], ['timeanddate.com', 'timeanddate'],
  ],
};

export const CATEGORY_ORDER = Object.keys(CATEGORIES);

const exact = new Map(); // host or host/path -> { group, name, rank }
const anyTld = new Map(); // "amazon" -> { ... }
for (const [group, sites] of Object.entries(CATEGORIES)) {
  sites.forEach(([host, name], rank) => {
    const entry = { group, name, rank };
    if (host.endsWith('.*')) anyTld.set(host.slice(0, -2), entry);
    else if (!exact.has(host)) exact.set(host, entry);
  });
}

/**
 * Find a popular site for a URL. Tries host+first path segment, the exact host,
 * then parent domains (gist.github.com -> github.com) and finally any-TLD brands.
 * `root` is true when the match is for the site itself, not a parent domain.
 */
export function lookupSite(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  const firstSegment = u.pathname.split('/')[1];
  if (firstSegment && exact.has(`${host}/${firstSegment}`)) return { ...exact.get(`${host}/${firstSegment}`), root: false };
  const labels = host.split('.');
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join('.');
    if (exact.has(candidate)) return { ...exact.get(candidate), root: i === 0 };
  }
  for (let i = 0; i < labels.length - 1; i++) {
    if (anyTld.has(labels[i])) return { ...anyTld.get(labels[i]), root: i === 0 };
  }
  return null;
}
