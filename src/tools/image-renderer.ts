/**
 * Terminal image renderer — no osascript, no open -a
 * Strategy: sharp resize → chafa CLI primary → ANSI block fallback
 * Supports sixel/kitty/iTerm2 detection for capable terminals
 */
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import * as fs from 'fs-extra';
import * as sharp from 'sharp';
import { execFileSync, execFile } from 'child_process';
import { URL } from 'url';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ImageRenderOpts {
  width?:   number;
  height?:  number;
  format?:  'chafa' | 'sixel' | 'ansi';
  quality?: number;
}

export interface TerminalCaps {
  sixel:  boolean;
  kitty:  boolean;
  iterm:  boolean;
  chafa:  boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CACHE_DIR   = path.join(os.homedir(), '.aura', 'browser', 'image-cache');
const CHAFA_PATH  = '/opt/homebrew/bin/chafa';
const MAX_WIDTH   = 120;
const MAX_HEIGHT  = 40;
const DEFAULT_QUALITY = 80;

// ─── Cache Helpers ───────────────────────────────────────────────────────────

function cacheKey(url: string): string {
  return crypto.createHash('sha256').update(url).digest('hex');
}

function cachePath(url: string): string {
  return path.join(CACHE_DIR, cacheKey(url));
}

async function ensureCacheDir(): Promise<void> {
  await fs.ensureDir(CACHE_DIR, { mode: 0o700 });
}

// ─── Terminal Capability Detection ───────────────────────────────────────────

export function detectTerminalCapabilities(): TerminalCaps {
  const term        = process.env.TERM || '';
  const termProgram = process.env.TERM_PROGRAM || '';
  const kittyPid    = process.env.KITTY_PID || '';
  const colorterm   = process.env.COLORTERM || '';

  // Sixel-capable terminals
  const sixelTerminals = ['wezterm', 'foot', 'mlterm', 'xterm'];
  const sixelPrograms  = ['WezTerm', 'iTerm.app', 'foot'];
  const sixel = sixelTerminals.some(t => term.toLowerCase().includes(t))
    || sixelPrograms.some(p => termProgram.includes(p));

  // Kitty graphics protocol
  const kitty = !!kittyPid || termProgram === 'kitty';

  // iTerm2 inline image protocol
  const iterm = termProgram === 'iTerm.app'
    || termProgram === 'iTerm2'
    || colorterm === 'iterm';

  // Chafa binary availability
  let chafa = false;
  try {
    execFileSync(CHAFA_PATH, ['--version'], { stdio: 'pipe', timeout: 3000 });
    chafa = true;
  } catch {
    // chafa not available
  }

  return { sixel, kitty, iterm, chafa };
}

// ─── Image Download ──────────────────────────────────────────────────────────

function downloadImage(rawUrl: string, redirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (redirects <= 0) return reject(new Error('Too many redirects'));

    let parsed: URL;
    try { parsed = new URL(rawUrl); } catch { return reject(new Error(`Invalid URL: ${rawUrl}`)); }

    const lib  = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'GET',
      headers:  {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AuraOS/1.0',
        'Accept':     'image/*,*/*',
      },
      timeout: 30000,
    };

    const req = (lib.request as Function)(opts, (res: http.IncomingMessage) => {
      const status = res.statusCode || 0;

      // Follow redirects
      if ((status >= 301 && status <= 308) && res.headers.location) {
        const next = res.headers.location.startsWith('http')
          ? res.headers.location
          : new URL(res.headers.location, rawUrl).href;
        res.destroy();
        return resolve(downloadImage(next, redirects - 1));
      }

      if (status < 200 || status >= 300) {
        res.destroy();
        return reject(new Error(`HTTP ${status} fetching image`));
      }

      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Image download timed out')); });
    req.end();
  });
}

// ─── Sharp Processing ────────────────────────────────────────────────────────

async function processImage(input: Buffer, opts: ImageRenderOpts): Promise<Buffer> {
  const width   = opts.width  || MAX_WIDTH;
  const height  = opts.height || MAX_HEIGHT;
  const quality = opts.quality || DEFAULT_QUALITY;

  // Terminal chars are ~2:1 aspect ratio (taller than wide), so scale
  // pixel dimensions accordingly for decent fidelity.
  const pixelWidth  = width * 8;
  const pixelHeight = height * 16;

  const processed = await (sharp as unknown as typeof sharp.default)(input)
    .resize(pixelWidth, pixelHeight, { fit: 'inside', withoutEnlargement: true })
    .png({ quality })
    .toBuffer();

  return processed;
}

// ─── Chafa Renderer (primary) ────────────────────────────────────────────────

function renderWithChafa(imageBuffer: Buffer, opts: ImageRenderOpts, caps: TerminalCaps): Promise<string> {
  return new Promise((resolve, reject) => {
    const width  = opts.width  || MAX_WIDTH;
    const height = opts.height || MAX_HEIGHT;

    // Pick best symbol mode based on terminal + requested format
    let symbolMode = 'block';
    if (opts.format === 'sixel' && caps.sixel) {
      symbolMode = 'sixel';
    }

    const args = [
      '--size', `${width}x${height}`,
      '--symbols', symbolMode,
      '--color-space', 'rgb',
      '--animate', 'off',
      '-',  // read from stdin
    ];

    const proc = execFile(CHAFA_PATH, args, {
      encoding: 'buffer',
      maxBuffer: 10 * 1024 * 1024,
      timeout: 15000,
    }, (err, stdout) => {
      if (err) return reject(new Error(`chafa failed: ${err.message}`));
      resolve((stdout as Buffer).toString('utf8'));
    });

    if (proc.stdin) {
      proc.stdin.write(imageBuffer);
      proc.stdin.end();
    }
  });
}

// ─── ANSI Block Fallback Renderer ────────────────────────────────────────────

async function renderWithAnsiBlocks(imageBuffer: Buffer, opts: ImageRenderOpts): Promise<string> {
  const width  = opts.width  || MAX_WIDTH;
  const height = opts.height || MAX_HEIGHT;

  // Resize to exact character dimensions — each "pixel" = 1 char wide,
  // use half-block chars (upper/lower) to pack 2 vertical pixels per row.
  const rows = height * 2;
  const { data, info } = await (sharp as unknown as typeof sharp.default)(imageBuffer)
    .resize(width, rows, { fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const lines: string[] = [];

  // Process two pixel-rows at a time using the unicode upper-half-block char
  for (let y = 0; y < info.height - 1; y += 2) {
    let line = '';
    for (let x = 0; x < info.width; x++) {
      const topIdx = (y * info.width + x) * 4;
      const botIdx = ((y + 1) * info.width + x) * 4;

      const tr = data[topIdx];
      const tg = data[topIdx + 1];
      const tb = data[topIdx + 2];
      const ta = data[topIdx + 3];

      const br = data[botIdx];
      const bg = data[botIdx + 1];
      const bb = data[botIdx + 2];
      const ba = data[botIdx + 3];

      if (ta < 32 && ba < 32) {
        // Both transparent
        line += ' ';
      } else if (ta < 32) {
        // Top transparent, bottom visible — use lower half block
        line += `\x1b[38;2;${br};${bg};${bb}m\u2584\x1b[0m`;
      } else if (ba < 32) {
        // Top visible, bottom transparent — use upper half block
        line += `\x1b[38;2;${tr};${tg};${tb}m\u2580\x1b[0m`;
      } else {
        // Both visible — upper half block with fg=top, bg=bottom
        line += `\x1b[38;2;${tr};${tg};${tb};48;2;${br};${bg};${bb}m\u2580\x1b[0m`;
      }
    }
    lines.push(line);
  }

  return lines.join('\n');
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Render an image (file path or raw Buffer) to a terminal-displayable string.
 * Returns the rendered string — does NOT write to stdout.
 */
export async function renderImage(input: string | Buffer, opts: ImageRenderOpts = {}): Promise<string> {
  let raw: Buffer;

  if (Buffer.isBuffer(input)) {
    raw = input;
  } else {
    // Treat as file path
    const resolved = path.resolve(input);
    if (!(await fs.pathExists(resolved))) {
      throw new Error(`Image not found: ${resolved}`);
    }
    raw = await fs.readFile(resolved);
  }

  // Process through sharp for consistent sizing
  const processed = await processImage(raw, opts);

  const caps = detectTerminalCapabilities();

  // Determine rendering strategy
  const format = opts.format || (caps.chafa ? 'chafa' : 'ansi');

  switch (format) {
    case 'chafa':
      if (!caps.chafa) {
        return renderWithAnsiBlocks(processed, opts);
      }
      return renderWithChafa(processed, opts, caps);

    case 'sixel':
      if (caps.chafa && caps.sixel) {
        return renderWithChafa(processed, { ...opts, format: 'sixel' }, caps);
      }
      // Sixel requested but not available — fall through to ANSI
      return renderWithAnsiBlocks(processed, opts);

    case 'ansi':
    default:
      return renderWithAnsiBlocks(processed, opts);
  }
}

/**
 * Download an image from a URL, cache it, and render for terminal display.
 * Returns the rendered string — does NOT write to stdout.
 */
export async function renderImageFromUrl(url: string, opts: ImageRenderOpts = {}): Promise<string> {
  await ensureCacheDir();

  const cached = cachePath(url);
  let raw: Buffer;

  if (await fs.pathExists(cached)) {
    raw = await fs.readFile(cached);
  } else {
    raw = await downloadImage(url);
    // Write cache file with chmod 600
    await fs.writeFile(cached, raw, { mode: 0o600 });
  }

  return renderImage(raw, opts);
}

/**
 * Check if a URL's image is already cached. Returns the rendered string if
 * cached, or null if not present.
 */
export async function getCachedImage(url: string): Promise<string | null> {
  await ensureCacheDir();

  const cached = cachePath(url);
  if (!(await fs.pathExists(cached))) {
    return null;
  }

  const raw = await fs.readFile(cached);
  return renderImage(raw);
}
