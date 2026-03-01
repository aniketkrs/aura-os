/**
 * Secure API key storage — keys are saved to ~/.aura/.keys (chmod 600)
 * and merged into process.env at runtime. Never echoed to terminal.
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import { getDataDir } from '../data/profile';
import { askHidden } from './auth';
import { T, Sym, divider } from '../tui/theme';

const KEYS_PATH = () => path.join(getDataDir(), '.keys.json');

interface KeyStore {
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  GOOGLE_API_KEY?: string;
  OLLAMA_BASE_URL?: string;
  [key: string]: string | undefined;
}

export async function loadKeys(): Promise<KeyStore> {
  const p = KEYS_PATH();
  if (!(await fs.pathExists(p))) return {};
  try { return await fs.readJson(p); } catch { return {}; }
}

export async function saveKey(name: keyof KeyStore, value: string): Promise<void> {
  await fs.ensureDir(getDataDir());
  const store = await loadKeys();
  store[name] = value;
  await fs.writeJson(KEYS_PATH(), store);
  try { await fs.chmod(KEYS_PATH(), 0o600); } catch { }
  // Inject into live process.env immediately
  process.env[name] = value;
}

export async function injectKeysToEnv(): Promise<void> {
  const store = await loadKeys();
  let dirty = false;
  for (const [k, v] of Object.entries(store)) {
    if (!v) continue;
    // Validate: keys must be at least 10 chars and not look like shell commands
    if (v.length < 10 || v.startsWith('/') || v.startsWith('\\')) {
      delete store[k];
      dirty = true;
      continue;
    }
    if (!process.env[k]) process.env[k] = v;
  }
  // Persist cleaned store
  if (dirty) {
    try {
      await fs.writeJson(KEYS_PATH(), store);
      try { await fs.chmod(KEYS_PATH(), 0o600); } catch { }
    } catch { /* file may be locked */ }
  }
}

export function maskKey(key: string): string {
  if (!key || key.length < 10) return '***';
  return key.slice(0, 8) + '·'.repeat(12) + key.slice(-4);
}

// ─── Interactive key setup ─────────────────────────────────────────────────────
export async function runApiKeySetup(provider: 'anthropic' | 'openai' | 'gemini' | 'mistral'): Promise<void> {
  const labels: Record<string, string> = {
    anthropic: 'Anthropic (claude-sonnet, claude-opus)',
    openai: 'OpenAI (gpt-4o, gpt-4o-mini)',
    gemini: 'Google Gemini (gemini-2.5-flash, gemini-2.0-flash)',
    mistral: 'Mistral AI (mistral-large, mistral-small)',
  };
  const envKeys: Record<string, keyof KeyStore> = {
    anthropic: 'ANTHROPIC_API_KEY',
    openai: 'OPENAI_API_KEY',
    gemini: 'GEMINI_API_KEY',
    mistral: 'MISTRAL_API_KEY',
  };

  console.log('');
  console.log(divider(`${labels[provider]} API KEY`));
  console.log('');
  console.log(`  ${T.muted('Key will be stored in')} ${T.dim('~/.aura/.keys.json')} ${T.muted('with restricted permissions.')}`);
  console.log(`  ${T.muted('It will never be echoed or logged to the terminal.')}`);
  console.log('');

  const envKey = envKeys[provider];
  const current = process.env[envKey];
  if (current) {
    console.log(`  ${T.muted('Current:')} ${T.dim(maskKey(current))}`);
    console.log('');
  }

  const key = await askHidden(`  ${T.aura(Sym.key)} Paste API key: `);
  if (!key.trim()) {
    console.log(`  ${T.nova('No key entered. Aborted.')}`);
    return;
  }

  await saveKey(envKey, key.trim());
  process.env[envKey] = key.trim(); // inject live so current session can use it immediately
  console.log(`  ${T.aurora(Sym.check)} Key saved: ${T.dim(maskKey(key.trim()))}`);
  console.log('');
}

// ─── Show masked key status ────────────────────────────────────────────────────
export async function showKeyStatus(): Promise<void> {
  const store = await loadKeys();
  const checks: Array<[string, string | undefined]> = [
    ['Anthropic', store.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY],
    ['OpenAI', store.OPENAI_API_KEY || process.env.OPENAI_API_KEY],
    ['Gemini', store.GEMINI_API_KEY || process.env.GEMINI_API_KEY],
    ['Mistral', store.MISTRAL_API_KEY || process.env.MISTRAL_API_KEY],
    ['Google API', store.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY],
    ['Ollama URL', store.OLLAMA_BASE_URL || process.env.OLLAMA_BASE_URL],
  ];
  console.log('');
  console.log(divider('API KEYS'));
  for (const [label, val] of checks) {
    const status = val
      ? `${T.aurora(Sym.check)} ${T.dim(maskKey(val))}`
      : `${T.dim(Sym.cross)} ${T.muted('not set')}`;
    console.log(`  ${T.muted(label.padEnd(14))} ${status}`);
  }
  console.log('');
  console.log(`  ${T.muted('Use')} ${T.aura('/apikey anthropic')} ${T.muted('/')} ${T.aura('/apikey openai')} ${T.muted('/')} ${T.aura('/apikey gemini')} ${T.muted('/')} ${T.aura('/apikey mistral')} ${T.muted('to update.')}`);
  console.log('');
}
