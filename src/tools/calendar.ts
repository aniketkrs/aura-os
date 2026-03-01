import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export interface CalEvent {
  uid: string;
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  allDay: boolean;
}

// Common macOS/iOS calendar ICS locations (no osascript needed)
const ICS_SEARCH_PATHS = [
  path.join(os.homedir(), 'Library/Calendars'),
  path.join(os.homedir(), 'Library/Group Containers/group.com.apple.calendar/Library/Calendars'),
];

async function findICSFiles(): Promise<string[]> {
  const found: string[] = [];
  for (const base of ICS_SEARCH_PATHS) {
    if (!(await fs.pathExists(base))) continue;
    await walkDir(base, found);
  }
  return found;
}

async function walkDir(dir: string, results: string[]): Promise<void> {
  try {
    const entries = await fs.readdir(dir);
    for (const entry of entries) {
      const full = path.join(dir, entry);
      try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
          await walkDir(full, results);
        } else if (entry.endsWith('.ics') || entry.endsWith('.ical')) {
          results.push(full);
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* skip inaccessible dir */ }
}

export async function getUpcomingEvents(days = 7): Promise<CalEvent[]> {
  const ical = await import('node-ical');
  const files = await findICSFiles();
  if (files.length === 0) return [];

  const now = new Date();
  const cutoff = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  const events: CalEvent[] = [];

  for (const file of files.slice(0, 50)) {
    try {
      const data = await ical.async.parseFile(file);
      for (const component of Object.values(data)) {
        if (!component || component.type !== 'VEVENT') continue;
        const ev = component as {
          summary?: string | { val: string };
          description?: string | { val: string };
          location?: string | { val: string };
          start?: Date;
          end?: Date;
          uid?: string;
          datetype?: string;
        };
        const start = ev.start;
        const end = ev.end;
        if (!start) continue;
        if (start < now || start > cutoff) continue;

        const getString = (v: string | { val: string } | undefined): string => {
          if (!v) return '';
          return typeof v === 'string' ? v : v.val;
        };

        events.push({
          uid: ev.uid || Math.random().toString(),
          summary: getString(ev.summary) || '(no title)',
          description: getString(ev.description),
          location: getString(ev.location),
          start,
          end: end || start,
          allDay: ev.datetype === 'date',
        });
      }
    } catch { /* skip invalid ICS */ }
  }

  return events.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function formatEvents(events: CalEvent[]): string {
  if (events.length === 0) return '  No upcoming events.';
  return events.map(e => {
    const time = e.allDay
      ? 'All day'
      : `${e.start.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} – ${e.end.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
    const date = e.start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    const loc = e.location ? `  @ ${e.location}` : '';
    return `  ${date}  ${time.padEnd(16)} ${e.summary}${loc}`;
  }).join('\n');
}
