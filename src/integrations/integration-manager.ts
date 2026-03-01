/**
 * Integration Manager — registry, config store, connect/disconnect
 * Config stored in ~/.aura/integrations.json (chmod 600)
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

const DATA_DIR = path.join(os.homedir(), '.aura');
const CONFIG_PATH = path.join(DATA_DIR, 'integrations.json');

// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface AppMessage {
  id: string;
  from: string;
  channel?: string;
  text: string;
  timestamp: string;
}

export interface SetupField {
  key: string;
  label: string;
  secret: boolean;
  hint?: string;
}

export interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  setupFields: SetupField[];
  fetchMessages(config: Record<string, string>, limit?: number): Promise<AppMessage[]>;
  sendMessage(config: Record<string, string>, target: string, text: string): Promise<void>;
  fetchNotifications?(config: Record<string, string>): Promise<AppMessage[]>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<string, IntegrationDef>();

export function registerIntegration(def: IntegrationDef): void {
  registry.set(def.id, def);
}

export function getIntegration(id: string): IntegrationDef | undefined {
  return registry.get(id);
}

export function listIntegrations(): Array<IntegrationDef & { connected: boolean }> {
  return Array.from(registry.values()).map(def => ({
    ...def,
    connected: false, // will be hydrated by caller after loading configs
  }));
}

// ─── Config store ─────────────────────────────────────────────────────────────

type ConfigStore = Record<string, Record<string, string>>;

async function loadStore(): Promise<ConfigStore> {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(CONFIG_PATH))) return {};
  try { return await fs.readJson(CONFIG_PATH); } catch { return {}; }
}

async function saveStore(store: ConfigStore): Promise<void> {
  await fs.ensureDir(DATA_DIR);
  await fs.writeJson(CONFIG_PATH, store, { spaces: 2 });
  try { await fs.chmod(CONFIG_PATH, 0o600); } catch {}
}

export async function loadIntegrationConfig(id: string): Promise<Record<string, string> | null> {
  const store = await loadStore();
  return store[id] ?? null;
}

export async function saveIntegrationConfig(id: string, config: Record<string, string>): Promise<void> {
  const store = await loadStore();
  store[id] = config;
  await saveStore(store);
}

export async function deleteIntegrationConfig(id: string): Promise<void> {
  const store = await loadStore();
  delete store[id];
  await saveStore(store);
}

export async function isConnected(id: string): Promise<boolean> {
  const def = registry.get(id);
  if (!def) return false;
  const config = await loadIntegrationConfig(id);
  if (!config) return false;
  // All non-secret required fields must be present
  return def.setupFields.every(f => !!config[f.key]);
}
