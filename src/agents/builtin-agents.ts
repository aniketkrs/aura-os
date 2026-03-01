import { registerAgent } from './agent-manager';
import { remember, EventBus } from '../data/memory';
import { T } from '../tui/theme';
import type { UserProfile } from '../data/profile';

// ─── Memory Keeper Agent ──────────────────────────────────────────────────────
// Periodically summarizes context and saves to memory
registerAgent({
  name: 'memory-keeper',
  description: 'Periodically consolidates and persists OS memory context',
  intervalMs: 10 * 60 * 1000, // every 10 min
  async run(ctx) {
    ctx.log('Memory consolidation pass');
    await remember('memory-keeper heartbeat', { type: 'event', source: 'memory-keeper' });
  },
});

// ─── Task Tracker Agent ───────────────────────────────────────────────────────
registerAgent({
  name: 'task-tracker',
  description: 'Monitors task list and surfaces overdue or high-priority items',
  intervalMs: 30 * 60 * 1000, // every 30 min
  async run(ctx) {
    const { listTasks } = await import('../data/tasks');
    const tasks = await listTasks();
    const highPriority = tasks.filter(t => t.priority === 'high' && t.status !== 'done');
    if (highPriority.length > 0) {
      ctx.log(`${T.nova('!')} ${highPriority.length} high-priority task(s) pending`);
      ctx.emit('tasks:high-priority', highPriority);
    } else {
      ctx.log('Task check complete — no alerts');
    }
  },
});

// ─── Research Agent ───────────────────────────────────────────────────────────
registerAgent({
  name: 'research-agent',
  description: 'Executes background research tasks queued by the user',
  intervalMs: 5 * 60 * 1000,
  async run(ctx) {
    // Check memory for queued research tasks
    const { recall } = await import('../data/memory');
    const queue = await recall('research-queue', 5);
    if (queue.length === 0) return;
    ctx.log(`Processing ${queue.length} queued research item(s)`);
  },
});

// ─── Briefing Agent (Executive role) ─────────────────────────────────────────
registerAgent({
  name: 'briefing-agent',
  description: 'Prepares daily briefings for executive users',
  intervalMs: 60 * 60 * 1000, // hourly check
  async run(ctx) {
    const hour = new Date().getHours();
    if (hour !== 8) return; // Only run at 8am
    ctx.log('Preparing morning briefing...');
    ctx.emit('briefing:ready', { time: new Date().toISOString() });
  },
});

// ─── Calendar Agent ───────────────────────────────────────────────────────────
registerAgent({
  name: 'calendar-agent',
  description: 'Monitors upcoming calendar events and sends reminders',
  intervalMs: 15 * 60 * 1000, // every 15 min
  async run(ctx) {
    try {
      const { getUpcomingEvents } = await import('../tools/calendar');
      const events = await getUpcomingEvents(1);
      // Alert for events starting in next 15 minutes
      const soon = events.filter(e => {
        const diff = e.start.getTime() - Date.now();
        return diff > 0 && diff < 15 * 60 * 1000;
      });
      for (const ev of soon) {
        ctx.log(`${T.solar('REMINDER:')} ${ev.summary} starts soon`);
        ctx.emit('calendar:reminder', ev);
      }
    } catch {
      // Calendar access might not be available
    }
  },
});

// ─── Writing Agent ────────────────────────────────────────────────────────────
registerAgent({
  name: 'writing-agent',
  description: 'Assists writers with background grammar and style suggestions',
  intervalMs: 60 * 60 * 1000,
  async run(ctx) {
    ctx.log('Writing agent standing by');
  },
});

// ─── Study Agent ──────────────────────────────────────────────────────────────
registerAgent({
  name: 'study-agent',
  description: 'Helps students track study sessions and review schedules',
  intervalMs: 60 * 60 * 1000,
  async run(ctx) {
    ctx.log('Study agent standing by');
  },
});

export function initBuiltinAgents(profile: UserProfile): void {
  // Agents are registered at import time.
  // Start is handled by agent-manager based on role defaults.
}
