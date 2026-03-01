import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

export type Role = 'Developer' | 'Researcher' | 'Executive' | 'Product Manager' | 'Project Manager' | 'Designer' | 'Student' | 'Writer' | 'Other';

export interface UserProfile {
  name: string;
  email: string;
  role: Role;
  purpose: string;
  createdAt: string;
  preferences: {
    defaultModel: string;
    theme: 'dark' | 'light';
    agentsAutoStart: string[];
    emailConfigured: boolean;
  };
}

const DATA_DIR = path.join(os.homedir(), '.aura');
const PROFILE_PATH = path.join(DATA_DIR, 'profile.json');

export function getDataDir(): string { return DATA_DIR; }

export async function profileExists(): Promise<boolean> {
  return fs.pathExists(PROFILE_PATH);
}

export async function loadProfile(): Promise<UserProfile | null> {
  if (!(await profileExists())) return null;
  try {
    return await fs.readJson(PROFILE_PATH);
  } catch {
    return null;
  }
}

export async function saveProfile(profile: UserProfile): Promise<void> {
  await fs.ensureDir(DATA_DIR);
  await fs.writeJson(PROFILE_PATH, profile, { spaces: 2 });
}

export async function updateProfile(updates: Partial<UserProfile>): Promise<UserProfile> {
  const current = await loadProfile();
  if (!current) throw new Error('No profile found');
  const updated = { ...current, ...updates };
  await saveProfile(updated);
  return updated;
}

// Role-based default agents
export function getDefaultAgents(role: Role): string[] {
  const base = ['memory-keeper'];
  const roleMap: Record<Role, string[]> = {
    Developer:         [...base, 'code-watcher', 'task-tracker'],
    Researcher:        [...base, 'research-agent', 'citation-tracker'],
    Executive:         [...base, 'briefing-agent', 'calendar-agent'],
    'Product Manager': [...base, 'task-tracker', 'briefing-agent', 'research-agent'],
    'Project Manager': [...base, 'task-tracker', 'calendar-agent', 'briefing-agent'],
    Designer:          [...base, 'inspiration-agent'],
    Student:           [...base, 'study-agent', 'research-agent'],
    Writer:            [...base, 'writing-agent', 'research-agent'],
    Other:             [...base],
  };
  return roleMap[role] || base;
}

// Role-based LLM system prompt context
export function getRoleContext(profile: UserProfile): string {
  const contexts: Record<Role, string> = {
    Developer:         'You are assisting a software developer. Prioritize code quality, debugging help, and technical clarity.',
    Researcher:        'You are assisting a researcher. Prioritize accuracy, citations, and deep analytical thinking.',
    Executive:         'You are assisting an executive. Be concise, strategic, and surface high-priority decisions first.',
    'Product Manager': 'You are assisting a Product Manager. Prioritize user needs, product strategy, roadmap clarity, feature prioritization, and stakeholder communication.',
    'Project Manager': 'You are assisting a Project Manager. Prioritize timelines, task tracking, risk management, team coordination, and delivery milestones.',
    Designer:          'You are assisting a designer. Consider aesthetics, user experience, and visual thinking.',
    Student:           'You are assisting a student. Explain concepts clearly, encourage learning, and help structure knowledge.',
    Writer:            'You are assisting a writer. Help with clarity, narrative structure, and creative expression.',
    Other:             'You are a general-purpose intelligent assistant.',
  };
  return `${contexts[profile.role]}\n\nUser's purpose: ${profile.purpose}`;
}
