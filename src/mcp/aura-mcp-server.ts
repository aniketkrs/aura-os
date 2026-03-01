/**
 * Aura OS MCP Server — exposes Aura tools over Model Context Protocol (SSE transport)
 * NO osascript, NO open -a — terminal only
 * Tools return data, never write to stdout
 */
import * as http from 'http';
import { URL } from 'url';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

import { browse, search } from '../tools/browser';
import { listTasks, addTask, updateTask } from '../data/tasks';
import { recall, remember } from '../data/memory';
import { getAgentStatus } from '../agents/agent-manager';
import { sendEmail } from '../tools/email-client';

// ─── State ──────────────────────────────────────────────────────────────────

let httpServer: http.Server | null = null;
let activePort = 3849;
const transports: Map<string, SSEServerTransport> = new Map();

// ─── MCP Server Factory ─────────────────────────────────────────────────────

function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: 'aura-os', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // NOTE: Schema objects cast to `any` to work around zod v3/v4 type mismatch
  // with @modelcontextprotocol/sdk 1.27+ (runtime works fine, only types differ).

  // ── browse ──────────────────────────────────────────────────────────────
  (server as any).tool(
    'browse',
    'Browse a URL and return its content as markdown',
    {
      url: z.string().describe('The URL to browse'),
      executeJs: z.boolean().optional().describe('Force JavaScript rendering via Puppeteer'),
    },
    async ({ url, executeJs }: any) => {
      const result = await browse(url, executeJs ?? false);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              url: result.url,
              title: result.title,
              markdown: result.markdown,
              links: result.links,
            }),
          },
        ],
      };
    },
  );

  // ── search ──────────────────────────────────────────────────────────────
  (server as any).tool(
    'search',
    'Web search via DuckDuckGo',
    {
      query: z.string().describe('Search query'),
    },
    async ({ query }: any) => {
      const result = await search(query);
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              url: result.url,
              title: result.title,
              markdown: result.markdown,
              links: result.links,
            }),
          },
        ],
      };
    },
  );

  // ── task_list ───────────────────────────────────────────────────────────
  (server as any).tool(
    'task_list',
    'List all tasks',
    async () => {
      const tasks = await listTasks();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(tasks) }],
      };
    },
  );

  // ── task_add ────────────────────────────────────────────────────────────
  (server as any).tool(
    'task_add',
    'Add a new task',
    {
      title: z.string().describe('Task title'),
      priority: z.enum(['high', 'med', 'low']).optional().describe('Task priority'),
    },
    async ({ title, priority }: any) => {
      const task = await addTask(title, { priority: priority ?? 'med' });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task) }],
      };
    },
  );

  // ── task_done ───────────────────────────────────────────────────────────
  (server as any).tool(
    'task_done',
    'Mark a task as done',
    {
      id: z.string().describe('Task ID'),
    },
    async ({ id }: any) => {
      const task = await updateTask(id, {
        status: 'done',
        doneAt: new Date().toISOString(),
      });
      if (!task) {
        return {
          content: [{ type: 'text' as const, text: `Task "${id}" not found` }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(task) }],
      };
    },
  );

  // ── memory_recall ──────────────────────────────────────────────────────
  (server as any).tool(
    'memory_recall',
    'Search memory for matching entries',
    {
      query: z.string().describe('Search query'),
    },
    async ({ query }: any) => {
      const entries = await recall(query);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entries) }],
      };
    },
  );

  // ── memory_remember ────────────────────────────────────────────────────
  (server as any).tool(
    'memory_remember',
    'Save content to memory',
    {
      content: z.string().describe('Content to remember'),
      tags: z.array(z.string()).optional().describe('Optional tags'),
    },
    async ({ content, tags }: any) => {
      const entry = await remember(content, {
        tags: tags ?? [],
        source: 'mcp',
      });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(entry) }],
      };
    },
  );

  // ── agent_status ───────────────────────────────────────────────────────
  (server as any).tool(
    'agent_status',
    'Get the status of all registered agents',
    async () => {
      const status = getAgentStatus();
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status) }],
      };
    },
  );

  // ── send_email ─────────────────────────────────────────────────────────
  (server as any).tool(
    'send_email',
    'Send an email',
    {
      to: z.string().describe('Recipient email address'),
      subject: z.string().describe('Email subject'),
      body: z.string().describe('Email body text'),
    },
    async ({ to, subject, body }: any) => {
      await sendEmail(to, subject, body);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify({ sent: true, to, subject }) },
        ],
      };
    },
  );

  return server;
}

// ─── CORS helpers ───────────────────────────────────────────────────────────

function setCorsHeaders(res: http.ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type');
}

// ─── HTTP Request Handler ───────────────────────────────────────────────────

function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  setCorsHeaders(res);

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url || '/', `http://localhost:${activePort}`);
  const pathname = parsedUrl.pathname;

  // GET /sse — establish SSE stream
  if (req.method === 'GET' && pathname === '/sse') {
    const transport = new SSEServerTransport('/messages', res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    transport.onclose = () => {
      transports.delete(sessionId);
    };

    const mcpServer = createMcpServer();
    mcpServer.connect(transport).catch(() => {
      transports.delete(sessionId);
    });
    return;
  }

  // POST /messages?sessionId=... — handle client messages
  if (req.method === 'POST' && pathname === '/messages') {
    const sessionId = parsedUrl.searchParams.get('sessionId');

    if (!sessionId) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing sessionId parameter');
      return;
    }

    const transport = transports.get(sessionId);
    if (!transport) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Session not found');
      return;
    }

    transport.handlePostMessage(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Internal server error');
      }
    });
    return;
  }

  // GET /health — basic health check
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getMcpServerStatus()));
    return;
  }

  // Fallback
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the MCP SSE server on the given port (default 3849).
 */
export async function startMcpServer(port?: number): Promise<void> {
  if (httpServer) {
    throw new Error('MCP server is already running');
  }

  activePort = port ?? 3849;

  return new Promise<void>((resolve, reject) => {
    const server = http.createServer(handleRequest);

    server.on('error', (err: NodeJS.ErrnoException) => {
      httpServer = null;
      reject(new Error(`Failed to start MCP server: ${err.message}`));
    });

    server.listen(activePort, () => {
      httpServer = server;
      resolve();
    });
  });
}

/**
 * Stop the MCP server and close all active SSE connections.
 */
export function stopMcpServer(): void {
  if (!httpServer) return;

  // Close all active transports
  for (const [sessionId, transport] of transports) {
    transport.close().catch(() => {});
    transports.delete(sessionId);
  }

  httpServer.close();
  httpServer = null;
}

/**
 * Get the current MCP server status.
 */
export function getMcpServerStatus(): { running: boolean; port: number; connections: number } {
  return {
    running: httpServer !== null,
    port: activePort,
    connections: transports.size,
  };
}
