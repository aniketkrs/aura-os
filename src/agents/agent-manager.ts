import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { EventBus } from '../data/memory';

export interface AgentDefinition {
  name: string;
  description: string;
  intervalMs: number;
  run: (ctx: AgentContext) => Promise<void>;
}

export interface AgentContext {
  log: (msg: string) => void;
  emit: (event: string, data?: unknown) => void;
}

export interface AgentInstance {
  def: AgentDefinition;
  active: boolean;
  timer: NodeJS.Timeout | null;
  lastRun?: Date;
  errors: number;
}

const registry: Map<string, AgentDefinition> = new Map();
const instances: Map<string, AgentInstance> = new Map();

// ─── Log to file only — never write to stdout ─────────────────────────────────
const LOG_PATH = path.join(os.homedir(), '.aura', 'agents.log');
const MAX_LOG_BYTES = 1024 * 512; // 512 KB

async function writeLog(agentName: string, msg: string): Promise<void> {
  try {
    await fs.ensureDir(path.dirname(LOG_PATH));
    // Rotate if too large
    try {
      const stat = await fs.stat(LOG_PATH);
      if (stat.size > MAX_LOG_BYTES) {
        const content = await fs.readFile(LOG_PATH, 'utf8');
        const half = content.slice(content.length / 2);
        await fs.writeFile(LOG_PATH, half);
      }
    } catch { /* file doesn't exist yet */ }

    const ts = new Date().toISOString();
    // Strip ANSI color codes before writing to log file
    const clean = msg.replace(/\x1B\[[0-9;]*m/g, '');
    await fs.appendFile(LOG_PATH, `[${ts}] [${agentName}] ${clean}\n`);
  } catch { /* never crash on log failure */ }
}

export function registerAgent(def: AgentDefinition): void {
  registry.set(def.name, def);
}

export function startAgent(name: string): boolean {
  const def = registry.get(name);
  if (!def) return false;

  const existing = instances.get(name);
  if (existing?.active) return true;

  const ctx: AgentContext = {
    // Logs go to file — terminal stays clean
    log: (msg) => { writeLog(name, msg); },
    emit: (event, data) => EventBus.emit(event, data),
  };

  const runSafe = async () => {
    const inst = instances.get(name);
    if (!inst?.active) return;
    try {
      await def.run(ctx);
      inst.lastRun = new Date();
      inst.errors = 0;
    } catch (err) {
      inst.errors = (inst.errors || 0) + 1;
      writeLog(name, `ERROR: ${String(err)}`);
      if (inst.errors >= 5) {
        writeLog(name, 'Too many errors — stopping agent');
        stopAgent(name);
      }
    }
  };

  // Delay first run so boot screen settles
  const timer = setInterval(runSafe, def.intervalMs);
  setTimeout(runSafe, 5000);

  instances.set(name, { def, active: true, timer, errors: 0 });
  return true;
}

export function stopAgent(name: string): boolean {
  const inst = instances.get(name);
  if (!inst?.active) return false;
  if (inst.timer) clearInterval(inst.timer);
  inst.active = false;
  inst.timer = null;
  return true;
}

export function stopAllAgents(): void {
  for (const name of instances.keys()) stopAgent(name);
}

export function getAgentStatus(): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const [name, inst] of instances) {
    status[name] = inst.active;
  }
  for (const name of registry.keys()) {
    if (!(name in status)) status[name] = false;
  }
  return status;
}

export function listAgents(): AgentInstance[] {
  return Array.from(instances.values());
}

export function listRegistered(): AgentDefinition[] {
  return Array.from(registry.values());
}

// ─── Read agent log for /log command ─────────────────────────────────────────
export async function readAgentLog(lines = 50): Promise<string[]> {
  try {
    if (!(await fs.pathExists(LOG_PATH))) return [];
    const content = await fs.readFile(LOG_PATH, 'utf8');
    return content.trim().split('\n').slice(-lines);
  } catch { return []; }
}

// Graceful shutdown
process.on('exit', stopAllAgents);
process.on('SIGINT', () => { stopAllAgents(); process.exit(0); });
process.on('SIGTERM', () => { stopAllAgents(); process.exit(0); });
