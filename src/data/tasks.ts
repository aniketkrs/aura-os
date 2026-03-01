import * as fs from 'fs-extra';
import * as path from 'path';
import { getDataDir } from './profile';

export type TaskStatus = 'todo' | 'in-progress' | 'done';
export type TaskPriority = 'high' | 'med' | 'low';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  doneAt?: string;
}

const TASKS_PATH = () => path.join(getDataDir(), 'tasks.json');

async function readTasks(): Promise<Task[]> {
  const p = TASKS_PATH();
  if (!(await fs.pathExists(p))) return [];
  try { return await fs.readJson(p); } catch { return []; }
}

async function writeTasks(tasks: Task[]): Promise<void> {
  await fs.ensureDir(getDataDir());
  await fs.writeJson(TASKS_PATH(), tasks, { spaces: 2 });
}

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

export async function listTasks(): Promise<Task[]> {
  return readTasks();
}

export async function addTask(title: string, opts: Partial<Task> = {}): Promise<Task> {
  const tasks = await readTasks();
  const task: Task = {
    id: genId(),
    title,
    status: 'todo',
    priority: 'med',
    tags: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...opts,
  };
  tasks.push(task);
  await writeTasks(tasks);
  return task;
}

export async function updateTask(id: string, updates: Partial<Task>): Promise<Task | null> {
  const tasks = await readTasks();
  const idx = tasks.findIndex(t => t.id === id || t.id.startsWith(id));
  if (idx === -1) return null;
  tasks[idx] = { ...tasks[idx], ...updates, updatedAt: new Date().toISOString() };
  await writeTasks(tasks);
  return tasks[idx];
}

export async function removeTask(id: string): Promise<boolean> {
  const tasks = await readTasks();
  const filtered = tasks.filter(t => !t.id.startsWith(id));
  if (filtered.length === tasks.length) return false;
  await writeTasks(filtered);
  return true;
}

export async function getTask(id: string): Promise<Task | null> {
  const tasks = await readTasks();
  return tasks.find(t => t.id.startsWith(id)) || null;
}
