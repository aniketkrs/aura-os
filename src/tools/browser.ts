/**
 * Terminal Browser — Aura OS
 * Native terminal browser with cheerio HTML parsing, JSDOM JS execution,
 * inline image rendering, virtual tabs, bookmarks, history, cookie persistence.
 * NO osascript, NO open -a — everything terminal-only.
 */
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import * as zlib from 'zlib';
import { URL } from 'url';
import * as cheerio from 'cheerio';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BrowseResult {
  url:        string;
  title:      string;
  markdown:   string;
  links:      Array<{ n: number; text: string; href: string }>;
  images:     Array<{ n: number; alt: string; src: string }>;
  statusCode: number;
  contentType: string;
  error?:     string;
  tabId?:     number;
}

export interface BrowserTab {
  id:       number;
  url:      string;
  title:    string;
  result?:  BrowseResult;
  scrollPos: number;
}

export interface Bookmark {
  url:       string;
  title:     string;
  createdAt: string;
  tags:      string[];
}

export interface HistoryEntry {
  url:       string;
  title:     string;
  visitedAt: string;
}

export interface CookieEntry {
  domain:    string;
  name:      string;
  value:     string;
  path:      string;
  expires?:  string;
  secure:    boolean;
  httpOnly:  boolean;
}

interface FetchResult {
  body:        string;
  contentType: string;
  finalUrl:    string;
  statusCode:  number;
  headers:     Record<string, string>;
  cookies:     CookieEntry[];
}

interface FetchOptions {
  timeout?:    number;
  maxRedirects?: number;
  cookies?:    CookieEntry[];
  headers?:    Record<string, string>;
}

// ─── Paths ───────────────────────────────────────────────────────────────────

const BROWSER_DIR    = path.join(os.homedir(), '.aura', 'browser');
const COOKIE_PATH    = path.join(BROWSER_DIR, 'cookies.json');
const HISTORY_PATH   = path.join(BROWSER_DIR, 'history.json');
const BOOKMARK_PATH  = path.join(BROWSER_DIR, 'bookmarks.json');

async function ensureBrowserDir(): Promise<void> {
  await fs.ensureDir(BROWSER_DIR);
  await fs.ensureDir(path.join(BROWSER_DIR, 'image-cache'));
}

// ─── Cookie persistence ──────────────────────────────────────────────────────

async function loadCookies(): Promise<CookieEntry[]> {
  await ensureBrowserDir();
  if (!(await fs.pathExists(COOKIE_PATH))) return [];
  try { return await fs.readJson(COOKIE_PATH); } catch { return []; }
}

async function saveCookies(cookies: CookieEntry[]): Promise<void> {
  await ensureBrowserDir();
  // Remove expired cookies
  const now = new Date();
  const valid = cookies.filter(c => {
    if (!c.expires) return true;
    return new Date(c.expires) > now;
  });
  await fs.writeJson(COOKIE_PATH, valid, { spaces: 2, mode: 0o600 });
}

function parseCookieHeader(setCookie: string, domain: string): CookieEntry {
  const parts = setCookie.split(';').map(s => s.trim());
  const [nameVal, ...attrs] = parts;
  const eqIdx = nameVal.indexOf('=');
  const name = nameVal.slice(0, eqIdx).trim();
  const value = nameVal.slice(eqIdx + 1).trim();

  const cookie: CookieEntry = { domain, name, value, path: '/', secure: false, httpOnly: false };
  for (const attr of attrs) {
    const lower = attr.toLowerCase();
    if (lower.startsWith('path='))    cookie.path = attr.split('=')[1] || '/';
    if (lower.startsWith('expires=')) cookie.expires = attr.split('=').slice(1).join('=');
    if (lower.startsWith('domain=')) cookie.domain = attr.split('=')[1]?.replace(/^\./, '') || domain;
    if (lower === 'secure')          cookie.secure = true;
    if (lower === 'httponly')        cookie.httpOnly = true;
  }
  return cookie;
}

function buildCookieHeader(cookies: CookieEntry[], domain: string, urlPath: string): string {
  return cookies
    .filter(c => domain.endsWith(c.domain) && urlPath.startsWith(c.path))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

// ─── History ─────────────────────────────────────────────────────────────────

async function loadHistory(): Promise<HistoryEntry[]> {
  await ensureBrowserDir();
  if (!(await fs.pathExists(HISTORY_PATH))) return [];
  try { return await fs.readJson(HISTORY_PATH); } catch { return []; }
}

async function addHistory(url: string, title: string): Promise<void> {
  const history = await loadHistory();
  history.push({ url, title, visitedAt: new Date().toISOString() });
  // Keep last 500 entries
  const trimmed = history.slice(-500);
  await fs.writeJson(HISTORY_PATH, trimmed, { spaces: 2, mode: 0o600 });
}

export async function getHistory(limit = 20): Promise<HistoryEntry[]> {
  const history = await loadHistory();
  return history.slice(-limit).reverse();
}

export async function clearHistory(): Promise<void> {
  await ensureBrowserDir();
  await fs.writeJson(HISTORY_PATH, [], { mode: 0o600 });
}

// ─── Bookmarks ───────────────────────────────────────────────────────────────

async function loadBookmarks(): Promise<Bookmark[]> {
  await ensureBrowserDir();
  if (!(await fs.pathExists(BOOKMARK_PATH))) return [];
  try { return await fs.readJson(BOOKMARK_PATH); } catch { return []; }
}

export async function addBookmark(url: string, title: string, tags: string[] = []): Promise<void> {
  const bookmarks = await loadBookmarks();
  // Avoid duplicates
  if (bookmarks.some(b => b.url === url)) return;
  bookmarks.push({ url, title, createdAt: new Date().toISOString(), tags });
  await fs.writeJson(BOOKMARK_PATH, bookmarks, { spaces: 2, mode: 0o600 });
}

export async function removeBookmark(url: string): Promise<boolean> {
  const bookmarks = await loadBookmarks();
  const filtered = bookmarks.filter(b => b.url !== url);
  if (filtered.length === bookmarks.length) return false;
  await fs.writeJson(BOOKMARK_PATH, filtered, { spaces: 2, mode: 0o600 });
  return true;
}

export async function getBookmarks(): Promise<Bookmark[]> {
  return loadBookmarks();
}

// ─── Virtual tabs ────────────────────────────────────────────────────────────

let tabs: BrowserTab[] = [];
let activeTabId = 0;
let nextTabId = 1;

export function createTab(url?: string): BrowserTab {
  const tab: BrowserTab = { id: nextTabId++, url: url || '', title: 'New Tab', scrollPos: 0 };
  tabs.push(tab);
  activeTabId = tab.id;
  return tab;
}

export function closeTab(id: number): boolean {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return false;
  tabs.splice(idx, 1);
  if (activeTabId === id && tabs.length > 0) {
    activeTabId = tabs[tabs.length - 1].id;
  }
  return true;
}

export function switchTab(id: number): BrowserTab | null {
  const tab = tabs.find(t => t.id === id);
  if (!tab) return null;
  activeTabId = tab.id;
  return tab;
}

export function getActiveTab(): BrowserTab | null {
  return tabs.find(t => t.id === activeTabId) || null;
}

export function listTabs(): BrowserTab[] {
  return [...tabs];
}

// ─── Native HTTPS fetch ──────────────────────────────────────────────────────

function nativeFetch(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const { timeout = 15000, maxRedirects = 8, cookies = [], headers = {} } = opts;

  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('ERR_TOO_MANY_REDIRECTS: Too many redirects (>8). The site may have a redirect loop.'));

    let parsed: URL;
    try { parsed = new URL(rawUrl); }
    catch { return reject(new Error(`ERR_INVALID_URL: "${rawUrl}" is not a valid URL. Check for typos.`)); }

    const lib = parsed.protocol === 'https:' ? https : http;
    const cookieHeader = buildCookieHeader(cookies, parsed.hostname, parsed.pathname);

    const reqHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate',
      'Connection': 'keep-alive',
      ...headers,
    };
    if (cookieHeader) reqHeaders['Cookie'] = cookieHeader;

    const reqOpts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  reqHeaders,
      timeout,
    };

    const req = lib.request(reqOpts, (res: http.IncomingMessage) => {
      const status = res.statusCode || 0;

      // Parse cookies from response
      const newCookies: CookieEntry[] = [];
      const setCookies = res.headers['set-cookie'];
      if (setCookies) {
        for (const sc of setCookies) {
          newCookies.push(parseCookieHeader(sc, parsed.hostname));
        }
      }

      // Follow redirects
      if (status >= 301 && status <= 308 && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, rawUrl).href;
        res.destroy();
        const mergedCookies = [...cookies, ...newCookies];
        return resolve(nativeFetch(next, { ...opts, maxRedirects: maxRedirects - 1, cookies: mergedCookies }));
      }

      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        const encoding = res.headers['content-encoding'];
        let body: string;

        try {
          if (encoding === 'gzip') {
            body = zlib.gunzipSync(raw).toString('utf8');
          } else if (encoding === 'deflate') {
            body = zlib.inflateSync(raw).toString('utf8');
          } else {
            body = raw.toString('utf8');
          }
        } catch {
          body = raw.toString('utf8');
        }

        const contentType = res.headers['content-type'] || '';
        const resHeaders: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === 'string') resHeaders[k] = v;
        }

        resolve({
          body,
          contentType,
          finalUrl: rawUrl,
          statusCode: status,
          headers: resHeaders,
          cookies: [...cookies, ...newCookies],
        });
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOTFOUND') {
        reject(new Error(`ERR_DNS: Cannot resolve host "${parsed.hostname}". Check the URL or your network connection.`));
      } else if (err.code === 'ECONNREFUSED') {
        reject(new Error(`ERR_CONNECTION_REFUSED: ${parsed.hostname}:${parsed.port} refused the connection. The server may be down.`));
      } else if (err.code === 'ECONNRESET') {
        reject(new Error(`ERR_CONNECTION_RESET: Connection to ${parsed.hostname} was reset. Try again.`));
      } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' || err.code === 'ERR_TLS_CERT_ALTNAME_INVALID') {
        reject(new Error(`ERR_SSL: SSL/TLS certificate error for ${parsed.hostname}. The site's certificate may be expired or invalid.\nHint: Try http:// instead of https:// if the site doesn't require SSL.`));
      } else {
        reject(new Error(`ERR_NETWORK: ${err.message}`));
      }
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`ERR_TIMEOUT: Request to ${parsed.hostname} timed out after ${timeout / 1000}s.\nHint: Try again, or check your network. Use /browse <url> --timeout 30 for slow sites.`));
    });

    req.end();
  });
}

// ─── HTTP error messages ─────────────────────────────────────────────────────

function httpErrorHint(status: number): string {
  const hints: Record<number, string> = {
    400: 'Bad Request — the server didn\'t understand the request.',
    401: 'Unauthorized — this page requires authentication.',
    403: 'Forbidden — access denied. The site blocks automated requests.',
    404: 'Not Found — this page doesn\'t exist. Check the URL.',
    405: 'Method Not Allowed.',
    408: 'Request Timeout — the server took too long.',
    429: 'Too Many Requests — you\'re being rate-limited. Wait and retry.',
    500: 'Internal Server Error — the server is having problems.',
    502: 'Bad Gateway — the server received an invalid response upstream.',
    503: 'Service Unavailable — the server is temporarily down.',
    504: 'Gateway Timeout — upstream server didn\'t respond in time.',
  };
  return hints[status] || `HTTP ${status}`;
}

// ─── Cheerio-based HTML parsing ──────────────────────────────────────────────

function parseWithCheerio(html: string, baseUrl: string): {
  title: string;
  markdown: string;
  links: Array<{ n: number; text: string; href: string }>;
  images: Array<{ n: number; alt: string; src: string }>;
} {
  const $ = cheerio.load(html);

  // Remove unwanted elements
  $('script, style, noscript, svg, iframe, nav, footer, header, aside').remove();
  $('[role="navigation"], [role="banner"], [role="contentinfo"]').remove();
  $('.ad, .ads, .advertisement, .cookie-banner, .popup, .modal').remove();

  // Extract title
  const title = $('title').first().text().trim()
    || $('h1').first().text().trim()
    || '';

  // Extract links
  const links: Array<{ n: number; text: string; href: string }> = [];
  let linkN = 1;
  $('a[href]').each((_i, el) => {
    if (linkN > 50) return false; // limit
    const $el = $(el);
    const href = $el.attr('href') || '';
    const text = $el.text().replace(/\s+/g, ' ').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) return;
    if (text.length < 2) return;
    try {
      const abs = href.startsWith('http') ? href : new URL(href, baseUrl).href;
      links.push({ n: linkN++, text: text.slice(0, 80), href: abs });
    } catch { /* skip invalid URLs */ }
  });

  // Extract images
  const images: Array<{ n: number; alt: string; src: string }> = [];
  let imgN = 1;
  $('img[src]').each((_i, el) => {
    if (imgN > 20) return false;
    const $el = $(el);
    const src = $el.attr('src') || '';
    const alt = $el.attr('alt') || $el.attr('title') || '';
    if (!src || src.startsWith('data:')) return;
    try {
      const abs = src.startsWith('http') ? src : new URL(src, baseUrl).href;
      images.push({ n: imgN++, alt: alt.slice(0, 60), src: abs });
    } catch { /* skip */ }
  });

  // Convert to markdown
  const markdown = htmlToMarkdown($, baseUrl, links);

  return { title, markdown, links, images };
}

function htmlToMarkdown($: ReturnType<typeof cheerio.load>, _baseUrl: string, links: Array<{ n: number; text: string; href: string }>): string {
  // Build a link lookup for numbered references
  const linkMap = new Map<string, number>();
  for (const l of links) linkMap.set(l.href, l.n);

  // Process main content area first, fall back to body
  const mainContent = $('main, article, [role="main"], .content, .post, .entry').first();
  const root = mainContent.length ? mainContent : $('body');

  const lines: string[] = [];

  function processNode(el: any, depth = 0): void {
    if (el.type === 'text') {
      const text = el.data || '';
      const clean = text.replace(/\s+/g, ' ');
      if (clean.trim()) lines.push(clean);
      return;
    }

    if (el.type !== 'tag' && el.type !== 'root') return;
    const tag = el.tagName?.toLowerCase() || '';
    const children = el.children || [];

    switch (tag) {
      case 'h1': lines.push(`\n# ${$(el).text().trim()}\n`); return;
      case 'h2': lines.push(`\n## ${$(el).text().trim()}\n`); return;
      case 'h3': lines.push(`\n### ${$(el).text().trim()}\n`); return;
      case 'h4': case 'h5': case 'h6':
        lines.push(`\n#### ${$(el).text().trim()}\n`); return;
      case 'p':
        lines.push('\n');
        for (const child of children) processNode(child, depth);
        lines.push('\n');
        return;
      case 'br': lines.push('\n'); return;
      case 'hr': lines.push('\n─────────────\n'); return;
      case 'strong': case 'b':
        lines.push(`**${$(el).text().trim()}**`); return;
      case 'em': case 'i':
        lines.push(`_${$(el).text().trim()}_`); return;
      case 'code':
        lines.push(`\`${$(el).text().trim()}\``); return;
      case 'pre':
        lines.push(`\n\`\`\`\n${$(el).text().trim()}\n\`\`\`\n`); return;
      case 'blockquote':
        lines.push('\n> ' + $(el).text().trim().replace(/\n/g, '\n> ') + '\n');
        return;
      case 'li': {
        const prefix = el.parentNode &&
          el.parentNode.tagName?.toLowerCase() === 'ol'
          ? `${depth + 1}. ` : '  · ';
        lines.push(`\n${prefix}${$(el).text().replace(/\s+/g, ' ').trim()}`);
        return;
      }
      case 'ul': case 'ol':
        lines.push('');
        for (const child of children) processNode(child, depth);
        lines.push('');
        return;
      case 'a': {
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        const href = $(el).attr('href') || '';
        const n = linkMap.get(href.startsWith('http') ? href : '');
        if (n) {
          lines.push(`${text} [${n}]`);
        } else {
          lines.push(text);
        }
        return;
      }
      case 'img': {
        const alt = $(el).attr('alt') || 'image';
        lines.push(`[img: ${alt}]`);
        return;
      }
      case 'table': {
        lines.push('\n');
        $(el).find('tr').each((_i, tr) => {
          const cells: string[] = [];
          $(tr).find('th, td').each((_j, td) => {
            cells.push($(td).text().replace(/\s+/g, ' ').trim());
          });
          lines.push('| ' + cells.join(' | ') + ' |');
        });
        lines.push('');
        return;
      }
      case 'div': case 'section': case 'article': case 'main': case 'span': case 'figure':
      case 'figcaption': case 'details': case 'summary': case 'dl': case 'dt': case 'dd':
      case 'tbody': case 'thead': case 'tfoot':
        for (const child of children) processNode(child, depth);
        return;
      default:
        for (const child of children) processNode(child, depth);
    }
  }

  root.contents().each((_i, el) => processNode(el));

  // Clean up the output
  let result = lines.join('')
    .replace(/\n{4,}/g, '\n\n\n')
    .replace(/ {3,}/g, '  ')
    .trim();

  // Truncate very long pages
  if (result.length > 8000) {
    result = result.slice(0, 8000) + '\n\n[...content truncated — page too long, use /browse <url> --full for complete output]';
  }

  return result;
}

// ─── Public browse API ───────────────────────────────────────────────────────

export async function browse(rawUrl: string, opts: { executeJs?: boolean; timeout?: number; fullPage?: boolean } = {}): Promise<BrowseResult> {
  if (!rawUrl.startsWith('http')) rawUrl = 'https://' + rawUrl;

  // Load cookies for this domain
  const storedCookies = await loadCookies();

  try {
    const fetchResult = await nativeFetch(rawUrl, {
      timeout: opts.timeout || 15000,
      cookies: storedCookies,
    });

    // Save updated cookies
    await saveCookies(fetchResult.cookies);

    // Handle non-HTML
    if (!fetchResult.contentType.includes('html') && !fetchResult.contentType.includes('text')) {
      const result: BrowseResult = {
        url: fetchResult.finalUrl,
        title: rawUrl,
        markdown: `[Binary content: ${fetchResult.contentType}]`,
        links: [],
        images: [],
        statusCode: fetchResult.statusCode,
        contentType: fetchResult.contentType,
      };
      return result;
    }

    // Handle HTTP errors
    if (fetchResult.statusCode >= 400) {
      const hint = httpErrorHint(fetchResult.statusCode);
      const result: BrowseResult = {
        url: fetchResult.finalUrl,
        title: `Error ${fetchResult.statusCode}`,
        markdown: `# HTTP ${fetchResult.statusCode}\n\n${hint}`,
        links: [],
        images: [],
        statusCode: fetchResult.statusCode,
        contentType: fetchResult.contentType,
        error: hint,
      };
      return result;
    }

    let html = fetchResult.body;

    // Execute JavaScript if requested
    if (opts.executeJs) {
      try {
        const { executePageScripts } = await import('./js-engine');
        const jsResult = await executePageScripts(html, fetchResult.finalUrl);
        html = jsResult.html;
      } catch {
        // JS execution failed, continue with static HTML
      }
    }

    // Parse with cheerio
    const parsed = parseWithCheerio(html, fetchResult.finalUrl);

    // Record history
    await addHistory(fetchResult.finalUrl, parsed.title);

    // Update active tab if exists
    const tab = getActiveTab();
    const result: BrowseResult = {
      url: fetchResult.finalUrl,
      title: parsed.title || fetchResult.finalUrl,
      markdown: parsed.markdown,
      links: parsed.links,
      images: parsed.images,
      statusCode: fetchResult.statusCode,
      contentType: fetchResult.contentType,
      tabId: tab?.id,
    };

    if (tab) {
      tab.url = fetchResult.finalUrl;
      tab.title = parsed.title;
      tab.result = result;
    }

    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      url: rawUrl,
      title: 'Error',
      markdown: `# Browse Error\n\n${message}`,
      links: [],
      images: [],
      statusCode: 0,
      contentType: '',
      error: message,
    };
  }
}

// ─── Web search via DuckDuckGo ───────────────────────────────────────────────

export async function search(query: string): Promise<BrowseResult> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  return browse(url);
}

// ─── Google Custom Search (uses API key) ─────────────────────────────────────

export async function googleSearch(query: string, apiKey: string, cx?: string): Promise<BrowseResult> {
  const searchCx = cx || '017576662512468239146:omuauf_lfve';
  const url = `https://www.googleapis.com/customsearch/v1?q=${encodeURIComponent(query)}&key=${apiKey}&cx=${searchCx}`;

  try {
    const storedCookies = await loadCookies();
    const { body } = await nativeFetch(url, { cookies: storedCookies });
    const data = JSON.parse(body) as {
      items?: Array<{ title: string; link: string; snippet: string }>;
      error?: { message: string };
    };

    if (data.error) throw new Error(data.error.message);

    const items = data.items || [];
    const lines = items.map((item, i) =>
      `### ${i + 1}. ${item.title}\n${item.snippet}\n[${item.link}](${item.link})\n`
    );

    return {
      url:         `Google Search: ${query}`,
      title:       `Search results for "${query}"`,
      markdown:    lines.join('\n') || 'No results found.',
      links:       items.map((item, i) => ({ n: i + 1, text: item.title, href: item.link })),
      images:      [],
      statusCode:  200,
      contentType: 'application/json',
    };
  } catch {
    return search(query);
  }
}

// ─── Follow a numbered link ──────────────────────────────────────────────────

export async function followLink(result: BrowseResult, linkNumber: number): Promise<BrowseResult> {
  const link = result.links.find(l => l.n === linkNumber);
  if (!link) {
    return {
      url: result.url,
      title: 'Error',
      markdown: `Link #${linkNumber} not found. Available links: 1-${result.links.length}`,
      links: [],
      images: [],
      statusCode: 0,
      contentType: '',
      error: `Link #${linkNumber} not found`,
    };
  }
  return browse(link.href);
}

// ─── Terminal renderer ───────────────────────────────────────────────────────

export function renderBrowseResult(result: BrowseResult): string {
  const cols   = process.stdout.columns || 80;
  const indent = '  ';
  const lines  = result.markdown.split('\n');
  const out: string[] = [];

  // Status bar
  const statusIcon = result.error ? '\x1b[38;5;167m✗\x1b[0m'
    : result.statusCode >= 200 && result.statusCode < 300 ? '\x1b[38;5;114m✓\x1b[0m'
    : '\x1b[38;5;214m⚠\x1b[0m';
  out.push(`${indent}${statusIcon} \x1b[38;5;141m${result.title}\x1b[0m`);
  out.push(`${indent}\x1b[38;5;246m${result.url}\x1b[0m ${result.statusCode ? `\x1b[38;5;240m[${result.statusCode}]\x1b[0m` : ''}`);
  out.push(`${indent}\x1b[38;5;236m${'─'.repeat(Math.min(cols - 4, 76))}\x1b[0m`);

  for (const line of lines) {
    if (!line.trim()) { out.push(''); continue; }
    if (line.startsWith('# '))        { out.push(`${indent}\x1b[1;38;5;141m${line.slice(2)}\x1b[0m`); continue; }
    if (line.startsWith('## '))       { out.push(`${indent}\x1b[1;38;5;110m${line.slice(3)}\x1b[0m`); continue; }
    if (line.startsWith('### '))      { out.push(`${indent}\x1b[38;5;110m${line.slice(4)}\x1b[0m`);   continue; }
    if (line.startsWith('#### '))     { out.push(`${indent}\x1b[38;5;246m${line.slice(5)}\x1b[0m`);   continue; }
    if (line.startsWith('  · '))      { out.push(`${indent}\x1b[38;5;246m·\x1b[0m ${line.slice(4)}`); continue; }
    if (line.startsWith('```'))       { out.push(`${indent}\x1b[38;5;242m${line}\x1b[0m`);            continue; }
    if (line.startsWith('─────'))     { out.push(`${indent}\x1b[38;5;236m${line}\x1b[0m`);            continue; }
    if (line.startsWith('> '))        { out.push(`${indent}\x1b[38;5;240m│\x1b[0m \x1b[3m${line.slice(2)}\x1b[0m`); continue; }
    if (line.startsWith('| '))        { out.push(`${indent}\x1b[38;5;246m${line}\x1b[0m`);            continue; }

    // Highlight numbered link references
    const withLinks = line.replace(/\[(\d+)\]/g, '\x1b[38;5;141m[$1]\x1b[0m');

    // Word-wrap long lines
    const words = withLinks.split(' ');
    let cur = indent;
    for (const w of words) {
      const plainLen = cur.replace(/\x1b\[[0-9;]*m/g, '').length;
      const wordPlainLen = w.replace(/\x1b\[[0-9;]*m/g, '').length;
      if (plainLen + wordPlainLen + 1 > cols) { out.push(cur); cur = indent + w; }
      else { cur += (cur === indent ? '' : ' ') + w; }
    }
    if (cur !== indent) out.push(cur);
  }

  // Link index
  if (result.links.length > 0) {
    out.push('');
    out.push(`${indent}\x1b[38;5;236m${'─'.repeat(Math.min(cols - 4, 76))}\x1b[0m`);
    out.push(`${indent}\x1b[1;38;5;141mLinks:\x1b[0m`);
    for (const l of result.links.slice(0, 20)) {
      out.push(`${indent}\x1b[38;5;141m[${String(l.n).padStart(2)}]\x1b[0m ${l.text}  \x1b[38;5;240m${l.href.slice(0, 50)}\x1b[0m`);
    }
    if (result.links.length > 20) {
      out.push(`${indent}\x1b[38;5;246m... and ${result.links.length - 20} more links\x1b[0m`);
    }
  }

  // Image list
  if (result.images.length > 0) {
    out.push('');
    out.push(`${indent}\x1b[1;38;5;110mImages:\x1b[0m`);
    for (const img of result.images.slice(0, 10)) {
      out.push(`${indent}\x1b[38;5;110m[img${img.n}]\x1b[0m ${img.alt || 'untitled'}  \x1b[38;5;240m${img.src.slice(0, 50)}\x1b[0m`);
    }
  }

  return out.join('\n');
}
