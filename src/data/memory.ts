import * as fs from 'fs-extra';
import * as path from 'path';
import { getDataDir } from './profile';

export interface MemoryEntry {
  id: string;
  type: 'fact' | 'event' | 'preference' | 'agent-note';
  content: string;
  source: string;
  tags: string[];
  createdAt: string;
  expiresAt?: string;
}

const MEMORY_PATH = () => path.join(getDataDir(), 'memory.json');

async function readMemory(): Promise<MemoryEntry[]> {
  const p = MEMORY_PATH();
  if (!(await fs.pathExists(p))) return [];
  try { return await fs.readJson(p); } catch { return []; }
}

async function writeMemory(entries: MemoryEntry[]): Promise<void> {
  await fs.ensureDir(getDataDir());
  await fs.writeJson(MEMORY_PATH(), entries, { spaces: 2 });
}

function genId(): string {
  return 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export async function remember(content: string, opts: Partial<MemoryEntry> = {}): Promise<MemoryEntry> {
  const entries = await readMemory();
  const entry: MemoryEntry = {
    id: genId(),
    type: 'fact',
    content,
    source: 'user',
    tags: [],
    createdAt: new Date().toISOString(),
    ...opts,
  };
  entries.push(entry);
  // Keep last 1000 entries
  const trimmed = entries.slice(-1000);
  await writeMemory(trimmed);
  return entry;
}

export async function recall(query: string, limit = 10): Promise<MemoryEntry[]> {
  const entries = await readMemory();
  const q = query.toLowerCase();
  const scored = entries
    .map(e => ({ e, score: scoreMatch(e, q) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.e);
  return scored;
}

function scoreMatch(entry: MemoryEntry, query: string): number {
  // Split query into words — each word scores independently
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const content = entry.content.toLowerCase();
  const tags    = entry.tags.join(' ').toLowerCase();
  const source  = entry.source.toLowerCase();
  let score = 0;
  for (const word of words) {
    if (content.includes(word)) score += 3;
    if (tags.includes(word))    score += 2;
    if (source.includes(word))  score += 1;
  }
  // Bonus: full phrase match
  if (content.includes(query.toLowerCase())) score += 5;
  return score;
}

export async function listMemory(): Promise<MemoryEntry[]> {
  return readMemory();
}

export async function clearMemory(): Promise<void> {
  await writeMemory([]);
}

// Event bus for agents
type EventHandler = (data: unknown) => void | Promise<void>;
const eventHandlers: Map<string, EventHandler[]> = new Map();

export const EventBus = {
  on(event: string, handler: EventHandler): void {
    if (!eventHandlers.has(event)) eventHandlers.set(event, []);
    eventHandlers.get(event)!.push(handler);
  },
  off(event: string, handler: EventHandler): void {
    const handlers = eventHandlers.get(event);
    if (handlers) {
      const idx = handlers.indexOf(handler);
      if (idx !== -1) handlers.splice(idx, 1);
    }
  },
  async emit(event: string, data?: unknown): Promise<void> {
    const handlers = eventHandlers.get(event) || [];
    for (const h of handlers) await h(data);
  },
};
