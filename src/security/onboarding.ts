import * as readline from 'readline';
import { T, Sym, boxLine, divider, Typing } from '../tui/theme';
import { askHidden, setPin } from './auth';
import { saveProfile, type UserProfile, type Role } from '../data/profile';
import { setModel, listModels, type ModelProvider } from '../tools/llm-router';
import { saveKey, maskKey } from './apikeys';

function ask(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(prompt, ans => { rl.close(); resolve(ans.trim()); });
  });
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

const ROLES: Role[] = ['Developer', 'Researcher', 'Executive', 'Product Manager', 'Project Manager', 'Designer', 'Student', 'Writer', 'Other'];
const ROLE_DESC: Record<Role, string> = {
  Developer: 'Software dev, coding, debugging, tech tasks',
  Researcher: 'Deep research, citations, analytical work',
  Executive: 'Strategic briefings, decisions, high-level overview',
  'Product Manager': 'Roadmaps, user stories, feature prioritization, strategy',
  'Project Manager': 'Timelines, task tracking, delivery, team coordination',
  Designer: 'UI/UX, visual thinking, creative projects',
  Student: 'Learning, study schedules, knowledge building',
  Writer: 'Writing, editing, narrative, content creation',
  Other: 'General purpose assistant',
};

// ─── Step renderer ─────────────────────────────────────────────────────────────
function step(n: number, total: number, title: string) {
  console.log('');
  console.log(`  ${T.dim(`Step ${n}/${total}`)}  ${T.auraBold(title)}`);
  console.log(T.dim('  ' + '─'.repeat(50)));
  console.log('');
}

// ─── Main onboarding flow ──────────────────────────────────────────────────────
export async function runOnboarding(): Promise<UserProfile> {
  console.clear();
  console.log('');
  console.log(boxLine('WELCOME TO AURA OS', 'aura'));
  console.log('');
  console.log(`  ${T.aurora(Sym.sparkle)}  ${T.auraBold("Let's get you set up.")}  ${T.muted('Takes about 60 seconds.')}`);
  console.log('');
  await sleep(400);

  // ── STEP 1: Name ────────────────────────────────────────────────────────────
  step(1, 6, 'Your Name');
  console.log(`  ${T.muted('What should Aura call you?')}`);
  console.log('');
  let name = await ask(`  ${T.aura(Sym.arrow)} Name: `);
  if (!name) name = 'User';

  // ── STEP 2: Email ───────────────────────────────────────────────────────────
  step(2, 6, 'Your Email');
  console.log(`  ${T.muted('Used for sending emails from within Aura OS.')}`);
  console.log('');
  const email = await ask(`  ${T.aura(Sym.arrow)} Email: `);

  // ── STEP 3: Role ────────────────────────────────────────────────────────────
  step(3, 6, 'Your Role');
  console.log(`  ${T.muted('Aura personalizes your dashboard, agents, and AI context based on your role.')}`);
  console.log('');
  ROLES.forEach((r, i) => {
    const num = T.aura(String(i + 1).padStart(2));
    const role = T.white(r.padEnd(14));
    const desc = T.muted(ROLE_DESC[r]);
    console.log(`  ${num}  ${role} ${desc}`);
  });
  console.log('');

  let role: Role = 'Developer';
  while (true) {
    const choice = await ask(`  ${T.aura(Sym.arrow)} Choose role (1–${ROLES.length}): `);
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < ROLES.length) { role = ROLES[idx]; break; }
    console.log(`  ${T.nova('Invalid.')} Enter a number between 1 and ${ROLES.length}.`);
  }
  console.log(`  ${T.aurora(Sym.check)} Role set to ${T.ice(role)}`);

  // ── STEP 4: PIN ─────────────────────────────────────────────────────────────
  step(4, 6, 'Set Your PIN');
  console.log(`  ${T.muted('You will enter this PIN every time you launch Aura OS.')}`);
  console.log(`  ${T.muted('Minimum 4 characters. Stored as a secure hash — never in plain text.')}`);
  console.log('');

  let pin = '';
  while (true) {
    const p1 = await askHidden(`  ${T.aura(Sym.key)} Create PIN:  `);
    if (p1.length < 4) { console.log(`  ${T.nova('Too short.')} Must be at least 4 characters.`); continue; }
    const p2 = await askHidden(`  ${T.aura(Sym.key)} Confirm PIN: `);
    if (p1 !== p2) { console.log(`  ${T.nova("PINs don't match.")} Try again.`); continue; }
    pin = p1;
    break;
  }
  await setPin(pin);
  console.log(`  ${T.aurora(Sym.check)} PIN saved securely`);

  // ── STEP 5: LLM Type ────────────────────────────────────────────────────────
  step(5, 6, 'Choose AI Backend');
  console.log(`  ${T.muted('Where should Aura\'s AI run?')}`);
  console.log('');
  console.log(`  ${T.aura(' 1')}  ${T.white('Cloud')}   ${T.muted('Anthropic · OpenAI · Gemini  (API key required, best quality)')}`);
  console.log(`  ${T.aura(' 2')}  ${T.white('Local')}   ${T.muted('Ollama running on your machine  (free, private, offline)')}`);
  console.log('');

  let providerType: 'cloud' | 'local' = 'cloud';
  while (true) {
    const choice = await ask(`  ${T.aura(Sym.arrow)} Choose (1 or 2): `);
    if (choice === '1') { providerType = 'cloud'; break; }
    if (choice === '2') { providerType = 'local'; break; }
    console.log(`  ${T.nova('Enter 1 or 2.')}`);
  }

  // ── API Key entry (cloud only) ───────────────────────────────────────────────
  if (providerType === 'cloud') {
    console.log('');
    console.log(`  ${T.muted('Enter your API key.')}`);
    console.log(`  ${T.muted('It will be stored encrypted at')} ${T.dim('~/.aura/.keys.json')} ${T.muted('and never echoed.')}`);
    console.log(`  ${T.muted('Press Enter to skip (you can set it later with')} ${T.aura('/apikey')}${T.muted(')')}`);
    console.log('');

    const providerChoices = ['anthropic', 'openai', 'gemini', 'mistral'];
    console.log(`  ${T.aura(' 1')}  ${T.white('Anthropic')}  ${T.muted('(claude-sonnet-4-5, claude-opus)')}`);
    console.log(`  ${T.aura(' 2')}  ${T.white('OpenAI')}     ${T.muted('(gpt-4o, gpt-4o-mini)')}`);
    console.log(`  ${T.aura(' 3')}  ${T.white('Gemini')}     ${T.muted('(gemini-2.0-flash, gemini-2.5-flash — free tier)')}`);
    console.log(`  ${T.aura(' 4')}  ${T.white('Mistral')}    ${T.muted('(mistral-large, mistral-small)')}`);
    console.log('');

    const pChoice = await ask(`  ${T.aura(Sym.arrow)} Which provider's key? (1-4, or Enter to skip): `);
    const pIdx = parseInt(pChoice) - 1;
    if (pIdx >= 0 && pIdx < providerChoices.length) {
      const providerName = providerChoices[pIdx] as 'anthropic' | 'openai' | 'gemini' | 'mistral';
      const envKeyMap: Record<string, string> = {
        anthropic: 'ANTHROPIC_API_KEY',
        openai: 'OPENAI_API_KEY',
        gemini: 'GEMINI_API_KEY',
        mistral: 'MISTRAL_API_KEY',
      };
      const apiKey = await askHidden(`  ${T.aura(Sym.key)} Paste ${providerName} API key: `);
      if (apiKey.trim()) {
        await saveKey(envKeyMap[providerName] as any, apiKey.trim());
        process.env[envKeyMap[providerName]] = apiKey.trim();
        console.log(`  ${T.aurora(Sym.check)} Key saved: ${T.dim(maskKey(apiKey.trim()))}`);
      } else {
        console.log(`  ${T.muted('Skipped. Use /apikey later to set your key.')}`);
      }
    }
  }

  // ── STEP 6: Model selection ─────────────────────────────────────────────────
  step(6, 6, 'Choose Model');

  const allModels = listModels();
  const filtered = providerType === 'cloud'
    ? allModels.filter(m => m.provider !== 'ollama')
    : allModels.filter(m => m.provider === 'ollama');

  console.log(`  ${T.muted('Available')} ${providerType === 'cloud' ? 'cloud' : 'local'} ${T.muted('models:')}`);
  console.log('');
  filtered.forEach((m, i) => {
    const provider = providerType === 'cloud'
      ? { anthropic: T.aura, openai: T.aurora, gemini: T.ice }[m.provider as string] || T.muted
      : T.solar;
    console.log(`  ${T.aura(String(i + 1).padStart(2))}  ${provider(m.provider.padEnd(12))} ${T.white(m.name.padEnd(16))} ${T.muted(m.model)}`);
  });
  console.log('');

  let selectedModel = filtered[0];
  while (true) {
    const choice = await ask(`  ${T.aura(Sym.arrow)} Choose model (1–${filtered.length}): `);
    const idx = parseInt(choice) - 1;
    if (idx >= 0 && idx < filtered.length) { selectedModel = filtered[idx]; break; }
    console.log(`  ${T.nova('Invalid.')} Enter a number between 1 and ${filtered.length}.`);
  }
  setModel(selectedModel.provider as ModelProvider, selectedModel.model);
  console.log(`  ${T.aurora(Sym.check)} Model set to ${T.ice(selectedModel.provider)} ${T.white(selectedModel.model)}`);

  // ── Save profile ─────────────────────────────────────────────────────────────
  const profile: UserProfile = {
    name,
    email,
    role,
    purpose: `${role} using Aura OS`,
    createdAt: new Date().toISOString(),
    preferences: {
      defaultModel: selectedModel.model,
      theme: 'dark',
      agentsAutoStart: [],
      emailConfigured: false,
    },
  };
  await saveProfile(profile);

  // ── Launch ────────────────────────────────────────────────────────────────────
  console.log('');
  console.log(boxLine('ALL SET', 'aurora'));
  console.log('');
  console.log(`  ${T.aurora(Sym.check)}  Name    ${T.white(name)}`);
  console.log(`  ${T.aurora(Sym.check)}  Email   ${T.white(email || '(none)')}`);
  console.log(`  ${T.aurora(Sym.check)}  Role    ${T.ice(role)}`);
  console.log(`  ${T.aurora(Sym.check)}  PIN     ${T.muted('secured')}`);
  console.log(`  ${T.aurora(Sym.check)}  Model   ${T.white(selectedModel.name)}`);
  console.log('');

  const spin = new Typing('Starting Aura OS...').start();
  await sleep(1200);
  spin.stop();

  return profile;
}
