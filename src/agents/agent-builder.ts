// ─── Agent Builder — storage and lifecycle for custom (user-created) agents ──
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { registerAgent } from './agent-manager';
import { getTemplate } from './agent-templates';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CustomAgentConfig {
  id: string;
  name: string;
  templateId: string;
  config: Record<string, string>;
  intervalMs: number;
  enabled: boolean;
  createdAt: string;
}

// ─── Storage path ────────────────────────────────────────────────────────────

const AGENTS_PATH = path.join(os.homedir(), '.aura', 'custom-agents.json');

// ─── Persistence ─────────────────────────────────────────────────────────────

export async function loadCustomAgents(): Promise<CustomAgentConfig[]> {
  if (!(await fs.pathExists(AGENTS_PATH))) return [];
  try {
    return await fs.readJson(AGENTS_PATH);
  } catch {
    return [];
  }
}

async function writeCustomAgents(agents: CustomAgentConfig[]): Promise<void> {
  await fs.ensureDir(path.dirname(AGENTS_PATH));
  await fs.writeJson(AGENTS_PATH, agents, { spaces: 2 });
}

export async function saveCustomAgent(agent: CustomAgentConfig): Promise<void> {
  const agents = await loadCustomAgents();
  const idx = agents.findIndex(a => a.id === agent.id);
  if (idx !== -1) {
    agents[idx] = agent;
  } else {
    agents.push(agent);
  }
  await writeCustomAgents(agents);
}

export async function removeCustomAgent(id: string): Promise<void> {
  const agents = await loadCustomAgents();
  const filtered = agents.filter(a => a.id !== id);
  await writeCustomAgents(filtered);
}

// ─── Registration ────────────────────────────────────────────────────────────

export function registerCustomAgent(agent: CustomAgentConfig): boolean {
  const template = getTemplate(agent.templateId);
  if (!template) return false;

  const runFn = template.buildRun(agent.config);

  registerAgent({
    name: agent.name,
    description: `[custom] ${template.description}`,
    intervalMs: agent.intervalMs,
    run: runFn,
  });

  return true;
}

export async function registerAllCustomAgents(): Promise<number> {
  const agents = await loadCustomAgents();
  let count = 0;

  for (const agent of agents) {
    if (!agent.enabled) continue;
    const ok = registerCustomAgent(agent);
    if (ok) count++;
  }

  return count;
}

// ─── Builder ─────────────────────────────────────────────────────────────────

export function buildAgentFromTemplate(
  templateId: string,
  name: string,
  config: Record<string, string>,
  intervalMs?: number,
): CustomAgentConfig {
  const template = getTemplate(templateId);
  const interval = intervalMs ?? template?.defaultInterval ?? 60000;

  return {
    id: 'ca_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    templateId,
    config,
    intervalMs: interval,
    enabled: true,
    createdAt: new Date().toISOString(),
  };
}
