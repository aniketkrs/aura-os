/**
 * Google OAuth2 — Localhost Redirect Flow (Desktop app client type)
 * Starts a local HTTP server to catch the redirect, no browser window required.
 * Supports Gmail API + Drive API + Calendar API
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { exec } from 'child_process';
import { getDataDir } from '../data/profile';
import { T, Sym, divider, Typing } from '../tui/theme';

// ─── OAuth2 credentials — loaded from env or user config ──────────────────────
// Users set these via: /google auth (prompted) or GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET env vars
const AURA_DEFAULT_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const AURA_DEFAULT_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';

export interface GoogleCredentials {
  apiKey?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

const CREDS_PATH = () => path.join(getDataDir(), '.google-creds.json');

// Scopes needed
const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
].join(' ');

export async function loadGoogleCreds(): Promise<GoogleCredentials> {
  const p = CREDS_PATH();
  if (!(await fs.pathExists(p))) return {};
  try { return await fs.readJson(p); } catch { return {}; }
}

export async function saveGoogleCreds(creds: GoogleCredentials): Promise<void> {
  await fs.ensureDir(getDataDir());
  await fs.writeJson(CREDS_PATH(), creds, { spaces: 2 });
  try { await fs.chmod(CREDS_PATH(), 0o600); } catch { }
}

function httpsPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const opts = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'AuraOS/1.0',
      },
    };
    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function refreshAccessToken(creds: GoogleCredentials): Promise<GoogleCredentials> {
  if (!creds.refreshToken || !creds.clientId || !creds.clientSecret) {
    throw new Error('Missing refresh token or client credentials');
  }
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    refresh_token: creds.refreshToken,
    grant_type: 'refresh_token',
  }).toString();

  const resp = await httpsPost('https://oauth2.googleapis.com/token', body);
  const data = JSON.parse(resp) as { access_token?: string; expires_in?: number; error?: string };
  if (data.error) throw new Error(`Token refresh failed: ${data.error}`);

  const updated = {
    ...creds,
    accessToken: data.access_token!,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
  await saveGoogleCreds(updated);
  return updated;
}

export async function getValidToken(): Promise<string> {
  let creds = await loadGoogleCreds();
  if (!creds.accessToken) throw new Error('Not authenticated with Google. Run /google auth');
  if (creds.expiresAt && Date.now() > creds.expiresAt - 60000) {
    creds = await refreshAccessToken(creds);
  }
  return creds.accessToken!;
}

export function isGoogleAuthed(): Promise<boolean> {
  return loadGoogleCreds().then(c => !!(c.accessToken || c.refreshToken));
}

/**
 * Get OAuth client credentials — uses saved creds if available, otherwise defaults.
 */
export async function getOAuthClientCreds(): Promise<{ clientId: string; clientSecret: string }> {
  const creds = await loadGoogleCreds();
  return {
    clientId: creds.clientId || AURA_DEFAULT_CLIENT_ID,
    clientSecret: creds.clientSecret || AURA_DEFAULT_CLIENT_SECRET,
  };
}

/**
 * Try to open a URL in the default browser (macOS/Linux/Windows).
 */
function tryOpenBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
      : 'xdg-open';
  exec(`${cmd} "${url}"`, () => { /* ignore errors — user can open manually */ });
}

// ─── Local redirect server to catch OAuth callback ────────────────────────────
function startCallbackServer(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      const code = url.searchParams.get('code');
      const error = url.searchParams.get('error');

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>');
        server.close();
        reject(new Error(`User denied access: ${error}`));
        return;
      }

      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><body><h2>✓ Aura OS authorized!</h2><p>You can close this tab and return to the terminal.</p></body></html>');
        server.close();
        resolve(code);
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><body><p>Waiting...</p></body></html>');
    });

    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(''));
  });
}

// ─── Main OAuth2 flow for Desktop app clients ─────────────────────────────────
export async function runGoogleAuth(clientId: string, clientSecret: string): Promise<void> {
  const PORT = 9876;
  const REDIRECT_URI = `http://localhost:${PORT}/callback`;

  console.log('');
  console.log(divider('GOOGLE OAUTH2 — DESKTOP APP FLOW'));
  console.log('');

  // Build the auth URL
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', clientId);
  authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', SCOPES);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  // Auto-open browser on macOS
  const authUrlStr = authUrl.toString();
  tryOpenBrowser(authUrlStr);

  console.log(`  ${T.aurora(Sym.sparkle)} ${T.auraBold('Opening browser for Google sign-in...')}`);
  console.log('');
  console.log(`  ${T.muted('If the browser did not open, copy this URL:')}`);
  console.log(`  ${T.ice(authUrlStr)}`);
  console.log('');
  console.log(`  ${T.muted('After you approve, the browser will redirect to localhost.')}`);
  console.log(`  ${T.muted('Aura OS is listening on port')} ${T.aura(String(PORT))} ${T.muted('— do not close this terminal.')}`);
  console.log('');

  const spin = new Typing('Waiting for browser authorization...').start();

  // Start server and wait for callback
  let code: string;
  try {
    // Start server first (before user opens URL)
    const serverPromise = new Promise<string>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${PORT}`);
        const authCode = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end('<html><body><h2>Authorization denied.</h2><p>You can close this tab.</p></body></html>');
          server.close();
          reject(new Error(`User denied access: ${error}`));
          return;
        }

        if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`<html><head><style>body{font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;background:#0a0a0a;color:#fff;}</style></head><body><div style="text-align:center"><h1 style="color:#a78bfa">✓ Aura OS Authorized!</h1><p style="color:#888">You can close this tab and return to your terminal.</p></div></body></html>`);
          server.close();
          resolve(authCode);
          return;
        }

        res.writeHead(404);
        res.end();
      });

      server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${PORT} is already in use. Kill any process using it and try again.`));
        } else {
          reject(err);
        }
      });

      server.listen(PORT, '127.0.0.1');
    });

    // Wait for browser redirect (5 minute timeout)
    const timeout = new Promise<string>((_, reject) =>
      setTimeout(() => reject(new Error('Timed out waiting for browser authorization (5 min)')), 5 * 60 * 1000)
    );

    code = await Promise.race([serverPromise, timeout]);
  } catch (err) {
    spin.stop(`  ${T.nova('Auth failed:')} ${String(err)}`);
    throw err;
  }

  // Exchange code for token
  spin.stop(`  ${T.aurora(Sym.check)} Browser authorized — exchanging code for token...`);

  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: REDIRECT_URI,
    grant_type: 'authorization_code',
  }).toString();

  const tokenResp = await httpsPost('https://oauth2.googleapis.com/token', tokenBody);
  const token = JSON.parse(tokenResp) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!token.access_token) {
    throw new Error(`Token exchange failed: ${token.error} — ${token.error_description}`);
  }

  const creds: GoogleCredentials = {
    clientId,
    clientSecret,
    redirectUri: REDIRECT_URI,
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresAt: Date.now() + (token.expires_in || 3600) * 1000,
  };
  await saveGoogleCreds(creds);

  console.log(`  ${T.aurora(Sym.check)} Google account connected!`);
  console.log(`  ${T.muted('Run')} ${T.aura('/mail inbox')} ${T.muted('to access Gmail ·')} ${T.aura('/drive list')} ${T.muted('for Drive.')}`);
}
