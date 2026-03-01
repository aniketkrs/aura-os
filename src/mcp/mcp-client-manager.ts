/**
 * MCP Client Manager — connect to external MCP servers (stdio + SSE)
 * Config stored in ~/.aura/mcp-servers.json (chmod 600)
 */
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// ─── Paths ───────────────────────────────────────────────────────────────────

const DATA_DIR = path.join(os.homedir(), '.aura');
const CONFIG_PATH = path.join(DATA_DIR, 'mcp-servers.json');

// ─── Types ───────────────────────────────────────────────────────────────────

export interface McpServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'sse';
  // stdio fields
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse fields
  url?: string;
  headers?: Record<string, string>;
  // common
  enabled: boolean;
  autoConnect: boolean;
}

export interface McpConnectionStatus {
  id: string;
  name: string;
  type: string;
  connected: boolean;
  tools: string[];
  error?: string;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
}

// ─── Internal State ──────────────────────────────────────────────────────────

interface LiveConnection {
  client: Client;
  transport: SSEClientTransport | StdioClientTransport;
  tools: string[];
  error?: string;
}

const connections = new Map<string, LiveConnection>();

// ─── Config Persistence ──────────────────────────────────────────────────────

export async function loadMcpConfig(): Promise<McpServerConfig[]> {
  await fs.ensureDir(DATA_DIR);
  if (!(await fs.pathExists(CONFIG_PATH))) return [];
  try {
    const data = await fs.readJson(CONFIG_PATH);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function saveMcpConfig(configs: McpServerConfig[]): Promise<void> {
  await fs.ensureDir(DATA_DIR);
  await fs.writeJson(CONFIG_PATH, configs, { spaces: 2 });
  try { await fs.chmod(CONFIG_PATH, 0o600); } catch { /* best-effort */ }
}

export async function addMcpServer(config: McpServerConfig): Promise<void> {
  const configs = await loadMcpConfig();
  const idx = configs.findIndex(c => c.id === config.id);
  if (idx >= 0) {
    configs[idx] = config;
  } else {
    configs.push(config);
  }
  await saveMcpConfig(configs);
}

export async function removeMcpServer(id: string): Promise<void> {
  // Disconnect first if live
  if (connections.has(id)) {
    await disconnectMcpServer(id);
  }
  const configs = await loadMcpConfig();
  await saveMcpConfig(configs.filter(c => c.id !== id));
}

// ─── Connection Lifecycle ────────────────────────────────────────────────────

export async function connectMcpServer(id: string): Promise<boolean> {
  // Already connected — skip
  if (connections.has(id)) return true;

  const configs = await loadMcpConfig();
  const cfg = configs.find(c => c.id === id);
  if (!cfg) throw new Error(`MCP server "${id}" not found in config`);
  if (!cfg.enabled) throw new Error(`MCP server "${id}" is disabled`);

  let transport: SSEClientTransport | StdioClientTransport;

  if (cfg.type === 'stdio') {
    if (!cfg.command) throw new Error(`MCP server "${id}" is missing command`);
    transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args,
      env: cfg.env ? { ...process.env as Record<string, string>, ...cfg.env } : undefined,
    });
  } else if (cfg.type === 'sse') {
    if (!cfg.url) throw new Error(`MCP server "${id}" is missing url`);
    const opts: { requestInit?: RequestInit } = {};
    if (cfg.headers && Object.keys(cfg.headers).length > 0) {
      opts.requestInit = { headers: cfg.headers };
    }
    transport = new SSEClientTransport(new URL(cfg.url), opts);
  } else {
    throw new Error(`Unsupported transport type: ${(cfg as McpServerConfig).type}`);
  }

  const client = new Client(
    { name: 'aura-os', version: '1.0.0' },
    { capabilities: {} },
  );

  try {
    await client.connect(transport);

    // Discover tools on this server
    const toolNames: string[] = [];
    try {
      const res = await client.listTools();
      for (const t of res.tools) {
        toolNames.push(t.name);
      }
    } catch {
      // Server may not expose tools — that is fine
    }

    connections.set(id, { client, transport, tools: toolNames });
    return true;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    connections.set(id, { client, transport, tools: [], error: message });
    return false;
  }
}

export async function disconnectMcpServer(id: string): Promise<void> {
  const conn = connections.get(id);
  if (!conn) return;
  try { await conn.client.close(); } catch { /* best-effort */ }
  try { await conn.transport.close(); } catch { /* best-effort */ }
  connections.delete(id);
}

export async function disconnectAll(): Promise<void> {
  const ids = Array.from(connections.keys());
  await Promise.allSettled(ids.map(id => disconnectMcpServer(id)));
}

// ─── Status & Discovery ─────────────────────────────────────────────────────

export function listMcpConnections(): McpConnectionStatus[] {
  const statuses: McpConnectionStatus[] = [];

  // We pull from the *config* so that even non-connected servers show up
  // Need to call this synchronously — loadMcpConfig is async but we cache
  // the map state in-memory. Iterate known connections + merge with any
  // configs that haven't been connected.
  //
  // Because this function is sync (per the spec), we report based on the
  // in-memory connections map only. Callers should loadMcpConfig() first
  // if they need the full picture.
  for (const [id, conn] of connections) {
    statuses.push({
      id,
      name: id, // overwritten below if config available
      type: 'unknown',
      connected: !conn.error,
      tools: conn.tools,
      error: conn.error,
    });
  }
  return statuses;
}

/**
 * Returns full connection statuses merged with on-disk config.
 * Prefer this over listMcpConnections() when you need names + types.
 */
export async function listMcpConnectionsFull(): Promise<McpConnectionStatus[]> {
  const configs = await loadMcpConfig();
  return configs.map(cfg => {
    const conn = connections.get(cfg.id);
    return {
      id: cfg.id,
      name: cfg.name,
      type: cfg.type,
      connected: conn ? !conn.error : false,
      tools: conn ? conn.tools : [],
      error: conn?.error,
    };
  });
}

// ─── Tool Interaction ────────────────────────────────────────────────────────

export async function listMcpTools(serverId: string): Promise<McpToolInfo[]> {
  const conn = connections.get(serverId);
  if (!conn) throw new Error(`MCP server "${serverId}" is not connected`);
  if (conn.error) throw new Error(`MCP server "${serverId}" is in error state: ${conn.error}`);

  const res = await conn.client.listTools();
  return res.tools.map(t => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: t.inputSchema,
  }));
}

export async function callMcpTool(
  serverId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const conn = connections.get(serverId);
  if (!conn) throw new Error(`MCP server "${serverId}" is not connected`);
  if (conn.error) throw new Error(`MCP server "${serverId}" is in error state: ${conn.error}`);

  const result = await conn.client.callTool({ name: toolName, arguments: args });
  return result;
}

// ─── Auto-Connect ────────────────────────────────────────────────────────────

export async function autoConnectAll(): Promise<void> {
  const configs = await loadMcpConfig();
  const targets = configs.filter(c => c.enabled && c.autoConnect);
  await Promise.allSettled(targets.map(c => connectMcpServer(c.id)));
}
