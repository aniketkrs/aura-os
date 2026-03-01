import * as crypto from 'crypto';
import * as fs from 'fs-extra';
import * as path from 'path';
import { getDataDir } from '../data/profile';

interface Session {
  token: string;
  createdAt: number;
  pid: number;
}

const SESSION_PATH = () => path.join(getDataDir(), '.session');

export async function createSession(): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const session: Session = { token, createdAt: Date.now(), pid: process.pid };
  await fs.ensureDir(getDataDir());
  await fs.writeJson(SESSION_PATH(), session);
  try { await fs.chmod(SESSION_PATH(), 0o600); } catch { /* ignore */ }
  return token;
}

export async function destroySession(): Promise<void> {
  const p = SESSION_PATH();
  if (await fs.pathExists(p)) {
    // Overwrite with zeros before deleting to prevent recovery
    const size = (await fs.stat(p)).size;
    await fs.writeFile(p, Buffer.alloc(size, 0));
    await fs.remove(p);
  }
}

export async function sessionExists(): Promise<boolean> {
  return fs.pathExists(SESSION_PATH());
}

// Cleanup on process exit
process.on('exit', () => {
  const p = SESSION_PATH();
  try {
    if (fs.pathExistsSync(p)) {
      fs.writeFileSync(p, Buffer.alloc(0));
      fs.removeSync(p);
    }
  } catch { /* ignore */ }
});

process.on('SIGINT', () => {
  destroySession().finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  destroySession().finally(() => process.exit(0));
});
