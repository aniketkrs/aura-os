// ─── Agent Templates — pre-built patterns for custom agents ─────────────────
import * as crypto from 'crypto';
import { AgentContext } from '../agents/agent-manager';
import { EventBus } from '../data/memory';

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface AgentConfigField {
  name: string;
  label: string;
  type: 'string' | 'number' | 'boolean' | 'select';
  required: boolean;
  default?: string;
  options?: string[]; // for select type
  hint?: string;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: 'monitor' | 'researcher' | 'reporter' | 'notifier' | 'scheduler';
  defaultInterval: number; // ms
  configFields: AgentConfigField[];
  buildRun: (config: Record<string, string>) => (ctx: AgentContext) => Promise<void>;
}

// ─── Template definitions ────────────────────────────────────────────────────

const urlMonitor: AgentTemplate = {
  id: 'url-monitor',
  name: 'URL Monitor',
  description: 'Polls a URL at interval and detects changes in content hash',
  category: 'monitor',
  defaultInterval: 5 * 60 * 1000, // 5 minutes
  configFields: [
    {
      name: 'url',
      label: 'URL to monitor',
      type: 'string',
      required: true,
      hint: 'Full URL including https://',
    },
    {
      name: 'selector',
      label: 'CSS selector (optional)',
      type: 'string',
      required: false,
      default: '',
      hint: 'If set, only hash content within this selector',
    },
  ],
  buildRun: (config: Record<string, string>) => {
    let lastHash: string | null = null;

    return async (ctx: AgentContext): Promise<void> => {
      const fetch = (await import('node-fetch')).default;
      const url = config.url;

      ctx.log(`Fetching ${url}`);
      const resp = await fetch(url, { timeout: 15000 });
      if (!resp.ok) {
        ctx.log(`HTTP ${resp.status} from ${url}`);
        return;
      }

      let body = await resp.text();

      // If selector is provided, extract a rough slice (no DOM parser in pure node)
      if (config.selector) {
        const tag = config.selector.replace(/[^a-zA-Z0-9-_]/g, '');
        const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
        const match = body.match(re);
        if (match) body = match[1];
      }

      const hash = crypto.createHash('sha256').update(body).digest('hex');

      if (lastHash === null) {
        lastHash = hash;
        ctx.log(`Initial hash: ${hash.slice(0, 12)}...`);
        return;
      }

      if (hash !== lastHash) {
        ctx.log(`Change detected! Old: ${lastHash.slice(0, 12)} New: ${hash.slice(0, 12)}`);
        ctx.emit('monitor:change', { url, oldHash: lastHash, newHash: hash });
        lastHash = hash;
      } else {
        ctx.log(`No change (hash: ${hash.slice(0, 12)}...)`);
      }
    };
  },
};

const topicResearcher: AgentTemplate = {
  id: 'topic-researcher',
  name: 'Topic Researcher',
  description: 'Uses the LLM to research a topic and saves findings to memory',
  category: 'researcher',
  defaultInterval: 60 * 60 * 1000, // 1 hour
  configFields: [
    {
      name: 'topic',
      label: 'Research topic',
      type: 'string',
      required: true,
      hint: 'The topic or question to research',
    },
    {
      name: 'depth',
      label: 'Research depth',
      type: 'select',
      required: false,
      default: 'brief',
      options: ['brief', 'detailed', 'exhaustive'],
      hint: 'How thorough the research should be',
    },
    {
      name: 'tags',
      label: 'Memory tags',
      type: 'string',
      required: false,
      default: 'research',
      hint: 'Comma-separated tags for saved memory entries',
    },
  ],
  buildRun: (config: Record<string, string>) => {
    return async (ctx: AgentContext): Promise<void> => {
      const { quickChat } = await import('../tools/llm-router');
      const { remember } = await import('../data/memory');

      const depth = config.depth || 'brief';
      const topic = config.topic;

      const prompt = depth === 'brief'
        ? `Provide a concise summary of the latest developments on: ${topic}. Keep it under 200 words.`
        : depth === 'detailed'
          ? `Provide a detailed analysis of: ${topic}. Cover key points, recent developments, and implications. 300-500 words.`
          : `Provide an exhaustive analysis of: ${topic}. Cover all aspects including history, current state, future outlook, key players, and implications. Be thorough.`;

      ctx.log(`Researching "${topic}" (depth: ${depth})`);
      const result = await quickChat(prompt, 'You are a focused research assistant. Provide factual, well-organized information.');

      const tags = (config.tags || 'research').split(',').map(t => t.trim()).filter(Boolean);

      await remember(result, {
        type: 'agent-note',
        source: `agent:topic-researcher`,
        tags: [...tags, 'auto-research'],
      });

      ctx.log(`Research saved to memory (${result.length} chars, tags: ${tags.join(', ')})`);
    };
  },
};

const dailyReporter: AgentTemplate = {
  id: 'daily-reporter',
  name: 'Daily Reporter',
  description: 'Compiles a daily summary from memory entries and tasks',
  category: 'reporter',
  defaultInterval: 60 * 60 * 1000, // check every hour
  configFields: [
    {
      name: 'hour',
      label: 'Report hour (0-23)',
      type: 'number',
      required: false,
      default: '9',
      hint: 'Hour of day to generate the report (24h format)',
    },
    {
      name: 'includeMemory',
      label: 'Include memory entries',
      type: 'boolean',
      required: false,
      default: 'true',
    },
    {
      name: 'includeTasks',
      label: 'Include task summary',
      type: 'boolean',
      required: false,
      default: 'true',
    },
  ],
  buildRun: (config: Record<string, string>) => {
    let lastReportDate = '';

    return async (ctx: AgentContext): Promise<void> => {
      const targetHour = parseInt(config.hour || '9', 10);
      const now = new Date();
      const today = now.toISOString().slice(0, 10);

      // Only run once per day at the specified hour
      if (now.getHours() !== targetHour) return;
      if (lastReportDate === today) return;

      ctx.log(`Generating daily report for ${today}`);
      const parts: string[] = [`# Daily Report — ${today}\n`];

      // Memory entries from last 24 hours
      if (config.includeMemory !== 'false') {
        const { listMemory } = await import('../data/memory');
        const entries = await listMemory();
        const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
        const recent = entries.filter(e => e.createdAt >= cutoff);

        parts.push(`## Memory (${recent.length} entries in last 24h)`);
        for (const e of recent.slice(-20)) {
          parts.push(`- [${e.type}] ${e.content.slice(0, 120)}`);
        }
        parts.push('');
      }

      // Tasks summary
      if (config.includeTasks !== 'false') {
        const { listTasks } = await import('../data/tasks');
        const tasks = await listTasks();
        const todo = tasks.filter(t => t.status === 'todo').length;
        const inProg = tasks.filter(t => t.status === 'in-progress').length;
        const done = tasks.filter(t => t.status === 'done').length;

        parts.push(`## Tasks`);
        parts.push(`- Todo: ${todo}`);
        parts.push(`- In Progress: ${inProg}`);
        parts.push(`- Done: ${done}`);
        parts.push('');
      }

      const report = parts.join('\n');
      lastReportDate = today;

      ctx.emit('report:ready', { date: today, report });
      ctx.log(`Report ready (${report.length} chars)`);
    };
  },
};

const webhookNotifier: AgentTemplate = {
  id: 'webhook-notifier',
  name: 'Webhook Notifier',
  description: 'Listens for EventBus events and sends HTTP POST to a webhook URL',
  category: 'notifier',
  defaultInterval: 0, // event-driven, no polling
  configFields: [
    {
      name: 'webhookUrl',
      label: 'Webhook URL',
      type: 'string',
      required: true,
      hint: 'HTTPS URL to POST event data to',
    },
    {
      name: 'events',
      label: 'Events to listen for',
      type: 'string',
      required: true,
      default: 'monitor:change,report:ready',
      hint: 'Comma-separated event names',
    },
    {
      name: 'secret',
      label: 'Webhook secret (optional)',
      type: 'string',
      required: false,
      default: '',
      hint: 'If set, sent as X-Webhook-Secret header',
    },
  ],
  buildRun: (config: Record<string, string>) => {
    let registered = false;

    return async (ctx: AgentContext): Promise<void> => {
      if (registered) return; // event handlers already bound
      registered = true;

      const fetch = (await import('node-fetch')).default;
      const events = (config.events || '').split(',').map(e => e.trim()).filter(Boolean);
      const url = config.webhookUrl;

      for (const event of events) {
        ctx.log(`Listening for event: ${event}`);
        EventBus.on(event, async (data: unknown) => {
          try {
            const headers: Record<string, string> = {
              'Content-Type': 'application/json',
            };
            if (config.secret) {
              headers['X-Webhook-Secret'] = config.secret;
            }

            const body = JSON.stringify({
              event,
              data,
              timestamp: new Date().toISOString(),
            });

            const resp = await fetch(url, {
              method: 'POST',
              headers,
              body,
              timeout: 10000,
            });

            ctx.log(`Webhook ${event} -> ${url} (${resp.status})`);
          } catch (err) {
            ctx.log(`Webhook failed for ${event}: ${String(err)}`);
          }
        });
      }

      ctx.log(`Webhook notifier registered for ${events.length} event(s)`);
    };
  },
};

const cronScheduler: AgentTemplate = {
  id: 'cron-scheduler',
  name: 'Cron Scheduler',
  description: 'Runs a shell command at the configured interval and logs output',
  category: 'scheduler',
  defaultInterval: 10 * 60 * 1000, // 10 minutes
  configFields: [
    {
      name: 'command',
      label: 'Shell command',
      type: 'string',
      required: true,
      hint: 'The command to execute (e.g. "df -h", "uptime")',
    },
    {
      name: 'shell',
      label: 'Shell',
      type: 'select',
      required: false,
      default: '/bin/sh',
      options: ['/bin/sh', '/bin/bash', '/bin/zsh'],
      hint: 'Shell to use for command execution',
    },
    {
      name: 'maxOutput',
      label: 'Max output bytes',
      type: 'number',
      required: false,
      default: '4096',
      hint: 'Truncate output beyond this length',
    },
  ],
  buildRun: (config: Record<string, string>) => {
    return async (ctx: AgentContext): Promise<void> => {
      const { execSync } = await import('child_process');
      const cmd = config.command;
      const shell = config.shell || '/bin/sh';
      const maxOutput = parseInt(config.maxOutput || '4096', 10);

      ctx.log(`Executing: ${cmd}`);

      try {
        const output = execSync(cmd, {
          shell,
          timeout: 30000,
          maxBuffer: maxOutput * 2,
          encoding: 'utf8',
        });

        const trimmed = output.length > maxOutput
          ? output.slice(0, maxOutput) + '\n... (truncated)'
          : output;

        ctx.log(`Output:\n${trimmed.trim()}`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        ctx.log(`Command failed: ${msg}`);
      }
    };
  },
};

// ─── Template registry ───────────────────────────────────────────────────────

const templates: AgentTemplate[] = [
  urlMonitor,
  topicResearcher,
  dailyReporter,
  webhookNotifier,
  cronScheduler,
];

export function getTemplates(): AgentTemplate[] {
  return templates;
}

export function getTemplate(id: string): AgentTemplate | undefined {
  return templates.find(t => t.id === id);
}
