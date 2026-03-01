import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';

import { getDataDir } from '../data/profile';

interface AuthStore {
  pinHash: string;
  salt: string;
  failedAttempts: number;
  lockUntil?: number;
}

const AUTH_PATH = () => path.join(getDataDir(), '.auth');
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

function hashPin(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin, salt, 100_000, 64, 'sha512').toString('hex');
}

async function readAuthStore(): Promise<AuthStore | null> {
  const p = AUTH_PATH();
  if (!(await fs.pathExists(p))) return null;
  try { return await fs.readJson(p); } catch { return null; }
}

async function writeAuthStore(store: AuthStore): Promise<void> {
  await fs.ensureDir(getDataDir());
  await fs.writeJson(AUTH_PATH(), store);
  // Restrict permissions: owner read/write only
  try { await fs.chmod(AUTH_PATH(), 0o600); } catch { /* ignore */ }
}

export async function pinExists(): Promise<boolean> {
  const store = await readAuthStore();
  return store !== null && !!store.pinHash;
}

export async function setPin(pin: string): Promise<void> {
  const salt = crypto.randomBytes(32).toString('hex');
  const pinHash = hashPin(pin, salt);
  await writeAuthStore({ pinHash, salt, failedAttempts: 0 });
}

export async function verifyPin(pin: string): Promise<'ok' | 'wrong' | 'locked'> {
  const store = await readAuthStore();
  if (!store) return 'wrong';

  // Check lockout
  if (store.lockUntil && Date.now() < store.lockUntil) {
    return 'locked';
  }

  const hash = hashPin(pin, store.salt);
  if (hash !== store.pinHash) {
    store.failedAttempts = (store.failedAttempts || 0) + 1;
    if (store.failedAttempts >= MAX_ATTEMPTS) {
      store.lockUntil = Date.now() + LOCKOUT_MS;
      store.failedAttempts = 0;
    }
    await writeAuthStore(store);
    return 'wrong';
  }

  // Reset on success
  store.failedAttempts = 0;
  store.lockUntil = undefined;
  await writeAuthStore(store);
  return 'ok';
}

export async function getLockoutRemaining(): Promise<number> {
  const store = await readAuthStore();
  if (!store?.lockUntil) return 0;
  return Math.max(0, store.lockUntil - Date.now());
}

// ─── Masked input (no echo) ───────────────────────────────────────────────────
export function askHidden(promptText: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(promptText);

    let chars = '';
    const isTTY = process.stdin.isTTY;

    // Enter raw mode so keypresses arrive one-by-one with no echo
    if (isTTY) {
      (process.stdin as NodeJS.ReadStream & { setRawMode(mode: boolean): void }).setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    function done() {
      process.stdout.write('\n');
      process.stdin.removeListener('data', onData);
      if (isTTY) {
        (process.stdin as NodeJS.ReadStream & { setRawMode(mode: boolean): void }).setRawMode(false);
      }
      process.stdin.pause();
      resolve(chars);
    }

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\u0003') { // Ctrl+C
          process.stdout.write('\n');
          process.exit(0);
        } else if (ch === '\r' || ch === '\n') { // Enter
          done();
          return;
        } else if (ch === '\u007F' || ch === '\b') { // Backspace
          if (chars.length > 0) {
            chars = chars.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (ch >= ' ') { // Printable character
          chars += ch;
          process.stdout.write('*');
        }
      }
    };

    process.stdin.on('data', onData);
  });
}

export async function changePin(currentPin: string, newPin: string): Promise<boolean> {
  const result = await verifyPin(currentPin);
  if (result !== 'ok') return false;
  await setPin(newPin);
  return true;
}
